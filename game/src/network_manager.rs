use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::pin::pin;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use bytes::{Bytes, BytesMut};
use futures::prelude::*;
use hashbrown::hash_map::Entry;
use hashbrown::HashMap;
use parking_lot::Mutex;
use prost::Message;
use quick_error::quick_error;
use tokio::select;
use tokio::sync::{mpsc, oneshot};

use crate::app_messages;
use crate::app_messages::{LobbyPlayerId, Route as RouteInput};
use crate::cancel_token::{CancelToken, Canceler};
use crate::netcode::ack_manager::{self, AckManager};
use crate::netcode::storm::{get_resend_info, get_storm_id, ResendType};
use crate::proto::messages::game_message_payload::Payload;
use crate::proto::messages::{GameMessage, StormWrapper};
use crate::rally_point::{PlayerId, RallyPoint, RallyPointError, RouteId};
use crate::snp::{self, SendMessages, SnpMessage};

#[derive(Clone)]
pub struct NetworkManager {
    send_messages: mpsc::Sender<NetworkManagerMessage>,
}

pub enum NetworkManagerMessage {
    Snp(SnpMessage),
    Routes(Vec<RouteInput>),
    InitRoutesWhenReady(),
    WaitNetworkReady(oneshot::Sender<Result<()>>),
    RoutesReady(Result<Vec<Arc<Route>>>),
    PingResult((String, u16), Result<RallyPointServer>),
    StartKeepAlive(Arc<Route>),
    SetGameInfo(Arc<app_messages::GameSetupInfo>),
    ReceivePacket(Ipv4Addr, Bytes, SendMessages),
    GameState(GameStateToNetworkMessage),
    RequestDebugInfo(Arc<OnceLock<DebugInfo>>),
}

pub enum GameStateToNetworkMessage {
    SendPayload(LobbyPlayerId, Option<Payload>),
    /// Run packets through the queue for a short duration to try and get acks for all the payloads
    /// in flight. This should be used at the completion of a game to ensure any final payloads get
    /// delivered.
    DeliverPayloadsInFlight(LobbyPlayerId, oneshot::Sender<Result<()>>),
}

pub enum NetworkToGameStateMessage {
    ReceivePayload(LobbyPlayerId, Payload),
}

quick_error! {
    #[derive(Debug, Clone)]
    pub enum NetworkError {
        NotActive {
            display("Network task is not active")
        }
        NoServerAddress {
            display("Server info has no address")
        }
        ServerUnreachable {
            display("Server is not reachable")
        }
        RallyPoint(e: Arc<RallyPointError>) {
            display("Rally-point error {}", e)
        }
    }
}

type Result<T> = std::result::Result<T, NetworkError>;

#[derive(Debug)]
pub struct Route {
    route_id: RouteId,
    player_id: PlayerId,
    address: SocketAddr,
    // Links routes to PlayerInfo
    lobby_player_id: LobbyPlayerId,
}

enum NetworkState {
    Incomplete(IncompleteNetwork),
    Ready(ReadyNetwork),
    Error(NetworkError),
}

#[derive(Clone)]
struct RouteState {
    route: Arc<Route>,
    ack_manager: Arc<Mutex<AckManager>>,
}

struct ReadyNetwork {
    ip_to_routes: HashMap<Ipv4Addr, RouteState>,
    lobby_id_to_routes: HashMap<LobbyPlayerId, RouteState>,
}

#[derive(Default)]
struct IncompleteNetwork {
    ready_to_init: bool,
    setup: Option<Vec<RouteInput>>,
    routes: Option<Vec<Arc<Route>>>,
    game_info: Option<Arc<app_messages::GameSetupInfo>>,
    // This existing means that storm side is active
    snp_send_messages: Option<snp::SendMessages>,
}

struct State {
    network: NetworkState,
    pings: PingState,
    rally_point: RallyPoint,
    waiting_for_network: Vec<oneshot::Sender<Result<()>>>,
    cancel_child_tasks: Vec<Canceler>,
    keep_routes_alive: Vec<Canceler>,
    send_messages: mpsc::Sender<NetworkManagerMessage>,
    game_state_send: mpsc::Sender<NetworkToGameStateMessage>,
    /// Maps a storm ID (from the Storm packet header) to a last seen time.
    last_seen_packet_time: HashMap<u8, Instant>,
    /// Maps an IP address to a player ID (from the Storm packet header).
    ip_to_storm_id: HashMap<Ipv4Addr, u8>,
    last_sent_snp_packet_time: Instant,
}

