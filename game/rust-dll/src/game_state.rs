use std::ffi::CStr;
use std::path::{Path, PathBuf};
use std::ptr::null_mut;
use std::sync::Arc;

use futures::future::{self, Either};
use quick_error::quick_error;
use tokio::prelude::*;
use tokio::sync::{mpsc, oneshot};

use crate::{
    AsyncSenders, box_future, BoxedFuture, GameThreadRequest, GameThreadRequestType,
    GameThreadResults,
};
use crate::bw;
use crate::client_socket;
use crate::client_messages::{
    GameSetupInfo, LocalUser, PlayerInfo, SetupProgress, Settings, GameResults, GAME_STATUS_ERROR
};
use crate::cancel_token::{CancelToken, Canceler, cancelable_channel, CancelableReceiver};
use crate::forge;
use crate::network_manager::{NetworkManager, RouteInput, NetworkError};
use crate::snp;
use crate::storm;
use crate::windows;

pub struct GameState {
    settings_set: bool,
    local_user: Option<LocalUser>,
    routes_set: bool,
    network: NetworkManager,
    senders: AsyncSenders,
    init_main_thread: std::sync::mpsc::Sender<()>,
    send_main_thread_requests: std::sync::mpsc::Sender<GameThreadRequest>,
    chat_ally_override: Option<Vec<StormPlayerId>>,
    running_game: Option<Canceler>,
    player_state: Option<PlayerState>,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
struct StormPlayerId(u8);

/// Messages sent from other async tasks to communicate with GameState
pub enum GameStateMessage {
    SetSettings(Settings),
    SetRoutes(Vec<RouteInput>),
    SetLocalUser(LocalUser),
    SetupGame(GameSetupInfo),
    Snp(snp::SnpMessage),
    InLobby,
    PlayerJoined,
    Results(GameThreadResults),
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
struct GameType {
    primary: u8,
    subtype: u8,
}

impl GameType {
    pub fn as_u32(self) -> u32 {
        self.primary as u32 | ((self.subtype as u32) << 16)
    }

