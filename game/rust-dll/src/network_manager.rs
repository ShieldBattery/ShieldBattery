use std::collections::hash_map::{HashMap, Entry};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use futures::future::{self, Either};
use quick_error::quick_error;
use tokio::prelude::*;
use tokio::sync::{mpsc, oneshot};

use crate::cancel_token::{CancelToken, Canceler};
use crate::client_messages;
use crate::client_messages::Route as RouteInput;
use crate::rally_point::{RallyPoint, RallyPointError, RouteId, PlayerId};
use crate::snp::{self, SnpMessage};
use crate::{box_future};

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
    SetGameInfo(Arc<client_messages::GameSetupInfo>),
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
type BoxedFuture<T> = crate::BoxedFuture<T, NetworkError>;

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
    game_info: Option<Arc<client_messages::GameSetupInfo>>,
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
    input: client_messages::RallyPointServer,
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
    fn join_routes(&mut self, setup: Vec<RouteInput>) -> BoxedFuture<Vec<Arc<Route>>> {
        let futures = setup.into_iter()
            .map(|route| {
                let route = Arc::new(route);
                let route1 = route.clone();
                let send_messages = self.send_messages.clone();
                let rally_point = self.rally_point.clone();
                self.pick_server(&route.server)
                    .and_then(move |server| {
                        let route_id = RouteId::from_string(&route1.route_id);
                        let player_id = PlayerId::from_u32(route1.player_id);
                        let timeout = Duration::from_millis(5000);
                        // Route id logged twice since we move from string to u64 here,
                        // have one line where they both are shown to connect them in case.
                        debug!(
                            "Picked server {:?} for route {:?} ({})",
                            server, route_id, route1.route_id,
                        );
                        rally_point.join_route(server.address, route_id, player_id, timeout)
                            .map(move |()| {
                                debug!(
                                    "Connected to {} for id {} [{:?}]",
                                    route1.server.desc,
                                    route1.for_player,
                                    route_id,
                                );
                                let route = Route {
                                    route_id: route_id,
                                    player_id: player_id,
                                    lobby_player_id: route1.for_player.clone(),
                                    address: server.address,
                                };
                                (rally_point, route)
                            })
                            .map_err(|e| NetworkError::RallyPoint(Arc::new(e)))
                    })
                    .and_then(move |(rally_point, route)| {
                        let route = Arc::new(route);
                        let ready = rally_point.wait_route_ready(&route.route_id, &route.address)
                            .map_err(|e| NetworkError::RallyPoint(Arc::new(e)));
                        send_messages
                            .send(NetworkManagerMessage::StartKeepAlive(route.clone()))
                            .map_err(|_| NetworkError::NotActive)
                            .and_then(move |_| ready)
                            .map(|()| route)
                            .inspect(|route| debug!("Route [{:?}] is ready", route.route_id))
                    })
            }).collect::<Vec<_>>();
        box_future(future::join_all(futures))
    }

    fn pick_server(
        &mut self,
        input: &client_messages::RallyPointServer,
    ) -> BoxedFuture<RallyPointServer> {
        let key = match (&input.address6, &input.address4) {
            (&Some(ref a), _) => (a.clone(), input.port),
            (_, &Some(ref a)) => (a.clone(), input.port),
            (&None, &None) => return box_future(future::err(NetworkError::NoServerAddress)),
        };
        if let Some(server) = self.pings.results.get(&key) {
            box_future(future::result(server.clone()))
        } else {
            let (send, recv) = oneshot::channel();
            let entry = self.pings.pings_in_progress.entry(key.clone());
            let send_messages = &self.send_messages;
            let rally_point = &self.rally_point;
            entry.or_insert_with(|| {
                let sender = send_messages.clone();
                let ping_task = ping_server(rally_point, input)
                    .then(|result| {
                        sender.send(NetworkManagerMessage::PingResult(key, result))
                            .map(|_| ())
                            .map_err(|_| ())
                    });
                let (cancel_token, canceler) = CancelToken::new();
                tokio::spawn(cancel_token.bind(ping_task));
                Ping {
                    retry_count: 3,
                    waiters: Vec::new(),
                    canceler,
                    input: input.clone(),
                }
            }).waiters.push(send);
            box_future(recv.map_err(|_| NetworkError::NotActive).flatten())
        }
    }

    fn handle_ping_result(&mut self, key: (String, u16), result: Result<RallyPointServer>) {
        let entry = self.pings.pings_in_progress.entry(key.clone());
        if let Entry::Occupied(mut ping) = entry {
            if result.is_ok() || ping.get().retry_count == 0 {
                let (_, ping) = ping.remove_entry();
                for send in ping.waiters {
                    let _  = send.send(result.clone());
                }
                self.pings.results.insert(key, result);
            } else {
                let ping = ping.get_mut();
                ping.retry_count -= 1;
                let sender = self.send_messages.clone();
                let ping_task = ping_server(&self.rally_point, &ping.input)
                    .then(|result| {
                        sender.send(NetworkManagerMessage::PingResult(key, result))
                            .map(|_| ())
                            .map_err(|_| ())
                    });
                let (cancel_token, canceler) = CancelToken::new();
                ping.canceler = canceler;
                tokio::spawn(cancel_token.bind(ping_task));
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
                let send = self.send_messages.clone();
                let task = future.then(|result| {
                    send.send(NetworkManagerMessage::RoutesReady(result))
                        .map(|_| ())
                        .map_err(|_| ())
                });
                let (cancel_token, canceler) = CancelToken::new();
                self.cancel_child_tasks.push(canceler);
                tokio::spawn(cancel_token.bind(task));
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
                        let sends = targets.iter()
                            .filter_map(|addr| {
                                network.ip_to_routes.get(&addr)
                            })
                            .map(|route| {
                                self.rally_point.forward(
                                    &route.route_id,
                                    route.player_id,
                                    data.clone(),
                                    &route.address,
                                )
                            })
                            .collect::<Vec<_>>();
                        let task = future::join_all(sends)
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
                let task = tokio::timer::Interval::new(Instant::now(), Duration::from_millis(500))
                    .map_err(|_| ())
                    .for_each(move |_| {
                        rally_point.keep_alive(&route.route_id, route.player_id, &route.address)
                            .map_err(|_| ())
                    });
                let (cancel_token, canceler) = CancelToken::new();
                self.keep_routes_alive.push(canceler);
                tokio::spawn(cancel_token.bind(task));
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
        let rest = game_info.slots.iter()
            .filter(|x| x.is_human() || x.is_observer())
            .filter(|x| x.id != game_info.host.id);
        let ip_to_routes = host.into_iter()
            .chain(rest)
            .enumerate()
            .filter_map(|(i, player)| {
                match routes.iter().find(|x| x.lobby_player_id == player.id) {
                    Some(route) => {
                        Some((Ipv4Addr::new(10, 27, 27, i as u8), route.clone()))
                    }
                    None => {
                        // There won't be a route for current player
                        None
                    }
                }
            })
            .collect::<HashMap<_, _>>();
        // Create the task which receives packets and forwards them to Storm
        let streams_done = ip_to_routes.iter()
            .map(|(&ip, route)| {
                let snp_send = snp_send_messages.clone();
                let stream = self.rally_point.listen_route_data(&route.route_id, &route.address)
                    .for_each(move |message| {
                        let message = snp::ReceivedMessage {
                            from: ip,
                            data: message,
                        };
                        snp_send.send(message);
                        Ok(())
                    })
                    .map_err(move |e| {
                        // I don't think there's much sense to kill network for this
                        // error, should never happen and if it does then try to keep going.
                        error!("Rally-point receive stream error for ip {:?}: {}", ip, e);
                    });
                stream
            })
            .collect::<Vec<_>>();
        let recv_task = future::join_all(streams_done)
            .map(|_| ());

        let (cancel_token, canceler) = CancelToken::new();
        self.cancel_child_tasks.push(canceler);
        tokio::spawn(cancel_token.bind(recv_task));

        let ready = ReadyNetwork {
            ip_to_routes,
        };
        self.network = NetworkState::Ready(ready);
        for waiting in self.waiting_for_network.drain(..) {
            let _ = waiting.send(Ok(()));
        }
    }
}

// Select ip4/6 address based on which finishses the ping faster
fn ping_server(
    rally_point: &RallyPoint,
    input: &client_messages::RallyPointServer,
) -> BoxedFuture<RallyPointServer> {
    fn ping_server_string(
        rally_point: &RallyPoint,
        input: &Option<String>,
        port: u16,
    ) -> impl Future<Item = RallyPointServer, Error = NetworkError> {
        match input {
            Some(s) => {
                match s.parse::<IpAddr>() {
                    Ok(ip) => {
                        let addr = SocketAddr::new(ip, port);
                        let future = rally_point.ping_server(addr)
                            .map(move |ping| {
                                RallyPointServer {
                                    address: addr,
                                    ping,
                                }
                            })
                            .map_err(|e| {
                                error!("Rally error {}", e);
                                NetworkError::ServerUnreachable
                            });
                        Either::A(future)
                    }
                    Err(_) => Either::B(future::err(NetworkError::NoServerAddress)),
                }
            }
            None => Either::B(future::err(NetworkError::NoServerAddress)),
        }
    }

    let future4 = ping_server_string(rally_point, &input.address4, input.port);
    let future6 = ping_server_string(rally_point, &input.address6, input.port);
    let future = future4.select(future6)
        .map(|(result, _next)| result)
        .or_else(|(_, next)| next);
    box_future(future)
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
        let task = receive_messages.map_err(|_| ())
            .chain(Err(()).into_future().into_stream()) // Chain an error to end the future.
            .select(internal_receive_messages.map_err(|_| ()))
            .for_each(move |message| {
                state.handle_message(message);
                Ok(())
            })
            .then(|_| {
                debug!("Route manager task ended");
                Ok(())
            });
        tokio::spawn(task);
        NetworkManager {
            send_messages,
        }
    }

    /// The main async future of NetworkManager.
    ///
    /// Finishes once routes have been resolved, and SNP is ready to use - after that
    /// calling BW functions that use network is fine, messages sent here will be forwarded
    /// through rally-point, and received messages will be pushed to snp's queue + handle
    /// signaled automatically.
    pub fn wait_network_ready(&self) -> impl Future<Item = (), Error = NetworkError> {
        let (send, recv) = oneshot::channel();
        self.send_messages.clone()
            .send(NetworkManagerMessage::WaitNetworkReady(send))
            .map_err(|_| NetworkError::NotActive)
            .and_then(|_| recv.map_err(|_| NetworkError::NotActive).flatten())
    }

    pub fn set_routes(
        &self,
        routes: Vec<RouteInput>,
    ) -> impl Future<Item = (), Error = NetworkError> {
        self.send_messages.clone()
            .send(NetworkManagerMessage::Routes(routes))
            .map(|_| ())
            .map_err(|_| NetworkError::NotActive)
    }

    pub fn send_snp_message(
        &self,
        message: SnpMessage,
    ) -> impl Future<Item = (), Error = ()> {
        self.send_messages.clone()
            .send(NetworkManagerMessage::Snp(message))
            .map(|_| ())
            .map_err(|_| ())
    }

    pub fn set_game_info(
        &self,
        info: Arc<client_messages::GameSetupInfo>,
    ) -> impl Future<Item = (), Error = NetworkError> {
        self.send_messages.clone()
            .send(NetworkManagerMessage::SetGameInfo(info))
            .map(|_| ())
            .map_err(|_| NetworkError::NotActive)
    }
}
