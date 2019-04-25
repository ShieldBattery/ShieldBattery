/// Implementing a custom async UDP socket since tokio::net::UdpSocket has the limitation that
/// on windows, due to sends being a 'start, wait for completion' two-step process,
/// but tokio/mio do not expose a way to poll the completion step, any failing sends are
/// reported as successes.
///
/// The implementation just spawns two threads for send/recv and uses the blocking
/// std::net::UdpSocket, which is relatively fine as we only need a single UDP socket for
/// rally-point. The more scalable solution would be to create improved version of
/// mio::net::UdpSocket, but I'm concerned that it would end up being a maintenance burden to
/// keep up to date when mio/miow/tokio change, as it would end up being comparatively complex
/// and hard to follow.

use std::io;
use std::mem;
use std::net::{UdpSocket, SocketAddr, SocketAddrV6};
use std::os::windows::io::FromRawSocket;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use bytes::{Bytes};
use futures::prelude::*;
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};
use winapi::um::winsock2::{
    bind, setsockopt, socket, WSAGetLastError, WSAStartup, INVALID_SOCKET, WSADATA,
};
use winapi::shared::ws2def::{AF_INET6, IPPROTO_IPV6, SOCK_DGRAM};
use winapi::shared::ws2ipdef::{IPV6_V6ONLY, SOCKADDR_IN6_LH};

pub struct UdpSend {
    thread_sender: std::sync::mpsc::Sender<(Bytes, SocketAddrV6)>,
    results: UnboundedReceiver<Result<(), io::Error>>,
    pending_results: usize,
}

pub struct UdpRecv {
    thread_receiver: UnboundedReceiver<Result<(Bytes, SocketAddrV6), io::Error>>,
    closed: Arc<AtomicBool>,
}

fn to_ipv6_addr(addr: &SocketAddr) -> SocketAddrV6 {
    match addr {
        SocketAddr::V6(v6) => *v6,
        SocketAddr::V4(v4) => SocketAddrV6::new(v4.ip().to_ipv6_mapped(), v4.port(), 0,0),
    }
}

fn bind_udp_ipv6_ipv4_socket(local_addr: &SocketAddrV6) -> Result<UdpSocket, io::Error> {
    unsafe {
        let mut data: WSADATA = mem::zeroed();
        let err = WSAStartup(0x202, &mut data);
        if err != 0 {
            return Err(io::Error::from_raw_os_error(WSAGetLastError()));
        }
        // Call winsock functions as setsockopt has to be called before bind()
        let socket = socket(AF_INET6, SOCK_DGRAM, 0);
        if socket == INVALID_SOCKET {
            return Err(io::Error::from_raw_os_error(WSAGetLastError()));
        }
        // Enable using this socket for both IPv4 and IPv6 addresses.
        // The send thread needs to convert any actual V4 sockaddr to V6 though.
        let zero = 0u32;
        let err = setsockopt(
            socket,
            IPPROTO_IPV6 as i32,
            IPV6_V6ONLY,
            &zero as *const u32 as *const i8,
            4,
        );
        if err != 0 {
            return Err(io::Error::from_raw_os_error(WSAGetLastError()));
        }
        let mut raw_addr = SOCKADDR_IN6_LH {
            sin6_family: AF_INET6 as u16,
            sin6_port: local_addr.port(),
            sin6_flowinfo: 0,
            ..mem::zeroed()
        };
        *raw_addr.sin6_addr.u.Word_mut() = local_addr.ip().segments();
        let err = bind(
            socket,
            &raw_addr as *const SOCKADDR_IN6_LH as *const _,
            mem::size_of::<SOCKADDR_IN6_LH>() as i32,
        );
        if err != 0 {
            return Err(io::Error::from_raw_os_error(WSAGetLastError()));
        }
        Ok(UdpSocket::from_raw_socket(socket as u32))
    }
}