    pub fn is_ums(&self) -> bool {
        self.primary == 0xa
    }

}

impl GameSetupInfo {
    fn game_type(&self) -> Option<GameType> {
        let (primary, subtype) = match &*self.game_type {
            "melee" => (0x2, 0x1),
            "ffa" => (0x3, 0x1),
            "oneVOne" => (0x4, 0x1),
            "ums" => (0xa, 0x1),
            // For team games the shieldbattery subtype is team count
            "teamMelee" => (0xb, self.game_sub_type? - 1),
            "teamFfa" => (0xc, self.game_sub_type? - 1),
            // For TvB the shieldbattery subtype is num players on top team
            "topVBottom" => (0xf, self.game_sub_type?),
            _ => return None,
        };
        Some(GameType {
            primary,
            subtype,
        })
    }
}

quick_error! {
    #[derive(Debug, Clone)]
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
        Closed {
            description("Game is being closed")
        }
        MapNotFound {
            description("Map was not found")
        }
        GameInitAlreadyInProgress {
            description("Cannot have two game inits active at once")
        }
        UnexpectedPlayer(name: String) {
            description("Unexpected player")
            display("Unexpected player name: {}", name)
        }
        StormIdChanged(name: String) {
            description("Player storm id changed")
            display("Unexpected storm id change for player {}", name)
        }
        NetworkInit(e: NetworkError) {
            description("Network initialization error")
            display("Network initialization error: {}", e)
        }
        UnknownGameType(ty: String, sub: Option<u8>) {
            description("Unknown game type")
            display("Unknown game type '{}', {:?}", ty, sub)
        }
        Bw(e: BwError) {
            description("BW error")
            display("BW error: {}", e)
        }
        NonAnsiPath(path: PathBuf) {
            description("A path cannot be passed to BW")
            display("Path '{}' cannot be passed to BW", path.display())
        }
    }
}

quick_error! {
    #[derive(Debug, Clone)]
    pub enum BwError {
        Unknown {}
        Invalid {}                 // This scenario is intended for use with a StarCraft Expansion Set.
        WrongGameType {}           // This map can only be played with the "Use Map Settings" game type.
        LadderBadAuth {}           // You must select an authenticated ladder map to start a ladder game.
        AlreadyExists {}           // A game by that name already exists!
        TooManyNames {}            // Unable to create game because there are too many games already running on this network.
        BadParameters {}           // An error occurred while trying to create the game.
        InvalidPlayerCount {}      // The selected scenario is not valid.
        UnsupportedGameType {}     // The selected map does not support the selected game type and options.
        MissingSaveGamePassword {} // You must enter a password to start a saved game.
        MissingReplayPassword {}   // You must enter a password to start a replay.
        IsDirectory {}             // (Changes the directory)
        NoHumanSlots {}            // This map does not have a slot for a human participant.
        NoComputerSlots {}         // You must have at least one computer opponent.
        InvalidLeagueMap {}        // You must select an official league map to start a league game.
        GameTypeUnavailable {}     // Unable to create game because the selected game type is currently unavailable.
        NotEnoughSlots {}          // The selected map does not have enough player slots for the selected game type.
        LeagueMissingBroodwar {}   // Brood War is required to play league games.
        LeagueBadAuth {}           // You must select an authenticated ladder map to start a ladder game.
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
            routes_set: false,
            network: NetworkManager::new(),
            senders,
            init_main_thread,
            send_main_thread_requests,
            chat_ally_override: None,
            running_game: None,
            player_state: None,
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

    fn set_routes(&mut self, routes: Vec<RouteInput>) -> BoxedFuture<(), ()> {
        // TODO check that game is not yet setup
        self.routes_set = true;
        box_future(self.network.set_routes(routes).or_else(|_| Ok(())))
    }

    fn send_game_request(
        &mut self,
        request_type: GameThreadRequestType,
    ) -> impl Future<Item = (), Error = ()> {
        send_game_request(&self.send_main_thread_requests, request_type)
    }

    fn start_game_request(
        &mut self,
        request_type: GameThreadRequestType,
    ) -> impl Future<Item = oneshot::Receiver<()>, Error = ()> {
        start_game_request(&self.send_main_thread_requests, request_type)
    }

    fn init_game(
        &mut self,
        info: GameSetupInfo,
    ) -> BoxedFuture<(), GameInitError> {
        if !self.settings_set {
            return box_future(Err(GameInitError::SettingsNotSet).into_future());
        }
        let local_user = match self.local_user {
            Some(ref s) => s.clone(),
            None => return box_future(Err(GameInitError::LocalUserNotSet).into_future()),
        };
        if !self.routes_set {
            return box_future(Err(GameInitError::RoutesNotSet).into_future());
        }
        let game_type = match info.game_type() {
            Some(s) => s,
            None => {
                let err = GameInitError::UnknownGameType(info.game_type, info.game_sub_type);
                return box_future(Err(err).into_future());
            }
        };
        let is_observer = info.slots.iter().find(|x| x.name == local_user.name)
            .map(|slot| slot.is_observer())
            .unwrap_or(false);
        if is_observer {
            unimplemented!("Override chat allies");
        } else {
            self.chat_ally_override = None;
        }

        let info = Arc::new(info);
        self.init_main_thread.send(()).expect("Main thread should be waiting for a wakeup");
        let init_request = GameThreadRequestType::Initialize;
        let is_host = local_user.name == info.host.name;
        let is_host = local_user.name == info.host.name;
        let info2 = info.clone();
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
                        create_lobby(&info2, game_type)
                    } else {
                        Ok(())
                    }
                }
            });
        // This future won't be ready until we tell WndProc to stop right before starting game
        // Also we want it to run after game thread init request, but no explicit ordering
        // is necessary since Game requests uses the non-async std::sync::mpsc.
        let wnd_proc_started = self.start_game_request(GameThreadRequestType::RunWndProc)
            .map_err(|()| GameInitError::Closed);

        let network_ready = self.network.wait_network_ready()
            .map_err(|e| GameInitError::NetworkInit(e))
            .inspect(|_| debug!("Network ready"));
        let info2 = info.clone();
        let in_lobby = pre_network_init.join3(network_ready, wnd_proc_started)
            .and_then(move |((), (), _wnd_proc_done)| {
                // Could carry wnd_proc_done around, but it should be fine to drop
                // as we end wnd proc and then send a new request to game thread without
                // any additional BW state poking from async side.
                if !is_host {
                    unsafe {
                        Either::A(join_lobby(&info2))
                    }
                } else {
                    Either::B(Ok(()).into_future())
                }
            });
        let info2 = info.clone();
        let info3 = info.clone();
        let mut player_state = PlayerState::new(info.clone());
        let players_joined = player_state.wait_for_players();
        let results = player_state.wait_for_results();
        self.player_state = Some(player_state);
        let send_messages_to_state = self.senders.game_state.clone();
        let lobby_ready = in_lobby
            .and_then(move |_| {
                debug!("In lobby, setting up slots");
                unsafe {
                    setup_slots(&info2.slots, game_type);
                }
                send_messages_to_state.send(GameStateMessage::InLobby)
                    .map_err(|_| GameInitError::Closed)
            })
            .and_then(move |_| players_joined)
            .and_then(move |()| {
                debug!("All players have joined");
                unsafe {
                    do_lobby_game_init(&info3);
                }
                Ok(())
            });
        let ws_send = self.senders.websocket.clone();
        let game_request_send = self.send_main_thread_requests.clone();
        let finished = lobby_ready
            .and_then(|()| {
                forge::end_wnd_proc();
                client_socket::send_message(ws_send, "/game/start", ())
                    .map_err(|_| GameInitError::Closed)
            }).and_then(move |ws_send| {
                let start_game_request = GameThreadRequestType::StartGame;
                let game_done = send_game_request(&game_request_send, start_game_request)
                    .map(|()| ws_send)
                    .map_err(|_| GameInitError::Closed);
                game_done.join(results)
            }).and_then(|(ws_send, results)| {
                client_socket::send_message(ws_send, "/game/end", results)
                    .map(|_| ())
                    .map_err(|_| GameInitError::Closed)
            });
        box_future(finished)
    }

    // Message handler, so ideally only return futures that are about sending
    // messages to other tasks.
    fn handle_message(&mut self, message: GameStateMessage) -> BoxedFuture<(), ()> {
        use self::GameStateMessage::*;
        match message {
            SetSettings(settings) => {
                self.set_settings(&settings);
                box_future(future::ok(()))
            }
            SetLocalUser(user) => {
                self.set_local_user(user);
                box_future(future::ok(()))
            }
            SetRoutes(routes) => self.set_routes(routes),
            SetupGame(info) => {
                let ws_send = self.senders.websocket.clone();
                let task = self.init_game(info)
                    .or_else(|e| {
                        let msg = format!("Failed to init game: {}", e);
                        error!("{}", msg);

                        let message = SetupProgress {
                            status: crate::client_messages::SetupProgressInfo {
                                state: GAME_STATUS_ERROR,
                                extra: Some(msg),
                            },
                        };
                        client_socket::send_message(ws_send, "/game/setupProgress", message)
                            .map(|_| ())
                    })
                    .then(|_| {
                        debug!("Game setup & play task ended");
                        Ok(())
                    });
                let (cancel_token, canceler) = CancelToken::new();
                self.running_game = Some(canceler);
                tokio::spawn(cancel_token.bind(task));
                box_future(future::ok(()))
            }
            Snp(snp) => box_future(self.network.send_snp_message(snp)),
            InLobby | PlayerJoined => {
                if let Some(ref mut state) = self.player_state {
                    state.player_joined();
                } else {
                    warn!("Player joined before player state was set");
                }
                box_future(future::ok(()))
            }
            Results(results) => {
                if let Some(ref mut player_state) = self.player_state {
                    if let Some(ref local_user) = self.local_user {
                        player_state.received_results(results, local_user);
                    } else {
                        warn!("Received results before local user was set");
                    }
                } else {
                    warn!("Received results before player state was set");
                }
                box_future(future::ok(()))
            }
        }
    }
}