#[derive(Default)]
struct PingState {
    results: HashMap<(String, u16), Result<RallyPointServer>>,
    pings_in_progress: HashMap<(String, u16), Ping>,
}

struct Ping {
    retry_count: u8,
    waiters: Vec<oneshot::Sender<Result<RallyPointServer>>>,
    #[allow(dead_code)]
    canceler: Canceler,
    input: app_messages::RallyPointServer,
}

#[derive(Debug, Clone)]
pub struct RallyPointServer {
    address: SocketAddr,
    ping: Duration,
}

impl NetworkState {
    fn ready_or_error(&self) -> Option<Result<()>> {
        match self {
            NetworkState::Incomplete(_) => None,
            NetworkState::Ready(_) => Some(Ok(())),
            NetworkState::Error(e) => Some(Err(e.clone())),
        }
    }

    fn set_error(&mut self, error: NetworkError) {
        match self {
            NetworkState::Incomplete(_) | NetworkState::Ready(_) => {
                *self = NetworkState::Error(error);
            }
            NetworkState::Error(_) => (),
        }
    }
}

impl State {
    fn maybe_init_routes(&mut self) {
        let mut setup = None;
        if let NetworkState::Incomplete(ref mut incomplete) = self.network {
            if incomplete.ready_to_init && incomplete.setup.is_some() {
                setup = incomplete.setup.take();
            }
        }

        if let Some(setup) = setup {
            let future = self.join_routes(setup);
            let send = self.send_messages.clone();
            let (cancel_token, canceler) = CancelToken::new();
            let cancelable = async move {
                let task = pin!(async move {
                    let result = future.await;
                    let _ = send.send(NetworkManagerMessage::RoutesReady(result)).await;
                });
                let _ = cancel_token.bind(task).await;
            };
            self.cancel_child_tasks.push(canceler);
            tokio::spawn(cancelable);
        }
    }

    fn join_routes(
        &mut self,
        setup: Vec<RouteInput>,
    ) -> impl Future<Output = Result<Vec<Arc<Route>>>> {
        let futures = setup
            .into_iter()
            .map(|route| {
                let route = Arc::new(route);
                let route1 = route.clone();
                let send_messages = self.send_messages.clone();
                let rally_point = self.rally_point.clone();
                let server_future = self.pick_server(&route.server);
                async move {
                    let server = server_future.await?;
                    let route_id = RouteId::from_string(&route1.route_id);
                    let player_id = PlayerId::from_u32(route1.player_id);
                    let timeout = Duration::from_millis(5000);
                    // Route id logged twice since we move from string to u64 here,
                    // have one line where they both are shown to connect them in case.
                    debug!(
                        "Picked server {:?} for route {:?} ({}) [{}ms]",
                        server,
                        route_id,
                        route1.route_id,
                        server.ping.as_millis(),
                    );
                    rally_point
                        .join_route(server.address, route_id, player_id, timeout)
                        .await
                        .map_err(|e| NetworkError::RallyPoint(Arc::new(e)))?;

                    debug!(
                        "Connected to {} for id {:?} [{:?}]",
                        route1.server.description, route1.for_player, route_id,
                    );
                    let route = Arc::new(Route {
                        route_id,
                        player_id,
                        lobby_player_id: route1.for_player.clone(),
                        address: server.address,
                    });
                    rally_point
                        .wait_route_ready(&route.route_id, &route.address)
                        .await
                        .map_err(|e| NetworkError::RallyPoint(Arc::new(e)))?;
                    send_messages
                        .send(NetworkManagerMessage::StartKeepAlive(route.clone()))
                        .await
                        .map_err(|_| NetworkError::NotActive)?;
                    debug!("Route [{:?}] is ready", route.route_id);
                    Ok(route)
                }
            })
            .collect::<Vec<_>>();
        future::try_join_all(futures)
    }

