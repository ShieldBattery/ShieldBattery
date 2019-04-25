use std::collections::{HashSet, hash_map::{Entry, HashMap}};

use std::io;
use std::net::{SocketAddr, SocketAddrV6};
use std::time::{Duration, Instant};
use std::sync::atomic::{AtomicUsize, Ordering};

use byteorder::{LE, ReadBytesExt, WriteBytesExt};
use bytes::{Bytes};
use futures::future::{self, Either};
use quick_error::quick_error;
use tokio::prelude::*;
use tokio::sync::{mpsc, oneshot};

use crate::{BoxedFuture, box_future};
use crate::cancel_token::{CancelToken, Canceler, CancelableSender, cancelable_channel};
use crate::udp::{self, UdpSend, UdpRecv};

quick_error! {
    #[derive(Debug)]
    pub enum RallyPointError {
        Bind(error: io::Error) {
            description("UDP bind error")
            display("UDP binding failed: {}", error)
        }
        Send(error: io::Error, addr: SocketAddr) {
            description("UDP send error")
            display("Failed to send datagram to {}: {}", addr, error)
        }
        NotActive {
            description("Rally-point instance has closed")
        }
        JoinFailed {
            description("Joining route failed")
        }
        Timeout {
            description("Operation timed out")
        }
        RouteNotActive {
            description("Route is not active")
        }
    }
}

const PING_TIMEOUT: Duration = Duration::from_millis(2000);
const RESEND_TIMEOUT: Duration = Duration::from_millis(500);

const MSG_JOIN_ROUTE: u8 = 0x5;
const MSG_JOIN_ROUTE_SUCCESS: u8 = 0x6;
const MSG_JOIN_ROUTE_SUCCESS_ACK: u8 = 0x7;
const MSG_JOIN_ROUTE_FAILURE: u8 = 0x8;
const MSG_JOIN_ROUTE_FAILURE_ACK: u8 = 0x9;
const MSG_ROUTE_READY: u8 = 0xa;
const MSG_ROUTE_READY_ACK: u8 = 0xb;
const MSG_KEEP_ALIVE: u8 = 0xc;
const MSG_RECEIVE: u8 = 0xd;
const MSG_FORWARD: u8 = 0xe;
const MSG_PING: u8 = 0xf;

#[derive(Hash, Eq, PartialEq, Debug, Clone)]
struct RouteKey(SocketAddrV6, RouteId);

struct JoinState {
    done: oneshot::Sender<Result<(), RallyPointError>>,
    player_id: PlayerId,
}

struct ActiveRoute {
    player_id: PlayerId,
    ready: bool,
    waiting_for_ready: Vec<oneshot::Sender<Result<(), RallyPointError>>>,
    on_data: Vec<mpsc::Sender<Bytes>>,
}

// Keep internal addrs as IPv6 since UDP recvs come as IPv6 always.
// External api uses SocketAddr
struct State {
    joins: HashMap<RouteKey, JoinState>,
    active_routes: HashMap<RouteKey, ActiveRoute>,
    joined_servers: HashSet<SocketAddrV6>,
    send_requests: mpsc::Sender<Request>,
    send_bytes: mpsc::Sender<(Bytes, SocketAddrV6, Option<mpsc::Sender<RallyPointError>>)>,
    pings: HashMap<(u32, SocketAddrV6), Ping>,
    #[allow(dead_code)]
    end_recv_task: Canceler,
}

struct Ping {
    start: Instant,
    done: oneshot::Sender<Duration>,
}

fn to_ipv6_addr(addr: &SocketAddr) -> SocketAddrV6 {
    match addr {
        SocketAddr::V6(v6) => *v6,
        SocketAddr::V4(v4) => SocketAddrV6::new(v4.ip().to_ipv6_mapped(), v4.port(), 0,0),
    }
}

fn send_bytes_future(
    send_bytes: &mpsc::Sender<(Bytes, SocketAddrV6, Option<mpsc::Sender<RallyPointError>>)>,
    message: Bytes,
    to: SocketAddrV6,
) -> impl Future<Item = (), Error = ()> + 'static {
    send_bytes.clone()
        .send((message, to, None))
        .map(|_| ())
        .map_err(|_| ())
}