struct PlayerState {
    on_all_players_joined: Vec<oneshot::Sender<Result<(), GameInitError>>>,
    all_players_joined: bool,
    setup_info: Arc<GameSetupInfo>,
    joined_players: Vec<JoinedPlayer>,
    waiting_for_result: Vec<oneshot::Sender<Arc<GameResults>>>,
}

#[derive(Debug)]
struct JoinedPlayer {
    name: String,
    storm_id: u8,
    player_id: Option<u8>,
}

impl PlayerState {
    fn new(setup_info: Arc<GameSetupInfo>) -> PlayerState {
        PlayerState {
            on_all_players_joined: Vec::new(),
            all_players_joined: false,
            setup_info,
            joined_players: Vec::new(),
            waiting_for_result: Vec::new(),
        }
    }

    fn player_joined(&mut self) {
        let result = match unsafe { self.update_joined_state() } {
            Ok(true) => Ok(()),
            Err(e) => Err(e),
            Ok(false) => return,
        };
        self.all_players_joined = true;
        for sender in self.on_all_players_joined.drain(..) {
            let _ = sender.send(result.clone());
        }
    }

    // Waits until players have joined.
    // self.player_wait_state gets signaled whenever game thread sends a join notification,
    // and once when the init task tells that a player is in lobby.
    fn wait_for_players(
        &mut self,
    ) -> BoxedFuture<(), GameInitError> {
        if self.all_players_joined {
            box_future(future::ok(()))
        } else {
            let (send_done, recv_done) = oneshot::channel();
            self.on_all_players_joined.push(send_done);
            box_future(recv_done.map_err(|_| GameInitError::Closed).flatten())
        }
    }

