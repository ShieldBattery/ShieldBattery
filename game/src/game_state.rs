use std::ffi::CStr;
use std::mem;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration};

use bytes::Bytes;
use futures::{pin_mut, select};
use futures::prelude::*;
use quick_error::quick_error;
use tokio::sync::{mpsc, oneshot};

use crate::app_messages::{
    self, GameResults, GameSetupInfo, LocalUser, PlayerInfo, Route, Settings, SetupProgress,
    GAME_STATUS_ERROR,
};
use crate::app_socket;
use crate::bw::{self, GameType, with_bw};
use crate::cancel_token::{CancelToken, Canceler, SharedCanceler};
use crate::chat::StormPlayerId;
use crate::forge;
use crate::game_thread::{GameThreadRequest, GameThreadRequestType, GameThreadResults};
use crate::network_manager::{NetworkError, NetworkManager};
use crate::snp;
use crate::windows;

pub struct GameState {
    init_state: InitState,
    network: NetworkManager,
    ws_send: app_socket::SendMessages,
    internal_send: self::SendMessages,
    init_main_thread: std::sync::mpsc::Sender<()>,
    send_main_thread_requests: std::sync::mpsc::Sender<GameThreadRequest>,
    running_game: Option<Canceler>,
    async_stop: SharedCanceler,
}

pub type SendMessages = mpsc::Sender<GameStateMessage>;

enum InitState {
    WaitingForInput(IncompleteInit),
    Started(InitInProgress),
}

struct IncompleteInit {
    local_user: Option<LocalUser>,
    settings_set: bool,
    routes_set: bool,
}

impl IncompleteInit {
    fn init_if_ready(
        &mut self,
        info: &Arc<GameSetupInfo>,
    ) -> Result<InitInProgress, GameInitError> {
        if !self.settings_set {
            return Err(GameInitError::SettingsNotSet);
        }
        if !self.routes_set {
            return Err(GameInitError::RoutesNotSet);
        }
        if self.local_user.is_none() {
            return Err(GameInitError::LocalUserNotSet);
        }
        Ok(InitInProgress::new(
            info.clone(),
            Arc::new(self.local_user.take().unwrap()),
        ))
    }
}

/// Messages sent from other async tasks to communicate with GameState
pub enum GameStateMessage {
    SetSettings(Settings),
    SetRoutes(Vec<Route>),
    SetLocalUser(LocalUser),
    SetupGame(GameSetupInfo),
    Snp(snp::SnpMessage),
    InLobby,
    PlayerJoined,
    Results(GameThreadResults),
    CleanupQuit,
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
        Some(GameType { primary, subtype })
    }
}

quick_error! {
    #[derive(Debug, Clone)]
    pub enum GameInitError {
        InitInProgress {
            description("Game init is already in progress")
        }
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
        UnknownTileset(name: String) {
            description("Unknown tileset")
            display("Unknown tileset '{}'", name)
        }
        Bw(e: bw::LobbyCreateError) {
            description("BW error")
            display("BW error: {}", e)
        }
        NonAnsiPath(path: PathBuf) {
            description("A path cannot be passed to BW")
            display("Path '{}' cannot be passed to BW", path.display())
        }
        MissingMapInfo(desc: &'static str) {
            description("Missing map info")
            display("Missing map info '{}'", desc)
        }
    }
}

impl GameState {
    fn set_settings(&mut self, settings: &Settings) {
        if let InitState::WaitingForInput(ref mut state) = self.init_state {
            crate::forge::init(&settings.local);
            state.settings_set = true;
        } else {
            error!("Received settings after game was started");
        }
    }

    fn set_local_user(&mut self, user: LocalUser) {
        if let InitState::WaitingForInput(ref mut state) = self.init_state {
            state.local_user = Some(user);
        } else {
            error!("Received local user after game was started");
        }
    }

    fn set_routes(&mut self, routes: Vec<Route>) -> impl Future<Output = ()> {
        if let InitState::WaitingForInput(ref mut state) = self.init_state {
            state.routes_set = true;
            // TODO log error
            self.network.set_routes(routes).map(|_| ()).boxed()
        } else {
            error!("Received routes after game was started");
            future::ready(()).boxed()
        }
    }

