use std::collections::hash_map::{Entry, HashMap};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration};

use bytes::Bytes;
use futures::prelude::*;
use futures::pin_mut;
use quick_error::quick_error;
use tokio::sync::{mpsc, oneshot};

use crate::app_messages;
use crate::app_messages::Route as RouteInput;
use crate::cancel_token::{CancelToken, Canceler};
use crate::rally_point::{PlayerId, RallyPoint, RallyPointError, RouteId};
use crate::snp::{self, SnpMessage};

pub struct NetworkManager {
    send_messages: mpsc::Sender<NetworkManagerMessage>,
}

pub enum NetworkManagerMessage {
    Snp(SnpMessage),
    Routes(Vec<RouteInput>),
    WaitNetworkReady(oneshot::Sender<Result<()>>),
    RoutesReady(Result<Vec<Arc<Route>>>),
    PingResult((String, u16), Result<RallyPointServer>),
    StartKeepAlive(Arc<Route>),
    SetGameInfo(Arc<app_messages::GameSetupInfo>),
}

quick_error! {
    #[derive(Debug, Clone)]
    pub enum NetworkError {
        NotActive {
            description("Network task is not active")
        }
        NoServerAddress {
            description("Server info has no address")
        }
        ServerUnreachable {
            description("Server is not reachable")
        }
        RallyPoint(e: Arc<RallyPointError>) {
            description("Rally-point error")
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
    lobby_player_id: String,
}

enum NetworkState {
    Incomplete(IncompleteNetwork),
    Ready(ReadyNetwork),
    Error(NetworkError),
}

struct ReadyNetwork {
    ip_to_routes: HashMap<Ipv4Addr, Arc<Route>>,
}

#[derive(Default)]
struct IncompleteNetwork {
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
}

#[derive(Default)]
struct PingState {
    results: HashMap<(String, u16), Result<RallyPointServer>>,
    pings_in_progress: HashMap<(String, u16), Ping>,
}

struct Ping {
    retry_count: u8,
    waiters: Vec<oneshot::Sender<Result<RallyPointServer>>>,
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
    fn join_routes(
        &mut self,
        setup: Vec<RouteInput>,
    ) -> impl Future<Output = Result<Vec<Arc<Route>>>> {
        let futures = setup
            .into_iter()
            .map(|route| {
                let route = Arc::new(route);
                let route1 = route.clone();
                let mut send_messages = self.send_messages.clone();
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
                        "Picked server {:?} for route {:?} ({})",
                        server, route_id, route1.route_id,
                    );
                    rally_point
                        .join_route(server.address, route_id, player_id, timeout).await
                        .map_err(|e| NetworkError::RallyPoint(Arc::new(e)))?;

                    debug!(
                        "Connected to {} for id {} [{:?}]",
                        route1.server.desc, route1.for_player, route_id,
                    );
                    let route = Arc::new(Route {
                        route_id: route_id,
                        player_id: player_id,
                        lobby_player_id: route1.for_player.clone(),
                        address: server.address,
                    });
                    rally_point
                        .wait_route_ready(&route.route_id, &route.address).await
                        .map_err(|e| NetworkError::RallyPoint(Arc::new(e)))?;
                    send_messages
                        .send(NetworkManagerMessage::StartKeepAlive(route.clone())).await
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
            (&Some(ref a), _) => (a.clone(), input.port),
            (_, &Some(ref a)) => (a.clone(), input.port),
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
                    let mut sender = send_messages.clone();
                    let (cancel_token, canceler) = CancelToken::new();
                    let ping = ping_server(rally_point, input);
                    let cancelable = async move {
                        let result = ping.await;
                        let task = async move {
                            sender.send(NetworkManagerMessage::PingResult(key, result)).await
                        };
                        pin_mut!(task);
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
                .and_then(|x| future::ready(x))
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
                let mut sender = self.send_messages.clone();
                let ping_result = ping_server(&self.rally_point, &ping.input);
                let (cancel_token, canceler) = CancelToken::new();
                let cancelable = async move {
                    let result = ping_result.await;
                    let task = async move {
                        sender.send(NetworkManagerMessage::PingResult(key, result)).await
                    };
                    pin_mut!(task);
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
                let future = self.join_routes(setup);
                let mut send = self.send_messages.clone();
                let (cancel_token, canceler) = CancelToken::new();
                let cancelable = async move {
                    let task = async move {
                        let result = future.await;
                        let _ = send.send(NetworkManagerMessage::RoutesReady(result)).await;
                    };
                    pin_mut!(task);
                    let _ = cancel_token.bind(task).await;
                };
                self.cancel_child_tasks.push(canceler);
                tokio::spawn(cancelable);
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
                SnpMessage::Destroy => {
                    debug!("Snp destroy");
                    self.network = NetworkState::Incomplete(Default::default());
                    self.cancel_child_tasks.clear();
                }
                SnpMessage::Send(targets, data) => {
                    if let NetworkState::Ready(ref network) = self.network {
                        let data: Bytes = data.into();
                        let sends = targets
                            .iter()
                            .filter_map(|addr| network.ip_to_routes.get(&addr))
                            .map(|route| {
                                self.rally_point.forward(
                                    &route.route_id,
                                    route.player_id,
                                    data.clone(),
                                    &route.address,
                                )
                            })
                            .collect::<Vec<_>>();
                        let task = future::try_join_all(sends)
                            .map_err(|e| error!("Send error {}", e))
                            .map(|_| ());
                        let (cancel_token, canceler) = CancelToken::new();
                        self.cancel_child_tasks.push(canceler);
                        tokio::spawn(cancel_token.bind(task));
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
                    let task = async move {
                        let mut interval = tokio::time::interval(Duration::from_millis(500));
                        while let Some(_) = interval.next().await {
                            let result = rally_point
                                .keep_alive(&route.route_id, route.player_id, &route.address)
                                .await;
                            if result.is_err() {
                                break;
                            }
                        }
                    };
                    pin_mut!(task);
                    let _ = cancel_token.bind(task).await;
                };
                self.keep_routes_alive.push(canceler);
                tokio::spawn(cancelable);
                // TODO when should this stop?
                // Doesn't hurt to keep them active but old code stopped them once storm
                // became active.
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
        let ip_to_routes = host
            .into_iter()
            .chain(rest)
            .enumerate()
            .filter_map(|(i, player)| {
                match routes.iter().find(|x| x.lobby_player_id == player.id) {
                    Some(route) => Some((Ipv4Addr::new(10, 27, 27, i as u8), route.clone())),
                    None => {
                        // There won't be a route for current player
                        None
                    }
                }
            })
            .collect::<HashMap<_, _>>();
        // Create the task which receives packets and forwards them to Storm
        let streams_done = ip_to_routes
            .iter()
            .map(|(&ip, route)| {
                let snp_send = snp_send_messages.clone();
                let stream = self
                    .rally_point
                    .listen_route_data(&route.route_id, &route.address)
                    .try_for_each(move |message| {
                        let message = snp::ReceivedMessage {
                            from: ip,
                            data: message,
                        };
                        snp_send.send(message);
                        future::ok(())
                    })
                    .map_err(move |e| {
                        // I don't think there's much sense to kill network for this
                        // error, should never happen and if it does then try to keep going.
                        error!("Rally-point receive stream error for ip {:?}: {}", ip, e);
                    });
                stream
            })
            .collect::<Vec<_>>();
        let recv_task = future::join_all(streams_done).map(|_| ());

        let (cancel_token, canceler) = CancelToken::new();
        self.cancel_child_tasks.push(canceler);
        tokio::spawn(cancel_token.bind(recv_task));

        let ready = ReadyNetwork { ip_to_routes };
        self.network = NetworkState::Ready(ready);
        for waiting in self.waiting_for_network.drain(..) {
            let _ = waiting.send(Ok(()));
        }
    }
}

// Select ip4/6 address based on which finishses the ping faster
fn ping_server(
    rally_point: &RallyPoint,
    input: &app_messages::RallyPointServer,
) -> impl Future<Output = Result<RallyPointServer>> {
    fn ping_server_string(
        rally_point: &RallyPoint,
        input: &Option<String>,
        port: u16,
    ) -> impl Future<Output = Result<RallyPointServer>> {
        match input {
            Some(s) => match s.parse::<IpAddr>() {
                Ok(ip) => {
                    let addr = SocketAddr::new(ip, port);
                    let future = rally_point
                        .ping_server(addr)
                        .map_ok(move |ping| RallyPointServer {
                            address: addr,
                            ping,
                        })
                        .map_err(|e| {
                            error!("Rally error {}", e);
                            NetworkError::ServerUnreachable
                        });
                    future.boxed()
                }
                Err(_) => future::err(NetworkError::NoServerAddress).boxed(),
            },
            None => future::err(NetworkError::NoServerAddress).boxed(),
        }
    }

    let future4 = ping_server_string(rally_point, &input.address4, input.port);
    let future6 = ping_server_string(rally_point, &input.address6, input.port);
    future::select_ok(vec![future4, future6]).map_ok(|x| x.0)
}

impl NetworkManager {
    pub fn new() -> NetworkManager {
        let (send_messages, receive_messages) = mpsc::channel(64);
        let (internal_send_messages, internal_receive_messages) = mpsc::channel(16);
        let mut state = State {
            network: NetworkState::Incomplete(Default::default()),
            waiting_for_network: Vec::new(),
            send_messages: internal_send_messages,
            rally_point: crate::rally_point::init(),
            cancel_child_tasks: Vec::new(),
            keep_routes_alive: Vec::new(),
            pings: PingState::default(),
        };
        let task = stream::select(
                receive_messages.map(Ok)
                    .chain(future::err(()).into_stream()),
                internal_receive_messages.map(Ok),
            )
            .try_for_each(move |message| {
                state.handle_message(message);
                future::ok(())
            })
            .map(|_| {
                debug!("Route manager task ended");
            });
        tokio::spawn(task);
        NetworkManager { send_messages }
    }

    /// The main async future of NetworkManager.
    ///
    /// Finishes once routes have been resolved, and SNP is ready to use - after that
    /// calling BW functions that use network is fine, messages sent here will be forwarded
    /// through rally-point, and received messages will be pushed to snp's queue + handle
    /// signaled automatically.
    pub fn wait_network_ready(&self) -> impl Future<Output = Result<()>> {
        let (send, recv) = oneshot::channel();
        let mut sender = self.send_messages.clone();
        async move {
            sender.send(NetworkManagerMessage::WaitNetworkReady(send)).await
                .map_err(|_| NetworkError::NotActive)?;
            let result = recv.await
                .map_err(|_| NetworkError::NotActive)?;
            result
        }
    }

    pub fn set_routes(
        &self,
        routes: Vec<RouteInput>,
    ) -> impl Future<Output = Result<()>> {
        let mut send = self.send_messages.clone();
        async move {
            send.send(NetworkManagerMessage::Routes(routes)).await
                .map_err(|_| NetworkError::NotActive)
        }
    }

    pub fn send_snp_message(&self, message: SnpMessage) -> impl Future<Output = Result<()>> {
        let mut send = self.send_messages.clone();
        async move {
            send.send(NetworkManagerMessage::Snp(message)).await
                .map_err(|_| NetworkError::NotActive)
        }
    }

    pub fn set_game_info(
        &self,
        info: Arc<app_messages::GameSetupInfo>,
    ) -> impl Future<Output = Result<()>> {
        let mut send = self.send_messages.clone();
        async move {
            send.send(NetworkManagerMessage::SetGameInfo(info)).await
                .map_err(|_| NetworkError::NotActive)
        }
    }
}