    fn wait_for_results(&mut self) -> impl Future<Item = Arc<GameResults>, Error = GameInitError> {
        let (send_done, recv_done) = oneshot::channel();
        self.waiting_for_result.push(send_done);
        recv_done.map_err(|_| GameInitError::Closed)
    }

    // Return Ok(true) on done, Ok(false) on keep waiting
    unsafe fn update_joined_state(&mut self) -> Result<bool, GameInitError> {
        let storm_names = storm::SNetGetPlayerNames();
        self.update_bw_slots(&storm_names)?;
        if self.has_all_players() {
            Ok(true)
        } else {
            Ok(false)
        }
    }

    unsafe fn update_bw_slots(
        &mut self,
        storm_names: &[Option<String>],
    ) -> Result<(), GameInitError> {
        for (storm_id, name) in storm_names.iter().enumerate() {
            let storm_id = storm_id as u8;
            let name = match name {
                Some(ref s) => &**s,
                None => continue,
            };
            let joined_pos = self.joined_players.iter().position(|x| x.name == name);
            if let Some(joined_pos) = joined_pos {
                if self.joined_players[joined_pos].storm_id != storm_id {
                    return Err(GameInitError::StormIdChanged(name.into()));
                }
            } else {
                if let Some(slot) = self.setup_info.slots.iter().find(|x| x.name == name) {
                    let player_id;
                    if slot.is_observer() {
                        player_id = None;
                    } else {
                        let bw_slot = (*bw::players).iter_mut().position(|x| {
                            let bw_name = CStr::from_ptr(x.name.as_ptr() as *const i8);
                            bw_name.to_str() == Ok(name)
                        });
                        if let Some(bw_slot) = bw_slot {
                            bw::players[bw_slot].storm_id = storm_id as u32;
                            player_id = Some(bw_slot as u8);
                        } else {
                            return Err(GameInitError::UnexpectedPlayer(name.into()));
                        }
                    }
                    if self.joined_players.iter().any(|x| x.player_id == player_id) {
                        return Err(GameInitError::UnexpectedPlayer(name.into()));
                    }
                    debug!("Player {} received storm id {}", name, storm_id);
                    self.joined_players.push(JoinedPlayer {
                        name: name.into(),
                        storm_id,
                        player_id,
                    });
                } else {
                    return Err(GameInitError::UnexpectedPlayer(name.into()));
                }
            }
        }
        Ok(())
    }