static PING_ID: AtomicUsize = AtomicUsize::new(0);
fn ping_id() -> u32 {
    let id = PING_ID.fetch_add(1, Ordering::Relaxed);
    if id == 0 {
        let id: usize = rand::random();
        PING_ID.store(id.wrapping_add(1), Ordering::Relaxed);
        id as u32
    } else {
        id as u32
    }
}

impl State {
    fn external_request(&mut self, request: ExternalRequest) -> BoxedFuture<(), ()> {
        match request {
            ExternalRequest::JoinRoute(route, player, address, timeout, done) => {
                let message = join_route_message(&route, player);
                let key = route_key(&address, &route);
                let (send_done, recv_done) = oneshot::channel();
                let (send_error, recv_error) = mpsc::channel(1);
                self.joins.insert(key.clone(), JoinState {
                    done: send_done,
                    player_id: player,
                });
                self.joined_servers.insert(address);
                let send_requests = resend_interval()
                    .map(move |()| (message.clone(), address, Some(send_error.clone())))
                    .forward(self.send_bytes.clone().sink_map_err(|_| ()))
                    .map(|_| ())
                    .map_err(|_| ());
                let send_errored = recv_error.into_future()
                    .then(|result| match result {
                        Ok((Some(s), _)) => Either::A(future::err(s)),
                        _ => Either::B(future::empty()),
                    });
                let wait_for_result = recv_done
                    .map_err(|_| RallyPointError::NotActive)
                    .timeout(timeout)
                    .map_err(|e| {
                        e.into_inner().unwrap_or_else(|| RallyPointError::Timeout)
                    })
                    .flatten();
                let result = wait_for_result.select2(send_errored)
                    .map(|ok| ok.split().0)
                    .map_err(|err| err.split().0);
                let result = done.send_result(result);

                let send_self_requests = self.send_requests.clone();
                let task = result.select(send_requests)
                    .then(move |_| send_self_requests.send(Request::CleanupJoin(key)))
                    .map(|_| ())
                    .map_err(|_| ());
                tokio::spawn(task);
                box_future(Ok(()).into_future())
            }
            ExternalRequest::Ping(address, done) => {
                let (send_done, recv_done) = oneshot::channel();
                let (send_error, recv_error) = mpsc::channel(1);
                let id = ping_id();
                let now = Instant::now();
                self.pings.insert((id, address), Ping {
                    start: now,
                    done: send_done,
                });
                let message = ping_message(id);

                let send = self.send_bytes.clone()
                    .send((message, address, Some(send_error)))
                    .map(|_| ())
                    .map_err(|_| ());
                let send_errored = recv_error.into_future()
                    .then(|result| match result {
                        Ok((Some(s), _)) => Either::A(future::err(s)),
                        _ => Either::B(future::empty()),
                    });
                let wait_for_result = recv_done
                    .map_err(|_| RallyPointError::NotActive)
                    .timeout(PING_TIMEOUT)
                    .map_err(|e| {
                        e.into_inner().unwrap_or_else(|| RallyPointError::Timeout)
                    });
                let result = wait_for_result.select2(send_errored)
                    .map(|ok| ok.split().0)
                    .map_err(|err| err.split().0);
                let result = done.send_result(result);

                let send_requests = self.send_requests.clone();
                let task = result
                    .then(move |_| send_requests.send(Request::CleanupPing((id, address))))
                    .map(|_| ())
                    .map_err(|_| ());
                tokio::spawn(task);
                box_future(send)
            }
            ExternalRequest::Forward(route, player, data, address) => {
                let message = forward_message(&route, player, &data);
                let send = self.send_bytes.clone()
                    .send((message, address, None))
                    .map(|_| ())
                    .map_err(|_| ());
                box_future(send)
            }
            ExternalRequest::WaitRouteReady(route, address, done) => {
                let key = route_key(&address, &route);
                if let Some(active_route) = self.active_routes.get_mut(&key) {
                    if active_route.ready {
                        let _ = done.send(Ok(()));
                    } else {
                        active_route.waiting_for_ready.push(done);
                    }
                } else {
                    let _ = done.send(Err(RallyPointError::RouteNotActive));
                }
                box_future(Ok(()).into_future())
            }
            ExternalRequest::KeepAlive(route, player, address) => {
                // I don't think there's any way to confirm the route is actually still alive
                let message = keep_alive_message(&route, player);
                let send = self.send_bytes.clone()
                    .send((message, address, None))
                    .map(|_| ())
                    .map_err(|_| ());
                box_future(send)
            }
            ExternalRequest::ListenData(route, address, listen) => {
                let key = route_key(&address, &route);
                if let Some(active_route) = self.active_routes.get_mut(&key) {
                    active_route.on_data.push(listen);
                } else {
                    error!("Attempted to listen on route {:?} which is not active", key);
                }
                box_future(Ok(()).into_future())
            }
        }
    }

