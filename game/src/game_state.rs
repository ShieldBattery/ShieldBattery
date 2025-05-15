use std::ffi::{CStr, CString};
use std::io;
use std::mem;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::pin::{pin, Pin};
use std::sync::Arc;
use std::time::Duration;

use futures::prelude::*;
use hashbrown::{HashMap, HashSet};
use quick_error::quick_error;
use reqwest::header::{HeaderMap, ORIGIN};
use smallvec::SmallVec;
use tokio::select;
use tokio::sync::{mpsc, oneshot};

use crate::app_messages::{
    GamePlayerResult, GameResults, GameResultsReport, GameSetupInfo, LobbyPlayerId, LocalUser,
    MapForce, NetworkStallInfo, PlayerInfo, Route, Settings, SetupProgress, UmsLobbyRace,
    GAME_STATUS_ERROR,
};
use crate::app_socket;
use crate::bw::players::{AllianceState, BwPlayerId, PlayerLoseType, StormPlayerId, VictoryState};
use crate::bw::{self, get_bw, Bw, GameType, LobbyOptions, UserLatency};
use crate::bw_scr::BwScr;
use crate::cancel_token::{CancelToken, Canceler, SharedCanceler};
use crate::forge;
use crate::game_thread::{
    self, GameThreadMessage, GameThreadRequest, GameThreadRequestType, GameThreadResults,
};
use crate::network_manager::{
    GameStateToNetworkMessage, NetworkError, NetworkManager, NetworkToGameStateMessage,
};
use crate::proto::messages::game_message_payload::Payload;
use crate::proto::messages::{ClientAckResponseMessage, ClientReadyMessage};
use crate::replay;

pub type SendMessages = mpsc::Sender<GameStateMessage>;

pub struct GameState {
    init_state: InitState,
    network: NetworkManager,
    network_send: mpsc::Sender<GameStateToNetworkMessage>,
    ws_send: app_socket::SendMessages,
    internal_send: SendMessages,
    init_main_thread: std::sync::mpsc::Sender<()>,
    send_main_thread_requests: std::sync::mpsc::Sender<GameThreadRequest>,
    #[allow(dead_code)]
    running_game: Option<Canceler>,
    async_stop: SharedCanceler,
    can_start_game: AwaitableTaskState,
    game_started: bool,
}

enum AwaitableTaskState<T = ()> {
    Complete,
    /// Things waiting for the task to complete push wakeup sender here
    Incomplete(Vec<oneshot::Sender<T>>),
}

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
    SetupGame(Box<GameSetupInfo>),
    StartWhenReady,
    InLobby,
    PlayersChanged,
    GameSetupDone,
    GameThread(GameThreadMessage),
    Network(NetworkToGameStateMessage),
    CleanupQuit,
    QuitIfNotStarted,
}

quick_error! {
    #[derive(Debug, Clone)]
    pub enum GameInitError {
        InitInProgress {
            display("Game init is already in progress")
        }
        SettingsNotSet {
            display("Settings not set")
        }
        LocalUserNotSet {
            display("Local user not set")
        }
        RoutesNotSet {
            display("Routes not set")
        }
        Closed {
            display("Game is being closed")
        }
        GameInitAlreadyInProgress {
            display("Cannot have two game inits active at once")
        }
        GameInitNotInProgress {
            display("Game isn't being inited")
        }
        UnexpectedPlayer(name: String) {
            display("Unexpected player name: {}", name)
        }
        NoShieldbatteryId(name: String) {
            display("Player {} doesn't have shieldbattery user id", name)
        }
        StormIdChanged(name: String) {
            display("Unexpected storm id change for player {}", name)
        }
        NetworkInit(e: NetworkError) {
            display("Network initialization error: {}", e)
        }
        UnknownGameType(ty: String, sub: Option<u8>) {
            display("Unknown game type '{}', {:?}", ty, sub)
        }
        Bw(e: bw::LobbyCreateError) {
            display("BW error: {}", e)
        }
        NonAnsiPath(path: PathBuf) {
            display("Path '{}' cannot be passed to BW", path.display())
        }
        MissingMapInfo(desc: &'static str) {
            display("Missing map info '{}'", desc)
        }
        NullInPath(path: String) {
            display("Path '{}' contains null character", path)
        }
    }
}

impl GameState {
    fn set_settings(&mut self, settings: &Settings) {
        if let InitState::WaitingForInput(ref mut state) = self.init_state {
            forge::init(&settings.local);
            get_bw().set_settings(settings);
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

    fn set_routes(&mut self, routes: Vec<Route>) -> impl Future<Output = ()> + '_ {
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

    fn wait_can_start_game(&mut self) -> impl Future<Output = ()> {
        let recv = match self.can_start_game {
            AwaitableTaskState::Incomplete(ref mut waiters) => {
                let (send, recv) = oneshot::channel();
                waiters.push(send);
                Some(recv)
            }
            AwaitableTaskState::Complete => None,
        };
        async move {
            if let Some(recv) = recv {
                let _ = recv.await;
            }
        }
    }

    /// On success, returns once game is ready to be started & shown.
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

        let info = Arc::new(info);
        // The complete initialization logic is split between futures in this function
        // and self.init_state updating itself in response to network events,
        // both places poking bw's state as well..
        // It may probably be better to move everything to InitInProgress and have this
        // function just initialize it?
        // For now it's worth noting that until the `init_state.wait_for_players` future
        // completes, InitInProgress will update bw's player state.
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
        let mut players_joined = init_state.wait_for_players().boxed();
        let all_players_ready = init_state.wait_all_players_ready().boxed();
        self.init_state = InitState::Started(init_state);

        let send_messages_to_state = self.internal_send.clone();
        let game_request_send = self.send_main_thread_requests.clone();

        let network_send = self.network_send.clone();

        let network = self.network.clone();
        let allow_start = self.wait_can_start_game().boxed();

        self.init_main_thread
            .send(())
            .expect("Main thread should be waiting for a wakeup");
        async move {
            let init_routes_when_ready_future = network.init_routes_when_ready();
            let network_ready_future = network.wait_network_ready();
            let net_game_info_set_future = network.set_game_info(info.clone());

            let sbat_replay_data = match info.is_replay() {
                true => Some(read_sbat_replay_data(Path::new(&info.map_path))),
                false => None,
            };
            // We tell BW thread to init, and then it'll stay in forge's WndProc until we're
            // ready to start the game - remaining initialization is done from other threads.
            // Could possibly aim to keep all of BW initialization in the main thread, but this
            // system has worked fine so far.
            let is_host = local_user.name == info.host.name;
            let req = send_game_request(
                &game_request_send,
                GameThreadRequestType::SetupInfo(info.clone()),
            );
            req.await;
            let req = send_game_request(&game_request_send, GameThreadRequestType::Initialize);
            req.await;
            unsafe {
                get_bw().remaining_game_init(&local_user.name);
                if is_host {
                    create_lobby(&info)?;
                }
            }
            init_routes_when_ready_future
                .await
                .map_err(GameInitError::NetworkInit)?;
            start_game_request(&game_request_send, GameThreadRequestType::RunWndProc)
                .map_err(|()| GameInitError::Closed)?;
            net_game_info_set_future
                .await
                .map_err(GameInitError::NetworkInit)?;
            network_ready_future
                .await
                .map_err(GameInitError::NetworkInit)?;
            debug!("Network ready");
            if !is_host {
                unsafe {
                    join_lobby(&info, game_type).await?;
                }
            }

            if let Some(latency) = info.user_latency {
                let latency = match latency {
                    0 => UserLatency::Low,
                    1 => UserLatency::High,
                    2 => UserLatency::ExtraHigh,
                    val => {
                        warn!("Invalid user latency value: {}", val);
                        UserLatency::Low
                    }
                };
                debug!("Setting initial user latency: {:?}", latency);
                let bw = get_bw();
                unsafe {
                    bw.set_user_latency(latency);
                }
            }

            debug!("In lobby, setting up slots");
            unsafe {
                let ums_forces = info
                    .map
                    .map_data
                    .as_ref()
                    .map(|x| &x.ums_forces[..])
                    .unwrap_or(&[]);
                setup_slots(&info.slots, game_type, ums_forces);
            }
            send_messages_to_state
                .send(GameStateMessage::InLobby)
                .await
                .map_err(|_| GameInitError::Closed)?;
            let bw = get_bw();
            loop {
                unsafe {
                    let mut someone_left = false;
                    let mut new_players = false;
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
                        // Somebody seemed to have joined but ended up deciding on their end
                        // that they failed to join. We may be able to recover from
                        // this by just letting them try joining again.
                        warn!(
                            "A player that was joined has left. Before: {:x?} After: {:x?}",
                            flags_before, flags_after,
                        );
                    }

                    if new_players || someone_left {
                        send_messages_to_state
                            .send(GameStateMessage::PlayersChanged)
                            .await
                            .map_err(|_| GameInitError::Closed)?;
                    }
                }
                select! {
                    _ = tokio::time::sleep(Duration::from_millis(42)) => continue,
                    res = &mut players_joined => {
                        res?;
                        break;
                    }
                }
            }
            debug!("All players have joined");
            if let Some(sbat_replay_data_promise) = sbat_replay_data {
                // Assuming that the extra replay data isn't needed in the above lobby
                // initialization.
                match sbat_replay_data_promise.await {
                    Ok(Some(o)) => {
                        debug!("Loaded shieldbattery replay extension");
                        game_thread::set_sbat_replay_data(o);
                    }
                    Ok(None) => (),
                    Err(e) => {
                        // Going to assume that most of the time if we fail to read the
                        // extra replay data, it won't be fatal, so just log the error
                        // and continue.
                        error!("Failed to read shieldbattery replay data: {}", e);
                    }
                }
            }

            if !is_host {
                debug!("Notifying host that client is ready");
                network_send
                    .send(GameStateToNetworkMessage::SendPayload(
                        info.host.id.clone(),
                        Some(Payload::ClientReady(ClientReadyMessage::default())),
                    ))
                    .await
                    .map_err(|_| GameInitError::Closed)?;
                // Note that we don't need to wait for anything further as a non-host, the game's
                // normal seed event will signal it's time to start (handled in do_lobby_game_init)
            } else {
                // Wait for all the players to be ready to start, and the server to let us go
                let mut ready_future =
                    future::try_join(allow_start.map(|_| Ok(())), all_players_ready);
                loop {
                    unsafe {
                        bw.maybe_receive_turns();
                    }

                    select! {
                        _ = tokio::time::sleep(Duration::from_millis(42)) => continue,
                        res = &mut ready_future => {
                            res?;
                            break
                        },
                    }
                }

                debug!("All players are ready to start");
            }

            unsafe {
                do_lobby_game_init(&info).await;
            }
            send_messages_to_state
                .send(GameStateMessage::GameSetupDone)
                .await
                .map_err(|_| GameInitError::Closed)?;
            Ok(())
        }
        .boxed()
    }