    fn has_all_players(&self) -> bool {
        let waiting_for = self.setup_info.slots.iter()
            .filter(|s| s.is_human() || s.is_observer())
            .filter(|s| !self.joined_players.iter().any(|player| s.name == player.name))
            .map(|s| &s.name)
            .collect::<Vec<_>>();
        if waiting_for.is_empty() {
            true
        } else {
            debug!("Waiting for players {:?}", waiting_for);
            false
        }
    }

    fn received_results(&mut self, game_results: GameThreadResults, local_user: &LocalUser) {
        use crate::PlayerLoseType;

        #[derive(Copy, Clone, Eq, PartialEq)]
        #[repr(u8)]
        enum GameResult {
            Playing = 0,
            Disconnected = 1,
            Defeat = 2,
            Victory = 3,
        }

        let mut results = vec![GameResult::Playing; 8];
        let local_storm_id = self.joined_players.iter()
            .find(|x| x.name == local_user.name)
            .map(|x| x.storm_id)
            .unwrap_or_else(|| {
                panic!(
                    "Local user ({}) was not in joined players? ({:?})",
                    local_user.name, self.joined_players,
                );
            }) as usize;


        for player in &self.joined_players {
            if let Some(player_id) = player.player_id {
                let storm_id = player.storm_id as usize;
                results[storm_id] = match game_results.victory_state[player_id as usize] {
                    1 => GameResult::Disconnected,
                    2 => GameResult::Defeat,
                    3 => GameResult::Victory,
                    _ => if storm_id == local_storm_id {
                        GameResult::Defeat
                    } else {
                        GameResult::Playing
                    },
                };
            }
        }

        let lose_type = game_results.player_lose_type;
        for storm_id in 0..8 {
            if game_results.player_has_left[storm_id] {
                results[storm_id] = if lose_type == Some(PlayerLoseType::UnknownDisconnect) {
                    GameResult::Playing
                } else {
                    GameResult::Disconnected
                };
            }
        }
        match lose_type {
            Some(PlayerLoseType::UnknownDisconnect) => {
                results[local_storm_id] = GameResult::Disconnected;
            }
            Some(PlayerLoseType::UnknownChecksumMismatch) => {
                results[local_storm_id] = GameResult::Playing;
            }
            None => (),
        }

        let results = self.joined_players.iter()
            .filter_map(|player| {
                if player.player_id.is_some() {
                    Some((player.name.clone(), results[player.storm_id as usize] as u8))
                } else {
                    None
                }
            }).collect();
        let message = Arc::new(GameResults {
            results,
            // Assuming fastest speed
            time_ms: game_results.time_ms,
        });
        for send in self.waiting_for_result.drain(..) {
            let _ = send.send(message.clone());
        }
    }
}

