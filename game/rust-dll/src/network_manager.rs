use std::sync::Arc;

use futures::future::{self, Either};
use quick_error::quick_error;
use serde::Deserialize;
use tokio::prelude::*;
use tokio::sync::{mpsc, oneshot};

use crate::cancel_token::{cancelable_channel, CancelableSender};
use crate::snp::{self, SnpMessage};
use crate::windows::OwnedHandle;

pub struct NetworkManager {
    send_messages: mpsc::Sender<NetworkManagerMessage>,
}

pub enum NetworkManagerMessage {
    Snp(SnpMessage),
    Routes(Vec<RouteInput>),
    WaitNetworkReady(oneshot::Sender<Result<(), NetworkError>>),
}

quick_error! {
    #[derive(Debug, Clone)]
    pub enum NetworkError {
        NotActive {
            description("Network task is not active")
        }
    }
}

#[derive(Debug)]
pub struct Route {
}

struct State {
    routes: Option<Result<(), NetworkError>>,
    // This existing means that storm side is active
    snp_send_messages: Option<snp::SendMessages>,
    waiting_for_routes: Vec<oneshot::Sender<Result<(), NetworkError>>>,
    waiting_for_snp: Vec<oneshot::Sender<()>>
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteInput {
    #[serde(rename = "for")]
    for_player: u8,
    server: String,
    route_id: u32,
    player_id: u8,
}

impl State {
    fn handle_message(&mut self, message: NetworkManagerMessage) {
        match message {
            NetworkManagerMessage::Routes(setup) => {
                // TODO the actual work
                assert!(setup.is_empty());
                let result = Ok(());
                for sender in self.waiting_for_routes.drain(..) {
                    let _ = sender.send(result.clone());
                }
                self.routes = Some(result);
            }
            NetworkManagerMessage::WaitNetworkReady(done) => {
                let snp_ok = if self.snp_send_messages.is_some() {
                    Either::A(future::ok(()))
                } else {
                    let (send, recv) = oneshot::channel();
                    self.waiting_for_snp.push(send);
                    Either::B(recv.map_err(|_| NetworkError::NotActive))
                };
                let routes_ok = match self.routes {
                    Some(ref s) => Either::A(s.clone().into_future()),
                    None => {
                        let (send, recv) = oneshot::channel();
                        self.waiting_for_routes.push(send);
                        Either::B(recv.map_err(|_| NetworkError::NotActive).flatten())
                    }
                };
                let task = snp_ok.join(routes_ok)
                    .map(|_| ())
                    .then(|result| {
                        let _ = done.send(result);
                        Ok(())
                    });
                tokio::spawn(task);
            }
            NetworkManagerMessage::Snp(message) => match message {
                SnpMessage::CreateNetworkHandler(send) => {
                    self.snp_send_messages = Some(send);
                    for sender in self.waiting_for_snp.drain(..) {
                        let _ = sender.send(());
                    }
                }
                SnpMessage::Destroy => {
                    self.snp_send_messages = None;
                    // TODO cancel what needs to be
                }
            },
        }
    }
}

impl NetworkManager {
    pub fn new() -> NetworkManager {
        let (send_messages, receive_messages) = mpsc::channel(64);
        let mut state = State {
            routes: None,
            snp_send_messages: None,
            waiting_for_routes: Vec::new(),
            waiting_for_snp: Vec::new(),
        };
        let task = crate::rally_point::init().into_future()
            .map_err(|e| {
                error!("Rally-point error: {}", e);
            })
            .and_then(|rally_point| {
                receive_messages
                    .map_err(|_| ())
                    .for_each(move |message| {
                        state.handle_message(message);
                        Ok(())
                    })
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
}