    fn pick_server(
        &mut self,
        input: &app_messages::RallyPointServer,
    ) -> impl Future<Output = Result<RallyPointServer>> {
        let key = match (&input.address6, &input.address4) {
            (Some(a), _) => (a.clone(), input.port),
            (_, Some(a)) => (a.clone(), input.port),
            (&None, &None) => return future::err(NetworkError::NoServerAddress).boxed(),
        };
        if let Some(server) = self.pings.results.get(&key) {
            future::ready(server.clone()).boxed()
        } else {
            let (send, recv) = oneshot::channel();
            let entry = self.pings.pings_in_progress.entry(key.clone());
            let send_messages = &self.send_messages;
            let rally_point = &self.rally_point;
            entry
                .or_insert_with(|| {
                    let sender = send_messages.clone();
                    let (cancel_token, canceler) = CancelToken::new();
                    let ping = ping_server(rally_point, input);
                    let cancelable = async move {
                        let result = ping.await;
                        let task = pin!(async move {
                            sender
                                .send(NetworkManagerMessage::PingResult(key, result))
                                .await
                        });
                        let _ = cancel_token.bind(task).await;
                    };
                    tokio::spawn(cancelable);
                    Ping {
                        retry_count: 3,
                        waiters: Vec::new(),
                        canceler,
                        input: input.clone(),
                    }
                })
                .waiters
                .push(send);
            recv.map_err(|_| NetworkError::NotActive)
                .and_then(future::ready)
                .boxed()
        }
    }

    fn handle_ping_result(&mut self, key: (String, u16), result: Result<RallyPointServer>) {
        let entry = self.pings.pings_in_progress.entry(key.clone());
        if let Entry::Occupied(mut ping) = entry {
            if result.is_ok() || ping.get().retry_count == 0 {
                let (_, ping) = ping.remove_entry();
                for send in ping.waiters {
                    let _ = send.send(result.clone());
                }
                self.pings.results.insert(key, result);
            } else {
                let ping = ping.get_mut();
                ping.retry_count -= 1;
                let sender = self.send_messages.clone();
                let ping_result = ping_server(&self.rally_point, &ping.input);
                let (cancel_token, canceler) = CancelToken::new();
                let cancelable = async move {
                    let result = ping_result.await;
                    let task = pin!(async move {
                        sender
                            .send(NetworkManagerMessage::PingResult(key, result))
                            .await
                    });
                    let _ = cancel_token.bind(task).await;
                };
                ping.canceler = canceler;
                tokio::spawn(cancelable);
            }
        }
    }

    fn clean_child_tasks(&mut self) {
        self.cancel_child_tasks.retain(|x| !x.has_ended());
    }