unsafe fn find_map_entry(map_path: &Path) -> Result<*mut bw::MapListEntry, GameInitError> {
    let map_dir = match map_path.parent() {
        Some(s) => s.into(),
        None => {
            warn!("Assuming map '{}' is in current working directory", map_path.display());
            match std::env::current_dir() {
                Ok(o) => o,
                Err(_) => return Err(GameInitError::MapNotFound),
            }
        }
    };
    let map_file = match map_path.file_name() {
        Some(s) => s,
        None => return Err(GameInitError::MapNotFound),
    };
    let map_file = windows::ansi_codepage_cstring(&map_file)
        .map_err(|_| GameInitError::NonAnsiPath(map_file.into()))?;
    let map_dir = windows::ansi_codepage_cstring(&map_dir)
        .map_err(|_| GameInitError::NonAnsiPath(map_dir.into()))?;
    for (i, &val) in map_dir.iter().enumerate() {
        bw::current_map_folder_path[i] = val;
    }

    extern "stdcall" fn dummy(_a: *mut bw::MapListEntry, _b: *const u8, _c: u32) -> u32 {
        0
    }
    bw::get_maps_list(0x28, (*bw::current_map_folder_path).as_ptr(), "\0".as_ptr(), dummy);
    let mut current_map = *bw::map_list_root;
    while current_map as isize > 0 {
        let name = CStr::from_ptr((*current_map).name.as_ptr() as *const i8);
        if name.to_bytes_with_nul() == &map_file[..] {
            return Ok(current_map);
        }
        current_map = (*current_map).next;
    }
    Err(GameInitError::MapNotFound)
}

unsafe fn create_lobby(info: &GameSetupInfo, game_type: GameType) -> Result<(), GameInitError> {
    let map = find_map_entry(Path::new(&info.map_path))?;
    // Password must be null for replays to work
    let name = windows::ansi_codepage_cstring(&info.name)
        .unwrap_or_else(|_| (&b"Shieldbattery\0"[..]).into());
    let password = null_mut();
    let map_folder_path = (*bw::current_map_folder_path).as_ptr();
    let speed = 6; // Fastest
    let result = bw::select_map_or_directory(
        name.as_ptr(),
        password,
        game_type.as_u32(),
        speed,
        map_folder_path,
        map,
    );
    if result != 0 {
        return Err(GameInitError::Bw(match result {
            0x8000_0001 => BwError::Invalid,
            0x8000_0002 => BwError::WrongGameType,
            0x8000_0003 => BwError::LadderBadAuth,
            0x8000_0004 => BwError::AlreadyExists,
            0x8000_0005 => BwError::TooManyNames,
            0x8000_0006 => BwError::BadParameters,
            0x8000_0007 => BwError::InvalidPlayerCount,
            0x8000_0008 => BwError::UnsupportedGameType,
            0x8000_0009 => BwError::MissingSaveGamePassword,
            0x8000_000a => BwError::MissingReplayPassword,
            0x8000_000b => BwError::IsDirectory,
            0x8000_000c => BwError::NoHumanSlots,
            0x8000_000d => BwError::NoComputerSlots,
            0x8000_000e => BwError::InvalidLeagueMap,
            0x8000_000f => BwError::GameTypeUnavailable,
            0x8000_0010 => BwError::NotEnoughSlots,
            0x8000_0011 => BwError::LeagueMissingBroodwar,
            0x8000_0012 => BwError::LeagueBadAuth,
            _ => BwError::Unknown,
        }));
    }
    bw::init_game_network();
    Ok(())
}

unsafe fn join_lobby(info: &GameSetupInfo) -> BoxedFuture<(), GameInitError> {
    // this._log('verbose', 'Attempting to join lobby')

    // this.bindings.spoofGame('shieldbattery', false, host, port)
    // const isJoined = await new Promise(resolve => {
    //   this.bindings.joinGame(mapPath, bwGameInfo, resolve)
    // })
    // if (!isJoined) {
    //   throw new Error('Could not join game')
    // }

    // this.bindings.initGameNetwork()
    // inLobby = true
    unimplemented!()
}