    fn server_message(&mut self, message: ServerMessage, addr: SocketAddrV6) -> BoxedFuture<(), ()> {
        match message {
            ServerMessage::JoinRouteSuccess(route) => {
                let key = route_key(&addr, &route);
                let join_entry = self.joins.entry(key.clone());
                let player_id = match join_entry {
                    Entry::Occupied(ref entry) => entry.get().player_id,
                    Entry::Vacant(_) => match self.active_routes.get(&key) {
                        Some(s) => s.player_id,
                        None => {
                            // We'd like to ack this, but we don't have a player ID so tough luck
                            return box_future(Ok(()).into_future());
                        }
                    }
                };
                let ack = join_route_success_ack(&route, player_id);
                let send_ack = send_bytes_future(&self.send_bytes, ack, addr);
                if let Entry::Occupied(entry) = join_entry {
                    let (_, join_state) = entry.remove_entry();
                    self.active_routes.insert(key, ActiveRoute {
                        player_id,
                        ready: false,
                        waiting_for_ready: Vec::new(),
                        on_data: Vec::new(),
                    });
                    let _ = join_state.done.send(Ok(()));
                }
                box_future(send_ack)
            }
            ServerMessage::JoinRouteFailure(route, failure_id) => {
                if !self.joined_servers.contains(&addr) {
                    return box_future(Ok(()).into_future());
                }
                let key = route_key(&addr, &route);
                let ack = join_route_failure_ack(failure_id);
                let send_ack = send_bytes_future(&self.send_bytes, ack, addr);
                if let Some(join_state) = self.joins.remove(&key) {
                    let _ = join_state.done.send(Err(RallyPointError::JoinFailed));
                }
                box_future(send_ack)
            }
            ServerMessage::Ping(ping_id) => {
                if let Some(ping) = self.pings.remove(&(ping_id, addr)) {
                    let _ = ping.done.send(ping.start.elapsed());
                }
                box_future(future::ok(()))
            }
            ServerMessage::RouteReady(route_id) => {
                let key = route_key(&addr, &route_id);
                if let Some(route) = self.active_routes.get_mut(&key) {
                    route.ready = true;
                    for send in route.waiting_for_ready.drain(..) {
                        let _ = send.send(Ok(()));
                    }
                    let ack = route_ready_ack(&route_id, route.player_id);
                    let send_ack = send_bytes_future(&self.send_bytes, ack, addr);
                    box_future(send_ack)
                } else {
                    debug!("Route ready received for route {:?} which wasn't active", key);
                    box_future(future::ok(()))
                }
            }
            ServerMessage::Receive(route, bytes) => {
                let key = route_key(&addr, &route);
                if let Some(route) = self.active_routes.get_mut(&key) {
                    let mut send_futures = Vec::new();
                    // If any of the listeners have been dropped, clean them up here
                    let mut closed_indices = Vec::new();
                    for (i, send) in route.on_data.iter_mut().enumerate() {
                        match send.try_send(bytes.clone()) {
                            Ok(()) => (),
                            Err(err) => if err.is_closed() {
                                closed_indices.push(i);
                            } else {
                                let future = send.clone().send(err.into_inner())
                                    .map(|_| ())
                                    .map_err(|_| ());
                                send_futures.push(future);
                            }
                        }
                    }
                    for &i in closed_indices.iter().rev() {
                        debug!("Removing listener {}", i);
                        route.on_data.swap_remove(i);
                    }
                    box_future(future::join_all(send_futures).map(|_| ()))
                } else {
                    debug!("Data received for route {:?} which wasn't active", key);
                    box_future(future::ok(()))
                }
            }
        }
    }