    fn handle_message(&mut self, message: NetworkManagerMessage) {
        self.clean_child_tasks();
        match message {
            NetworkManagerMessage::Routes(setup) => {
                if let NetworkState::Incomplete(ref mut incomplete) = self.network {
                    incomplete.setup = Some(setup);
                    debug!("NetworkManager setup received");
                }
                self.maybe_init_routes();
            }
            NetworkManagerMessage::InitRoutesWhenReady() => {
                if let NetworkState::Incomplete(ref mut incomplete) = self.network {
                    incomplete.ready_to_init = true;
                    debug!("NetworkManager okay to init routes once setup is received");
                }
                self.maybe_init_routes();
            }
            NetworkManagerMessage::PingResult(key, result) => {
                self.handle_ping_result(key, result);
            }
            NetworkManagerMessage::RoutesReady(result) => {
                match result {
                    Ok(routes) => {
                        if let NetworkState::Incomplete(ref mut incomplete) = self.network {
                            incomplete.routes = Some(routes);
                        }
                    }
                    Err(e) => self.network.set_error(e),
                }
                self.check_network_ready();
            }
            NetworkManagerMessage::WaitNetworkReady(done) => {
                if let Some(result) = self.network.ready_or_error() {
                    let _ = done.send(result);
                } else {
                    self.waiting_for_network.push(done);
                }
            }
            NetworkManagerMessage::Snp(message) => match message {
                SnpMessage::CreateNetworkHandler(send) => {
                    if let NetworkState::Incomplete(ref mut incomplete) = self.network {
                        incomplete.snp_send_messages = Some(send);
                    }
                    self.check_network_ready();
                }
                SnpMessage::Send(target, data) => {
                    if let NetworkState::Ready(ref network) = self.network {
                        match get_resend_info(&data) {
                            Some(ResendType::Request(None)) => {
                                // NOTE(tec27): We drop all Storm resend requests to the same user
                                // who original sent them, because they add nothing to our existing
                                // protocol. Our protocol now resends payloads until they're acked,
                                // so any missing payloads from this user will already be in flight.
                                return;
                            }
                            Some(ResendType::Request(Some(ref resend_target))) => {
                                if let Some(last_seen) =
                                    self.last_seen_packet_time.get(resend_target)
                                {
                                    if last_seen.elapsed() < Duration::from_millis(500) {
                                        // If we've seen a packet from this player recently, then
                                        // just ignore this request and assume Storm will get what
                                        // it needs through normal protocol means.
                                        return;
                                    }
                                }
                            }
                            // NOTE(tec27): We allow all resend responses through because those are
                            // *only* for other users' packets, resends of our own packets are sent
                            // as normal (non-resend) packets.
                            _ => {}
                        };

                        self.last_sent_snp_packet_time = Instant::now();
                        let payload = Some(Payload::Storm(StormWrapper {
                            storm_data: data.into(),
                        }));

                        if let Some(route_state) = network.ip_to_routes.get(&target) {
                            let game_message = {
                                let mut ack_manager = route_state.ack_manager.lock();
                                ack_manager.build_outgoing(payload)
                            };

                            let mut packet = BytesMut::with_capacity(game_message.encoded_len());
                            game_message.encode(&mut packet).unwrap();
                            let packet = packet.freeze();

                            let route = &route_state.route;
                            let route_id = route.route_id;
                            let player_id = route.player_id;
                            let address = route.address;
                            let rally_point = self.rally_point.clone();

                            let (cancel_token, canceler) = CancelToken::new();
                            self.cancel_child_tasks.push(canceler);
                            tokio::spawn(async move {
                                let send =
                                    rally_point.forward(&route_id, player_id, packet, &address);
                                let task =
                                    pin!(send.map_err(|e| error!("Send error {}", e)).map(|_| ()));
                                let _ = cancel_token.bind(task).await;
                            });
                        } else {
                            error!("Tried to send packet without a route: {}", target);
                        }
                    } else {
                        warn!("Storm tried to send data without ready network");
                    }
                }
            },
            NetworkManagerMessage::SetGameInfo(info) => {
                if let NetworkState::Incomplete(ref mut incomplete) = self.network {
                    incomplete.game_info = Some(info);
                }
                self.check_network_ready();
            }
            NetworkManagerMessage::StartKeepAlive(route) => {
                let rally_point = self.rally_point.clone();
                let (cancel_token, canceler) = CancelToken::new();
                let cancelable = async move {
                    let task = pin!(async move {
                        let mut interval = tokio::time::interval(Duration::from_millis(500));
                        loop {
                            interval.tick().await;
                            let result = rally_point
                                .keep_alive(&route.route_id, route.player_id, &route.address)
                                .await;
                            if result.is_err() {
                                break;
                            }
                        }
                    });
                    let _ = cancel_token.bind(task).await;
                };
                self.keep_routes_alive.push(canceler);
                tokio::spawn(cancelable);
                // TODO when should this stop?
                // Doesn't hurt to keep them active but old code stopped them once storm
                // became active.
            }
            NetworkManagerMessage::ReceivePacket(ip, mut packet, snp_send) => {
                if let NetworkState::Ready(ref network) = self.network {
                    if let Some(route_state) = network.ip_to_routes.get(&ip) {
                        if let Ok(game_message) = GameMessage::decode(&mut packet) {
                            // CLion is bad at figuring out this type :(
                            let game_message = game_message as GameMessage;

                            {
                                let mut ack_manager = route_state.ack_manager.lock();
                                ack_manager.handle_incoming(&game_message);
                            }

                            let mut need_id = if let Some(storm_id) = self.ip_to_storm_id.get(&ip) {
                                self.last_seen_packet_time.insert(*storm_id, Instant::now());
                                false
                            } else {
                                true
                            };

                            for payload in game_message.payloads.into_iter() {
                                match payload.payload {
                                    Some(Payload::Storm(s)) => {
                                        if need_id {
                                            if let Some(from_id) =
                                                get_storm_id(s.storm_data.as_ref())
                                            {
                                                if from_id != 255
                                                    && get_resend_info(s.storm_data.as_ref())
                                                        .is_none()
                                                {
                                                    self.ip_to_storm_id
                                                        .entry(ip)
                                                        .or_insert(from_id);
                                                    need_id = false;
                                                    debug!(
                                                        "{:?} found to have Storm ID: {}",
                                                        ip, from_id
                                                    );
                                                }
                                            }
                                        }

                                        let message = snp::ReceivedMessage {
                                            from: ip,
                                            data: s.storm_data.clone(),
                                        };
                                        snp_send.send(message)
                                    }
                                    Some(payload) => {
                                        let message = NetworkToGameStateMessage::ReceivePayload(
                                            route_state.route.lobby_player_id.clone(),
                                            payload,
                                        );

                                        let game_state_send = self.game_state_send.clone();
                                        let (cancel_token, canceler) = CancelToken::new();
                                        self.cancel_child_tasks.push(canceler);

                                        let cancelable = async move {
                                            let task = pin!(async move {
                                                game_state_send
                                                    .send(message)
                                                    .map_err(|e| error!("Send error {}", e))
                                                    .map(|_| ())
                                                    .await
                                            });
                                            let _ = cancel_token.bind(task).await;
                                        };
                                        tokio::spawn(cancelable);
                                    }
                                    _ => {}
                                }
                            }
                        } else {
                            error!("Received a badly formed packet from {}", ip);
                        }
                    } else {
                        error!("Received a packet without an associated route: {}", ip)
                    }
                } else {
                    error!("Received a packet before network was ready");
                }
            }
            NetworkManagerMessage::GameState(message) => match message {
                GameStateToNetworkMessage::SendPayload(target, payload) => {
                    if let NetworkState::Ready(ref network) = self.network {
                        if let Some(route_state) = network.lobby_id_to_routes.get(&target) {
                            let game_message = {
                                let mut ack_manager = route_state.ack_manager.lock();
                                ack_manager.build_outgoing(payload)
                            };

                            let mut packet = BytesMut::with_capacity(game_message.encoded_len());
                            game_message.encode(&mut packet).unwrap();
                            let packet = packet.freeze();

                            let route = &route_state.route;
                            let route_id = route.route_id;
                            let player_id = route.player_id;
                            let address = route.address;
                            let rally_point = self.rally_point.clone();

                            let (cancel_token, canceler) = CancelToken::new();
                            self.cancel_child_tasks.push(canceler);
                            tokio::spawn(async move {
                                let send =
                                    rally_point.forward(&route_id, player_id, packet, &address);
                                let task =
                                    pin!(send.map_err(|e| error!("Send error {}", e)).map(|_| ()));
                                let _ = cancel_token.bind(task).await;
                            });
                        } else {
                            error!("Tried to send packet without a route: {:?}", target);
                        }
                    } else {
                        warn!("Game state tried to send a payload before network was ready");
                    }
                }
                GameStateToNetworkMessage::DeliverPayloadsInFlight(target, on_complete) => {
                    if let NetworkState::Ready(ref network) = self.network {
                        if let Some(route_state) = network.lobby_id_to_routes.get(&target) {
                            let (cancel_token, canceler) = CancelToken::new();
                            self.cancel_child_tasks.push(canceler);
                            let rally_point = self.rally_point.clone();
                            let ack_manager = route_state.ack_manager.clone();
                            let route = route_state.route.clone();

                            let cancelable = async move {
                                let task = pin!(async move {
                                    let mut attempts = 0;

                                    loop {
                                        let game_message = {
                                            let mut ack_manager = ack_manager.lock();
                                            if ack_manager.payloads_in_flight() == 0 {
                                                break;
                                            }
                                            ack_manager.build_outgoing(None)
                                        };

                                        let mut packet =
                                            BytesMut::with_capacity(game_message.encoded_len());
                                        game_message.encode(&mut packet).unwrap();
                                        let packet = packet.freeze();

                                        let _ = rally_point
                                            .forward(
                                                &route.route_id,
                                                route.player_id,
                                                packet.clone(),
                                                &route.address,
                                            )
                                            .await
                                            .map_err(|e| error!("Send error {}", e));

                                        attempts += 1;
                                        if attempts < 50 {
                                            tokio::time::sleep(Duration::from_millis(42)).await;
                                        } else {
                                            break;
                                        }
                                    }

                                    let _ = on_complete.send(Ok(()));
                                });
                                let _ = cancel_token.bind(task).await;
                            };

                            tokio::spawn(cancelable);
                        } else {
                            error!("Tried to send packet without a route: {:?}", target);
                        }
                    } else {
                        warn!("Game state tried to send a payload before network was ready");
                    }
                }
            },
            NetworkManagerMessage::RequestDebugInfo(out) => {
                let routes;
                if let NetworkState::Ready(ref network) = self.network {
                    routes = network
                        .ip_to_routes
                        .iter()
                        .map(|(ip, route)| {
                            let storm_id = self.ip_to_storm_id.get(ip).copied();
                            let last_seen_packet_time = storm_id
                                .and_then(|x| Some(self.last_seen_packet_time.get(&x)?.elapsed()));
                            DebugRoute {
                                lobby_player_id: route.route.lobby_player_id.clone(),
                                address: route.route.address,
                                ack_manager: route.ack_manager.lock().debug_info(),
                                storm_id: storm_id.unwrap_or(u8::MAX),
                                last_seen_packet_time,
                            }
                        })
                        .collect();
                } else {
                    routes = Vec::new();
                }
                let result = out.set(DebugInfo {
                    routes,
                    last_sent_snp_packet_time: self.last_sent_snp_packet_time.elapsed(),
                });
                if result.is_err() {
                    error!("Requested debug info output was already used");
                }
            }
        }
    }