    /// Future finishes after results have been sent to server
    fn run_game(&mut self) -> impl Future<Output = Result<(), GameInitError>> {
        let init_state = match self.init_state {
            InitState::Started(ref mut s) => s,
            _ => return future::err(GameInitError::GameInitNotInProgress).boxed(),
        };
        let local_user = init_state.local_user.clone();
        let info = init_state.setup_info.clone();
        self.game_started = true;

        let ws_send = self.ws_send.clone();
        let game_request_send = self.send_main_thread_requests.clone();
        let setup_info = init_state.setup_info.clone();
        let network_send = self.network_send.clone();
        let results = init_state.wait_for_results();
        async move {
            forge::end_wnd_proc();
            let start_game_request = GameThreadRequestType::StartGame;
            let game_done = send_game_request(&game_request_send, start_game_request);

            app_socket::send_message(&ws_send, "/game/start", ())
                .await
                .map_err(|_| GameInitError::Closed)?;

            // NOTE(tec27): We await the game results before game_done since we get results as soon
            // as the Victory/Defeat dialog is shown, which is before the game loop exits
            let results = results.await?;
            if !info.is_replay() {
                send_game_result(&results, &info, &local_user, &ws_send).await;
            }
            debug!("Network stall statistics: {:?}", results.network_stalls);

            game_done.await;

            // Make sure (or at least try to) that quit messages get delivered to everyone and don't
            // get lost, so that quitting players don't trigger a drop screen.
            let mut deliver_final_network = Vec::new();
            for (uid, _) in results
                .results
                .iter()
                .filter(|(_, r)| r.result == VictoryState::Playing)
            {
                if let Some(slot) = setup_info
                    .slots
                    .iter()
                    .find(|s| uid == &s.user_id.unwrap_or(0))
                {
                    debug!("Triggering final network sends for {}", slot.name);
                    let (send, recv) = oneshot::channel();
                    let _ = network_send
                        .send(GameStateToNetworkMessage::DeliverPayloadsInFlight(
                            slot.id.clone(),
                            send,
                        ))
                        .await
                        .map_err(|e| debug!("Send error {}", e));

                    deliver_final_network.push(recv);
                }
            }

            if !deliver_final_network.is_empty() {
                select! {
                    _ = future::join_all(deliver_final_network) => {},
                    _ = tokio::time::sleep(Duration::from_millis(5000)) => {},
                }
            }
            debug!("Final network sends completed");

            app_socket::send_message(&ws_send, "/game/finished", ())
                .await
                .map_err(|_| GameInitError::Closed)?;

            Ok(())
        }
        .boxed()
    }

    // Message handler, so ideally only return futures that are about sending
    // messages to other tasks.
    fn handle_message(&mut self, message: GameStateMessage) -> impl Future<Output = ()> + '_ {
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
            StartWhenReady => {
                match mem::replace(&mut self.can_start_game, AwaitableTaskState::Complete) {
                    AwaitableTaskState::Complete => (),
                    AwaitableTaskState::Incomplete(waiting) => {
                        for sender in waiting {
                            let _ = sender.send(());
                        }
                    }
                }
            }
            SetupGame(info) => {
                let ws_send = self.ws_send.clone();
                let async_stop = self.async_stop.clone();
                let game_ready = self.init_game(*info);
                let task = async move {
                    if let Err(e) = game_ready.await {
                        let msg = format!("Failed to init game: {}", e);
                        error!("{}", msg);

                        let message = SetupProgress {
                            status: crate::app_messages::SetupProgressInfo {
                                state: GAME_STATUS_ERROR,
                                extra: Some(msg),
                            },
                        };
                        let _ = app_socket::send_message(&ws_send, "/game/setupProgress", message)
                            .await;
                        expect_quit(&async_stop).await;
                    }
                };
                let (cancel_token, canceler) = CancelToken::new();
                self.running_game = Some(canceler);
                tokio::spawn(async move {
                    let task = pin!(task);
                    cancel_token.bind(task).await
                });
            }
            InLobby | PlayersChanged => {
                if let InitState::Started(ref mut state) = self.init_state {
                    state.players_changed();
                } else {
                    warn!("Player joined before init was started");
                }
            }
            GameSetupDone => {
                let game_done = self.run_game();
                let async_stop = self.async_stop.clone();
                let task = async move {
                    if let Err(e) = game_done.await {
                        error!("Error on running game: {}", e);
                    }
                    debug!("Game play task ended");
                    expect_quit(&async_stop).await;
                };
                let (cancel_token, canceler) = CancelToken::new();
                self.running_game = Some(canceler);
                tokio::spawn(async move {
                    let task = pin!(task);
                    cancel_token.bind(task).await
                });
            }
            GameThread(msg) => {
                return self.handle_game_thread_message(msg);
            }
            Network(msg) => {
                return self.handle_network_message(msg);
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
            QuitIfNotStarted => {
                if !self.game_started {
                    debug!("Exiting since game has not started");
                    // Not cleaning up (that is, saving user settings or anything)
                    // since we didn't start in the first place
                    self.async_stop.cancel();
                }
            }
        }
        future::ready(()).boxed()
    }

    fn handle_game_thread_message<'s>(
        &'s mut self,
        message: GameThreadMessage,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + 's>> {
        use crate::game_thread::GameThreadMessage::*;
        match message {
            WindowMove(..) => (),
            ReplaySaved(..) => (),
            Snp(snp) => {
                return self.network.send_snp_message(snp).map(|_| ()).boxed();
            }
            PlayersRandomized(new_mapping) => {
                if let InitState::Started(ref mut state) = self.init_state {
                    for player in &mut state.joined_players {
                        let old_id = player.player_id;
                        player.player_id = new_mapping
                            .get(player.storm_id.0 as usize)
                            .and_then(|&id| id);
                        if old_id.is_some() != player.player_id.is_some() {
                            warn!(
                                "Player {} lost/gained player id after randomization: {:?} -> {:?}",
                                player.name, old_id, player.player_id,
                            );
                        }
                    }
                    let mapping = state
                        .joined_players
                        .iter()
                        .map(|player| game_thread::PlayerIdMapping {
                            game_id: player.player_id,
                            sb_user_id: player.sb_user_id,
                        })
                        .collect();
                    game_thread::set_player_id_mapping(mapping);
                } else {
                    warn!("Player randomization received too early");
                }
            }
            Results(results) => {
                if let InitState::Started(ref mut state) = self.init_state {
                    state.received_results(results);
                } else {
                    warn!("Received results before init was started");
                }
            }
            NetworkStall(duration) => {
                if let InitState::Started(ref mut state) = self.init_state {
                    state.stall_count += 1;
                    // We stop storing more durations if there have been a ton of stalls, don't want
                    // to use up tons of memory just to get a median
                    if state.stall_count <= 1024 {
                        state.stall_durations.push(duration)
                    }
                    if duration > state.stall_max {
                        state.stall_max = duration;
                    }
                    if duration < state.stall_min {
                        state.stall_min = duration;
                    }
                } else {
                    warn!("Notified of network stall before init was started");
                }
            }
            DebugInfoRequest(info) => {
                return match info {
                    game_thread::DebugInfoRequest::Network(out) => {
                        self.network.request_debug_info(out).boxed()
                    }
                }
            }
        }
        future::ready(()).boxed()
    }

    fn handle_network_message<'s>(
        &'s mut self,
        msg: NetworkToGameStateMessage,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + 's>> {
        use crate::network_manager::NetworkToGameStateMessage::*;
        match msg {
            ReceivePayload(ref player_id, payload) => match payload {
                Payload::ClientReady(_) => {
                    if let InitState::Started(ref mut state) = self.init_state {
                        if state.unready_players.remove(player_id) {
                            debug!("{:?} is now ready", player_id)
                        }

                        state.check_unready_players();
                    } else {
                        error!(
                            "Got ClientReady for {:?} before init had started",
                            player_id
                        );
                    }
                }
                Payload::ClientAckRequest(_) => {
                    // Trigger a response to this packet immediately to deliver any acks.
                    let network_send = self.network_send.clone();
                    let player_id = player_id.clone();
                    tokio::spawn(async move {
                        let _ = network_send
                            .send(GameStateToNetworkMessage::SendPayload(
                                player_id,
                                Some(Payload::ClientAckResponse(
                                    ClientAckResponseMessage::default(),
                                )),
                            ))
                            .await
                            .map_err(|e| error!("Send error {}", e));
                    });
                }
                _ => {}
            },
        }
        future::ready(()).boxed()
    }
}