unsafe fn setup_slots(slots: &[PlayerInfo], game_type: GameType) {
    for i in 0..8 {
        bw::players[i] = bw::Player {
            player_id: i as u32,
            storm_id: 255,
            player_type: match slots.len() < i {
                true => bw::PLAYER_TYPE_OPEN,
                false => bw::PLAYER_TYPE_NONE,
            },
            race: bw::RACE_RANDOM,
            team: 0,
            name: [0; 25],
        };
    }
    let is_ums = game_type.is_ums();
    for (i, slot) in slots.iter().enumerate() {
        if slot.is_observer() {
            continue;
        }
        let slot_id = if is_ums {
            slot.player_id.unwrap_or(0) as usize
        } else {
            i
        };
        // This player_type_id check is completely ridiculous and doesn't make sense, but that gives
        // the same behaviour as normal bw. Not that any maps use those slot types as Scmdraft
        // doesn't allow setting them anyways D:
        let team = if !is_ums || (slot.player_type_id != 1 && slot.player_type_id != 2) {
            slot.team_id.unwrap_or(0)
        } else {
            0
        };
        let mut name = [0; 25];
        for (i, &byte) in slot.name.as_bytes().iter().take(24).enumerate() {
            name[i] = byte;
        }
        bw::players[slot_id] = bw::Player {
            player_id: slot_id as u32,
            storm_id: match slot.is_human() {
                true => 27,
                false => 255,
            },
            race: slot.bw_race(),
            player_type: if is_ums && !slot.is_human() {
                // The type of UMS computers is set in the map file, and we have no reason to
                // worry about the various possibilities there are, so just pass the integer onwards.
                slot.player_type_id
            } else {
                slot.bw_player_type()
            },
            team,
            name,
        };
    }
}

unsafe fn do_lobby_game_init(info: &GameSetupInfo) {
    let storm_names = storm::SNetGetPlayerNames();
    let storm_ids_to_init = info.slots.iter()
        .filter(|s| s.is_human() || s.is_observer())
        .map(|s| {
            storm_names.iter().position(|x| match x {
                Some(name) => name == &s.name,
                None => false,
            }).unwrap_or_else(|| {
                // Okay, this really should not have passed has_all_players
                panic!("No storm id for player {}", s.name);
            })
        });
    for id in storm_ids_to_init {
        bw::init_network_player_info(id as u32, 0, 1, 5);
    }

    bw::update_nation_and_human_ids(*bw::local_storm_id);
    *bw::lobby_state = 8;
    let data = bw::LobbyGameInitData {
        game_init_command: 0x48,
        random_seed: info.seed,
        // TODO(tec27): deal with player bytes if we ever allow save games
        player_bytes: [8; 8],
    };
    // We ask bw to handle lobby game init packet that was sent by host (storm id 0)
    bw::on_lobby_game_init(0, &data);
    *bw::lobby_state = 9;
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
            game_state.handle_message(message)
        });
    box_future(future)
}

/// Sends a request to game thread and waits for it to finish
fn send_game_request(
    sender: &std::sync::mpsc::Sender<GameThreadRequest>,
    request_type: GameThreadRequestType,
) -> impl Future<Item = (), Error = ()> {
    start_game_request(sender, request_type)
        .and_then(|wait_done| wait_done.map_err(|_| ()))
}

/// Sends a request to game thread and only waits until it has been sent,
/// resolves to a receiver that can be used to wait for finish.
fn start_game_request(
    sender: &std::sync::mpsc::Sender<GameThreadRequest>,
    request_type: GameThreadRequestType,
) -> impl Future<Item = oneshot::Receiver<()>, Error = ()> {
    let (done, wait_done) = oneshot::channel();
    let request = GameThreadRequest {
        done,
        request_type,
    };
    sender.send(request).into_future().map_err(|_| ())
        .map(|_| wait_done)
}

unsafe fn remaining_game_init(local_user: &LocalUser) {
    let name = windows::ansi_codepage_cstring(&local_user.name)
        .unwrap_or_else(|e| e);
    for (&input, out) in name.iter().zip(bw::local_player_name.iter_mut()) {
        *out = input;
    }
    // The old code waits for rally-point being bound here, but I don't really
    // see much reason to do that?
    bw::choose_network_provider(snp::PROVIDER_ID);
    *bw::is_multiplayer = 1;
}