    // If we have all parts needed to init network, do all of the remaining work
    fn check_network_ready(&mut self) {
        let game_info;
        let routes;
        let snp_send_messages;
        match self.network {
            NetworkState::Incomplete(ref mut i) => {
                if i.game_info.is_some() && i.routes.is_some() && i.snp_send_messages.is_some() {
                    game_info = i.game_info.take().unwrap();
                    routes = i.routes.take().unwrap();
                    snp_send_messages = i.snp_send_messages.take().unwrap();
                } else {
                    return;
                }
            }
            NetworkState::Ready(_) => return,
            NetworkState::Error(ref e) => {
                for send in self.waiting_for_network.drain(..) {
                    let _ = send.send(Err(e.clone()));
                }
                return;
            }
        }
        // Build an object mapping Fake-IP => rally-point route, ordered consistently between all
        // players (host first, then all other players ordered by slot). Computers are not
        // included, as we [obviously] won't be sending network traffic to them. This mapping
        // will be used by our SNP to shuttle packets back and forth from Storm while:
        // - Keeping consistent IPs/ports between all players of the game
        //   (even though they might differ due to NAT, LAN, etc.)
        // - Allowing us to easily get references to active rally-point routes
        let host = game_info.slots.iter().find(|x| x.id == game_info.host.id);
        let rest = game_info
            .slots
            .iter()
            .filter(|x| x.is_human() || x.is_observer())
            .filter(|x| x.id != game_info.host.id);
        let lobby_id_to_routes = host
            .into_iter()
            .chain(rest.clone())
            .enumerate()
            .filter_map(|(_, player)| {
                routes
                    .iter()
                    .find(|x| x.lobby_player_id == player.id)
                    .map(|route| {
                        (
                            player.id.clone(),
                            RouteState {
                                route: route.clone(),
                                ack_manager: Arc::new(Mutex::new(AckManager::new())),
                            },
                        )
                    })
            })
            .collect::<HashMap<_, _>>();
        let ip_to_routes = host
            .into_iter()
            .chain(rest)
            .enumerate()
            .filter_map(|(i, player)| {
                routes
                    .iter()
                    .find(|x| x.lobby_player_id == player.id)
                    .map(|route| {
                        (
                            Ipv4Addr::new(10, 27, 27, i as u8),
                            lobby_id_to_routes
                                .get(&route.lobby_player_id)
                                .unwrap()
                                .clone(),
                        )
                    })
            })
            .collect::<HashMap<_, _>>();

        // Create the task which receives packets and forwards them to Storm
        let streams_done = ip_to_routes
            .iter()
            .map(|(&ip, RouteState { ref route, .. })| {
                let snp_send = snp_send_messages.clone();
                let net_message_sender = self.send_messages.clone();
                let rally_point = self.rally_point.clone();
                let route_id = route.route_id;
                let address = route.address;
                async move {
                    let stream = rally_point
                        .listen_route_data(&route_id, &address);
                    let mut stream = pin!(stream);
                    while let Some(message) = stream.next().await {
                        match message {
                            Ok(message) => {
                                let result = net_message_sender
                                    .send(NetworkManagerMessage::ReceivePacket(
                                        ip,
                                        message,
                                        snp_send.clone(),
                                    ))
                                    .await;

                                if let Err(e) = result {
                                    error!(
                                        "Received error while trying to receive packet for ip {:?}: {}",
                                        ip, e,
                                    );
                                }
                            }
                            Err(e) => {
                                // I don't think there's much sense to kill network
                                // for this error, should never happen and if it does
                                // then try to keep going.
                                error!("Rally-point receive stream error for ip {:?}: {}", ip, e);
                            }
                        }
                    }
                }
            })
            .collect::<Vec<_>>();
        let recv_task = future::join_all(streams_done).map(|_| ());

        let (cancel_token, canceler) = CancelToken::new();
        self.cancel_child_tasks.push(canceler);
        tokio::spawn(cancel_token.bind(recv_task));

        let ready = ReadyNetwork {
            ip_to_routes,
            lobby_id_to_routes,
        };
        self.network = NetworkState::Ready(ready);
        for waiting in self.waiting_for_network.drain(..) {
            let _ = waiting.send(Ok(()));
        }
    }
}