    fn send_game_request(
        &mut self,
        request_type: GameThreadRequestType,
    ) -> impl Future<Output = ()> {
        send_game_request(&self.send_main_thread_requests, request_type)
    }

    /// On success returns after the game is finished and results have been forwarded
    /// to the app.
    fn init_game(
        &mut self,
        info: GameSetupInfo,
    ) -> impl Future<Output = Result<(), GameInitError>> {
        let game_type = match info.game_type() {
            Some(s) => s,
            None => {
                let err = GameInitError::UnknownGameType(info.game_type, info.game_sub_type);
                return future::err(err).boxed();
            }
        };

        // The complete initialization logic is split between futures in this function
        // and self.init_state updating itself in response to network events,
        // both places poking bw's state as well..
        // It may probably be better to move everything to InitInProgress and have this
        // function just initialize it?
        // For now it's worth noting that until the `init_state.wait_for_players` future
        // completes, InitInProgress will update bw's player state and setting observer
        // chat override.
        let info = Arc::new(info);
        let mut init_state = match self.init_state {
            InitState::WaitingForInput(ref mut state) => match state.init_if_ready(&info) {
                Ok(o) => o,
                Err(e) => return future::err(e).boxed(),
            },
            InitState::Started(_) => {
                return future::err(GameInitError::InitInProgress).boxed();
            }
        };
        let local_user = init_state.local_user.clone();
        let mut players_joined = init_state.wait_for_players().fuse();
        let results = init_state.wait_for_results();
        self.init_state = InitState::Started(init_state);

        let mut send_messages_to_state = self.internal_send.clone();
        let game_request_send = self.send_main_thread_requests.clone();
        let mut ws_send = self.ws_send.clone();

        let network_ready_future = self.network.wait_network_ready();
        let net_game_info_set_future = self.network.set_game_info(info.clone());

        self.init_main_thread
            .send(())
            .expect("Main thread should be waiting for a wakeup");
        async move {
            // We tell BW thread to init, and then it'll stay in forge's WndProc until we're
            // ready to start the game - remaining initialization is done from other threads.
            // Could possibly aim to keep all of BW initialization in the main thread, but this
            // system has worked fine so far.
            let is_host = local_user.name == info.host.name;
            let init_done =
                send_game_request(&game_request_send, GameThreadRequestType::Initialize);
            init_done.await;
            unsafe {
                with_bw(|bw| bw.remaining_game_init(&local_user.name));
                if is_host {
                    create_lobby(&info, game_type)?;
                }
            }
            start_game_request(&game_request_send, GameThreadRequestType::RunWndProc)
                .map_err(|()| GameInitError::Closed)?;
            net_game_info_set_future.await
                .map_err(|e| GameInitError::NetworkInit(e))?;
            network_ready_future.await
                .map_err(|e| GameInitError::NetworkInit(e))?;
            debug!("Network ready");
            if !is_host {
                unsafe {
                    join_lobby(&info, game_type).await?;
                }
            }
            debug!("In lobby, setting up slots");
            unsafe {
                setup_slots(&info.slots, game_type);
            }
            send_messages_to_state.send(GameStateMessage::InLobby).await
                .map_err(|_| GameInitError::Closed)?;
            loop {
                unsafe {
                    let mut someone_left = false;
                    let mut new_players = false;
                    with_bw(|bw| {
                        let flags_before = bw.storm_player_flags();
                        bw.maybe_receive_turns();
                        let flags_after = bw.storm_player_flags();
                        let flags = flags_before.iter().zip(flags_after.iter());
                        for (i, (&old, &new)) in flags.enumerate() {
                            if old == 0 && new != 0 {
                                bw.init_network_player_info(i as u32);
                                new_players = true;
                            }
                            if old != 0 && new == 0 {
                                someone_left = true;
                            }
                        }
                        if someone_left {
                            // No idea what to do here, launching is probably going to fail
                            // but log the error so that investigation will be easier.
                            error!(
                                "A player that was joined has left??? Before: {:x?} After: {:x?}",
                                flags_before, flags_after,
                            );
                        }
                    });

                    if new_players {
                        send_messages_to_state.send(GameStateMessage::PlayerJoined).await
                            .map_err(|_| GameInitError::Closed)?;
                    }
                }
                select! {
                    _ = tokio::time::delay_for(Duration::from_millis(100)).fuse() => continue,
                    _ = players_joined => break,
                }
            }
            debug!("All players have joined");
            unsafe {
                do_lobby_game_init(&info);
            }
            forge::end_wnd_proc();
            app_socket::send_message(&mut ws_send, "/game/start", ()).await
                .map_err(|_| GameInitError::Closed)?;

            let start_game_request = GameThreadRequestType::StartGame;
            let game_done = send_game_request(&game_request_send, start_game_request);
            game_done.await;
            let results = results.await?;
            app_socket::send_message(&mut ws_send, "/game/end", results).await
                .map_err(|_| GameInitError::Closed)?;
            Ok(())
        }.boxed()
    }