    fn new(
        addr: &SocketAddr,
        send_requests: mpsc::Sender<Request>,
    ) -> Result<State, RallyPointError> {
        let (udp_send, udp_recv) = match udp::udp_socket(addr) {
            Ok(o) => o,
            Err(e) => return Err(RallyPointError::Bind(e)),
        };
        let (send_bytes, recv_bytes) = mpsc::channel(16);
        // Send task closes from send_bytes dropping, but recv task will not notice
        // recv_requests dropping if it doesn't receive anyhing, so use an explicit canceler.
        let (cancel_token, end_recv_task) = CancelToken::new();
        let send_task = udp_send_task(udp_send, recv_bytes);
        let recv_task = udp_recv_task(udp_recv, send_requests.clone());
        tokio::spawn(send_task);
        tokio::spawn(cancel_token.bind(recv_task));
        Ok(State {
            joins: HashMap::default(),
            active_routes: HashMap::default(),
            joined_servers: HashSet::default(),
            send_requests,
            send_bytes,
            pings: HashMap::default(),
            end_recv_task,
        })
    }
}

fn udp_send_task(
    udp_send: UdpSend,
    recv_bytes: mpsc::Receiver<(Bytes, SocketAddrV6, Option<mpsc::Sender<RallyPointError>>)>,
) -> impl Future<Item = (), Error = ()> {
    let send_future = recv_bytes
        .map_err(|_| ())
        .fold(udp_send, |udp_send, (bytes, addr, report_error)| {
            udp_send.send_recoverable((bytes, addr.into()))
                .or_else(move |(e, udp)| {
                    if let Some(report) = report_error {
                        error!("UDP send error: {}", e);
                        box_future(report.send(RallyPointError::Send(e, addr.into()))
                            .then(|_| Ok(udp)))
                    } else {
                        error!("UDP send error: {}", e);
                        box_future(Ok(udp).into_future())
                    }
                })
        })
        .map(|_| ());
    send_future
}

fn udp_recv_task(
    udp_recv: UdpRecv,
    send_requests: mpsc::Sender<Request>,
) -> impl Future<Item = (), Error = ()> {
    let recv_future = udp_recv
        .map_err(|e| {
            error!("UDP recv error: {}", e);
        })
        .filter_map(|(bytes, addr)| {
            match decode_message(&bytes) {
                Some(o) => Some((o, addr)),
                None => None,
            }
        })
        .map(|msg| Request::ServerMessage(msg.0, msg.1))
        .forward(send_requests.sink_map_err(|_| ()))
        .map(|_| ());
    recv_future
}

fn resend_interval() -> impl Stream<Item = (), Error = ()> {
    tokio::timer::Interval::new(Instant::now(), RESEND_TIMEOUT)
        .map(|_| ())
        .map_err(|_| ())
}

pub fn init() -> RallyPoint {
    // Rally-point uses 2 tasks.
    // The main task receives requests from recv/send tasks and outer world,
    // while recv/send task just communicate their results to the main task.
    // Though additionally, in order to report send errors to whichever future caused the send,
    // send requests take an optional mpsc::Sender that can should link back to the relevant
    // future. Acks sent to server can/should have it as None.
    let addr = "[::]:0".parse().unwrap();

    let (send_requests, recv_requests) = mpsc::channel(16);
    // Separate channel for internal communication, so that dropping RallyPoint
    // will cause main_future to stop.
    let (internal_send_requests, internal_recv_requests) = mpsc::channel(16);
    let mut state = State::new(&addr, internal_send_requests)
        .expect("Couldn't bind rally-point");
    let main_future = recv_requests.map_err(|_| ())
        .chain(Err(()).into_future().into_stream()) // Chain an error to end the future.
        .select(internal_recv_requests.map_err(|_| ()))
        .for_each(move |request| {
            match request {
                Request::External(req) => {
                    state.external_request(req)
                }
                Request::ServerMessage(msg, from) => {
                    state.server_message(msg, from)
                }
                Request::CleanupJoin(key) => {
                    state.joins.remove(&key);
                    box_future(Ok(()).into_future())
                }
                Request::CleanupPing(key) => {
                    state.pings.remove(&key);
                    box_future(Ok(()).into_future())
                }
            }
        })
        .then(|_| {
            debug!("Rally-point task ended");
            Ok(())
        });
    tokio::spawn(main_future);
    RallyPoint {
        send_requests
    }
}

/// Messages sent from server to players
#[derive(Debug)]
enum ServerMessage {
    JoinRouteSuccess(RouteId),
    JoinRouteFailure(RouteId, FailureId),
    RouteReady(RouteId),
    Receive(RouteId, Bytes),
    Ping(u32),
}

type ResponseSender<T> = CancelableSender<Result<T, RallyPointError>>;