/// Data that gets sent out of async thread to be rendered by egui thread.
pub struct DebugInfo {
    routes: Vec<DebugRoute>,
    /// How long ago was the last packet queued to be sent from this game.
    /// (This should be always small?
    /// If it is large then something is wrong with game performance?)
    last_sent_snp_packet_time: Duration,
}

struct DebugRoute {
    lobby_player_id: LobbyPlayerId,
    address: SocketAddr,
    storm_id: u8,
    ack_manager: ack_manager::DebugInfo,
    last_seen_packet_time: Option<Duration>,
}

/// State for UI drawing kept between frames
pub struct DebugState {
    /// Keep largest duration from last few seconds as
    /// the constantly updating time is hard to read.
    /// Not that the clear mechanism is that good
    route_max_times: Vec<(LobbyPlayerId, Duration)>,
    sent_snp_packet_max_time: Duration,
    last_clear: Instant,
}

impl DebugInfo {
    pub fn draw(&self, ui: &mut egui::Ui, state: &mut DebugState) {
        if state.last_clear.elapsed().as_millis() > 5000 {
            *state = DebugState::new();
        }
        for route in &self.routes {
            ui.label(format!(
                "{:x} {} {:?}",
                route.storm_id, route.address, route.lobby_player_id
            ));
            if let Some(time) = route.last_seen_packet_time {
                let index = match state
                    .route_max_times
                    .iter()
                    .position(|x| x.0 == route.lobby_player_id)
                {
                    Some(s) => s,
                    None => {
                        state
                            .route_max_times
                            .push((route.lobby_player_id.clone(), time));
                        state.route_max_times.len() - 1
                    }
                };
                let max = state.route_max_times[index].1.max(time);
                state.route_max_times[index].1 = max;
                ui.label(format!(
                    "Last packet {:03}ms ago, Max {:03}",
                    time.as_millis(),
                    max.as_millis()
                ));
            }
            route.ack_manager.draw(ui);
        }
        let max = state
            .sent_snp_packet_max_time
            .max(self.last_sent_snp_packet_time);
        state.sent_snp_packet_max_time = max;
        ui.label(format!(
            "Last sent SNP packet {:03}ms ago, Max {:03}",
            self.last_sent_snp_packet_time.as_millis(),
            max.as_millis()
        ));
    }
}