pub fn udp_socket(local_addr: &SocketAddr) -> Result<(UdpSend, UdpRecv), io::Error> {
    let socket = bind_udp_ipv6_ipv4_socket(&to_ipv6_addr(local_addr))?;
    debug!("UDP socket bound to {:?}", socket.local_addr());
    let socket2 = socket.try_clone()?;
    let (send, recv) = std::sync::mpsc::channel();
    let (mut send_result, recv_result) = unbounded_channel();
    std::thread::spawn(move || {
        while let Ok((val, addr)) = recv.recv() {
            let val: Bytes = val;
            let result = match socket.send_to(&val, addr) {
                Ok(len) => if val.len() == len {
                    Ok(())
                } else {
                    Err(io::Error::new(io::ErrorKind::Other, "Failed to send all of the data"))
                },
                Err(e) => Err(e),
            };
            if let Err(_) = send_result.try_send(result) {
                break;
            }
        }
        debug!("UDP send thread end");
    });
    let udp_send = UdpSend {
        thread_sender: send,
        results: recv_result,
        pending_results: 0,
    };
    let closed = Arc::new(AtomicBool::new(false));
    let closed2 = closed.clone();
    let (mut send, recv) = unbounded_channel();
    std::thread::spawn(move || {
        let mut buf = vec![0; 1024];
        loop {
            if closed2.load(Ordering::Relaxed) == true {
                break;
            }
            let result = match socket2.recv_from(&mut buf) {
                Ok((n, addr)) => Ok(((&buf[..n]).into(), to_ipv6_addr(&addr))),
                Err(e) => Err(e),
            };
            if let Err(_) = send.try_send(result) {
                break;
            }
        }
        debug!("UDP recv thread end");
    });
    let udp_recv = UdpRecv {
        thread_receiver: recv,
        closed,
    };
    Ok((udp_send, udp_recv))
}

impl Drop for UdpRecv {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::Relaxed);
    }
}

impl Stream for UdpRecv {
    type Item = (Bytes, SocketAddrV6);
    type Error = io::Error;

    fn poll(&mut self) -> Poll<Option<Self::Item>, io::Error> {
        match self.thread_receiver.poll() {
            Ok(Async::Ready(Some(Ok(data)))) => Ok(Async::Ready(Some(data))),
            Ok(Async::Ready(Some(Err(e)))) => Err(e),
            Ok(Async::Ready(None)) => Ok(Async::Ready(None)),
            Ok(Async::NotReady) => Ok(Async::NotReady),
            Err(e) => Err(io::Error::new(io::ErrorKind::Other, e)),
        }
    }
}

impl Sink for UdpSend {
    type SinkItem = (Bytes, SocketAddr);
    type SinkError = io::Error;

    fn start_send(&mut self, data: Self::SinkItem) -> StartSend<Self::SinkItem, io::Error> {
        match self.thread_sender.send((data.0, to_ipv6_addr(&data.1))) {
            Ok(()) => {
                self.pending_results += 1;
                Ok(AsyncSink::Ready)
            }
            Err(e) => {
                Err(io::Error::new(io::ErrorKind::Other, e))
            }
        }
    }

    fn poll_complete(&mut self) -> Poll<(), io::Error> {
        while self.pending_results != 0 {
            match self.results.poll() {
                Ok(Async::NotReady) => return Ok(Async::NotReady),
                Ok(Async::Ready(Some(Ok(())))) => {
                    self.pending_results -= 1;
                }
                Ok(Async::Ready(Some(Err(e)))) => {
                    self.pending_results -= 1;
                    return Err(e);
                }
                Ok(Async::Ready(None)) => {
                    let err = io::Error::new(io::ErrorKind::Other, "Child thread has closed");
                    return Err(err);
                }
                Err(e) => {
                    return Err(io::Error::new(io::ErrorKind::Other, e));
                }
            }
        }
        Ok(Async::Ready(()))
    }
}

impl UdpSend {
    /// Allows recovering the UdpSend even on errors.
    pub fn send_recoverable(self, val: (Bytes, SocketAddr)) -> SendRecoverable {
        SendRecoverable {
            socket: Some(self),
            val: Some(val),
        }
    }
}

pub struct SendRecoverable {
    socket: Option<UdpSend>,
    val: Option<(Bytes, SocketAddr)>
}

impl Future for SendRecoverable {
    type Item = UdpSend;
    type Error = (io::Error, UdpSend);

    fn poll(&mut self) -> Poll<Self::Item, Self::Error> {
        let mut socket = self.socket.take().expect("Poll called after end");
        if let Some(val) = self.val.take() {
            match socket.start_send(val) {
                Ok(AsyncSink::Ready) => (),
                Ok(AsyncSink::NotReady(val)) => {
                    self.val = Some(val);
                    self.socket = Some(socket);
                    return Ok(Async::NotReady);
                }
                Err(e) => return Err((e, socket)),
            }
        }
        match socket.poll_complete() {
            Ok(Async::Ready(())) => Ok(Async::Ready(socket)),
            Ok(Async::NotReady) => {
                self.socket = Some(socket);
                Ok(Async::NotReady)
            }
            Err(e) => Err((e, socket)),
        }
    }
}