enum ExternalRequest {
    JoinRoute(RouteId, PlayerId, SocketAddrV6, Duration, ResponseSender<()>),
    Ping(SocketAddrV6, ResponseSender<Duration>),
    WaitRouteReady(RouteId, SocketAddrV6, oneshot::Sender<Result<(), RallyPointError>>),
    KeepAlive(RouteId, PlayerId, SocketAddrV6),
    ListenData(RouteId, SocketAddrV6, mpsc::Sender<Bytes>),
    Forward(RouteId, PlayerId, Bytes, SocketAddrV6),
}

enum Request {
    External(ExternalRequest),
    ServerMessage(ServerMessage, SocketAddrV6),
    CleanupJoin(RouteKey),
    CleanupPing((u32, SocketAddrV6)),
}

#[derive(Clone)]
pub struct RallyPoint {
    send_requests: mpsc::Sender<Request>,
}

#[derive(Copy, Clone, Debug, Hash, Eq, PartialEq)]
pub struct RouteId(u64);
#[derive(Copy, Clone, Debug)]
pub struct FailureId(u64);
#[derive(Copy, Clone, Debug)]
pub struct PlayerId(u32);

impl RouteId {
    pub fn from_string(val: &str) -> RouteId {
        RouteId(val.as_bytes().read_u64::<LE>().unwrap_or(0))
    }
}

impl PlayerId {
    pub fn from_u32(val: u32) -> PlayerId {
        PlayerId(val)
    }
}

impl RallyPoint {
    pub fn join_route(
        &self,
        address: SocketAddr,
        route_id: RouteId,
        player_id: PlayerId,
        timeout: Duration,
    ) -> impl Future<Item = (), Error = RallyPointError> {
        let (send, recv) = cancelable_channel();

        let address = to_ipv6_addr(&address);
        let request = ExternalRequest::JoinRoute(route_id, player_id, address, timeout, send);
        let future = self.send_requests.clone().send(Request::External(request))
            .map_err(|_| RallyPointError::NotActive)
            .and_then(|_| {
                recv.map_err(|_| RallyPointError::NotActive).flatten()
            });
        future
    }

    pub fn ping_server(
        &self,
        address: SocketAddr,
    ) -> impl Future<Item = Duration, Error = RallyPointError> {
        let (send, recv) = cancelable_channel();

        let address = to_ipv6_addr(&address);
        let request = ExternalRequest::Ping(address, send);
        let future = self.send_requests.clone().send(Request::External(request))
            .map_err(|_| RallyPointError::NotActive)
            .and_then(|_| {
                recv.map_err(|_| RallyPointError::NotActive).flatten()
            });
        future
    }

    pub fn wait_route_ready(
        &self,
        route: &RouteId,
        address: &SocketAddr,
    ) -> impl Future<Item = (), Error = RallyPointError> {
        let (send, recv) = oneshot::channel();
        let address = to_ipv6_addr(&address);
        let request = ExternalRequest::WaitRouteReady(*route, address, send);
        let future = self.send_requests.clone().send(Request::External(request))
            .map_err(|_| RallyPointError::NotActive)
            .and_then(|_| {
                recv.map_err(|_| RallyPointError::NotActive).flatten()
            });
        future
    }

    pub fn keep_alive(
        &self,
        route: &RouteId,
        player_id: PlayerId,
        address: &SocketAddr,
    ) -> impl Future<Item = (), Error = RallyPointError> {
        let address = to_ipv6_addr(&address);
        let request = ExternalRequest::KeepAlive(*route, player_id, address);
        let future = self.send_requests.clone().send(Request::External(request))
            .map(|_| ())
            .map_err(|_| RallyPointError::NotActive);
        future
    }

    pub fn listen_route_data(
        &self,
        route: &RouteId,
        address: &SocketAddr,
    ) -> impl Stream<Item = Bytes, Error = RallyPointError> {
        let address = to_ipv6_addr(&address);
        let (send, recv) = mpsc::channel(32);
        let request = ExternalRequest::ListenData(*route, address, send);
        let stream = self.send_requests.clone().send(Request::External(request))
            .map(|_| ())
            .map_err(|_| RallyPointError::NotActive)
            .into_stream()
            .filter_map(|_| None)
            .chain(recv.map_err(|_| RallyPointError::NotActive));
        stream
    }