impl DebugState {
    pub fn new() -> DebugState {
        DebugState {
            route_max_times: Vec::new(),
            sent_snp_packet_max_time: Duration::from_millis(0),
            last_clear: Instant::now(),
        }
    }
}

// Select ip4/6 address based on which finishses the ping faster
fn ping_server(
    rally_point: &RallyPoint,
    input: &app_messages::RallyPointServer,
) -> impl Future<Output = Result<RallyPointServer>> {
    fn parse_address(input: &Option<String>) -> Option<IpAddr> {
        input.as_ref()?.parse::<IpAddr>().ok()
    }

    async fn ping_server_string(
        rally_point: &RallyPoint,
        ip: Option<IpAddr>,
        port: u16,
    ) -> Result<RallyPointServer> {
        match ip {
            Some(ip) => {
                let addr = SocketAddr::new(ip, port);
                rally_point
                    .ping_server(addr)
                    .map_ok(move |ping| RallyPointServer {
                        address: addr,
                        ping,
                    })
                    .map_err(|e| {
                        error!("Rally-point error {}", e);
                        NetworkError::ServerUnreachable
                    })
                    .await
            }
            None => Err(NetworkError::NoServerAddress),
        }
    }

    let rally_point = rally_point.clone();
    let address4 = parse_address(&input.address4);
    let address6 = parse_address(&input.address6);
    let port = input.port;
    async move {
        let future4 = pin!(ping_server_string(&rally_point, address4, port));
        let future6 = pin!(ping_server_string(&rally_point, address6, port));
        future::select_ok(vec![future4, future6])
            .map_ok(|x| x.0)
            .await
    }
}