    // Message handler, so ideally only return futures that are about sending
    // messages to other tasks.
    fn handle_message(&mut self, message: GameStateMessage) -> impl Future<Output = ()> {
        use self::GameStateMessage::*;
        match message {
            SetSettings(settings) => {
                self.set_settings(&settings);
            }
            SetLocalUser(user) => {
                self.set_local_user(user);
            }
            SetRoutes(routes) => {
                return self.set_routes(routes).boxed();
            }
            SetupGame(info) => {
                let mut ws_send = self.ws_send.clone();
                let async_stop = self.async_stop.clone();
                let game_done = self.init_game(info);
                let task = async move {
                    if let Err(e) = game_done.await {
                        let msg = format!("Failed to init game: {}", e);
                        error!("{}", msg);

                        let message = SetupProgress {
                            status: crate::app_messages::SetupProgressInfo {
                                state: GAME_STATUS_ERROR,
                                extra: Some(msg),
                            },
                        };
                        let _ = app_socket::send_message(
                            &mut ws_send,
                            "/game/setupProgress",
                            message,
                        ).await;
                    }
                    debug!("Game setup & play task ended");
                    tokio::time::delay_for(Duration::from_millis(10000)).await;
                    // The app is supposed to send a CleanupQuit command to acknowledge
                    // that it received /game/end, or simple quit on error, but maybe it died?
                    //
                    // TODO(neive): Would be nice to do CleanupQuit if we finished game
                    // succesfully even if the app didn't end up replying to us?
                    warn!("Didn't receive close command, exiting automatically");
                    async_stop.cancel();
                };
                let (cancel_token, canceler) = CancelToken::new();
                self.running_game = Some(canceler);
                tokio::spawn(async move {
                    pin_mut!(task);
                    cancel_token.bind(task).await
                });
            }
            Snp(snp) => {
                return self.network.send_snp_message(snp).map(|_| ()).boxed();
            }
            InLobby | PlayerJoined => {
                if let InitState::Started(ref mut state) = self.init_state {
                    state.player_joined();
                } else {
                    warn!("Player joined before init was started");
                }
            }
            Results(results) => {
                if let InitState::Started(ref mut state) = self.init_state {
                    state.received_results(results);
                } else {
                    warn!("Received results before init was started");
                }
            }
            CleanupQuit => {
                let cleanup_request = GameThreadRequestType::ExitCleanup;
                let async_stop = self.async_stop.clone();
                let cleanup_done = self.send_game_request(cleanup_request);
                let task = async move {
                    cleanup_done.await;
                    debug!("BW cleanup done, exiting..");
                    async_stop.cancel();
                };
                tokio::spawn(task);
            }
        }
        future::ready(()).boxed()
    }
}

struct InitInProgress {
    on_all_players_joined: Vec<oneshot::Sender<Result<(), GameInitError>>>,
    all_players_joined: bool,
    setup_info: Arc<GameSetupInfo>,
    local_user: Arc<LocalUser>,
    joined_players: Vec<JoinedPlayer>,
    waiting_for_result: Vec<oneshot::Sender<Arc<GameResults>>>,
}