    pub fn forward(
        &self,
        route: &RouteId,
        player: PlayerId,
        data: Bytes,
        address: &SocketAddr,
    ) -> impl Future<Item = (), Error = RallyPointError> {
        let address = to_ipv6_addr(&address);
        let request = ExternalRequest::Forward(*route, player, data, address);
        let future = self.send_requests.clone().send(Request::External(request))
            .map(|_| ())
            .map_err(|_| RallyPointError::NotActive);
        future
    }
}

fn route_key(address: &SocketAddrV6, route_id: &RouteId) -> RouteKey {
    RouteKey(address.clone(), route_id.clone())
}

fn decode_message(bytes: &Bytes) -> Option<ServerMessage> {
    let mut read: &[u8] = &bytes;
    let message = match read.read_u8().ok()? {
        MSG_JOIN_ROUTE_SUCCESS => {
            let route = RouteId(read.read_u64::<LE>().ok()?);
            ServerMessage::JoinRouteSuccess(route)
        }
        MSG_JOIN_ROUTE_FAILURE => {
            let route = RouteId(read.read_u64::<LE>().ok()?);
            let failure = FailureId(read.read_u64::<LE>().ok()?);
            ServerMessage::JoinRouteFailure(route, failure)
        }
        MSG_ROUTE_READY => {
            let route = RouteId(read.read_u64::<LE>().ok()?);
            ServerMessage::RouteReady(route)
        }
        MSG_RECEIVE => {
            let route = RouteId(read.read_u64::<LE>().ok()?);
            let data = bytes.slice_from(bytes.len() - read.len());
            // Length validation below doesn't work here since `data` is not read from `read`.
            return Some(ServerMessage::Receive(route, data));
        }
        MSG_PING => {
            let id = read.read_u32::<LE>().ok()?;
            ServerMessage::Ping(id)
        }
        // Should this be handled?
        MSG_KEEP_ALIVE => return None,
        _ => {
            warn!("Received an unknown rally-point message: {:x?}", bytes);
            return None;
        }
    };
    if read.is_empty() {
        Some(message)
    } else {
        warn!("Rally-point message {:?} contained additional data, ignoring", message);
        None
    }
}

fn join_route_message(route_id: &RouteId, player_id: PlayerId) -> Bytes {
    let mut data = Vec::with_capacity(16);
    data.push(MSG_JOIN_ROUTE);
    data.write_u64::<LE>(route_id.0).unwrap();
    data.write_u32::<LE>(player_id.0).unwrap();
    data.into()
}

fn join_route_success_ack(route_id: &RouteId, player_id: PlayerId) -> Bytes {
    let mut data = Vec::with_capacity(13);
    data.push(MSG_JOIN_ROUTE_SUCCESS_ACK);
    data.write_u64::<LE>(route_id.0).unwrap();
    data.write_u32::<LE>(player_id.0).unwrap();
    data.into()
}

fn join_route_failure_ack(failure_id: FailureId) -> Bytes {
    let mut data = Vec::with_capacity(9);
    data.push(MSG_JOIN_ROUTE_FAILURE_ACK);
    data.write_u64::<LE>(failure_id.0).unwrap();
    data.into()
}

fn route_ready_ack(route_id: &RouteId, player_id: PlayerId) -> Bytes {
    let mut data = Vec::with_capacity(13);
    data.push(MSG_ROUTE_READY_ACK);
    data.write_u64::<LE>(route_id.0).unwrap();
    data.write_u32::<LE>(player_id.0).unwrap();
    data.into()
}

fn keep_alive_message(route_id: &RouteId, player_id: PlayerId) -> Bytes {
    let mut data = Vec::with_capacity(13);
    data.push(MSG_KEEP_ALIVE);
    data.write_u64::<LE>(route_id.0).unwrap();
    data.write_u32::<LE>(player_id.0).unwrap();
    data.into()
}

fn forward_message(route_id: &RouteId, player_id: PlayerId, bytes: &[u8]) -> Bytes {
    let mut data = Vec::with_capacity(13 + bytes.len());
    data.push(MSG_FORWARD);
    data.write_u64::<LE>(route_id.0).unwrap();
    data.write_u32::<LE>(player_id.0).unwrap();
    data.extend(bytes.iter().cloned());
    data.into()
}

fn ping_message(id: u32) -> Bytes {
    let mut data = Vec::with_capacity(5);
    data.push(MSG_PING);
    data.write_u32::<LE>(id).unwrap();
    data.into()
}
