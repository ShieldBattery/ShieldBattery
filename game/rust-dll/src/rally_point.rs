use std::collections::{HashSet, hash_map::{Entry, HashMap}};

use std::io;
use std::net::SocketAddr;
use std::time::{Duration, Instant};

use byteorder::{LE, ReadBytesExt, WriteBytesExt};
use bytes::{Bytes};
use futures::future::Either;
use quick_error::quick_error;
use tokio::codec::BytesCodec;
use tokio::net::{UdpSocket, UdpFramed};
use tokio::prelude::*;
use tokio::sync::{mpsc, oneshot};
use tokio::timer::Delay;

use crate::{BoxedFuture, box_future};
use crate::cancel_token::{CancelableSender, cancelable_channel};

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
struct RouteKey(SocketAddr, RouteId);

struct JoinState {
    done: oneshot::Sender<Result<(), RallyPointError>>,
    player_id: PlayerId,
}

struct ActiveRoute {
    player_id: PlayerId,
}

struct State {
    joins: HashMap<RouteKey, JoinState>,
    active_routes: HashMap<RouteKey, ActiveRoute>,
    joined_servers: HashSet<SocketAddr>,
    send_requests: mpsc::Sender<Request>,
    send_bytes: mpsc::Sender<(Bytes, SocketAddr, Option<mpsc::Sender<RallyPointError>>)>,
    local_addr: SocketAddr,
}

fn send_bytes_future(
    send_requests: &mpsc::Sender<Request>,
    message: Bytes,
    to: SocketAddr,
) -> impl Future<Item = (), Error = ()> + 'static {
    send_requests.clone()
        .send(Request::Send(message, to, None))
        .map(|_| ())
        .map_err(|_| ())
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
                    .map(move |()| {
                        Request::Send(message.clone(), address, Some(send_error.clone()))
                    })
                    .forward(self.send_requests.clone().sink_map_err(|_| ()))
                    .map(|_| ())
                    .map_err(|_| ());
                let send_errored = recv_error.into_future()
                    .map_err(|_| RallyPointError::NotActive)
                    .and_then(|(error, _)| match error {
                        Some(s) => Err(s),
                        None => Err(RallyPointError::NotActive),
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

                let task = result.select(send_requests)
                    .map(|_| ())
                    .map_err(|((), _)| ());
                tokio::spawn(task);
                box_future(Ok(()).into_future())
            }
        }
    }

    fn server_message(&mut self, message: ServerMessage, addr: SocketAddr) -> BoxedFuture<(), ()> {
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
                let send_ack = send_bytes_future(&self.send_requests, ack, addr);
                if let Entry::Occupied(entry) = join_entry {
                    let (_, join_state) = entry.remove_entry();
                    self.active_routes.insert(key, ActiveRoute {
                        player_id,
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
                let send_ack = send_bytes_future(&self.send_requests, ack, addr);
                if let Some(join_state) = self.joins.remove(&key) {
                    let _ = join_state.done.send(Err(RallyPointError::JoinFailed));
                }
                box_future(send_ack)
            }
            _ => panic!("Unimplemented msg {:?}", message),
        }
    }

    fn new(
        addr: &SocketAddr,
        send_requests: mpsc::Sender<Request>,
    ) -> Result<State, RallyPointError> {
        // Getting separate Stream and Sink for an UDP socket is a bit messy,
        // but wrapping it in a UdpFramed<BytesCodec> will work fine
        // without adding any extra data to the transported bytes.
        let socket = match UdpSocket::bind(addr) {
            Ok(o) => o,
            Err(e) => return Err(RallyPointError::Bind(e)),
        };
        let local_addr = match socket.local_addr() {
            Ok(o) => o,
            Err(e) => return Err(RallyPointError::Bind(e)),
        };
        debug!("UDP socket bound to {:?}", local_addr);
        let (send_bytes, recv_bytes) = mpsc::channel(16);
        let task = udp_task(socket, send_requests.clone(), recv_bytes);
        tokio::spawn(task);
        Ok(State {
            joins: HashMap::default(),
            active_routes: HashMap::default(),
            joined_servers: HashSet::default(),
            send_requests,
            send_bytes,
            local_addr,
        })
    }

    fn reset(&mut self) {
        let socket = match UdpSocket::bind(&self.local_addr) {
            Ok(o) => o,
            Err(e) => {
                error!("Couldn't reset udp socket: {}", e);
                let send_requests = self.send_requests.clone();
                let retry = Delay::new(Instant::now() + Duration::from_millis(500))
                    .map_err(|_| ())
                    .and_then(|_| send_requests.send(Request::Reset).map_err(|_| ()))
                    .map(|_| ());
                tokio::spawn(retry);
                return;
            }
        };
        let (send_bytes, recv_bytes) = mpsc::channel(16);
        let task = udp_task(socket, self.send_requests.clone(), recv_bytes);
        tokio::spawn(task);
        self.send_bytes = send_bytes;
    }
}

