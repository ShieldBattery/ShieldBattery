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
use std::net::{SocketAddr, SocketAddrV6, UdpSocket};
use std::os::windows::io::FromRawSocket;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::task::{self, Poll};

use bytes::Bytes;
use futures::prelude::*;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};
use winapi::shared::ws2def::{AF_INET6, IPPROTO_IPV6, SOCK_DGRAM};
use winapi::shared::ws2ipdef::{IPV6_V6ONLY, SOCKADDR_IN6_LH};
use winapi::um::winsock2::{
    bind, setsockopt, socket, WSAGetLastError, WSAStartup, INVALID_SOCKET, WSADATA,
};

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
        SocketAddr::V4(v4) => SocketAddrV6::new(v4.ip().to_ipv6_mapped(), v4.port(), 0, 0),
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
            sin6_port: local_addr.port().to_be(),
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
    let (send_result, recv_result) = unbounded_channel();
    std::thread::spawn(move || {
        while let Ok((val, addr)) = recv.recv() {
            let val: Bytes = val;
            let result = match socket.send_to(&val, addr) {
                Ok(len) => {
                    if val.len() == len {
                        Ok(())
                    } else {
                        Err(io::Error::new(
                            io::ErrorKind::Other,
                            "Failed to send all of the data",
                        ))
                    }
                }
                Err(e) => Err(e),
            };
            if let Err(_) = send_result.send(result) {
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
    let (send, recv) = unbounded_channel();
    std::thread::spawn(move || {
        let mut buf = vec![0; 2048];
        loop {
            if closed2.load(Ordering::Relaxed) == true {
                break;
            }
            let result = match socket2.recv_from(&mut buf) {
                Ok((n, addr)) => {
                    let bytes = Bytes::copy_from_slice(&buf[..n]);
                    Ok((bytes, to_ipv6_addr(&addr)))
                }
                Err(e) => Err(e),
            };
            if let Err(_) = send.send(result) {
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
    type Item = Result<(Bytes, SocketAddrV6), io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut task::Context) -> Poll<Option<Self::Item>> {
        self.thread_receiver.poll_recv(cx)
    }
}

impl Sink<(Bytes, SocketAddr)> for UdpSend {
    type Error = io::Error;

    fn poll_ready(self: Pin<&mut Self>, _cx: &mut task::Context) -> Poll<Result<(), io::Error>> {
        Poll::Ready(Ok(()))
    }

    fn start_send(mut self: Pin<&mut Self>, data: (Bytes, SocketAddr)) -> Result<(), io::Error> {
        match self.thread_sender.send((data.0, to_ipv6_addr(&data.1))) {
            Ok(()) => {
                self.pending_results += 1;
                Ok(())
            }
            Err(e) => Err(io::Error::new(io::ErrorKind::Other, e)),
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut task::Context) -> Poll<Result<(), io::Error>> {
        while self.pending_results != 0 {
            match self.results.poll_recv(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Ok(()))) => {
                    self.pending_results -= 1;
                }
                Poll::Ready(Some(Err(e))) => {
                    self.pending_results -= 1;
                    return Poll::Ready(Err(e));
                }
                Poll::Ready(None) => {
                    let err = io::Error::new(io::ErrorKind::Other, "Child thread has closed");
                    return Poll::Ready(Err(err));
                }
            }
        }
        Poll::Ready(Ok(()))
    }

    fn poll_close(self: Pin<&mut Self>, cx: &mut task::Context) -> Poll<Result<(), io::Error>> {
        self.poll_flush(cx)
    }
}