async fn expect_quit(async_stop: &SharedCanceler) {
    tokio::time::sleep(Duration::from_millis(10000)).await;
    // The app is supposed to send a CleanupQuit command to acknowledge
    // that it received /game/end, or simple quit on error, but maybe it died?
    //
    // TODO(neive): Would be nice to do CleanupQuit if we finished game
    // succesfully even if the app didn't end up replying to us?
    warn!("Didn't receive close command, exiting automatically");
    async_stop.cancel();
}

async fn send_game_result(
    results: &GameResults,
    info: &GameSetupInfo,
    local_user: &LocalUser,
    ws_send: &app_socket::SendMessages,
) {
    // Send results to the app.
    // If the app is closed, ignore the error and try to still send results to server.
    let _ = app_socket::send_message(ws_send, "/game/result", &results).await;

    if info.result_code.is_none() {
        debug!("Had no result code, skipping sending results");
        return;
    }

    // Attempt to send results to the server, if this fails, we expect
    // the app to retry in the future
    let client = reqwest::Client::new();
    let result_url = format!("{}/api/1/games/{}/results2", info.server_url, info.game_id);

    let mut result_headers = HeaderMap::new();
    result_headers.insert(ORIGIN, "shieldbattery://game".parse().unwrap());

    let result_body = GameResultsReport {
        user_id: local_user.id,
        result_code: info.result_code.clone().unwrap(),
        time: results.time_ms,
        player_results: results
            .results
            .iter()
            .map(|(&uid, result)| (uid, *result))
            .collect(),
    };

    for _ in 0u8..3 {
        let result = client
            .post(&result_url)
            .timeout(Duration::from_secs(30))
            .headers(result_headers.clone())
            .json(&result_body)
            .send()
            .await;

        match result.and_then(|r| r.error_for_status()) {
            Ok(_) => {
                debug!("Game results sent successfully");
                let _ = app_socket::send_message(ws_send, "/game/resultSent", ()).await;
                break;
            }
            Err(err) => {
                error!("Error sending game results: {}", err);
            }
        };
    }
}

struct InitInProgress {
    all_players_joined: AwaitableTaskState<Result<(), GameInitError>>,
    all_players_ready: AwaitableTaskState<()>,
    setup_info: Arc<GameSetupInfo>,
    local_user: Arc<LocalUser>,
    joined_players: Vec<JoinedPlayer>,
    unready_players: HashSet<LobbyPlayerId>,
    waiting_for_result: Vec<oneshot::Sender<Arc<GameResults>>>,
    stall_durations: Vec<Duration>,
    stall_count: usize,
    stall_min: Duration,
    stall_max: Duration,
}

#[derive(Debug)]
struct JoinedPlayer {
    name: String,
    storm_id: StormPlayerId,
    player_id: Option<BwPlayerId>,
    sb_user_id: u32,
}

impl InitInProgress {
    fn new(setup_info: Arc<GameSetupInfo>, local_user: Arc<LocalUser>) -> InitInProgress {
        let is_host = setup_info.host.name == local_user.name;
        // Only the host tracks client readiness
        let unready_players = if is_host {
            setup_info
                .slots
                .iter()
                .filter_map(|slot| {
                    if !slot.is_human() || slot.name == local_user.name {
                        None
                    } else {
                        Some(slot.id.clone())
                    }
                })
                .collect::<HashSet<_>>()
        } else {
            HashSet::new()
        };

        let mut result = InitInProgress {
            all_players_joined: AwaitableTaskState::Incomplete(Vec::new()),
            all_players_ready: AwaitableTaskState::Incomplete(Vec::new()),
            setup_info,
            local_user,
            joined_players: Vec::new(),
            unready_players,
            waiting_for_result: Vec::new(),
            stall_durations: Vec::new(),
            stall_count: 0,
            stall_max: Duration::from_millis(0),
            stall_min: Duration::MAX,
        };
        result.check_unready_players();

        result
    }

    fn players_changed(&mut self) {
        let result = match unsafe { self.update_joined_state() } {
            Ok(true) => Ok(()),
            Err(e) => Err(e),
            Ok(false) => return,
        };

        match mem::replace(&mut self.all_players_joined, AwaitableTaskState::Complete) {
            AwaitableTaskState::Complete => {}
            AwaitableTaskState::Incomplete(waiting) => {
                for sender in waiting {
                    let _ = sender.send(result.clone());
                }
            }
        }
    }

    // Waits until players have joined.
    // self.players_changed gets called whenever game thread sends a join notification,
    // and once when the init task tells that a player is in lobby.
    fn wait_for_players(&mut self) -> impl Future<Output = Result<(), GameInitError>> {
        let f = match self.all_players_joined {
            AwaitableTaskState::Incomplete(ref mut waiters) => {
                let (send, recv) = oneshot::channel();
                waiters.push(send);
                Some(recv)
            }
            AwaitableTaskState::Complete => None,
        };

        async move {
            if let Some(f) = f {
                f.map_err(|_| GameInitError::Closed).await?
            } else {
                Ok(())
            }
        }
    }

    /// Waits until all players have notified the host that they are ready.
    fn wait_all_players_ready(&mut self) -> impl Future<Output = Result<(), GameInitError>> {
        let f = match self.all_players_ready {
            AwaitableTaskState::Incomplete(ref mut waiters) => {
                let (send, recv) = oneshot::channel();
                waiters.push(send);
                Some(recv)
            }
            AwaitableTaskState::Complete => None,
        };

        async move {
            if let Some(f) = f {
                f.map_err(|_| GameInitError::Closed)
                    .and_then(future::ok)
                    .await
            } else {
                Ok(())
            }
        }
    }

    fn wait_for_results(
        &mut self,
    ) -> impl Future<Output = Result<Arc<GameResults>, GameInitError>> {
        let (send_done, recv_done) = oneshot::channel();
        self.waiting_for_result.push(send_done);
        recv_done.map_err(|_| GameInitError::Closed)
    }

    // Return Ok(true) on done, Ok(false) on keep waiting
    unsafe fn update_joined_state(&mut self) -> Result<bool, GameInitError> {
        let storm_names = storm_player_names(get_bw());
        self.update_bw_slots(&storm_names)?;
        if self.has_all_players() {
            debug!("All players have joined: {:?}", self.joined_players);
            Ok(true)
        } else {
            Ok(false)
        }
    }