#[derive(Debug)]
struct JoinedPlayer {
    name: String,
    storm_id: StormPlayerId,
    player_id: Option<u8>,
}

impl InitInProgress {
    fn new(setup_info: Arc<GameSetupInfo>, local_user: Arc<LocalUser>) -> InitInProgress {
        InitInProgress {
            on_all_players_joined: Vec::new(),
            all_players_joined: false,
            setup_info,
            local_user,
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

        // Change ally chat for observers to be observer chat.
        let is_observer = self
            .setup_info
            .slots
            .iter()
            .find(|x| x.name == self.local_user.name)
            .map(|slot| slot.is_observer())
            .unwrap_or(false);
        if is_observer {
            let observer_storm_ids = self
                .setup_info
                .slots
                .iter()
                .filter(|x| x.is_observer())
                .filter_map(|slot| {
                    match self
                        .joined_players
                        .iter()
                        .find(|joined| slot.name == joined.name)
                    {
                        Some(s) => Some(s.storm_id),
                        None => {
                            error!("Couldn't find storm id for observer {}", slot.name);
                            None
                        }
                    }
                })
                .collect::<Vec<_>>();
            crate::chat::set_ally_override(&observer_storm_ids);
        } else {
            crate::chat::clear_ally_override();
        }

        for sender in self.on_all_players_joined.drain(..) {
            let _ = sender.send(result.clone());
        }
    }

    // Waits until players have joined.
    // self.player_joined gets called whenever game thread sends a join notification,
    // and once when the init task tells that a player is in lobby.
    fn wait_for_players(&mut self) -> impl Future<Output = Result<(), GameInitError>> {
        if self.all_players_joined {
            future::ok(()).boxed()
        } else {
            let (send_done, recv_done) = oneshot::channel();
            self.on_all_players_joined.push(send_done);
            recv_done
                .map_err(|_| GameInitError::Closed)
                .and_then(|inner| future::ready(inner))
                .boxed()
        }
    }

    fn wait_for_results(&mut self) -> impl Future<Output = Result<Arc<GameResults>, GameInitError>> {
        let (send_done, recv_done) = oneshot::channel();
        self.waiting_for_result.push(send_done);
        recv_done.map_err(|_| GameInitError::Closed)
    }

    // Return Ok(true) on done, Ok(false) on keep waiting
    unsafe fn update_joined_state(&mut self) -> Result<bool, GameInitError> {
        let storm_names = with_bw(|bw| storm_player_names(bw));
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
        let players = with_bw(|bw| bw.players());
        for (storm_id, name) in storm_names.iter().enumerate() {
            let storm_id = StormPlayerId(storm_id as u8);
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
                        let bw_slot = (0..12).find(|&i| {
                            let player = players.add(i);
                            let bw_name = CStr::from_ptr((*player).name.as_ptr() as *const i8);
                            bw_name.to_str() == Ok(name)
                        });
                        if let Some(bw_slot) = bw_slot {
                            (*players.add(bw_slot)).storm_id = storm_id.0 as u32;
                            player_id = Some(bw_slot as u8);
                        } else {
                            return Err(GameInitError::UnexpectedPlayer(name.into()));
                        }
                    }
                    if self.joined_players.iter().any(|x| x.player_id == player_id) {
                        return Err(GameInitError::UnexpectedPlayer(name.into()));
                    }
                    debug!("Player {} received storm id {}", name, storm_id.0);
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
        let waiting_for = self
            .setup_info
            .slots
            .iter()
            .filter(|s| s.is_human() || s.is_observer())
            .filter(|s| {
                !self
                    .joined_players
                    .iter()
                    .any(|player| s.name == player.name)
            })
            .map(|s| &s.name)
            .collect::<Vec<_>>();
        if waiting_for.is_empty() {
            true
        } else {
            debug!("Waiting for players {:?}", waiting_for);
            false
        }
    }

    fn received_results(&mut self, game_results: GameThreadResults) {
        use crate::game_thread::PlayerLoseType;

        #[derive(Copy, Clone, Eq, PartialEq)]
        #[repr(u8)]
        enum GameResult {
            Playing = 0,
            Disconnected = 1,
            Defeat = 2,
            Victory = 3,
        }

        let mut results = vec![GameResult::Playing; 8];
        let local_storm_id = self
            .joined_players
            .iter()
            .find(|x| x.name == self.local_user.name)
            .map(|x| x.storm_id.0)
            .unwrap_or_else(|| {
                panic!(
                    "Local user ({}) was not in joined players? ({:?})",
                    self.local_user.name, self.joined_players,
                );
            }) as usize;

        for player in &self.joined_players {
            if let Some(player_id) = player.player_id {
                let storm_id = player.storm_id.0 as usize;
                results[storm_id] = match game_results.victory_state[player_id as usize] {
                    1 => GameResult::Disconnected,
                    2 => GameResult::Defeat,
                    3 => GameResult::Victory,
                    _ => {
                        if storm_id == local_storm_id {
                            GameResult::Defeat
                        } else {
                            GameResult::Playing
                        }
                    }
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

        let results = self
            .joined_players
            .iter()
            .filter_map(|player| {
                if player.player_id.is_some() {
                    Some((
                        player.name.clone(),
                        results[player.storm_id.0 as usize] as u8,
                    ))
                } else {
                    None
                }
            })
            .collect();
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

unsafe fn create_lobby(info: &GameSetupInfo, game_type: GameType) -> Result<(), GameInitError> {
    let map_path = Path::new(&info.map_path);
    with_bw(|bw| bw.create_lobby(map_path, &info.name, game_type))
        .map_err(|e| GameInitError::Bw(e))
}

unsafe fn join_lobby(
    info: &GameSetupInfo,
    game_type: GameType,
) -> impl Future<Output = Result<(), GameInitError>> {
    let map_data = match info.map.map_data {
        Some(ref s) => s,
        None => return future::err(GameInitError::MissingMapInfo("map data")).boxed(),
    };
    let map_name = match info.map.name {
        Some(ref s) => s,
        None => return future::err(GameInitError::MissingMapInfo("name")).boxed(),
    };
    let tileset = match app_messages::bw_tileset_from_str(&map_data.tileset) {
        Some(s) => s as u16,
        None => {
            return future::err(GameInitError::UnknownTileset(map_data.tileset.clone())).boxed();
        }
    };
    let max_player_count = info.slots.len() as u8;
    let active_player_count = info
        .slots
        .iter()
        .filter(|x| x.is_human() || x.is_observer())
        .count() as u8;

    // This info isn't used ingame (with exception of game_type?),
    // but it is written in the header of replays/saves.
    let game_info = {
        let mut game_info = bw::JoinableGameInfo {
            index: 1,
            map_width: map_data.width,
            map_height: map_data.height,
            active_player_count,
            max_player_count,
            game_speed: 6, // Fastest
            game_type: game_type.primary as u16,
            game_subtype: game_type.subtype as u16,
            tileset,
            is_replay: 0,
            ..mem::zeroed()
        };
        for (out, val) in game_info.game_creator.iter_mut().zip(b"fakename".iter()) {
            *out = *val;
        }
        for (out, val) in game_info.name.iter_mut().zip(info.name.as_bytes().iter()) {
            *out = *val;
        }
        for (out, val) in game_info
            .map_name
            .iter_mut()
            .zip(map_name.as_bytes().iter())
        {
            *out = *val;
        }
        game_info
    };
    let map_path: Bytes = match windows::ansi_codepage_cstring(&info.map_path) {
        Ok(o) => o.into(),
        Err(_) => {
            return future::err(GameInitError::NonAnsiPath(
                (&info.map_path).into(),
            )).boxed();
        }
    };
    async move {
        let mut repeat_interval = tokio::time::interval(Duration::from_millis(10));
        while let Some(_) = repeat_interval.next().await {
            match try_join_lobby_once(game_info.clone(), map_path.clone()).await {
                Ok(()) => break,
                Err(e) => debug!("Storm join error: {:08x}", e),
            }
        }
        with_bw(|bw| {
            bw.init_game_network();
            bw.maybe_receive_turns();
            let storm_flags = bw.storm_player_flags();
            for (i, &flags) in storm_flags.iter().enumerate() {
                if flags != 0 {
                    bw.init_network_player_info(i as u32);
                }
            }
            let player_names = storm_player_names(bw);
            debug!("Storm player names at join: {:?}", player_names);
        });
        Ok(())
    }.boxed()
}

async unsafe fn try_join_lobby_once(
    mut game_info: bw::JoinableGameInfo,
    map_path: Bytes,
) -> Result<(), u32> {
    // Storm sends game join packets and then waits for a response *synchronously* (waiting for up to
    // 5 seconds). Since we're on the async thread, and our network code is on the async thread, obviously
    // that won't work out well (although did it work out "well" in the normal network interface? Not
    // really. But I digress). Therefore, we queue this onto a background thread, which will let our
    // network code actually do its job.
    let (send, recv) = oneshot::channel();
    std::thread::spawn(move || {
        snp::spoof_game("shieldbattery", Ipv4Addr::new(10, 27, 27, 0));
        let result = with_bw(|bw| bw.join_lobby(&mut game_info, &map_path));
        let _ = send.send(result);
    });

    match recv.await {
        Ok(storm_result) => storm_result,
        // Thread died??
        Err(_) => Err(!0u32),
    }
}

unsafe fn setup_slots(slots: &[PlayerInfo], game_type: GameType) {
    let players = with_bw(|bw| bw.players());
    for i in 0..8 {
        *players.add(i) = bw::Player {
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
        *players.add(slot_id) = bw::Player {
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

unsafe fn storm_player_names(bw: &dyn bw::Bw) -> Vec<Option<String>> {
    let storm_players = bw.storm_players();
    storm_players.iter().map(|player| {
        let name_len = player.name.iter().position(|&c| c == 0).unwrap_or(player.name.len());
        if name_len != 0 {
            Some(String::from_utf8_lossy(&player.name[..name_len]).into())
        } else {
            None
        }
    }).collect::<Vec<_>>()
}

unsafe fn do_lobby_game_init(info: &GameSetupInfo) {
    with_bw(|bw| {
        bw.do_lobby_game_init(info.seed)
    });
}

pub async fn create_future(
    ws_send: app_socket::SendMessages,
    async_stop: SharedCanceler,
    messages: mpsc::Receiver<GameStateMessage>,
    init_main_thread: std::sync::mpsc::Sender<()>,
    send_main_thread_requests: std::sync::mpsc::Sender<GameThreadRequest>,
) {
    let (internal_send, internal_recv) = mpsc::channel(8);
    let mut game_state = GameState {
        init_state: InitState::WaitingForInput(IncompleteInit {
            settings_set: false,
            local_user: None,
            routes_set: false,
        }),
        network: NetworkManager::new(),
        ws_send,
        internal_send,
        init_main_thread,
        send_main_thread_requests,
        running_game: None,
        async_stop,
    };
    let mut internal_recv = internal_recv.fuse();
    let mut messages = messages.fuse();
    loop {
        let message = select! {
            x = messages.next() => x,
            x = internal_recv.next() => x,
        };
        match message {
            Some(m) => game_state.handle_message(m).await,
            None => break,
        }
    }
}

/// Sends a request to game thread and waits for it to finish
fn send_game_request(
    sender: &std::sync::mpsc::Sender<GameThreadRequest>,
    request_type: GameThreadRequestType,
) -> impl Future<Output = ()> {
    // (Error means that game thread closed)
    let result = start_game_request(sender, request_type);
    async move {
        if let Ok(wait_done) = result {
            let _ = wait_done.await;
        };
    }
}

/// Sends a request to game thread and only waits until it has been sent,
/// resolves to a receiver that can be used to wait for finish.
fn start_game_request(
    sender: &std::sync::mpsc::Sender<GameThreadRequest>,
    request_type: GameThreadRequestType,
) -> Result<oneshot::Receiver<()>, ()> {
    let (request, wait_done) = GameThreadRequest::new(request_type);

    sender.send(request).map_err(|_| ())?;
    Ok(wait_done)
}
