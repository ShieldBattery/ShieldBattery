use std::path::PathBuf;

use futures::future::Either;
use quick_error::quick_error;
use serde::Deserialize;
use tokio::prelude::*;
use tokio::sync::{mpsc, oneshot};

use crate::{
    AsyncSenders, box_future, BoxedFuture, Settings, GameThreadRequest,
    GameThreadRequestType, GameType, SetupProgress, GAME_STATUS_ERROR,
};
use crate::bw;
use crate::cancel_token::{cancelable_channel, CancelableReceiver};
use crate::route_manager::{RouteManager, RouteInput, Route};
use crate::snp;

pub struct GameState {
    settings_set: bool,
    local_user: Option<LocalUser>,
    routes: RouteManager,
    routes_ready: Option<CancelableReceiver<Result<Vec<Route>, ()>>>,
    senders: AsyncSenders,
    init_main_thread: std::sync::mpsc::Sender<()>,
    send_main_thread_requests: std::sync::mpsc::Sender<GameThreadRequest>,
}

/// Messages sent from other async tasks to communicate with GameState
pub enum GameStateMessage {
    SetSettings(Settings),
    SetRoutes(Vec<RouteInput>),
    SetLocalUser(LocalUser),
    SetupGame(GameSetupInfo),
}

#[derive(Deserialize, Clone)]
pub struct LocalUser {
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSetupInfo {
    name: String,
    map: MapInfo,
    map_path: String,
    game_type: String,
    game_sub_type: u8,
    slots: Vec<PlayerInfo>,
    host: PlayerInfo,
    seed: u32,
}

impl GameSetupInfo {
    fn game_type(&self) -> Option<GameType> {
        let primary = match self.game_type {
            "melee" => 0x2,
            "ffa" => 0x3,
            "oneVOne" => 0x4,
            "ums" => 0xa,
            "teamMelee" => 0xb,
            "teamFfa" => 0xc,
            "topVBottom" => 0xf,
            _ => return None,
        };
        Some(GameType {
            primary,
            subtype: self.game_sub_type,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapInfo {
    hash: String,
    height: u32,
    width: u32,
    ums_slots: u8,
    slots: u8,
    tileset: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayerInfo {
    id: String,
    name: String,
    race: String,
    team_id: Option<u8>,
    // Player type can have shieldbattery-specific players (e.g. "observer"),
    // player type id is the id in BW structures.
    #[serde(rename = "type")]
    player_type: String,
    #[serde(rename = "typeId")]
    player_type_id: u8,
}

quick_error! {
    #[derive(Debug)]
    pub enum GameInitError {
        SettingsNotSet {
            description("Settings not set")
        }
        LocalUserNotSet {
            description("Local user not set")
        }
        RoutesNotSet {
            description("Routes not set")
        }
        Routes {
            description("Route setup error")
        }
        Closed {
            description("Game is being closed")
        }
        UnknownGameType(ty: String) {
            description("Unknown game type")
            display("Unknown game type '{}'", ty)
        }
    }
}

impl GameState {
    fn new(
        senders: AsyncSenders,
        init_main_thread: std::sync::mpsc::Sender<()>,
        send_main_thread_requests: std::sync::mpsc::Sender<GameThreadRequest>,
    ) -> GameState {
        GameState {
            settings_set: false,
            local_user: None,
            routes: RouteManager::new(),
            routes_ready: None,
            senders,
            init_main_thread,
            send_main_thread_requests,
        }
    }

    fn set_settings(&mut self, settings: &Settings) {
        // TODO check that game is not yet setup
        crate::forge::init(&settings.local);
        self.settings_set = true;
    }

    fn set_local_user(&mut self, user: LocalUser) {
        // TODO check that game is not yet setup
        self.local_user = Some(user);
    }

    fn set_routes(&mut self, routes: Vec<RouteInput>) {
        // TODO check that game is not yet setup
        let (send, recv) = cancelable_channel();
        let task = send.send_result(self.routes.setup(routes));
        tokio::spawn(task);
        self.routes_ready = Some(recv);
    }

    fn send_game_request(
        &mut self,
        request_type: GameThreadRequestType,
    ) -> impl Future<Item = (), Error = ()> {
        send_game_request(&self.send_main_thread_requests, request_type)
    }

    fn init_game(
        &mut self,
        info: GameSetupInfo,
    ) -> BoxedFuture<(), GameInitError> {
        if !self.settings_set {
            return box_future(Err(GameInitError::SettingsNotSet).into_future());
        }
        let local_user = match self.local_user.take() {
            Some(s) => s,
            None => return box_future(Err(GameInitError::LocalUserNotSet).into_future()),
        };
        let routes_ready = match self.routes_ready.take() {
            Some(s) => s,
            None => return box_future(Err(GameInitError::RoutesNotSet).into_future()),
        };
        let game_type = match info.game_type() {
            Some(s) => s,
            None => {
                let err = GameInitError::UnknownGameType(info.game_type);
                return box_future(Err(err).into_future());
            }
        };
        let init_request = GameThreadRequestType::Initialize;
        let is_host = local_user.name == info.host.name;
        let map_path = info.map_path.clone().into();
        let sender = self.send_main_thread_requests.clone();
        // We tell BW thread to init, and then it'll stay in forge's WndProc until we're
        // ready to start the game - remaining initialization is done from other threads.
        // Could possibly aim to keep all of BW initialization in the main thread, but this
        // system has worked fine so far.
        let pre_network_init = self.send_game_request(init_request)
            .map_err(|()| GameInitError::Closed)
            .and_then(move |()| {
                unsafe {
                    remaining_game_init(&local_user);
                    if is_host {
                        Either::A(create_lobby(game_type, map_path))
                    } else {
                        Either::B(Ok(()).into_future())
                    }
                }
            });
        // This future won't be ready until we tell WndProc to stop right before starting game
        // Also we want it to run after game thread init request, but no explicit ordering
        // is necessary since `send_game_request` uses the non-async std::sync::mpsc.
        let wnd_proc_done = self.send_game_request(GameThreadRequestType::RunWndProc)
            .map_err(|()| GameInitError::Closed);

        let routes = routes_ready
            .map_err(|_| ())
            .flatten()
            .map_err(|()| GameInitError::Routes)
            .and_then(|routes| {
                debug!("Using routes {:?}", routes);
                // TODO
                assert!(routes.is_empty());
                Ok(()).into_future()
            });
        let in_lobby = pre_network_init.join(routes)
            .and_then(move |((), ())| {
                if !is_host {
                    Either::A(join_lobby(&info))
                } else {
                    Either::B(Ok(()).into_future())
                }
            });

        unimplemented!();
    }

    fn handle_message(&mut self, message: GameStateMessage) {
        use self::GameStateMessage::*;
        match message {
            SetSettings(settings) => self.set_settings(&settings),
            SetLocalUser(user) => self.set_local_user(user),
            SetRoutes(routes) => self.set_routes(routes),
            SetupGame(info) => {
                let ws_send = self.senders.websocket.clone();
                let task = self.init_game(info)
                    .or_else(|e| {
                        let msg = format!("Failed to init game: {}", e);
                        error!("{}", msg);
                        let result = crate::encode_message("/game/setupProgress", SetupProgress {
                            status: crate::SetupProgressInfo {
                                state: GAME_STATUS_ERROR,
                                extra: Some(msg),
                            },
                        });
                        match result {
                            Ok(o) => {
                                box_future(ws_send.send(o).then(|_| Err(())))
                            }
                            Err(e) => {
                                error!("JSON encode error: {}", e);
                                box_future(Err(()).into_future())
                            }
                        }
                    })
                    .then(|_| {
                        debug!("Game init task ended");
                        Ok(())
                    });
                debug!("Spawning game init task");
                tokio::spawn(task);
            }
        }
    }
}

fn create_lobby(game_type: GameType, map_path: PathBuf) -> BoxedFuture<(), GameInitError> {
    unimplemented!()
}

fn join_lobby(info: &GameSetupInfo) -> BoxedFuture<(), GameInitError> {
    unimplemented!()
}

pub fn create_future(
    senders: &AsyncSenders,
    messages: mpsc::Receiver<GameStateMessage>,
    main_thread: std::sync::mpsc::Sender<()>,
    send_main_thread_requests: std::sync::mpsc::Sender<GameThreadRequest>,
) -> BoxedFuture<(), ()> {
    let mut game_state = GameState::new(senders.clone(), main_thread, send_main_thread_requests);
    let future = messages
        .map_err(|_| ())
        .for_each(move |message| {
            game_state.handle_message(message);
            Ok(())
        });
    box_future(future)
}

fn send_game_request(
    sender: &std::sync::mpsc::Sender<GameThreadRequest>,
    request_type: GameThreadRequestType,
) -> impl Future<Item = (), Error = ()> {
    let (done, wait_done) = oneshot::channel();
    let request = GameThreadRequest {
        done,
        request_type,
    };
    sender.send(request).into_future().map_err(|_| ())
        .and_then(|_| wait_done.map_err(|_| ()))
}

unsafe fn remaining_game_init(local_user: &LocalUser) {
    let name_bytes = local_user.name.as_bytes().iter().cloned().chain(Some(0));
    for (input, out) in name_bytes.zip(bw::local_player_name.iter_mut()) {
        *out = input;
    }
    // The old code waits for rally-point being bound here, but I don't really
    // see much reason to do that?
    bw::choose_network_provider(snp::PROVIDER_ID);
    *bw::is_multiplayer = 1;
}