    unsafe fn update_bw_slots(
        &mut self,
        storm_names: &[Option<String>],
    ) -> Result<(), GameInitError> {
        let players = get_bw().players();
        // Remove any players that may have left.
        // Should be rare but something may end up making joining player not see themselves
        // join, making them leave a bit later.
        // This is still going to have issues if the last player to join ends up leaving,
        // we probably should add some extra step (E.g. sending some network packet)
        // to make sure the person is totally joined before we add them here at all.
        self.joined_players.retain(|joined_player| {
            let retain = storm_names
                .iter()
                .any(|name| name.as_deref() == Some(&*joined_player.name));
            if !retain {
                warn!("Player {} has left", joined_player.name);
                if let Some(bw_slot) = joined_player.player_id {
                    (*players.add(bw_slot.0 as usize)).storm_id = u32::MAX;
                }
            }
            retain
        });
        for (storm_id, name) in storm_names.iter().enumerate() {
            let storm_id = StormPlayerId(storm_id as u8);
            let name = match name {
                Some(ref s) => &**s,
                None => continue,
            };
            let joined_pos = self.joined_players.iter().position(|x| x.name == name);
            if let Some(joined_pos) = joined_pos {
                if self.joined_players[joined_pos].storm_id != storm_id {
                    return Err(GameInitError::StormIdChanged(name.to_string()));
                }
            } else if let Some(slot) = self.setup_info.slots.iter().find(|x| x.name == name) {
                let player_id;
                let bw_slot = (0..16).find(|&i| {
                    let player = players.add(i);
                    let bw_name = CStr::from_ptr((*player).name.as_ptr() as *const i8);
                    bw_name.to_str() == Ok(name)
                });
                if let Some(bw_slot) = bw_slot {
                    (*players.add(bw_slot)).storm_id = storm_id.0 as u32;
                    player_id = Some(BwPlayerId(bw_slot as u8));
                } else {
                    return Err(GameInitError::UnexpectedPlayer(name.to_string()));
                }
                if self.joined_players.iter().any(|x| x.player_id == player_id) {
                    return Err(GameInitError::UnexpectedPlayer(name.to_string()));
                }
                // I believe there isn't any reason why a slot associated with
                // human wouldn't have shieldbattery user ids, so just fail here
                // instead of keeping sb_user_id as Option<u32>.
                let sb_user_id = slot
                    .user_id
                    .ok_or_else(|| GameInitError::NoShieldbatteryId(name.into()))?;
                debug!("Player {} received storm id {}", name, storm_id.0);
                self.joined_players.push(JoinedPlayer {
                    name: name.to_string(),
                    storm_id,
                    player_id,
                    sb_user_id,
                });
            } else {
                return Err(GameInitError::UnexpectedPlayer(name.to_string()));
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

    /// Checks if there are still any unready players, updating the task state if not.
    fn check_unready_players(&mut self) {
        if self.unready_players.is_empty() {
            match mem::replace(&mut self.all_players_ready, AwaitableTaskState::Complete) {
                AwaitableTaskState::Complete => {}
                AwaitableTaskState::Incomplete(waiting) => {
                    for sender in waiting {
                        let _ = sender.send(());
                    }
                }
            }
        } else {
            debug!("Still waiting for ready from: {:?}", self.unready_players);
        }
    }

    fn received_results(&mut self, game_results: GameThreadResults) {
        debug!("Got results from game thread: {game_results:#?}");

        let time_ms = game_results.time.as_millis() as u64;
        let results = determine_game_results(game_results, &self.joined_players, &self.local_user);

        self.stall_durations.sort_unstable();
        let stall_median = self
            .stall_durations
            .get(self.stall_durations.len() / 2)
            .map_or(0, |d| d.as_millis());
        let (stall_min, stall_max) = if self.stall_count > 0 {
            (self.stall_min.as_millis(), self.stall_max.as_millis())
        } else {
            (0, 0)
        };

        let message = Arc::new(GameResults {
            results,
            time_ms,
            network_stalls: NetworkStallInfo {
                count: self.stall_count as u32,
                median: stall_median as u32,
                min: stall_min as u32,
                max: stall_max as u32,
            },
        });
        for send in self.waiting_for_result.drain(..) {
            let _ = send.send(message.clone());
        }
    }
}

unsafe fn create_lobby(info: &GameSetupInfo) -> Result<(), GameInitError> {
    let map_path = Path::new(&info.map_path);
    get_bw()
        .create_lobby(map_path, &info.map, &info.name, info.into())
        .map_err(GameInitError::Bw)
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
    let max_player_count = info.slots.len() as u8;
    let active_player_count = info
        .slots
        .iter()
        .filter(|x| x.is_human() || x.is_observer())
        .count() as u8;
    let is_eud = map_data.is_eud;

    // This info isn't used ingame (with exception of game_type?),
    // but it is written in the header of replays/saves.
    let game_info = {
        let mut game_info = bw::BwGameData {
            index: 1,
            map_width: map_data.width,
            map_height: map_data.height,
            active_player_count,
            max_player_count,
            game_speed: 6, // Fastest
            game_type: game_type.primary as u16,
            game_subtype: game_type.subtype as u16,
            tileset: map_data.tileset,
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
    let map_path = match CString::new(info.map_path.as_bytes()) {
        Ok(o) => Arc::new(o),
        Err(_) => return future::err(GameInitError::NullInPath(info.map_path.clone())).boxed(),
    };
    let options: LobbyOptions = info.into();
    async move {
        let mut repeat_interval = tokio::time::interval(Duration::from_millis(10));
        loop {
            repeat_interval.tick().await;
            match try_join_lobby_once(game_info, is_eud, options, &map_path).await {
                Ok(()) => break,
                Err(e) => debug!("Storm join error: {:08x}", e),
            }
        }
        let bw = get_bw();
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
        Ok(())
    }
    .boxed()
}

async unsafe fn try_join_lobby_once(
    mut game_info: bw::BwGameData,
    is_eud: bool,
    options: LobbyOptions,
    map_path: &Arc<CString>,
) -> Result<(), u32> {
    // Storm sends game join packets and then waits for a response *synchronously* (waiting for up to
    // 5 seconds). Since we're on the async thread, and our network code is on the async thread, obviously
    // that won't work out well (although did it work out "well" in the normal network interface? Not
    // really. But I digress). Therefore, we queue this onto a background thread, which will let our
    // network code actually do its job.
    let (send, recv) = oneshot::channel();
    let map_path = map_path.clone();
    std::thread::spawn(move || {
        let address = Ipv4Addr::new(10, 27, 27, 0);
        let bw = get_bw();
        let result = bw.join_lobby(&mut game_info, is_eud, options, &map_path, address);
        let _ = send.send(result);
    });

    match recv.await {
        Ok(storm_result) => storm_result,
        // Thread died??
        Err(_) => Err(!0u32),
    }
}

unsafe fn setup_slots(slots: &[PlayerInfo], game_type: GameType, ums_forces: &[MapForce]) {
    let bw = get_bw();
    let is_ums = game_type.is_ums();
    let players = bw.players();
    for i in 0..12 {
        *players.add(i) = bw::Player {
            id: i as u32,
            storm_id: u32::MAX,
            player_type: match slots.len() < i {
                true => bw::PLAYER_TYPE_OPEN,
                false => bw::PLAYER_TYPE_NONE,
            },
            race: bw::RACE_RANDOM,
            team: 0,
            name: [0; 25],
        };
    }

    for i in 12..16 {
        *players.add(i) = bw::Player {
            id: 128 + (i - 12) as u32,
            storm_id: u32::MAX,
            player_type: bw::PLAYER_TYPE_OBSERVER_NONE,
            race: bw::RACE_RANDOM,
            team: 0,
            name: [0; 25],
        };
    }

    let mut num_observers = 0;
    for (i, slot) in slots.iter().enumerate() {
        let slot_id = if is_ums {
            slot.player_id.unwrap_or(0) as usize
        } else if slot.is_observer() {
            num_observers += 1;
            if num_observers > 4 {
                panic!("Slots had more than 4 observers!");
            }

            11 + num_observers
        } else {
            i
        };

        // This player_type_id check is completely ridiculous and doesn't make sense, but that gives
        // the same behaviour as normal bw. Not that any maps use those slot types as Scmdraft
        // doesn't allow setting them anyways D:
        let team = if !is_ums || (slot.player_type_id != 1 && slot.player_type_id != 2) {
            slot.team_id
        } else {
            0
        };
        *players.add(slot_id) = bw::Player {
            id: if slot.is_observer() {
                128 + (slot_id - 12) as u32
            } else {
                slot_id as u32
            },
            storm_id: match slot.is_human() || slot.is_observer() {
                true => 27,
                false => u32::MAX,
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
            name: [0; 25],
        };
        bw.set_player_name(slot_id as u8, &slot.name);
    }
    if game_type.is_ums() {
        // BW would normally set UMS user selectable slots in replay header around the
        // same part where it initializes lobby player data. As this function is pretty
        // much replacement for that code, we'll have to set this replay header value here.
        let replay_header = bw.replay_header();
        for player in ums_forces.iter().flat_map(|x| x.players.iter()) {
            if let Some(value) = (*replay_header)
                .ums_user_select_slots
                .get_mut(player.id as usize)
            {
                *value = if player.race == UmsLobbyRace::Any {
                    1
                } else {
                    0
                };
            }
        }
    }
    // Verify that computer team races in team melee are either all random or no random.
    // Otherwise the race randomization function will generate invalid races.
    // This is also supposed to be prevented server-side, but verifying it also here is
    // very preferable to debugging a game that broke due to invalid races.
    if game_type.is_team_game() {
        let players = std::slice::from_raw_parts(players, 8);
        for i in 0..4 {
            let team = i + 1;
            if players.iter().any(|x| {
                x.team == team
                    && x.player_type == bw::PLAYER_TYPE_LOBBY_COMPUTER
                    && x.race == bw::RACE_RANDOM
            }) && players
                .iter()
                .any(|x| x.team == team && x.race != bw::RACE_RANDOM)
            {
                panic!(
                    "Computer team {} has both random and non-random slots, which is not allowed",
                    i
                );
            }
        }
    }
}

unsafe fn storm_player_names(bw: &BwScr) -> Vec<Option<String>> {
    let storm_players = bw.storm_players();
    storm_players
        .iter()
        .map(|player| {
            let name_len = player
                .name
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(player.name.len());
            if name_len != 0 {
                Some(String::from_utf8_lossy(&player.name[..name_len]).into())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
}

async unsafe fn do_lobby_game_init(info: &GameSetupInfo) {
    let bw = get_bw();
    bw.do_lobby_game_init(info.seed);
    loop {
        bw.maybe_receive_turns();
        let done = bw.try_finish_lobby_game_init();
        if done {
            break;
        }
        tokio::time::sleep(Duration::from_millis(42)).await;
    }
}

pub async fn create_future(
    ws_send: app_socket::SendMessages,
    async_stop: SharedCanceler,
    mut messages: mpsc::Receiver<GameStateMessage>,
    init_main_thread: std::sync::mpsc::Sender<()>,
    send_main_thread_requests: std::sync::mpsc::Sender<GameThreadRequest>,
) {
    let (internal_send, mut internal_recv) = mpsc::channel(8);
    let (network_send, network_recv) = mpsc::channel(64);
    let (from_network_send, mut from_network_recv) = mpsc::channel(64);
    let mut game_state = GameState {
        init_state: InitState::WaitingForInput(IncompleteInit {
            settings_set: false,
            local_user: None,
            routes_set: false,
        }),
        network: NetworkManager::new(from_network_send, network_recv),
        network_send,
        ws_send,
        internal_send,
        init_main_thread,
        send_main_thread_requests,
        running_game: None,
        async_stop,
        can_start_game: AwaitableTaskState::Incomplete(Vec::new()),
        game_started: false,
    };
    loop {
        let message = select! {
            x = messages.recv() => x,
            x = internal_recv.recv() => x,
            x = from_network_recv.recv() => x.map(GameStateMessage::Network),
        };
        match message {
            Some(m) => game_state.handle_message(m).await,
            None => break,
        }
    }
    debug!("Game state task ended");
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

async fn read_sbat_replay_data(path: &Path) -> Result<Option<replay::SbatReplayData>, io::Error> {
    use byteorder::{ByteOrder, LittleEndian};
    use tokio::fs;
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let mut file = fs::File::open(path).await?;
    let mut buffer = [0u8; 0x14];
    file.read_exact(&mut buffer).await?;
    let magic = LittleEndian::read_u32(&buffer[0xc..]);
    let scr_extension_offset = LittleEndian::read_u32(&buffer[0x10..]);
    if magic != 0x53526573 {
        return Ok(None);
    }
    let end_pos = file.seek(io::SeekFrom::End(0)).await?;
    file.seek(io::SeekFrom::Start(scr_extension_offset as u64))
        .await?;
    let length = end_pos.saturating_sub(scr_extension_offset as u64) as usize;
    let mut buffer = vec![0u8; length];
    file.read_exact(&mut buffer).await?;
    let mut pos = 0;
    while pos < length {
        let header = match buffer.get(pos..(pos + 8)) {
            Some(s) => s,
            None => break,
        };
        let id = LittleEndian::read_u32(header);
        let section_length = LittleEndian::read_u32(&header[4..]) as usize;
        if id == replay::SECTION_ID {
            let data = Some(())
                .and_then(|()| buffer.get(pos.checked_add(8)?..)?.get(..section_length))
                .and_then(replay::parse_shieldbattery_data);
            return match data {
                Some(o) => Ok(Some(o)),
                None => Err(io::Error::other("Failed to parse shieldbattery section")),
            };
        } else {
            pos = pos.saturating_add(section_length).saturating_add(8);
        }
    }
    Ok(None)
}

fn determine_game_results(
    mut game_thread_results: GameThreadResults,
    joined_players: &[JoinedPlayer],
    local_user: &LocalUser,
) -> HashMap<u32, GamePlayerResult> {
    let mut results = joined_players
        .iter()
        .filter_map(|player| {
            player.player_id.and_then(|player_id| {
                if player_id.is_observer() {
                    return None;
                }

                game_thread_results.player_results.get(&player_id).map(|r| {
                    (
                        player.sb_user_id,
                        GamePlayerResult {
                            result: r.victory_state,
                            race: r.race,
                            // TODO(tec27): implement APM calculation
                            apm: 0,
                        },
                    )
                })
            })
        })
        .collect();

    // For UMS games, we just send exactly what we were given, we expect the UMS logic to control
    // game results
    if game_thread_results.game_type.is_ums() {
        debug!("Game is UMS, not modifying reported results");
        return results;
    }

    let storm_to_sb = joined_players
        .iter()
        .map(|p| (p.storm_id, p.sb_user_id))
        .collect::<HashMap<_, _>>();
    let sb_to_storm = storm_to_sb
        .iter()
        .map(|(&k, &v)| (v, k))
        .collect::<HashMap<_, _>>();
    let sb_to_bw = joined_players
        .iter()
        .filter_map(|p| {
            p.player_id.and_then(|bw| {
                if bw.is_observer() {
                    None
                } else {
                    Some((p.sb_user_id, bw))
                }
            })
        })
        .collect::<HashMap<_, _>>();
    let bw_to_sb = sb_to_bw
        .iter()
        .map(|(&k, &v)| (v, k))
        .collect::<HashMap<_, _>>();

    // When we grab results from BW, unless the local player has actually been defeated (e.g. had
    // all their buildings destroyed), they will still be marked as Playing. We map any Playing
    // status to Defeat (since Victory would have been applied). Logic further on may still map this
    // to other statuses.
    if let Some(r) = results.get_mut(&local_user.id) {
        if r.result == VictoryState::Playing {
            r.result = VictoryState::Defeat;
        }
    };

    let has_victory = game_thread_results
        .player_results
        .values()
        .any(|r| r.victory_state == VictoryState::Victory);
    let only_computers_playing = !has_victory
        && !game_thread_results.player_results.iter().any(|(bw_id, r)| {
            r.victory_state == VictoryState::Playing && bw_to_sb.contains_key(bw_id)
        })
        && game_thread_results.player_results.iter().any(|(bw_id, r)| {
            r.victory_state == VictoryState::Playing && !bw_to_sb.contains_key(bw_id)
        });

    if only_computers_playing {
        debug!("Only computers left playing");
        // If only computers are left playing, and all computers are allied with one another, we
        // assign them all a victory.
        // If they are not all allied, a final result for this game will never be known :(
        let comp_ids = game_thread_results
            .player_results
            .keys()
            .copied()
            .filter(|id| !bw_to_sb.contains_key(id))
            .collect::<SmallVec<[_; 8]>>();
        let mut all_allied = true;
        for (&comp_id, result) in game_thread_results
            .player_results
            .iter_mut()
            .filter(|(&id, _)| !bw_to_sb.contains_key(&id))
        {
            for &ally_id in comp_ids.iter() {
                if ally_id != comp_id
                    && result.alliance_with(ally_id) != AllianceState::AlliedVictory
                {
                    all_allied = false;
                    break;
                }
            }
        }

        if all_allied {
            debug!("All computers left playing are allied, assigning victory to them.");
            for bw_id in comp_ids.iter() {
                if let Some(r) = game_thread_results.player_results.get_mut(bw_id) {
                    r.victory_state = VictoryState::Victory;
                };
            }
        } else {
            debug!("Not all playing computers are allied, no final result will be known");
        }
    }

    for (&sb_id, result) in results.iter_mut() {
        let storm_id = sb_to_storm
            .get(&sb_id)
            .expect("should have had storm id for SB user");
        let dropped = game_thread_results
            .network_results
            .get(storm_id)
            .is_some_and(|r| r.was_dropped);

        // If the player was dropped but it was a mass disconnect, we assume they are probably still
        // playing in the other games, so we mark them back to Playing
        if dropped
            && result.result == VictoryState::Disconnected
            && game_thread_results.local_player_lose_type == Some(PlayerLoseType::MassDisconnect)
        {
            result.result = VictoryState::Playing;
        }
    }

    // NOTE(tec27): we recalculate this here because it may have changed due to the above logic
    let has_victory = game_thread_results
        .player_results
        .values()
        .any(|r| r.victory_state == VictoryState::Victory);
    if !has_victory {
        // If we don't see a victory yet, the game is still ongoing, so map any Defeats to
        // Disconnected if they could still possibly win from allied victory

        // The set of players who are still "live", e.g. still have a chance at victory
        let mut live_players = results
            .iter()
            .filter_map(|(sb, r)| {
                if r.result == VictoryState::Playing
                    && !sb_to_storm
                        .get(sb)
                        .map(|storm| {
                            game_thread_results
                                .network_results
                                .get(storm)
                                .is_none_or(|r| r.has_quit)
                        })
                        .unwrap_or(true)
                {
                    sb_to_bw.get(sb).copied()
                } else {
                    None
                }
            })
            .collect::<HashSet<_>>();
        let mut to_process = live_players.iter().copied().collect::<SmallVec<[_; 8]>>();
        while let Some(live_bw_id) = to_process.pop() {
            let live_player_result = game_thread_results
                .player_results
                .get(&live_bw_id)
                .expect("Should have had PlayerResult for live player");
            for ally in
                live_player_result
                    .alliances
                    .iter()
                    .enumerate()
                    .filter_map(|(ally_id, alliance)| {
                        let ally_id = BwPlayerId(ally_id as u8);
                        if !ally_id.is_observer() && *alliance == AllianceState::AlliedVictory {
                            Some(ally_id)
                        } else {
                            None
                        }
                    })
            {
                if live_players.insert(ally) {
                    to_process.push(ally);
                }
            }
        }

        for (&sb_id, result) in results.iter_mut() {
            let storm_id = sb_to_storm
                .get(&sb_id)
                .expect("should have had storm id for SB user");
            // BW never marks our local user as having quit by this point, but we want to treat them
            // that way so the logic is easier
            let quit = sb_id == local_user.id
                || game_thread_results
                    .network_results
                    .get(storm_id)
                    .is_none_or(|r| r.has_quit);

            if quit && result.result == VictoryState::Defeat {
                let bw_id = sb_to_bw
                    .get(&sb_id)
                    .expect("should have had bw id for SB user");
                if live_players.contains(bw_id) {
                    result.result = VictoryState::Disconnected;
                }
            }
        }
    } else {
        // We see a victory, so the game should be completed here. Use allied victory settings to
        // bring any disconnected players along for the victory, mark the rest of the disconnected
        // players as defeated
        debug!("At least 1 Victory result, processing allied victors...");
        let mut to_process = SmallVec::<[BwPlayerId; 8]>::new();
        for (&bw_id, result) in game_thread_results.player_results.iter() {
            if result.victory_state == VictoryState::Victory {
                to_process.push(bw_id);
            }
        }

        while let Some(victor_bw_id) = to_process.pop() {
            let victor_player_result = game_thread_results
                .player_results
                .get(&victor_bw_id)
                .expect("should have had PlayerResult for victor");
            let alliances = victor_player_result.alliances;
            debug!("processing player {victor_bw_id:?}, alliances: {alliances:?}");
            for (sb_id, ally_result) in results.iter_mut().filter(|(&sb, r)| {
                let bw_id = *sb_to_bw
                    .get(&sb)
                    .expect("Should have had BW ID id for ally");
                if bw_id == victor_bw_id
                    || victor_player_result.alliance_with(bw_id) != AllianceState::AlliedVictory
                    || !matches!(r.result, VictoryState::Disconnected | VictoryState::Defeat)
                {
                    return false;
                }

                let bw_result = game_thread_results
                    .player_results
                    .get(&bw_id)
                    .expect("Should have had PlayerResult for ally");
                bw_result.alliance_with(victor_bw_id) == AllianceState::AlliedVictory
            }) {
                ally_result.result = VictoryState::Victory;
                // Changing this player's result may also change the result of people *they* were
                // allied with, so add them to the processing list
                to_process.push(sb_to_bw[sb_id]);
            }
        }

        // Now that we've processed any possible allied victories, anyone still left as disconnected
        // can be marked as defeated
        for result in results.values_mut() {
            if result.result == VictoryState::Disconnected {
                result.result = VictoryState::Defeat;
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use crate::bw::players::{
        AllianceState, AssignedRace, FinalNetworkStatus, PlayerLoseType, PlayerResult, VictoryState,
    };

    use super::*;

    // TODO(tec27): Move this somewhere common for all tests
    static INIT_LOGS: std::sync::Once = std::sync::Once::new();

    fn init_logs() {
        INIT_LOGS.call_once(|| {
            fern::Dispatch::new()
                .level(log::LevelFilter::Debug)
                .level_for("tokio_reactor", log::LevelFilter::Warn) // Too spammy otherwise
                .chain(fern::Output::call(|record| {
                    // Rust test runner's capturing of test prings works only through
                    // println and related macros, not when writing directly to io::stdout,
                    // so this is not same as just chain(stdout)
                    println!(
                        "{}:{} {}",
                        record.file().unwrap_or("?"),
                        record.line().unwrap_or(0),
                        record.args(),
                    );
                }))
                .apply()
                .unwrap();
        });
    }

    fn make_standard_network_results(
        num_players: u8,
    ) -> HashMap<StormPlayerId, FinalNetworkStatus> {
        (0..8)
            .map(|i| {
                (
                    StormPlayerId(i),
                    FinalNetworkStatus {
                        has_quit: i >= num_players,
                        was_dropped: false,
                    },
                )
            })
            .collect()
    }

    #[test]
    fn results_1v1_opponent_leaves() {
        init_logs();
        // 0 has victory_state defeat
        // 1 has victory_state victory
        // 0 has was_dropped false, has_quit false
        // 1 has was_dropped false, has_quit true
        let local_user = LocalUser {
            id: 1,
            name: "local".to_string(),
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(1)),
            sb_user_id: local_user.id,
        };
        let opponent = JoinedPlayer {
            name: "opponent".to_string(),
            storm_id: StormPlayerId(1),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: 77,
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: GameType::one_v_one(),
                player_results: HashMap::from([
                    (
                        BwPlayerId(1),
                        PlayerResult {
                            victory_state: VictoryState::Victory,
                            race: AssignedRace::Zerg,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[1] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(0),
                        PlayerResult {
                            victory_state: VictoryState::Defeat,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                ]),
                network_results: {
                    let mut n = make_standard_network_results(2);
                    n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                    n
                },
                local_player_lose_type: None,
                time: Duration::from_millis(27270),
            },
            &[local, opponent],
            &local_user,
        );

        assert_eq!(
            results,
            HashMap::from([
                (
                    local_user.id,
                    GamePlayerResult {
                        result: VictoryState::Victory,
                        race: AssignedRace::Zerg,
                        apm: 0,
                    }
                ),
                (
                    77,
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                )
            ])
        )
    }

    #[test]
    fn results_1v1_self_leaves() {
        init_logs();
        // 0 has victory_state playing
        // 1 has victory_state playing
        // 0 has was_dropped false, has_quit false
        // 1 has was_dropped false, has_quit false
        let local_user = LocalUser {
            id: 1,
            name: "local".to_string(),
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(1)),
            sb_user_id: local_user.id,
        };
        let opponent = JoinedPlayer {
            name: "opponent".to_string(),
            storm_id: StormPlayerId(1),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: 77,
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: GameType::melee(),
                player_results: HashMap::from([
                    (
                        BwPlayerId(1),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Zerg,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[1] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(0),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                ]),
                network_results: make_standard_network_results(2),
                local_player_lose_type: None,
                time: Duration::from_millis(27270),
            },
            &[local, opponent],
            &local_user,
        );

        assert_eq!(
            results,
            HashMap::from([
                (
                    local_user.id,
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Zerg,
                        apm: 0,
                    }
                ),
                (
                    77,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                )
            ])
        )
    }

    #[test]
    fn results_1v1_self_all_buildings_killed() {
        init_logs();
        // 0 has victory_state defeat
        // 1 has victory state victory
        // 0 has was_dropped false, has_quit false
        // 1 has was_dropped false, has_quit false
        // (note that has_quit can differ depending on order of players leaving, at least until
        // we calc/submit results when the dialog shows)
        let local_user = LocalUser {
            id: 1,
            name: "local".to_string(),
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(1)),
            sb_user_id: local_user.id,
        };
        let opponent = JoinedPlayer {
            name: "opponent".to_string(),
            storm_id: StormPlayerId(1),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: 77,
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: GameType::melee(),
                player_results: HashMap::from([
                    (
                        BwPlayerId(1),
                        PlayerResult {
                            victory_state: VictoryState::Defeat,
                            race: AssignedRace::Zerg,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[1] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(0),
                        PlayerResult {
                            victory_state: VictoryState::Victory,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                ]),
                network_results: make_standard_network_results(2),
                local_player_lose_type: None,
                time: Duration::from_millis(27270),
            },
            &[local, opponent],
            &local_user,
        );

        assert_eq!(
            results,
            HashMap::from([
                (
                    local_user.id,
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Zerg,
                        apm: 0,
                    }
                ),
                (
                    77,
                    GamePlayerResult {
                        result: VictoryState::Victory,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                )
            ])
        )
    }

    #[test]
    fn results_1v1_opponent_dropped() {
        init_logs();
        // 0 has victory_state victory
        // 1 has victory_state disconnected
        // 0 has was_dropped false, has_quit false
        // 1 has was_dropped true, has_quit true
        // lose type = TargetedDisconnect
        let local_user = LocalUser {
            id: 1,
            name: "local".to_string(),
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(1)),
            sb_user_id: local_user.id,
        };
        let opponent = JoinedPlayer {
            name: "opponent".to_string(),
            storm_id: StormPlayerId(1),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: 77,
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: GameType::one_v_one(),
                player_results: HashMap::from([
                    (
                        BwPlayerId(1),
                        PlayerResult {
                            victory_state: VictoryState::Victory,
                            race: AssignedRace::Zerg,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[1] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(0),
                        PlayerResult {
                            victory_state: VictoryState::Disconnected,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                ]),
                network_results: {
                    let mut n = make_standard_network_results(2);
                    n.get_mut(&StormPlayerId(1)).unwrap().was_dropped = true;
                    n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                    n
                },
                local_player_lose_type: Some(PlayerLoseType::TargetedDisconnect),
                time: Duration::from_millis(27270),
            },
            &[local, opponent],
            &local_user,
        );

        assert_eq!(
            results,
            HashMap::from([
                (
                    local_user.id,
                    GamePlayerResult {
                        result: VictoryState::Victory,
                        race: AssignedRace::Zerg,
                        apm: 0,
                    }
                ),
                (
                    77,
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                )
            ])
        )
    }

    #[test]
    fn results_2v2_victory_ally_left() {
        init_logs();
        let local_user = LocalUser {
            id: 1,
            name: "local".to_string(),
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: local_user.id,
        };
        let ally = JoinedPlayer {
            name: "ally".to_string(),
            storm_id: StormPlayerId(1),
            player_id: Some(BwPlayerId(1)),
            sb_user_id: 77,
        };
        let opponent1 = JoinedPlayer {
            name: "opponent1".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78,
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(3),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79,
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: GameType::top_v_bottom(2),
                player_results: HashMap::from([
                    (
                        BwPlayerId(0),
                        PlayerResult {
                            victory_state: VictoryState::Victory,
                            race: AssignedRace::Zerg,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::AlliedVictory;
                                a[1] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(1),
                        PlayerResult {
                            victory_state: VictoryState::Defeat,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::AlliedVictory;
                                a[1] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(2),
                        PlayerResult {
                            victory_state: VictoryState::Defeat,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(3),
                        PlayerResult {
                            victory_state: VictoryState::Defeat,
                            race: AssignedRace::Terran,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                ]),
                network_results: {
                    let mut n = make_standard_network_results(4);
                    n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                    n
                },
                local_player_lose_type: None,
                time: Duration::from_millis(27270),
            },
            &[local, ally, opponent1, opponent2],
            &local_user,
        );

        assert_eq!(
            results,
            HashMap::from([
                (
                    local_user.id,
                    GamePlayerResult {
                        result: VictoryState::Victory,
                        race: AssignedRace::Zerg,
                        apm: 0,
                    }
                ),
                (
                    77,
                    GamePlayerResult {
                        result: VictoryState::Victory,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78,
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79,
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Terran,
                        apm: 0,
                    }
                )
            ])
        )
    }

    #[test]
    fn results_2v2_left_with_ally_still_playing() {
        init_logs();
        let local_user = LocalUser {
            id: 1,
            name: "local".to_string(),
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: local_user.id,
        };
        let ally = JoinedPlayer {
            name: "ally".to_string(),
            storm_id: StormPlayerId(1),
            player_id: Some(BwPlayerId(1)),
            sb_user_id: 77,
        };
        let opponent1 = JoinedPlayer {
            name: "opponent1".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78,
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(3),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79,
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: GameType::melee(),
                player_results: HashMap::from([
                    (
                        BwPlayerId(0),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Zerg,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::AlliedVictory;
                                a[1] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(1),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::AlliedVictory;
                                a[1] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(2),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(3),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Terran,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                ]),
                network_results: make_standard_network_results(4),
                local_player_lose_type: None,
                time: Duration::from_millis(27270),
            },
            &[local, ally, opponent1, opponent2],
            &local_user,
        );

        assert_eq!(
            results,
            HashMap::from([
                (
                    local_user.id,
                    GamePlayerResult {
                        result: VictoryState::Disconnected,
                        race: AssignedRace::Zerg,
                        apm: 0,
                    }
                ),
                (
                    77,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Terran,
                        apm: 0,
                    }
                )
            ])
        )
    }

    #[test]
    fn results_2v2_loss() {
        init_logs();
        let local_user = LocalUser {
            id: 1,
            name: "local".to_string(),
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: local_user.id,
        };
        let ally = JoinedPlayer {
            name: "ally".to_string(),
            storm_id: StormPlayerId(1),
            player_id: Some(BwPlayerId(1)),
            sb_user_id: 77,
        };
        let opponent1 = JoinedPlayer {
            name: "opponent1".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78,
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(3),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79,
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: GameType::top_v_bottom(2),
                player_results: HashMap::from([
                    (
                        BwPlayerId(0),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Zerg,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::AlliedVictory;
                                a[1] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(1),
                        PlayerResult {
                            victory_state: VictoryState::Defeat,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::AlliedVictory;
                                a[1] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(2),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(3),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Terran,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                ]),
                network_results: {
                    let mut n = make_standard_network_results(4);
                    n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                    n
                },
                local_player_lose_type: None,
                time: Duration::from_millis(27270),
            },
            &[local, ally, opponent1, opponent2],
            &local_user,
        );

        assert_eq!(
            results,
            HashMap::from([
                (
                    local_user.id,
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Zerg,
                        apm: 0,
                    }
                ),
                (
                    77,
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Terran,
                        apm: 0,
                    }
                )
            ])
        )
    }

    #[test]
    fn results_2v2_nonsymmetric_allies() {
        init_logs();
        let local_user = LocalUser {
            id: 1,
            name: "local".to_string(),
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: local_user.id,
        };
        let ally = JoinedPlayer {
            name: "ally".to_string(),
            storm_id: StormPlayerId(1),
            player_id: Some(BwPlayerId(1)),
            sb_user_id: 77,
        };
        let opponent1 = JoinedPlayer {
            name: "opponent1".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78,
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(3),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79,
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: GameType::melee(),
                player_results: HashMap::from([
                    (
                        BwPlayerId(0),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Zerg,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::AlliedVictory;
                                a[1] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(1),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[1] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(2),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(3),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Terran,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                ]),
                network_results: make_standard_network_results(4),
                local_player_lose_type: None,
                time: Duration::from_millis(27270),
            },
            &[local, ally, opponent1, opponent2],
            &local_user,
        );

        assert_eq!(
            results,
            HashMap::from([
                (
                    local_user.id,
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Zerg,
                        apm: 0,
                    }
                ),
                (
                    77,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Terran,
                        apm: 0,
                    }
                )
            ])
        )
    }

    #[test]
    fn results_2v2_self_disconnect() {
        init_logs();
        // Ally: disconnected, was_dropped + has_quit
        // Enemies: disconnected, was_dropped + has quit
        // Me: victory, not dropped or quit
        let local_user = LocalUser {
            id: 1,
            name: "local".to_string(),
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: local_user.id,
        };
        let ally = JoinedPlayer {
            name: "ally".to_string(),
            storm_id: StormPlayerId(1),
            player_id: Some(BwPlayerId(1)),
            sb_user_id: 77,
        };
        let opponent1 = JoinedPlayer {
            name: "opponent1".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78,
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(3),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79,
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: GameType::top_v_bottom(2),
                player_results: HashMap::from([
                    (
                        BwPlayerId(0),
                        PlayerResult {
                            victory_state: VictoryState::Victory,
                            race: AssignedRace::Zerg,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::AlliedVictory;
                                a[1] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(1),
                        PlayerResult {
                            victory_state: VictoryState::Disconnected,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::AlliedVictory;
                                a[1] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(2),
                        PlayerResult {
                            victory_state: VictoryState::Disconnected,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(3),
                        PlayerResult {
                            victory_state: VictoryState::Disconnected,
                            race: AssignedRace::Terran,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                ]),
                network_results: {
                    let mut n = make_standard_network_results(4);
                    n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                    n.get_mut(&StormPlayerId(1)).unwrap().was_dropped = true;
                    n.get_mut(&StormPlayerId(2)).unwrap().has_quit = true;
                    n.get_mut(&StormPlayerId(2)).unwrap().was_dropped = true;
                    n.get_mut(&StormPlayerId(3)).unwrap().has_quit = true;
                    n.get_mut(&StormPlayerId(3)).unwrap().was_dropped = true;
                    n
                },
                local_player_lose_type: Some(PlayerLoseType::MassDisconnect),
                time: Duration::from_millis(27270),
            },
            &[local, ally, opponent1, opponent2],
            &local_user,
        );

        // The desire here is that we mark ourselves however the game said, but we leave everyone
        // else as "Playing" if they were dropped as part of the mass disconnect, so that, ideally,
        // the majority report from the other side of the connection will outweigh our reports.
        assert_eq!(
            results,
            HashMap::from([
                (
                    local_user.id,
                    GamePlayerResult {
                        result: VictoryState::Victory,
                        race: AssignedRace::Zerg,
                        apm: 0,
                    }
                ),
                (
                    77,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Terran,
                        apm: 0,
                    }
                )
            ])
        )
    }

    #[test]
    fn results_2v2_with_dropped_player() {
        init_logs();
        // Ally (dropped): disconnected, was_dropped + has_quit
        // Enemies: playing, not dropped or quit
        // Me: playing, not dropped or quit
        let local_user = LocalUser {
            id: 1,
            name: "local".to_string(),
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: local_user.id,
        };
        let ally = JoinedPlayer {
            name: "ally".to_string(),
            storm_id: StormPlayerId(1),
            player_id: Some(BwPlayerId(1)),
            sb_user_id: 77,
        };
        let opponent1 = JoinedPlayer {
            name: "opponent1".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78,
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(3),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79,
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: GameType::melee(),
                player_results: HashMap::from([
                    (
                        BwPlayerId(0),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Zerg,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::AlliedVictory;
                                a[1] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(1),
                        PlayerResult {
                            victory_state: VictoryState::Disconnected,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::AlliedVictory;
                                a[1] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(2),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(3),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Terran,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                ]),
                network_results: {
                    let mut n = make_standard_network_results(4);
                    n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                    n.get_mut(&StormPlayerId(1)).unwrap().was_dropped = true;
                    n
                },
                local_player_lose_type: None,
                time: Duration::from_millis(27270),
            },
            &[local, ally, opponent1, opponent2],
            &local_user,
        );

        assert_eq!(
            results,
            HashMap::from([
                (
                    local_user.id,
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Zerg,
                        apm: 0,
                    }
                ),
                (
                    77,
                    GamePlayerResult {
                        result: VictoryState::Disconnected,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Terran,
                        apm: 0,
                    }
                )
            ])
        )
    }

    #[test]
    fn results_ums_game() {
        init_logs();
        // UMS should exactly reproduce whatever the game thread sent us
        let local_user = LocalUser {
            id: 1,
            name: "local".to_string(),
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: local_user.id,
        };
        let opponent = JoinedPlayer {
            name: "opponent".to_string(),
            storm_id: StormPlayerId(1),
            player_id: Some(BwPlayerId(1)),
            sb_user_id: 77,
        };
        let third = JoinedPlayer {
            name: "third".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78,
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: GameType::ums(),
                player_results: HashMap::from([
                    (
                        BwPlayerId(0),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Zerg,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(1),
                        PlayerResult {
                            victory_state: VictoryState::Defeat,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[1] = AllianceState::AlliedVictory;
                                a[2] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(2),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[1] = AllianceState::AlliedVictory;
                                a[2] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                ]),
                network_results: {
                    let mut n = make_standard_network_results(2);
                    n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                    n
                },
                local_player_lose_type: None,
                time: Duration::from_millis(27270),
            },
            &[local, opponent, third],
            &local_user,
        );

        assert_eq!(
            results,
            HashMap::from([
                (
                    local_user.id,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Zerg,
                        apm: 0,
                    }
                ),
                (
                    77,
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78,
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                )
            ])
        )
    }

    #[test]
    fn results_with_allied_computers() {
        init_logs();
        let local_user = LocalUser {
            id: 1,
            name: "local".to_string(),
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: local_user.id,
        };
        let opponent1 = JoinedPlayer {
            name: "opponent1".to_string(),
            storm_id: StormPlayerId(1),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78,
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79,
        };

        // BW ID 1 + 4 are computers, allied with each other and players 2 + 3
        // Local player (0) has their buildings destroyed and thus loses, the remaining computer
        // should bring along 2 + 3 as victors
        let results = determine_game_results(
            GameThreadResults {
                game_type: GameType::melee(),
                player_results: HashMap::from([
                    (
                        BwPlayerId(0),
                        PlayerResult {
                            victory_state: VictoryState::Defeat,
                            race: AssignedRace::Zerg,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(1),
                        PlayerResult {
                            victory_state: VictoryState::Defeat,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[1] = AllianceState::AlliedVictory;
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a[4] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(2),
                        PlayerResult {
                            victory_state: VictoryState::Defeat,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[1] = AllianceState::AlliedVictory;
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(3),
                        PlayerResult {
                            victory_state: VictoryState::Defeat,
                            race: AssignedRace::Terran,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[1] = AllianceState::AlliedVictory;
                                a[2] = AllianceState::AlliedVictory;
                                a[3] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(4),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[1] = AllianceState::AlliedVictory;
                                a[4] = AllianceState::AlliedVictory;
                                a
                            },
                        },
                    ),
                ]),
                network_results: {
                    let mut n = make_standard_network_results(3);
                    n.get_mut(&StormPlayerId(1)).unwrap().has_quit = true;
                    n.get_mut(&StormPlayerId(2)).unwrap().has_quit = true;
                    n
                },
                local_player_lose_type: None,
                time: Duration::from_millis(27270),
            },
            &[local, opponent1, opponent2],
            &local_user,
        );

        assert_eq!(
            results,
            HashMap::from([
                (
                    local_user.id,
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Zerg,
                        apm: 0,
                    }
                ),
                (
                    78,
                    GamePlayerResult {
                        result: VictoryState::Victory,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79,
                    GamePlayerResult {
                        result: VictoryState::Victory,
                        race: AssignedRace::Terran,
                        apm: 0,
                    }
                )
            ])
        )
    }

    #[test]
    fn results_with_unallied_computers() {
        init_logs();
        let local_user = LocalUser {
            id: 1,
            name: "local".to_string(),
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: local_user.id,
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: GameType::melee(),
                player_results: HashMap::from([
                    (
                        BwPlayerId(0),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Zerg,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[0] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(1),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[1] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                    (
                        BwPlayerId(2),
                        PlayerResult {
                            victory_state: VictoryState::Playing,
                            race: AssignedRace::Protoss,
                            alliances: {
                                let mut a = [AllianceState::Unallied; 8];
                                a[2] = AllianceState::Allied;
                                a
                            },
                        },
                    ),
                ]),
                network_results: make_standard_network_results(1),
                local_player_lose_type: None,
                time: Duration::from_millis(27270),
            },
            &[local],
            &local_user,
        );

        assert_eq!(
            results,
            HashMap::from([(
                local_user.id,
                GamePlayerResult {
                    result: VictoryState::Defeat,
                    race: AssignedRace::Zerg,
                    apm: 0,
                }
            ),])
        )
    }
}