fn udp_task(
    socket: UdpSocket,
    send_requests: mpsc::Sender<Request>,
    recv_bytes: mpsc::Receiver<(Bytes, SocketAddr, Option<mpsc::Sender<RallyPointError>>)>,
) -> impl Future<Item = (), Error = ()> {
    let socket = UdpFramed::new(socket, BytesCodec::new());
    let (udp_send, udp_recv) = socket.split();
    let send_reqs = send_requests.clone();
    let recv_future = udp_recv
        .map_err(|e| {
            error!("UDP recv error: {}", e);
        })
        .filter_map(|(bytes, addr)| {
            let bytes = bytes.freeze();
            match decode_message(&bytes) {
                Some(o) => Some((o, addr)),
                None => {
                    warn!("Received an invalid message from {:?}: {:x?}", addr, bytes);
                    None
                }
            }
        })
        .map(|msg| Request::ServerMessage(msg.0, msg.1))
        .forward(send_reqs.sink_map_err(|_| ()))
        .map(|_| ());
    let send_future = recv_bytes
        .map_err(|_| ())
        .chain(Err(()).into_future().into_stream())
        .fold(udp_send, |udp_send, (bytes, addr, report_error)| {
            udp_send.send((bytes, addr))
                .or_else(move |e| {
                    if let Some(report) = report_error {
                        box_future(report.send(RallyPointError::Send(e, addr))
                            .then(|_| Err(())))
                    } else {
                        error!("UDP send error: {}", e);
                        box_future(Err(()).into_future())
                    }
                })
        })
        .map(|_| ());
    let task = send_future.join(recv_future)
        .map(|((), ())| ())
        .or_else(move |()| {
            send_requests.send(Request::Reset)
                .map(|_| ())
                .map_err(|_| ())
        });
    task
}

fn resend_interval() -> impl Stream<Item = (), Error = ()> {
    tokio::timer::Interval::new(Instant::now(), RESEND_TIMEOUT)
        .map(|_| ())
        .map_err(|_| ())
}

pub fn init() -> Result<RallyPoint, RallyPointError> {
    // Rally-point uses 3 tasks.
    // The main task receives requests from recv/send tasks and outer world,
    // while recv/send tasks just communicate their results to the main task.
    // Though additionally, in order to report send errors to whichever future caused the send,
    // send requests take an optional mpsc::Sender that can should link back to the relevant
    // future. Acks sent to server can/should have it as None.
    let addr = "[::]:0".parse().unwrap();

    let (send_requests, recv_requests) = mpsc::channel(16);
    // Separate channel for internal communication, so that dropping RallyPoint
    // will cause main_future to stop.
    let (internal_send_requests, internal_recv_requests) = mpsc::channel(16);
    let mut state = State::new(&addr, internal_send_requests)?;
    let main_future = recv_requests.map_err(|_| ())
        .chain(Err(()).into_future().into_stream()) // Chain an error to end the future.
        .select(internal_recv_requests.map_err(|_| ()))
        .for_each(move |request| {
            match request {
                Request::Reset => {
                    state.reset();
                    box_future(Ok(()).into_future())
                }
                Request::Send(data, addr, report) => {
                    box_future(state.send_bytes.clone().send((data, addr, report))
                        .map(|_| ())
                        .map_err(|_| ()))
                }
                Request::External(req) => {
                    state.external_request(req)
                }
                Request::ServerMessage(msg, from) => {
                    state.server_message(msg, from)
                }
            }
        })
        .then(|_| {
            debug!("Rally-point task ended");
            Ok(())
        });
    tokio::spawn(main_future);
    Ok(RallyPoint {
        send_requests
    })
}

impl std::ops::Drop for RallyPoint {
    fn drop(&mut self) {
        debug!("Rally drop");
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
    JoinRoute(RouteId, PlayerId, SocketAddr, Duration, ResponseSender<()>),
}

enum Request {
    Reset,
    External(ExternalRequest),
    Send(Bytes, SocketAddr, Option<mpsc::Sender<RallyPointError>>),
    ServerMessage(ServerMessage, SocketAddr),
}

pub struct RallyPoint {
    send_requests: mpsc::Sender<Request>,
}

#[derive(Copy, Clone, Debug, Hash, Eq, PartialEq)]
pub struct RouteId(u64);
#[derive(Copy, Clone, Debug)]
pub struct FailureId(u64);
#[derive(Copy, Clone, Debug)]
pub struct PlayerId(u32);

impl RallyPoint {
    pub fn join_route(
        &self,
        address: SocketAddr,
        route_id: RouteId,
        player_id: PlayerId,
        timeout: Duration,
    ) -> impl Future<Item = (), Error = RallyPointError> {
        let (send, recv) = cancelable_channel();

        let request = ExternalRequest::JoinRoute(route_id, player_id, address, timeout, send);
        let future = self.send_requests.clone().send(Request::External(request))
            .map_err(|_| RallyPointError::NotActive)
            .and_then(|_| {
                recv.map_err(|_| RallyPointError::NotActive).flatten()
            })
            .map(|_| ());
        future
    }
}

fn route_key(address: &SocketAddr, route_id: &RouteId) -> RouteKey {
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
