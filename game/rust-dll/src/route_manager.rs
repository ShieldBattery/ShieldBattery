use serde::Deserialize;
use tokio::prelude::*;
use tokio::sync::{mpsc};

use crate::cancel_token::{cancelable_channel, CancelableSender};

// The input, a channel to send results back to, and a cancel token
type SetupInput = (Vec<RouteInput>, CancelableSender<Result<Vec<Route>, ()>>);
pub struct RouteManager {
    send_setup: mpsc::Sender<SetupInput>,
}

#[derive(Debug)]
pub struct Route {
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

impl RouteManager {
    pub fn new() -> RouteManager {
        let (send_setup, receive_setup) = mpsc::channel::<SetupInput>(1);
        let task = crate::rally_point::init().into_future()
            .map_err(|e| {
                error!("Rally-point error: {}", e);
            })
            .and_then(|rally_point| {
                receive_setup
                    .map_err(|_| ())
                    .for_each(|(setup, done)| {
                        // TODO the actual work
                        assert!(setup.is_empty());
                        let task = done.send_result(
                            Ok(Vec::new()).into_future()
                        );
                        tokio::spawn(task);
                        Ok(())
                    })
            })
            .then(|_| {
                debug!("Route manager task ended");
                Ok(())
            });
        tokio::spawn(task);
        RouteManager {
            send_setup,
        }
    }

    pub fn setup(&self, routes: Vec<RouteInput>) -> impl Future<Item = Vec<Route>, Error = ()> {
        let (send, recv) = cancelable_channel();
        let future = self.send_setup.clone().send((routes, send))
            .map_err(|_| ())
            .and_then(|_| {
                recv.flatten()
            });
        future
    }
}