impl NetworkManager {
    pub fn new(
        game_state_send: mpsc::Sender<NetworkToGameStateMessage>,
        mut game_state_recv: mpsc::Receiver<GameStateToNetworkMessage>,
    ) -> Self {
        let (send_messages, mut receive_messages) = mpsc::channel(64);
        let (internal_send_messages, mut internal_receive_messages) = mpsc::channel(16);
        let mut state = State {
            network: NetworkState::Incomplete(Default::default()),
            waiting_for_network: Vec::new(),
            send_messages: internal_send_messages,
            rally_point: crate::rally_point::init(),
            cancel_child_tasks: Vec::new(),
            keep_routes_alive: Vec::new(),
            pings: PingState::default(),
            game_state_send,
            last_seen_packet_time: HashMap::new(),
            ip_to_storm_id: HashMap::new(),
            last_sent_snp_packet_time: Instant::now(),
        };
        let task = async move {
            loop {
                let message = select! {
                    x = receive_messages.recv() => x,
                    x = internal_receive_messages.recv() => x,
                    x = game_state_recv.recv() => x.map(NetworkManagerMessage::GameState),
                };
                match message {
                    Some(m) => state.handle_message(m),
                    None => break,
                }
            }
            debug!("Route manager task ended");
        };
        tokio::spawn(task);
        Self { send_messages }
    }

    /// The main async future of NetworkManager.
    ///
    /// Finishes once routes have been resolved, and SNP is ready to use - after that
    /// calling BW functions that use network is fine, messages sent here will be forwarded
    /// through rally-point, and received messages will be pushed to snp's queue + handle
    /// signaled automatically.
    pub async fn wait_network_ready(&self) -> Result<()> {
        let (send, recv) = oneshot::channel();
        self.send_messages
            .send(NetworkManagerMessage::WaitNetworkReady(send))
            .map_err(|_| NetworkError::NotActive)
            .await?;
        recv.map_err(|_| NetworkError::NotActive).await?
    }

    /// Tells the NetworkManager it is okay to do route initialization once the setup has been
    /// received. This is used to block rally-point init from happening before the lobby has been
    /// created (which helps avoid the dreaded "mandatory 5 second timeout" that happens if a client
    /// tries to join before it's ready).
    pub async fn init_routes_when_ready(&self) -> Result<()> {
        self.send_messages
            .send(NetworkManagerMessage::InitRoutesWhenReady())
            .map_err(|_| NetworkError::NotActive)
            .await
    }

    pub async fn set_routes(&self, routes: Vec<RouteInput>) -> Result<()> {
        self.send_messages
            .send(NetworkManagerMessage::Routes(routes))
            .map_err(|_| NetworkError::NotActive)
            .await
    }

    pub async fn send_snp_message(&self, message: SnpMessage) -> Result<()> {
        self.send_messages
            .send(NetworkManagerMessage::Snp(message))
            .map_err(|_| NetworkError::NotActive)
            .await
    }

    pub async fn set_game_info(&self, info: Arc<app_messages::GameSetupInfo>) -> Result<()> {
        self.send_messages
            .send(NetworkManagerMessage::SetGameInfo(info))
            .map_err(|_| NetworkError::NotActive)
            .await
    }

    pub async fn request_debug_info(&self, out: Arc<OnceLock<DebugInfo>>) {
        let _ = self
            .send_messages
            .send(NetworkManagerMessage::RequestDebugInfo(out))
            .await;
    }
}
