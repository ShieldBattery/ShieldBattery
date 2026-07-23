use std::ffi::{CStr, CString};
use std::io;
use std::mem;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::pin::{Pin, pin};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::prelude::*;
use hashbrown::{HashMap, HashSet};
use quick_error::quick_error;
use reqwest::header::{HeaderMap, ORIGIN};
use smallvec::SmallVec;
use tokio::select;
use tokio::sync::{mpsc, oneshot};

use crate::app_messages::{
    GAME_STATUS_ERROR, GamePlayerResult, GameResults, GameResultsMessage, GameSetupInfo, GameType,
    MapForce, MapInfo, NetcodeV2Setup, NetworkStallInfo, NetworkStatus, NetworkTransport,
    PlayerInfo, RawGameResultsReport, RawNetPlayer, RawPlayerResult, SbUser, SbUserId,
    ServerConfig, Settings, SetupProgress, UmsLobbyRace,
};
use crate::app_socket;
use crate::bw::players::{AllianceState, BwPlayerId, PlayerLoseType, StormPlayerId, VictoryState};
use crate::bw::{self, Bw, BwGameType, LobbyOptions, UserLatency, get_bw};
use crate::cancel_token::{CancelToken, Canceler, SharedCanceler};
use crate::forge;
use crate::game_thread::{
    self, GameThreadMessage, GameThreadRequest, GameThreadRequestType, GameThreadResults,
};
use crate::netcode_v2;
use crate::replay;

pub type SendMessages = mpsc::Sender<GameStateMessage>;

pub struct GameState {
    init_state: InitState,
    ws_send: app_socket::SendMessages,
    internal_send: SendMessages,
    init_main_thread: std::sync::mpsc::Sender<()>,
    send_main_thread_requests: std::sync::mpsc::Sender<GameThreadRequest>,
    #[allow(dead_code)]
    running_game: Option<Canceler>,
    async_stop: SharedCanceler,
    /// Netcode v2 credentials + relay endpoints, if the app sent them (`netcodeV2Setup`). Consumed
    /// by `init_game` to stand up the rally-point2 session (`netcode_v2::establish_session`).
    /// `None` for a solo game (which runs a sessionless turn state) or a replay.
    netcode_v2_setup: Option<Box<NetcodeV2Setup>>,
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
    local_user: Option<SbUser>,
    /// SbUserIds the local user has blocked; their in-game chat is hidden. Not required for init,
    /// so it defaults to empty if the app never sends it.
    blocked_users: Vec<SbUserId>,
    server_config: Option<ServerConfig>,
    settings_set: bool,
}

impl IncompleteInit {
    fn init_if_ready(
        &mut self,
        info: &Arc<GameSetupInfo>,
    ) -> Result<InitInProgress, GameInitError> {
        if !self.settings_set {
            return Err(GameInitError::SettingsNotSet);
        }
        if self.local_user.is_none() {
            return Err(GameInitError::LocalUserNotSet);
        }
        if self.server_config.is_none() {
            return Err(GameInitError::ServerConfigNotSet);
        }

        Ok(InitInProgress::new(
            info.clone(),
            self.local_user.take().unwrap(),
            mem::take(&mut self.blocked_users),
            self.server_config.take().unwrap(),
        ))
    }
}

/// Messages sent from other async tasks to communicate with GameState
pub enum GameStateMessage {
    SetSettings(Settings),
    /// Netcode v2 (rally-point2) per-session credentials + relay endpoints from the app.
    /// Boxed because it is large and rarely sent (once per game) relative to the other variants.
    SetNetcodeV2Setup(Box<NetcodeV2Setup>),
    SetLocalUser(SbUser),
    SetBlockedUsers(Vec<SbUserId>),
    SetServerConfig(ServerConfig),
    SetupGame(Box<GameSetupInfo>),
    /// The fully-known joined-player set, built directly from the session roster + slot layout.
    /// Populates `joined_players` (for results/chat/id-mapping) and completes the
    /// all-players-joined gate.
    SetV2JoinedPlayers(Vec<JoinedPlayer>),
    GameSetupDone,
    GameThread(GameThreadMessage),
    CleanupQuit,
    QuitIfNotStarted,
    /// Debug/verification control surface command (see `crate::debug_control`); absent from
    /// release builds.
    #[cfg(debug_assertions)]
    DebugControl(crate::debug_control::DebugControlCommand),
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
        ServerConfigNotSet {
            display("Server config not set")
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
        NetcodeV2SessionInit(msg: String) {
            display("Netcode v2 session could not be established: {}", msg)
        }
        UnknownGameType(ty: crate::app_messages::GameType, sub: Option<u8>) {
            display("Unknown game type '{:?}', {:?}", ty, sub)
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
            forge::init(&settings.local, &settings.scr, settings.monitor_bounds);
            get_bw().set_settings(settings);
            state.settings_set = true;
        } else {
            error!("Received settings after game was started");
        }
    }

    fn set_local_user(&mut self, user: SbUser) {
        if let InitState::WaitingForInput(ref mut state) = self.init_state {
            state.local_user = Some(user);
        } else {
            error!("Received local user after game was started");
        }
    }

    fn set_blocked_users(&mut self, users: Vec<SbUserId>) {
        if let InitState::WaitingForInput(ref mut state) = self.init_state {
            state.blocked_users = users;
        } else {
            error!("Received blocked users after game was started");
        }
    }

    fn set_server_config(&mut self, config: ServerConfig) {
        if let InitState::WaitingForInput(ref mut state) = self.init_state {
            state.server_config = Some(config);
        } else {
            error!("Received server config after game was started");
        }
    }

    fn send_game_request(
        &mut self,
        request_type: GameThreadRequestType,
    ) -> impl Future<Output = ()> + use<> {
        send_game_request(&self.send_main_thread_requests, request_type)
    }

    /// On success, returns once game is ready to be started & shown.
    fn init_game(
        &mut self,
        info: GameSetupInfo,
    ) -> impl Future<Output = Result<(), GameInitError>> + use<> {
        let game_type = match info.bw_game_type() {
            Some(s) => s,
            None => {
                let err = GameInitError::UnknownGameType(info.game_type, info.game_sub_type);
                return future::err(err).boxed();
            }
        };

        let info = Arc::new(info);
        // The complete initialization logic is split between the future in this function and
        // InitInProgress, both places poking bw's state as well.. It may probably be better to move
        // everything to InitInProgress and have this function just initialize it?
        let init_state = match self.init_state {
            InitState::WaitingForInput(ref mut state) => match state.init_if_ready(&info) {
                Ok(o) => o,
                Err(e) => return future::err(e).boxed(),
            },
            InitState::Started(_) => {
                return future::err(GameInitError::InitInProgress).boxed();
            }
        };
        let local_user = init_state.local_user.clone();
        // The server base URL the netcode-v2 re-home provider posts to (same origin as the results
        // submission). Captured before `init_state` is moved into `Started`.
        let server_url = init_state.server_config.server_url.clone();
        self.init_state = InitState::Started(init_state);

        let send_messages_to_state = self.internal_send.clone();
        let game_request_send = self.send_main_thread_requests.clone();
        let ws_send = self.ws_send.clone();

        // Present for a relay game, whose per-session credentials + relay endpoints the app sent as
        // `netcodeV2Setup`; absent for a solo (single-human) game or a replay. Drives the transport
        // policy the async block below branches on.
        let netcode_v2_setup = self.netcode_v2_setup.take();

        self.init_main_thread
            .send(())
            .expect("Main thread should be waiting for a wakeup");
        async move {
            let sbat_replay_data = match info.is_replay() {
                true => Some(read_sbat_replay_data(Path::new(&info.map_path))),
                false => None,
            };
            // We tell BW thread to init, and then it'll stay in forge's WndProc until we're
            // ready to start the game - remaining initialization is done from other threads.
            // Could possibly aim to keep all of BW initialization in the main thread, but this
            // system has worked fine so far.
            let is_host = info.host.user_id.is_some_and(|host_id| host_id == local_user.id);
            let req = send_game_request(
                &game_request_send,
                GameThreadRequestType::SetupInfo(info.clone()),
            );
            req.await;
            let req = send_game_request(&game_request_send, GameThreadRequestType::Initialize);
            req.await;

            let latency = if let Some(latency) = info.user_latency {
                match latency {
                    0 => UserLatency::Low,
                    1 => UserLatency::High,
                    2 => UserLatency::ExtraHigh,
                    val => {
                        warn!("Invalid user latency value: {val}");
                        UserLatency::Low
                    }
                }
            } else {
                UserLatency::Low
            };

            unsafe {
                // Writes the local player name, brings up the SNP provider (choose_snp) and sets
                // is_multiplayer. A networked game needs the provider too: Storm's local session
                // create hard-fails without one, even though the rp2 turn transport carries all real
                // traffic. A replay plays back through a local Storm session created here (it is
                // always its own host), with its user latency from the setup info; networked games
                // create their lobby in their own setup path below and let the turn transport own
                // latency.
                get_bw().remaining_game_init(&local_user.name);
                if info.is_replay() {
                    create_lobby(&info)?;
                    debug!("Setting initial user latency: {latency:?}");
                    get_bw().set_user_latency(latency);
                }
            }

            start_game_request(&game_request_send, GameThreadRequestType::RunWndProc)
                .map_err(|()| GameInitError::Closed)?;

            // Transport policy:
            // - `netcodeV2Setup` present → a relay game (host or peer): stand up the QUIC turn
            //   transport and run the native lobby over the rp2 seam.
            // - absent, a replay → play back locally from the recorded command stream (no session).
            // - absent, exactly one human → a solo game: a sessionless, local-only turn state.
            // - absent, more than one human → a server misconfiguration: fail the load loudly.
            if let Some(setup) = netcode_v2_setup {
                // Stand up the rally-point2 turn transport before the native lobby is created. A game
                // launched for netcode v2 must run on it; if the relay can't be reached the load
                // fails outright, so the app cancels it and surfaces an error rather than silently
                // playing on native networking.
                //
                // A game with AI players self-closes its relay session when the last remote human
                // leaves, so the lone human plays on versus the computers locally (see
                // `TurnState::should_self_close`).
                let has_computers = info.slots.iter().any(|s| s.is_computer());
                // Context the re-home provider authenticates its SB-server failover requests with
                // (the same gameId + userId + resultCode the results submission uses).
                let rehome_context = netcode_v2::RehomeContext {
                    server_url: server_url.clone(),
                    game_id: info.game_id.clone(),
                    user_id: local_user.id,
                    result_code: info.result_code.clone(),
                };
                let mut session_start =
                    netcode_v2::establish_session(&setup, has_computers, rehome_context)
                        .await
                        .map_err(|e| GameInitError::NetcodeV2SessionInit(e.to_string()))?;
                info!("Netcode v2 session established");
                // Route lobby command traffic through the rp2 turn transport rather than native
                // Storm networking. This must latch on before any native create/join runs: the
                // host's lobby machine starts flushing lobby turns the instant its session is
                // created, and those turns have to ride the seam from the very first flush.
                netcode_v2::with_turn_state(|s| s.enable_lobby_seam());
                let _ = app_socket::send_message(
                    &ws_send,
                    "/game/networkStatus",
                    NetworkStatus {
                        transport: NetworkTransport::NetcodeV2,
                        error: None,
                    },
                )
                .await;
                // Native-lobby setup over the rp2 seam: the host creates the native lobby and each
                // peer joins it, but all lobby command traffic rides the turn transport rather than
                // Storm networking. Storm ids come straight from the rp2 roster (storm id ≡ rp2
                // slot) instead of being learned from a Storm join, and the joined-player set is
                // built directly rather than discovered through Storm's flag-poll reconciliation.
                let bw = get_bw();
                let MapInfo::Game(ref game_map) = info.map else {
                    return Err(GameInitError::NetcodeV2SessionInit(
                        "netcode v2 game is not a map game".into(),
                    ));
                };

                // The (user → storm id) mapping from the live session roster (storm id ≡ rp2 slot).
                let storm_id_map: HashMap<SbUserId, u8> =
                    netcode_v2::with_turn_state(|s| s.roster_storm_ids())
                        .unwrap_or_default()
                        .into_iter()
                        .map(|(user, storm)| (user, storm.0))
                        .collect();
                let Some(&local_storm) = storm_id_map.get(&local_user.id) else {
                    return Err(GameInitError::NetcodeV2SessionInit(
                        "local user has no slot in the session roster".into(),
                    ));
                };

                // storm_create_game validates both names as non-empty. Strip any interior NULs so
                // the CStrings are well-formed, and fall back to a constant game name if empty.
                let game_name = sanitized_name_cstring(&info.name)
                    .unwrap_or_else(|| CString::new("game").unwrap());
                let local_name = sanitized_name_cstring(&local_user.name).ok_or_else(|| {
                    GameInitError::NetcodeV2SessionInit("local player name is empty".into())
                })?;

                // The peer's join replacement rebuilds an equivalent Storm session from these inputs;
                // the total slot count is the number of setup slots (what native create derives from
                // its GameInput on the host side).
                let slot_count = info.slots.len() as u32;

                // Every OTHER session member (the local player builds its own identity). Each member's
                // name comes from the roster user list, NUL-stripped like the local name, and its
                // Storm net key is derived from its slot + user id. A roster member missing from
                // the user list, or whose name sanitizes to empty, is a server-data invariant
                // violation — fail the load loudly rather than silently dropping the member.
                let members: Vec<netcode_v2::StormMemberSeed> = storm_id_map
                    .iter()
                    .filter(|&(&user_id, _)| user_id != local_user.id)
                    .map(|(&user_id, &slot)| {
                        let name = info
                            .users
                            .iter()
                            .find(|u| u.id == user_id)
                            .and_then(|u| sanitized_name_cstring(&u.name))
                            .ok_or_else(|| {
                                GameInitError::NetcodeV2SessionInit(format!(
                                    "roster member {user_id:?} has no usable name in the user list"
                                ))
                            })?;
                        Ok(netcode_v2::StormMemberSeed {
                            slot,
                            name,
                            net_key: netcode_v2::storm_net_key(slot, user_id),
                        })
                    })
                    .collect::<Result<Vec<_>, GameInitError>>()?;

                let ums_forces = &game_map.map_data.ums_forces[..];

                if is_host {
                    // Storm makes the session creator slot 0 unconditionally, and storm id ≡ rp2
                    // slot everywhere else, so the server assigns the host rp2 slot 0. If that
                    // contract ever breaks, every id derived from the roster is wrong — fail the
                    // load loudly instead of desyncing on the first turn.
                    if local_storm != 0 {
                        return Err(GameInitError::NetcodeV2SessionInit(format!(
                            "host must occupy rp2 slot 0, got slot {local_storm}"
                        )));
                    }
                    unsafe {
                        // Create the native lobby (its Storm create allocates the session the peers
                        // are admitted into). No set_user_latency: netcode v2 latency is relay-owned.
                        create_lobby(&info)?;
                        // Admit the peers into the just-created session, standing in for the network
                        // join packets native Storm would have received from each of them.
                        bw.v2_seed_storm_session_members(&members);
                    }
                } else {
                    // Stage the session seed the storm_join_game hook consumes to build this client's
                    // Storm session itself (create-then-fixup + member seeding) instead of running the
                    // native network join handshake.
                    netcode_v2::set_lobby_session_seed(netcode_v2::LobbySessionSeed {
                        game_name,
                        local_name,
                        slot_count,
                        local_slot: local_storm,
                        members,
                    });
                    unsafe {
                        join_lobby(&info, game_type, latency).await?;
                    }
                    // Drop the staged seed now that the join consumed it: a stale seed must never
                    // survive to be picked up by any later storm_join_game call. This only covers
                    // the success path — `join_lobby`'s error/cancellation paths never reach here,
                    // but session teardown (`clear_session`) clears the seed too, so those paths
                    // are still covered.
                    netcode_v2::clear_lobby_session_seed();
                }

                game_thread::step_lobby_init();

                unsafe {
                    // Overlay the real game-type template onto game_data. Native create sets it on the
                    // host from BW's registry, but the roster-driven peer join never receives the
                    // host's game-info blob, so its template stays zeroed — which BW runs as Use Map
                    // Settings (wrong rules → a turn-0 desync against the host's real-rules sim). The
                    // registry is identical on every client, so this local lookup matches the host.
                    bw.apply_game_type_template(game_type).map_err(|()| {
                        GameInitError::NetcodeV2SessionInit("game type template lookup failed".into())
                    })?;
                    // Fill net_player_info directly for every human and observer. Native
                    // init_net_player only populates the entry a player Storm's own provider-gated
                    // name lookup resolves — the local player, but not a roster-seeded remote — so a
                    // direct write is what gives every participant a populated entry (name + in-use
                    // state). Observers are net players too — their storm ids are rp2 slots < 12,
                    // in range of the net-player table — so they register the same way.
                    for slot in info.slots.iter().filter(|s| s.is_human() || s.is_observer()) {
                        if let Some(uid) = slot.user_id
                            && let Some(&storm) = storm_id_map.get(&uid)
                        {
                            let name = info
                                .users
                                .iter()
                                .find(|u| u.id == uid)
                                .map(|u| u.name.as_str())
                                .unwrap_or("");
                            bw.v2_register_net_player(storm, name);
                        }
                    }
                    // Slot layout with the real storm ids from the roster (SB owns the arrangement,
                    // the roster owns the ids).
                    setup_slots(
                        &info.slots,
                        &info.users,
                        game_type,
                        ums_forces,
                        Some(&storm_id_map),
                    );
                    // Natively lobby_state 4 is reached when the lobby-entry slot-setup record is
                    // received, which never arrives under this seam; set it directly.
                    bw.set_lobby_state(4);
                    // Build the id maps from players[].storm_id and bump lobby_state to 8 (the state
                    // the 0x48 handler requires).
                    bw.ready_lobby_for_start();
                }

                // Populate the joined-player set directly from the roster + slot layout (no Storm
                // read), so results/chat/id-mapping work and the all_players_joined gate completes.
                let v2_joined_players = build_v2_joined_players(&info, &storm_id_map);
                send_messages_to_state
                    .send(GameStateMessage::SetV2JoinedPlayers(v2_joined_players))
                    .await
                    .map_err(|_| GameInitError::Closed)?;

                // The relay's SessionStart directive gates the game start: the relay fires it once
                // every expected slot (players + observers) has connected somewhere in the session's
                // mesh. Await it once here, then local-drive the 0x48 (in do_lobby_game_init on the
                // game thread). The frame-0 barrier (receive_turns parks until every required slot is
                // present) remains the true lockstep sync. Keep stepping lobby init so the window
                // stays responsive while we wait.
                let mut last_lobby_state = unsafe { bw.lobby_state() };
                debug!("Waiting for the session-start directive at lobby_state {last_lobby_state}");
                loop {
                    game_thread::step_lobby_init();
                    let lobby_state = unsafe { bw.lobby_state() };
                    if lobby_state != last_lobby_state {
                        debug!(
                            "lobby_state changed {last_lobby_state} -> {lobby_state} while \
                            awaiting the session-start directive"
                        );
                        last_lobby_state = lobby_state;
                    }
                    select! {
                        _ = tokio::time::sleep(Duration::from_millis(game_thread::until_next_lobby_init_step())) => continue,
                        received = session_start.recv() => {
                            match received {
                                // The authoring relay sized an initial latency-buffer depth for this
                                // session: stamp it onto the live turn state now, before countdown and
                                // `seed_netcode_v2_pipe`, so the first pipe fill runs at that depth
                                // instead of the tenant-minimum seed. Applied only here, in this single
                                // pre-start receive — the background drain below discards any re-push,
                                // so a mid-game re-delivery never resizes a running buffer.
                                Some(Some(turns)) => {
                                    netcode_v2::with_turn_state(|s| s.set_initial_latency_turns(turns));
                                    info!(
                                        "Netcode v2 session-start directive received with initial \
                                        buffer depth {turns} turns; starting game"
                                    );
                                }
                                // A depth-less directive (an authority relay that predates the field,
                                // or a resumed re-home re-push mid-flight): keep the depth already
                                // seeded at session establish.
                                Some(None) => debug!(
                                    "Netcode v2 session-start directive received without an initial \
                                    buffer depth; keeping the seeded depth and starting game"
                                ),
                                None => warn!(
                                    "Netcode v2 session-start channel closed before a directive; starting anyway"
                                ),
                            }
                            break;
                        }
                    }
                }
                // Delivery is at-least-once: keep the receiver alive and drained for the rest of the
                // session so a re-pushed directive (authority churn / a late slot's re-register)
                // stays a no-op instead of wedging or closing the driver on a dropped receiver.
                tokio::spawn(async move {
                    while session_start.recv().await.is_some() {
                        debug!("netcode v2: redundant session-start directive drained (no-op)");
                    }
                });
                debug!(
                    "Session-start directive handled (netcode v2); local-driving lobby init at lobby_state {}",
                    unsafe { bw.lobby_state() },
                );
            } else if info.is_replay() {
                // A replay plays back from its recorded command stream, not the turn transport:
                // there is no session and no peers to join. Its local Storm session was already
                // created in the prologue; here it lays out slots, loads any ShieldBattery replay
                // extension, and readies the lobby.
                game_thread::step_lobby_init();
                let bw = get_bw();

                // The prologue's create_lobby assigns this client's storm id (almost certainly 0,
                // since a replay's local session has no one else to share it with) — read it rather
                // than assume. `players[].storm_id` must carry this real value by the time
                // `ready_lobby_for_start` runs `update_nation_and_human_ids`, which asserts every
                // human/observer slot's storm id is a valid (< 16) id; feeding it the placeholder
                // `setup_slots` plants when given no roster would trip that assert.
                let local_storm = unsafe { bw.local_storm_id() };

                // Native `create_lobby` flips this client's storm flag on asynchronously; wait a
                // bounded, short while for it before pulling the local player into net_player_info —
                // mirrors the flag transition the (now direct-registration) join path used to key on.
                unsafe {
                    let mut attempts = 0;
                    while bw
                        .storm_player_flags()
                        .get(local_storm as usize)
                        .copied()
                        .unwrap_or(0)
                        == 0
                        && attempts < 20
                    {
                        game_thread::step_lobby_init();
                        tokio::time::sleep(Duration::from_millis(10)).await;
                        attempts += 1;
                    }
                    if bw
                        .storm_player_flags()
                        .get(local_storm as usize)
                        .copied()
                        .unwrap_or(0)
                        == 0
                    {
                        warn!(
                            "replay: local storm id {local_storm}'s flag never went nonzero after \
                             {attempts} attempts; proceeding anyway"
                        );
                    }
                    // Native init_net_player's name lookup only resolves the local player (there is
                    // no roster-seeded remote to fill in for a replay), so this alone populates the
                    // net_player_info entry the game needs.
                    bw.init_network_player_info(local_storm);
                }

                // The lone participant is this client's own viewer, at its real storm id — used both
                // to lay out slots with a valid (non-placeholder) storm id and for chat/id-mapping.
                let storm_id_map: HashMap<SbUserId, u8> =
                    std::iter::once((local_user.id, local_storm as u8)).collect();
                unsafe {
                    setup_slots(&info.slots, &info.users, game_type, &[], Some(&storm_id_map));
                }

                if let Some(sbat_replay_data_promise) = sbat_replay_data {
                    match sbat_replay_data_promise.await {
                        Ok(Some(o)) => {
                            debug!("Loaded shieldbattery replay extension");
                            game_thread::set_sbat_replay_data(o);
                        }
                        Ok(None) => (),
                        Err(e) => {
                            // A failure to read the extra replay data is usually not fatal, so log
                            // it and continue.
                            error!("Failed to read shieldbattery replay data: {e}");
                        }
                    }
                }

                unsafe {
                    bw.ready_lobby_for_start();
                }

                let joined = build_v2_joined_players(&info, &storm_id_map);
                send_messages_to_state
                    .send(GameStateMessage::SetV2JoinedPlayers(joined))
                    .await
                    .map_err(|_| GameInitError::Closed)?;

                // The replay's local session is fully readied above; there is no session peer to
                // wait on, so init proceeds directly. Lobby init completes later on the game thread
                // in the StartGame handler (which synthesizes the 0x48 and steps to completion).
            } else {
                // No netcode v2 setup and not a replay: a solo game, the local human versus AI. More
                // than one human here is a server misconfiguration — multiplayer must run on netcode
                // v2 — so fail the load loudly rather than trying to play it on native networking.
                let human_count = info.slots.iter().filter(|s| s.is_human()).count();
                if human_count != 1 {
                    return Err(GameInitError::NetcodeV2SessionInit(format!(
                        "multiplayer game ({human_count} humans) launched without netcode v2 setup"
                    )));
                }
                let MapInfo::Game(ref game_map) = info.map else {
                    return Err(GameInitError::NetcodeV2SessionInit(
                        "solo game is not a map game".into(),
                    ));
                };

                // Stand up a sessionless turn state: local-only from birth, driving the same turn
                // seam a relay game uses but with every driver-bound send landing in a void. A game
                // with AI keeps playing versus the computers after the lone human wins or loses.
                let has_computers = info.slots.iter().any(|s| s.is_computer());
                netcode_v2::establish_sessionless(local_user.id, has_computers);
                netcode_v2::with_turn_state(|s| s.enable_lobby_seam());
                let _ = app_socket::send_message(
                    &ws_send,
                    "/game/networkStatus",
                    NetworkStatus {
                        transport: NetworkTransport::Native,
                        error: None,
                    },
                )
                .await;

                let bw = get_bw();
                // The lone human occupies rp2 slot 0 (storm id ≡ rp2 slot), the same identity the
                // sessionless turn state seeds.
                let storm_id_map: HashMap<SbUserId, u8> =
                    std::iter::once((local_user.id, 0u8)).collect();
                let ums_forces = &game_map.map_data.ums_forces[..];
                unsafe {
                    // Create the native lobby (its Storm create allocates the local session). This
                    // solo path has no remote members, so no StormSessionPlayer seeding happens here.
                    create_lobby(&info)?;
                    // Overlay the real game-type template so the sim runs the correct rules rather
                    // than the zeroed template's Use Map Settings default.
                    bw.apply_game_type_template(game_type).map_err(|()| {
                        GameInitError::NetcodeV2SessionInit("game type template lookup failed".into())
                    })?;
                    // Fill net_player_info for the single human directly (native init_net_player only
                    // populates a provider-resolved name, which this path bypasses).
                    bw.v2_register_net_player(0, &local_user.name);
                    setup_slots(
                        &info.slots,
                        &info.users,
                        game_type,
                        ums_forces,
                        Some(&storm_id_map),
                    );
                    // lobby_state 4 is natively reached on the lobby-entry slot-setup record, which
                    // never arrives under this seam; set it directly, then build the id maps and bump
                    // to the state the 0x48 handler requires.
                    bw.set_lobby_state(4);
                    bw.ready_lobby_for_start();
                }

                let joined = build_v2_joined_players(&info, &storm_id_map);
                send_messages_to_state
                    .send(GameStateMessage::SetV2JoinedPlayers(joined))
                    .await
                    .map_err(|_| GameInitError::Closed)?;

                // The sessionless turn state is local-only from birth with nothing to wait on, so
                // init proceeds directly. do_countdown below keeps stepping lobby init, and the
                // StartGame handler on the game thread drives it to completion.
            }

            forge::start_process_events_dispatch();

            if !info.is_replay() {
                unsafe {
                    do_countdown().await;
                }
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
    fn run_game(&mut self) -> impl Future<Output = Result<(), GameInitError>> + use<> {
        let init_state = match self.init_state {
            InitState::Started(ref mut s) => s,
            _ => return future::err(GameInitError::GameInitNotInProgress).boxed(),
        };
        let local_user = init_state.local_user.clone();
        let server_config = init_state.server_config.clone();
        let info = init_state.setup_info.clone();

        let ws_send = self.ws_send.clone();
        let game_request_send = self.send_main_thread_requests.clone();
        let results = init_state.wait_for_results();
        async move {
            forge::end_wnd_proc();
            let start_game_request = GameThreadRequestType::StartGame;
            let game_done = send_game_request(&game_request_send, start_game_request);

            // NOTE(tec27): We await the game results before game_done since we get results as soon
            // as the Victory/Defeat dialog is shown, which is before the game loop exits
            let results = results.await?;
            if !info.is_replay() {
                send_game_result(&results, &info, &local_user, &server_config, &ws_send).await;
            }
            debug!("Network stall statistics: {:?}", results.network_stalls);

            game_done.await;

            // The turn transport announces this client's clean departure to the relay on its own
            // (`TurnState::send_leave_intent`, driven from the game thread as the game loop returns),
            // so surviving players get a prompt synced leave rather than a drop-timeout.

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
            SetBlockedUsers(users) => {
                self.set_blocked_users(users);
            }
            SetNetcodeV2Setup(setup) => {
                // SECURITY: `setup` holds the per-session private key; never log its contents.
                // `NetcodeV2Setup`'s `Debug` redacts the key, but don't `{:?}` it here regardless.
                debug!("Received netcode v2 setup for the home relay");
                self.netcode_v2_setup = Some(setup);
            }
            SetServerConfig(config) => {
                self.set_server_config(config);
            }
            SetupGame(info) => {
                let ws_send = self.ws_send.clone();
                let async_stop = self.async_stop.clone();
                let game_ready = self.init_game(*info);
                let task = async move {
                    if let Err(e) = game_ready.await {
                        let msg = format!("Failed to init game: {e}");
                        error!("{msg}");

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
            SetV2JoinedPlayers(players) => {
                if let InitState::Started(ref mut state) = self.init_state {
                    state.set_v2_joined_players(players);
                } else {
                    warn!("Received netcode v2 joined players before init was started");
                }
            }
            GameSetupDone => {
                let game_done = self.run_game();
                let async_stop = self.async_stop.clone();
                let task = async move {
                    if let Err(e) = game_done.await {
                        error!("Error on running game: {e}");
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
                if !get_bw().has_game_started() {
                    debug!("Exiting since game has not started");
                    // Not cleaning up (that is, saving user settings or anything)
                    // since we didn't start in the first place
                    self.async_stop.cancel();
                }
            }
            #[cfg(debug_assertions)]
            DebugControl(cmd) => {
                use crate::debug_control::DebugControlCommand;
                match cmd {
                    DebugControlCommand::Ping => {
                        return app_socket::send_message(&self.ws_send, "/game/debug/pong", ())
                            .map(|_| ())
                            .boxed();
                    }
                    DebugControlCommand::QueryState => {
                        let turn_state = crate::netcode_v2::with_turn_state(|s| s.debug_snapshot());
                        let response = crate::debug_control::DebugStateResponse { turn_state };
                        return app_socket::send_message(
                            &self.ws_send,
                            "/game/debug/state",
                            response,
                        )
                        .map(|_| ())
                        .boxed();
                    }
                    DebugControlCommand::ForceUnsyncedLeave { slot } => {
                        crate::netcode_v2::with_turn_state(|s| {
                            s.debug_force_unsynced_leave(rally_point_client::proto::ids::SlotId(
                                slot,
                            ))
                        });
                        // Fire-and-forget: the injection applies on the game thread's next receive;
                        // verify via queryState. No reply.
                    }
                    DebugControlCommand::ForceDesync => {
                        crate::netcode_v2::with_turn_state(|s| s.debug_force_desync());
                        // Fire-and-forget: the mineral perturbation applies on the game thread's next
                        // receive. No reply.
                    }
                    DebugControlCommand::SendChat { text, target } => {
                        use crate::debug_control::DebugChatTarget;
                        let target = match target {
                            DebugChatTarget::All => netcode_v2::ChatTarget::All,
                            DebugChatTarget::Allies => netcode_v2::ChatTarget::Allies,
                            DebugChatTarget::Observers => netcode_v2::ChatTarget::Observers,
                            DebugChatTarget::Player { slot } => {
                                netcode_v2::ChatTarget::Players(netcode_v2::SlotMask::single(
                                    rally_point_client::proto::ids::SlotId(slot),
                                ))
                            }
                        };
                        crate::netcode_v2::with_turn_state(|s| s.debug_queue_chat(target, text));
                        // Fire-and-forget: sent + locally echoed on the game thread's next receive
                        // (see `bw_scr::apply_debug_chat`), through the same path the in-game chat
                        // box's own send tap uses. No reply.
                    }
                    DebugControlCommand::RequestDrop { slot } => {
                        crate::netcode_v2::with_turn_state(|s| {
                            s.request_drop(rally_point_client::proto::ids::SlotId(slot))
                        });
                        // Fire-and-forget, the same call the overlay's Drop button makes: the relay
                        // honors it only past its floor and confirms it solely via the slot's synced
                        // leave. No reply — verify via queryState.
                    }
                    DebugControlCommand::ToggleNetStats => {
                        crate::netcode_v2::with_turn_state(|s| s.toggle_net_stats());
                        // Fire-and-forget, the same toggle the `/netstat` chat command makes. No
                        // reply — verify via queryState's `netStats.visible`.
                    }
                    DebugControlCommand::Screenshot => {
                        let ws_send = self.ws_send.clone();
                        return async move {
                            let response = match tokio::task::spawn_blocking(
                                crate::debug_control::capture_screenshot,
                            )
                            .await
                            {
                                Ok(response) => response,
                                Err(e) => crate::debug_control::DebugScreenshotResponse {
                                    screenshot: None,
                                    error: Some(format!("screenshot task failed: {e}")),
                                },
                            };
                            let _ = app_socket::send_message(
                                &ws_send,
                                "/game/debug/screenshot",
                                response,
                            )
                            .await;
                        }
                        .boxed();
                    }
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
            MinimapSettings {
                color_mode,
                terrain_hidden,
            } => {
                // Sent on the ordered game-completion path (the game thread enqueues this before
                // its results message, which gates `/game/finished`), so the app reliably persists
                // it before shutdown rather than racing the bridge task against `/game/finished`.
                return app_socket::send_message(
                    &self.ws_send,
                    "/game/minimapSettings",
                    crate::app_messages::MinimapSettings {
                        color_mode,
                        terrain_hidden,
                    },
                )
                .map(|_| ())
                .boxed();
            }
            PlayersRandomized(new_mapping) => {
                if let InitState::Started(ref mut state) = self.init_state {
                    if state.setup_info.is_replay() {
                        // Replays don't go through the normal lobby join flow that populates
                        // joined_players (the launch config only carries the local viewer), so
                        // rebuild it here from the SB user ids recorded in the replay's Sbat
                        // section. This is what lets the chat manager hide blocked players' chat.
                        state.joined_players = build_replay_joined_players();
                    } else {
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
                    }

                    get_bw().init_chat_manager(
                        &state.joined_players,
                        state.local_user.id,
                        &state.blocked_users,
                        state.setup_info.is_chat_restricted.unwrap_or_default(),
                    );

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
            GameStarting => {
                return app_socket::send_message(&self.ws_send, "/game/start", ())
                    .map(|_| ())
                    .boxed();
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

/// Returns the common headers needed for API server requests.
fn api_request_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(ORIGIN, "shieldbattery://game".parse().unwrap());
    headers
}

async fn send_game_result(
    results: &GameResults,
    info: &GameSetupInfo,
    local_user: &SbUser,
    server_config: &ServerConfig,
    ws_send: &app_socket::SendMessages,
) {
    // Send results to the app for its UI/state surface. If the app is closed the send fails; ignore
    // it, since the relay report and replay upload below run regardless.
    let results_message = GameResultsMessage {
        time: results.time_ms,
        results: &results.results,
        network_stalls: &results.network_stalls,
        temp_replay_path: results.replay_path.as_ref().and_then(|p| p.to_str()),
    };
    let _ = app_socket::send_message(ws_send, "/game/result", &results_message).await;

    if info.result_code.is_none() {
        debug!("Had no result code, skipping sending results and replay");
        return;
    }

    let result_code = info.result_code.clone().unwrap();

    // A tracked game's end-of-game report travels over the rally-point2 relay's reliable control
    // stream: build the report the server validates and hand it to the relay driver.
    // `submit_result_report` delivers it for a relay-backed session and does nothing for a
    // sessionless one, so a sessionless solo game submits no result anywhere. That asymmetry is
    // deliberate: a single-human game has nothing to rank, so the server treats it as
    // results-exempt. The replay upload below runs for every game type; it has no relay analogue
    // and always stays on HTTP.
    let report = RawGameResultsReport {
        version: 2,
        user_id: local_user.id,
        result_code: &result_code,
        time: results.time_ms,
        players: &results.raw_players,
        net_players: &results.raw_net_players,
        local_player_lose_type: results.local_player_lose_type,
    };
    match serde_json::to_vec(&report) {
        Ok(bytes) => {
            netcode_v2::submit_result_report(bytes);
        }
        Err(err) => error!("Failed to serialize game result report: {err}"),
    }

    if let Some(replay_path) = &results.replay_path {
        send_replay(
            replay_path,
            &info.game_id,
            local_user.id,
            &result_code,
            server_config,
            ws_send,
        )
        .await;
    }
}

/// Uploads a replay file to the server.
async fn send_replay(
    replay_path: &Path,
    game_id: &str,
    user_id: SbUserId,
    result_code: &str,
    server_config: &ServerConfig,
    ws_send: &app_socket::SendMessages,
) {
    let client = reqwest::Client::new();
    let headers = api_request_headers();
    let replay_url = format!(
        "{}/api/1/games/{}/replay",
        server_config.server_url, game_id
    );

    // Read the replay file
    let replay_data = match tokio::fs::read(replay_path).await {
        Ok(data) => data,
        Err(err) => {
            error!(
                "Failed to read replay file {}: {}",
                replay_path.display(),
                err
            );
            return;
        }
    };

    let file_name = replay_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("replay.rep")
        .to_string();

    for attempt in 0u8..3 {
        let file_part = reqwest::multipart::Part::bytes(replay_data.clone())
            .file_name(file_name.clone())
            .mime_str("application/octet-stream")
            .unwrap();

        let form = reqwest::multipart::Form::new()
            .text("userId", user_id.0.to_string())
            .text("resultCode", result_code.to_string())
            .part("replay", file_part);

        let result = client
            .post(&replay_url)
            .timeout(Duration::from_secs(90))
            .headers(headers.clone())
            .multipart(form)
            .send()
            .await;

        match result.and_then(|r| r.error_for_status()) {
            Ok(_) => {
                debug!("Replay uploaded successfully");
                // Clean up the temporary replay file
                if let Err(err) = tokio::fs::remove_file(replay_path).await {
                    warn!("Failed to delete temporary replay file: {}", err);
                }
                let _ = app_socket::send_message(ws_send, "/game/replayUploaded", ()).await;
                return;
            }
            Err(err) => {
                error!("Error uploading replay (attempt {}): {}", attempt + 1, err);
            }
        };
    }

    warn!("Failed to upload replay after 3 attempts, leaving file for potential retry");
}

struct InitInProgress {
    setup_info: Arc<GameSetupInfo>,
    local_user: SbUser,
    blocked_users: Vec<SbUserId>,
    server_config: ServerConfig,

    all_players_joined: AwaitableTaskState<Result<(), GameInitError>>,
    joined_players: Vec<JoinedPlayer>,
    waiting_for_result: Vec<oneshot::Sender<Arc<GameResults>>>,

    stall_durations: Vec<Duration>,
    stall_count: usize,
    stall_min: Duration,
    stall_max: Duration,
}

#[derive(Clone, Debug)]
pub struct JoinedPlayer {
    pub name: String,
    pub storm_id: StormPlayerId,
    pub player_id: Option<BwPlayerId>,
    pub sb_user_id: SbUserId,
}

impl InitInProgress {
    fn new(
        setup_info: Arc<GameSetupInfo>,
        local_user: SbUser,
        blocked_users: Vec<SbUserId>,
        server_config: ServerConfig,
    ) -> InitInProgress {
        InitInProgress {
            setup_info,
            local_user,
            blocked_users,
            server_config,

            all_players_joined: AwaitableTaskState::Incomplete(Vec::new()),
            joined_players: Vec::new(),
            waiting_for_result: Vec::new(),
            stall_durations: Vec::new(),
            stall_count: 0,
            stall_max: Duration::from_millis(0),
            stall_min: Duration::MAX,
        }
    }

    /// Installs the joined-player set built directly from the session roster + slot layout, and
    /// completes the all-players-joined gate. Every participant is known up front, so there is no
    /// Storm-read reconciliation to run and nothing to wait for.
    fn set_v2_joined_players(&mut self, players: Vec<JoinedPlayer>) {
        debug!("Netcode v2 joined players: {players:?}");
        self.joined_players = players;
        match mem::replace(&mut self.all_players_joined, AwaitableTaskState::Complete) {
            AwaitableTaskState::Complete => {}
            AwaitableTaskState::Incomplete(waiting) => {
                for sender in waiting {
                    let _ = sender.send(Ok(()));
                }
            }
        }
    }

    fn wait_for_results(
        &mut self,
    ) -> impl Future<Output = Result<Arc<GameResults>, GameInitError>> + use<> {
        let (send_done, recv_done) = oneshot::channel();
        self.waiting_for_result.push(send_done);
        recv_done.map_err(|_| GameInitError::Closed)
    }

    fn received_results(&mut self, game_results: GameThreadResults) {
        debug!("Got results from game thread: {game_results:#?}");

        let time_ms = game_results.time.as_millis() as u64;
        let replay_path = game_results.replay_path.clone();
        let raw_players = build_raw_players(&game_results, &self.joined_players);
        let raw_net_players = build_raw_net_players(&game_results);
        let local_player_lose_type = game_results.local_player_lose_type;
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
            raw_players,
            raw_net_players,
            local_player_lose_type,
            replay_path,
        });
        for send in self.waiting_for_result.drain(..) {
            let _ = send.send(message.clone());
        }
    }
}

unsafe fn create_lobby(info: &GameSetupInfo) -> Result<(), GameInitError> {
    unsafe {
        let map_path = Path::new(&info.map_path);
        get_bw()
            .create_lobby(map_path, &info.map, &info.name, info.into())
            .map_err(GameInitError::Bw)
    }
}

/// Builds the [`bw::BwGameData`] written to the `game_data` global / replay+save headers, from the
/// ShieldBattery setup info + map. Shared by the native join path ([`join_lobby`]) and the netcode
/// v2 direct-registration path (which native `create_game_multiplayer` populated only on a
/// successful Storm create). Not used in-game beyond `game_type`.
fn build_bw_game_data(
    info: &GameSetupInfo,
    game_type: BwGameType,
    map_data: &crate::app_messages::MapData,
    map_name: &str,
) -> bw::BwGameData {
    let max_player_count = info.slots.len() as u8;
    let active_player_count = info
        .slots
        .iter()
        .filter(|x| x.is_human() || x.is_observer())
        .count() as u8;

    // SAFETY: `BwGameData` is a `#[repr(C)]` POD (integers + byte arrays), so an all-zero bit
    // pattern is a valid instance; the fields we care about are set explicitly below.
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
        ..unsafe { mem::zeroed() }
    };

    let creator = if let Some(host) = info.users.iter().find(|u| Some(u.id) == info.host.user_id) {
        host.name.as_str()
    } else {
        "fakename"
    };
    for (out, val) in game_info
        .game_creator
        .iter_mut()
        .zip(creator.as_bytes().iter())
    {
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
}

/// Strips interior NULs and builds a `CString`, or `None` if the result is empty. Storm name
/// fields reject empty strings and NULs would truncate them.
fn sanitized_name_cstring(raw: &str) -> Option<CString> {
    CString::new(raw.replace('\0', ""))
        .ok()
        .filter(|s| !s.as_bytes().is_empty())
}

/// Builds the joined-player set for a netcode v2 game directly from the session roster + slot
/// layout, without reading Storm's join bookkeeping. The storm id is the user's rp2 roster slot
/// (storm id ≡ rp2 slot). For a non-UMS human the BW game slot (`player_id`) equals its index in
/// `slots` — the same `slot_id` `setup_slots` assigns — and is re-derived from the storm id once BW
/// randomizes slots (`PlayersRandomized`), so the pre-randomization value only needs to be a valid
/// game slot. A UMS game places players by the map's slot id (`slot.player_id`) instead — the same
/// id `setup_slots` places them at — and BW does not randomize UMS slots. Observers occupy the
/// observer game slots `players[12..16]` (ids 0x80-0x83): the nth observer in slot order takes
/// `players[11 + n]`, matching `setup_slots`, and BW's randomization leaves those slots in place.
/// A slot whose user has no roster storm id is skipped (a replay's roster names only the local
/// viewer).
fn build_v2_joined_players(
    info: &GameSetupInfo,
    storm_id_map: &HashMap<SbUserId, u8>,
) -> Vec<JoinedPlayer> {
    let is_ums = info.game_type == GameType::Ums;
    let mut joined = Vec::new();
    let mut num_observers = 0u8;
    for (i, slot) in info.slots.iter().enumerate() {
        let is_observer = slot.is_observer();
        if !slot.is_human() && !is_observer {
            continue;
        }
        // Observers count in slot order regardless of whether the entry resolves below, so a later
        // observer still lands on the game slot `setup_slots` gave it.
        let player_id = if is_observer {
            num_observers += 1;
            BwPlayerId(11 + num_observers)
        } else if is_ums {
            BwPlayerId(slot.player_id.unwrap_or(0))
        } else {
            BwPlayerId(i as u8)
        };
        let Some(user_id) = slot.user_id else {
            continue;
        };
        let Some(name) = info
            .users
            .iter()
            .find(|u| u.id == user_id)
            .map(|u| u.name.clone())
        else {
            continue;
        };
        let Some(&storm_id) = storm_id_map.get(&user_id) else {
            continue;
        };
        joined.push(JoinedPlayer {
            name,
            storm_id: StormPlayerId(storm_id),
            player_id: Some(player_id),
            sb_user_id: user_id,
        });
    }
    joined
}

unsafe fn join_lobby(
    info: &GameSetupInfo,
    game_type: BwGameType,
    user_latency: UserLatency,
) -> impl Future<Output = Result<(), GameInitError>> + use<> {
    unsafe {
        let MapInfo::Game(ref game_map) = info.map else {
            panic!("join_lobby called for a replay");
        };
        let map_data = &game_map.map_data;
        let map_name = &game_map.name;
        let is_eud = map_data.is_eud;

        // This info isn't used ingame (with exception of game_type?),
        // but it is written in the header of replays/saves.
        let game_info = build_bw_game_data(info, game_type, map_data, map_name);
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
                    Err(e) => debug!("Storm join error: {e:08x}"),
                }
            }
            let bw = get_bw();
            bw.init_game_network();

            debug!("Setting initial user latency: {user_latency:?}");
            bw.set_user_latency(user_latency);

            bw.maybe_receive_turns();
            let storm_flags = bw.storm_player_flags();
            for (i, &flags) in storm_flags.iter().enumerate() {
                if flags != 0 {
                    bw.init_network_player_info(i as u32);
                }
            }
            Ok(())
        }
        .boxed()
    }
}

async unsafe fn try_join_lobby_once(
    mut game_info: bw::BwGameData,
    is_eud: bool,
    options: LobbyOptions,
    map_path: &Arc<CString>,
) -> Result<(), u32> {
    unsafe {
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
}

unsafe fn setup_slots(
    slots: &[PlayerInfo],
    users: &[SbUser],
    game_type: BwGameType,
    ums_forces: &[MapForce],
    // The real storm id per user (storm id ≡ rp2 slot, from the roster), used to lay out slots
    // directly. `None` for a replay, which has no roster and plants the placeholder `27` (a replay
    // reads its participants from the recorded stream, not from these slot storm ids).
    v2_storm_ids: Option<&HashMap<SbUserId, u8>>,
) {
    let id_to_name = users
        .iter()
        .map(|u| (u.id, u.name.as_str()))
        .collect::<HashMap<_, _>>();

    unsafe {
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
                    // Netcode v2: write the real storm id from the roster (storm id ≡ rp2 slot) so
                    // `update_nation_and_human_ids` builds the id maps with no Storm-read
                    // reconciliation. Observer storm ids are rp2 slots as well (< 16, which the
                    // id-map builder requires); the lookup covers players and observers alike. A
                    // miss falls through to `u32::MAX`, which that builder asserts against — the
                    // same loud failure a missing player would get.
                    true => match v2_storm_ids {
                        Some(map) => slot
                            .user_id
                            .and_then(|uid| map.get(&uid).copied())
                            .map_or(u32::MAX, |storm| storm as u32),
                        // Native path: placeholder overwritten by Storm-join reconciliation.
                        None => 27,
                    },
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
            bw.set_player_name(
                slot_id as u8,
                id_to_name
                    .get(&slot.user_id.unwrap_or(SbUserId(0)))
                    .copied()
                    .unwrap_or("Unknown Player"),
            );
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
                        "Computer team {i} has both random and non-random slots, which is not allowed"
                    );
                }
            }
        }
    }
}

/// Builds the joined-player list for a replay from the SB user ids recorded in its Sbat section,
/// so the chat manager can hide blocked players' chat. Unlike a live game, a replay never populates
/// `joined_players` through the lobby join flow — but the replay records each player's SB user id
/// keyed by BW player id, which is exactly the id the chat manager matches incoming chat against.
///
/// Note we deliberately don't use the storm player list here: in a replay the only storm player is
/// the local viewer, not the recorded players. `user_ids` is indexed by BW player id (and covers
/// only the 8 playing slots), so we map it straight across — observers and empty slots (which have
/// a 0 user id) are skipped and won't have their chat hidden.
///
/// Returns an empty list for replays without the Sbat section (e.g. non-ShieldBattery replays), in
/// which case no chat is hidden.
fn build_replay_joined_players() -> Vec<JoinedPlayer> {
    let Some(replay_data) = game_thread::sbat_replay_data() else {
        return Vec::new();
    };
    let players = unsafe { get_bw().players() };
    let joined_players = replay_data
        .user_ids
        .iter()
        .enumerate()
        .filter_map(|(player_id, &sb_user_id)| {
            if sb_user_id.0 == 0 {
                return None;
            }
            // The BW player array is indexed by BW player id too, so it lines up with user_ids.
            let name = unsafe {
                CStr::from_ptr((*players.add(player_id)).name.as_ptr() as *const i8)
                    .to_str()
                    .unwrap_or("")
                    .to_string()
            };
            Some(JoinedPlayer {
                name,
                storm_id: StormPlayerId(player_id as u8),
                player_id: Some(BwPlayerId(player_id as u8)),
                sb_user_id,
            })
        })
        .collect::<Vec<_>>();
    debug!("Built replay joined players: {joined_players:?}");
    joined_players
}

async unsafe fn do_countdown() {
    const COUNTDOWN_BEEP: &str = "GLUSND_CHAT_COUNTDOWN";

    let bw = get_bw();

    let turn_seq = bw.snet_next_turn_sequence_number();
    debug!("Pre-countdown turn seq {turn_seq}");

    let load_start = Instant::now();

    // Wait a small amount of time for things to settle so the countdown beeps don't have laggy
    // playback speed due to rendering changes
    while load_start.elapsed() < Duration::from_secs(2) {
        tokio::time::sleep(Duration::from_millis(
            game_thread::until_next_lobby_init_step(),
        ))
        .await;
        game_thread::step_lobby_init();
    }

    // TODO(tec27): Sync countdown across clients
    let turn_seq = bw.snet_next_turn_sequence_number();
    debug!("Starting countdown at turn seq {turn_seq}");

    let mut beeps = 0;
    let mut countdown_interval = tokio::time::interval(Duration::from_secs(1));
    let mut last_lobby_state = bw.lobby_state();

    loop {
        let lobby_state = bw.lobby_state();
        if lobby_state != last_lobby_state {
            debug!("lobby_state changed {last_lobby_state} -> {lobby_state} during countdown");
            last_lobby_state = lobby_state;
        }
        select! {
            _ = countdown_interval.tick() => {
                if beeps == 0 {
                    let countdown_start = Instant::now();
                    bw.set_countdown_start(countdown_start);
                }

                bw.play_sound(COUNTDOWN_BEEP);
                beeps += 1;

                if beeps == 6 {
                    let turn_seq = bw.snet_next_turn_sequence_number();
                    debug!("Countdown complete at turn seq {turn_seq}");
                    break;
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(game_thread::until_next_lobby_init_step())) => {
                game_thread::step_lobby_init();
            }
        }
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
    let mut game_state = GameState {
        init_state: InitState::WaitingForInput(IncompleteInit {
            local_user: None,
            blocked_users: Vec::new(),
            server_config: None,
            settings_set: false,
        }),
        ws_send,
        internal_send,
        init_main_thread,
        send_main_thread_requests,
        running_game: None,
        async_stop,
        netcode_v2_setup: None,
    };
    loop {
        let message = select! {
            x = messages.recv() => x,
            x = internal_recv.recv() => x,
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
) -> impl Future<Output = ()> + use<> {
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

/// Builds the raw per-player evidence rows for the server report. A player row is a human when its
/// BW id belongs to a joined player, otherwise it is a computer (no user id / storm id).
fn build_raw_players(
    game_thread_results: &GameThreadResults,
    joined_players: &[JoinedPlayer],
) -> Vec<RawPlayerResult> {
    let humans_by_bw = joined_players
        .iter()
        .filter_map(|p| p.player_id.map(|bw| (bw, p)))
        .collect::<HashMap<_, _>>();

    let mut rows = game_thread_results
        .player_results
        .iter()
        .map(|(&bw_id, result)| {
            let human = humans_by_bw.get(&bw_id);
            RawPlayerResult {
                user_id: human.map(|p| p.sb_user_id),
                bw_player_id: bw_id.0,
                storm_id: human.map(|p| p.storm_id.0),
                race: result.race,
                victory_state: result.victory_state,
                alliances: result.alliances,
            }
        })
        .collect::<Vec<_>>();
    rows.sort_by_key(|r| r.bw_player_id);
    rows
}

/// Builds the raw network status rows for the server report, one per storm id, sorted by storm id.
fn build_raw_net_players(game_thread_results: &GameThreadResults) -> Vec<RawNetPlayer> {
    let mut rows = game_thread_results
        .network_results
        .iter()
        .map(|(&storm_id, status)| RawNetPlayer {
            storm_id: storm_id.0,
            was_dropped: status.was_dropped,
            has_quit: status.has_quit,
        })
        .collect::<Vec<_>>();
    rows.sort_by_key(|r| r.storm_id);
    rows
}

fn determine_game_results(
    mut game_thread_results: GameThreadResults,
    joined_players: &[JoinedPlayer],
    local_user: &SbUser,
) -> HashMap<SbUserId, GamePlayerResult> {
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
    if let Some(r) = results.get_mut(&local_user.id)
        && r.result == VictoryState::Playing
    {
        r.result = VictoryState::Defeat;
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
            .filter(|&(&id, _)| !bw_to_sb.contains_key(&id))
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
            for (sb_id, ally_result) in results.iter_mut().filter(|&(&sb, ref r)| {
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

    /// A 1v1 melee `GameSetupInfo` fixture (host = user 10 at slot 0, opponent = user 20 at slot 1),
    /// deserialized from JSON since `PlayerInfo`/`LobbyPlayerId` aren't constructible field-by-field
    /// outside their module.
    fn v2_setup_info() -> GameSetupInfo {
        serde_json::from_value(serde_json::json!({
            "name": "test game",
            "map": {
                "id": "map-id",
                "hash": "hash",
                "name": "Fighting Spirit",
                "description": "",
                "mapData": {
                    "height": 128,
                    "width": 112,
                    "umsSlots": 2,
                    "slots": 2,
                    "tileset": 3,
                    "umsForces": [],
                    "isEud": false
                },
                "imageVersion": 0
            },
            "mapPath": "z:\\maps\\fs.scm",
            "gameType": "melee",
            "slots": [
                { "id": "s0", "type": "human", "typeId": 6, "teamId": 0, "userId": 10, "race": "z", "playerId": 0 },
                { "id": "s1", "type": "human", "typeId": 6, "teamId": 0, "userId": 20, "race": "p", "playerId": 1 }
            ],
            "host": { "id": "s0", "type": "human", "typeId": 6, "teamId": 0, "userId": 10, "race": "z", "playerId": 0 },
            "users": [
                { "id": 10, "name": "hostname" },
                { "id": 20, "name": "oppname" }
            ],
            "seed": 305419896,
            "gameId": "game-id"
        }))
        .expect("valid GameSetupInfo fixture")
    }

    #[test]
    fn build_bw_game_data_fills_map_and_counts() {
        let info = v2_setup_info();
        let MapInfo::Game(ref game_map) = info.map else {
            panic!("fixture is a map game");
        };
        let data = build_bw_game_data(
            &info,
            BwGameType::melee(),
            &game_map.map_data,
            &game_map.name,
        );
        // Packed struct: copy each field to a local before asserting (can't take a reference to a
        // packed field).
        assert_eq!({ data.map_width }, 112);
        assert_eq!({ data.map_height }, 128);
        assert_eq!({ data.tileset }, 3);
        assert_eq!({ data.active_player_count }, 2);
        assert_eq!({ data.max_player_count }, 2);
        assert_eq!({ data.game_speed }, 6);
        assert_eq!({ data.game_type }, BwGameType::melee().primary as u16);
        assert_eq!({ data.game_subtype }, BwGameType::melee().subtype as u16);
        assert_eq!({ data.is_replay }, 0);
        assert_eq!({ data.index }, 1);
        let creator = data.game_creator;
        assert!(creator.starts_with(b"hostname"));
        let name = data.name;
        assert!(name.starts_with(b"test game"));
        let map_name = data.map_name;
        assert!(map_name.starts_with(b"Fighting Spirit"));
    }

    #[test]
    fn build_v2_joined_players_maps_roster_to_storm_and_game_slots() {
        let info = v2_setup_info();
        // storm id ≡ rp2 slot: user 10 → slot 0 (host), user 20 → slot 1.
        let storm_ids = HashMap::from([(SbUserId(10), 0u8), (SbUserId(20), 1u8)]);
        let mut joined = build_v2_joined_players(&info, &storm_ids);
        joined.sort_by_key(|p| p.storm_id.0);

        assert_eq!(joined.len(), 2);
        assert_eq!(joined[0].name, "hostname");
        assert_eq!(joined[0].storm_id, StormPlayerId(0));
        assert_eq!(joined[0].player_id, Some(BwPlayerId(0)));
        assert_eq!(joined[0].sb_user_id, SbUserId(10));
        assert_eq!(joined[1].name, "oppname");
        assert_eq!(joined[1].storm_id, StormPlayerId(1));
        assert_eq!(joined[1].player_id, Some(BwPlayerId(1)));
        assert_eq!(joined[1].sb_user_id, SbUserId(20));
    }

    #[test]
    fn build_v2_joined_players_places_observers_at_observer_slots() {
        let info: GameSetupInfo = serde_json::from_value(serde_json::json!({
            "name": "obs game",
            "map": {
                "id": "map-id",
                "hash": "hash",
                "name": "Fighting Spirit",
                "description": "",
                "mapData": {
                    "height": 128,
                    "width": 112,
                    "umsSlots": 2,
                    "slots": 2,
                    "tileset": 3,
                    "umsForces": [],
                    "isEud": false
                },
                "imageVersion": 0
            },
            "mapPath": "z:\\maps\\fs.scm",
            "gameType": "melee",
            "slots": [
                { "id": "s0", "type": "human", "typeId": 6, "teamId": 0, "userId": 10, "race": "z", "playerId": 0 },
                { "id": "s1", "type": "human", "typeId": 6, "teamId": 0, "userId": 20, "race": "p", "playerId": 1 },
                { "id": "s2", "type": "observer", "typeId": 6, "teamId": 0, "userId": 30, "race": "r", "playerId": 2 }
            ],
            "host": { "id": "s0", "type": "human", "typeId": 6, "teamId": 0, "userId": 10, "race": "z", "playerId": 0 },
            "users": [
                { "id": 10, "name": "hostname" },
                { "id": 20, "name": "oppname" },
                { "id": 30, "name": "obsname" }
            ],
            "seed": 305419896,
            "gameId": "game-id"
        }))
        .expect("valid GameSetupInfo fixture");
        // storm id ≡ rp2 slot: the observer sits at rp2 slot 8, above the two players.
        let storm_ids = HashMap::from([
            (SbUserId(10), 0u8),
            (SbUserId(20), 1u8),
            (SbUserId(30), 8u8),
        ]);
        let mut joined = build_v2_joined_players(&info, &storm_ids);
        joined.sort_by_key(|p| p.storm_id.0);

        assert_eq!(joined.len(), 3);
        assert_eq!(joined[0].player_id, Some(BwPlayerId(0)));
        assert_eq!(joined[1].player_id, Some(BwPlayerId(1)));
        // First (and only) observer occupies players[12]; its id reports as an observer.
        assert_eq!(joined[2].name, "obsname");
        assert_eq!(joined[2].storm_id, StormPlayerId(8));
        assert_eq!(joined[2].player_id, Some(BwPlayerId(12)));
        assert!(joined[2].player_id.unwrap().is_observer());
    }

    #[test]
    fn build_v2_joined_players_places_ums_players_by_map_slot_id() {
        let info: GameSetupInfo = serde_json::from_value(serde_json::json!({
            "name": "ums game",
            "map": {
                "id": "map-id",
                "hash": "hash",
                "name": "Some Scenario",
                "description": "",
                "mapData": {
                    "height": 128,
                    "width": 112,
                    "umsSlots": 8,
                    "slots": 8,
                    "tileset": 3,
                    "umsForces": [],
                    "isEud": false
                },
                "imageVersion": 0
            },
            "mapPath": "z:\\maps\\scenario.scx",
            "gameType": "ums",
            "slots": [
                { "id": "s0", "type": "human", "typeId": 6, "teamId": 1, "userId": 10, "race": "z", "playerId": 0 },
                { "id": "s1", "type": "human", "typeId": 6, "teamId": 1, "userId": 20, "race": "p", "playerId": 1 },
                { "id": "s2", "type": "human", "typeId": 6, "teamId": 2, "userId": 30, "race": "t", "playerId": 4 }
            ],
            "host": { "id": "s0", "type": "human", "typeId": 6, "teamId": 1, "userId": 10, "race": "z", "playerId": 0 },
            "users": [
                { "id": 10, "name": "hostname" },
                { "id": 20, "name": "oppname" },
                { "id": 30, "name": "thirdname" }
            ],
            "seed": 305419896,
            "gameId": "game-id"
        }))
        .expect("valid GameSetupInfo fixture");
        let storm_ids = HashMap::from([
            (SbUserId(10), 0u8),
            (SbUserId(20), 1u8),
            (SbUserId(30), 2u8),
        ]);
        let mut joined = build_v2_joined_players(&info, &storm_ids);
        joined.sort_by_key(|p| p.storm_id.0);

        assert_eq!(joined.len(), 3);
        // UMS placement follows the map's slot id, not the slot-list index: the third human sits
        // at map slot 4 even though it is slots[2].
        assert_eq!(joined[0].player_id, Some(BwPlayerId(0)));
        assert_eq!(joined[1].player_id, Some(BwPlayerId(1)));
        assert_eq!(joined[2].player_id, Some(BwPlayerId(4)));
    }

    #[test]
    fn lobby_game_init_data_has_the_expected_13_byte_layout() {
        // The exact buffer do_lobby_game_init synthesizes: 0x48, u32 seed (LE), then 8 player bytes
        // each = 8 (the empty/no-remapping sentinel for a fresh game). This is what the netcode-v2
        // local-drive injects via process_lobby_commands(ptr, 13, 0).
        let data = bw::LobbyGameInitData {
            game_init_command: 0x48,
            random_seed: 0x1234_5678,
            player_bytes: [8; 8],
        };
        assert_eq!(mem::size_of::<bw::LobbyGameInitData>(), 13);
        let bytes = unsafe {
            std::slice::from_raw_parts(
                &data as *const bw::LobbyGameInitData as *const u8,
                mem::size_of::<bw::LobbyGameInitData>(),
            )
        };
        assert_eq!(
            bytes,
            &[0x48, 0x78, 0x56, 0x34, 0x12, 8, 8, 8, 8, 8, 8, 8, 8]
        );
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
        let local_user = SbUser {
            id: 1.into(),
            name: "local".to_string(),
            avatar_url: None,
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
            sb_user_id: 77.into(),
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: BwGameType::one_v_one(),
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
                replay_path: None,
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
                    77.into(),
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
        let local_user = SbUser {
            id: 1.into(),
            name: "local".to_string(),
            avatar_url: None,
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
            sb_user_id: 77.into(),
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: BwGameType::melee(),
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
                replay_path: None,
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
                    77.into(),
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
        let local_user = SbUser {
            id: 1.into(),
            name: "local".to_string(),
            avatar_url: None,
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
            sb_user_id: 77.into(),
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: BwGameType::melee(),
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
                replay_path: None,
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
                    77.into(),
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
        let local_user = SbUser {
            id: 1.into(),
            name: "local".to_string(),
            avatar_url: None,
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
            sb_user_id: 77.into(),
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: BwGameType::one_v_one(),
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
                replay_path: None,
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
                    77.into(),
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
        let local_user = SbUser {
            id: 1.into(),
            name: "local".to_string(),
            avatar_url: None,
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
            sb_user_id: 77.into(),
        };
        let opponent1 = JoinedPlayer {
            name: "opponent1".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78.into(),
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(3),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79.into(),
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: BwGameType::top_v_bottom(2),
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
                replay_path: None,
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
                    77.into(),
                    GamePlayerResult {
                        result: VictoryState::Victory,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78.into(),
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79.into(),
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
        let local_user = SbUser {
            id: 1.into(),
            name: "local".to_string(),
            avatar_url: None,
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
            sb_user_id: 77.into(),
        };
        let opponent1 = JoinedPlayer {
            name: "opponent1".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78.into(),
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(3),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79.into(),
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: BwGameType::melee(),
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
                replay_path: None,
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
                    77.into(),
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78.into(),
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79.into(),
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
        let local_user = SbUser {
            id: 1.into(),
            name: "local".to_string(),
            avatar_url: None,
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
            sb_user_id: 77.into(),
        };
        let opponent1 = JoinedPlayer {
            name: "opponent1".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78.into(),
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(3),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79.into(),
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: BwGameType::top_v_bottom(2),
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
                replay_path: None,
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
                    77.into(),
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78.into(),
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79.into(),
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
        let local_user = SbUser {
            id: 1.into(),
            name: "local".to_string(),
            avatar_url: None,
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
            sb_user_id: 77.into(),
        };
        let opponent1 = JoinedPlayer {
            name: "opponent1".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78.into(),
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(3),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79.into(),
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: BwGameType::melee(),
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
                replay_path: None,
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
                    77.into(),
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78.into(),
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79.into(),
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
        let local_user = SbUser {
            id: 1.into(),
            name: "local".to_string(),
            avatar_url: None,
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
            sb_user_id: 77.into(),
        };
        let opponent1 = JoinedPlayer {
            name: "opponent1".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78.into(),
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(3),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79.into(),
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: BwGameType::top_v_bottom(2),
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
                replay_path: None,
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
                    77.into(),
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78.into(),
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79.into(),
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
        let local_user = SbUser {
            id: 1.into(),
            name: "local".to_string(),
            avatar_url: None,
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
            sb_user_id: 77.into(),
        };
        let opponent1 = JoinedPlayer {
            name: "opponent1".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78.into(),
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(3),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79.into(),
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: BwGameType::melee(),
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
                replay_path: None,
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
                    77.into(),
                    GamePlayerResult {
                        result: VictoryState::Disconnected,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78.into(),
                    GamePlayerResult {
                        result: VictoryState::Playing,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79.into(),
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
        let local_user = SbUser {
            id: 1.into(),
            name: "local".to_string(),
            avatar_url: None,
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
            sb_user_id: 77.into(),
        };
        let third = JoinedPlayer {
            name: "third".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(2)),
            sb_user_id: 78.into(),
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: BwGameType::ums(),
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
                replay_path: None,
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
                    77.into(),
                    GamePlayerResult {
                        result: VictoryState::Defeat,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    78.into(),
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
        let local_user = SbUser {
            id: 1.into(),
            name: "local".to_string(),
            avatar_url: None,
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
            sb_user_id: 78.into(),
        };
        let opponent2 = JoinedPlayer {
            name: "opponent2".to_string(),
            storm_id: StormPlayerId(2),
            player_id: Some(BwPlayerId(3)),
            sb_user_id: 79.into(),
        };

        // BW ID 1 + 4 are computers, allied with each other and players 2 + 3
        // Local player (0) has their buildings destroyed and thus loses, the remaining computer
        // should bring along 2 + 3 as victors
        let results = determine_game_results(
            GameThreadResults {
                game_type: BwGameType::melee(),
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
                replay_path: None,
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
                    78.into(),
                    GamePlayerResult {
                        result: VictoryState::Victory,
                        race: AssignedRace::Protoss,
                        apm: 0,
                    }
                ),
                (
                    79.into(),
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
        let local_user = SbUser {
            id: 1.into(),
            name: "local".to_string(),
            avatar_url: None,
        };
        let local = JoinedPlayer {
            name: local_user.name.clone(),
            storm_id: StormPlayerId(0),
            player_id: Some(BwPlayerId(0)),
            sb_user_id: local_user.id,
        };

        let results = determine_game_results(
            GameThreadResults {
                game_type: BwGameType::melee(),
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
                replay_path: None,
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

    #[test]
    fn raw_report_serializes_expected_json() {
        let players = vec![
            RawPlayerResult {
                user_id: Some(10.into()),
                bw_player_id: 0,
                storm_id: Some(0),
                race: AssignedRace::Zerg,
                victory_state: VictoryState::Victory,
                alliances: {
                    let mut a = [AllianceState::Unallied; 8];
                    a[1] = AllianceState::AlliedVictory;
                    a
                },
            },
            RawPlayerResult {
                user_id: None,
                bw_player_id: 1,
                storm_id: None,
                race: AssignedRace::Terran,
                victory_state: VictoryState::Defeat,
                alliances: [AllianceState::Unallied; 8],
            },
        ];
        let net_players = vec![RawNetPlayer {
            storm_id: 0,
            was_dropped: false,
            has_quit: true,
        }];
        let report = RawGameResultsReport {
            version: 2,
            user_id: 10.into(),
            result_code: "abc",
            time: 1234,
            players: &players,
            net_players: &net_players,
            local_player_lose_type: Some(PlayerLoseType::TargetedDisconnect),
        };

        let value = serde_json::to_value(&report).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "version": 2,
                "userId": 10,
                "resultCode": "abc",
                "time": 1234,
                "players": [
                    {
                        "userId": 10,
                        "bwPlayerId": 0,
                        "stormId": 0,
                        "race": "z",
                        "victoryState": 3,
                        "alliances": [0, 2, 0, 0, 0, 0, 0, 0],
                    },
                    {
                        "userId": null,
                        "bwPlayerId": 1,
                        "stormId": null,
                        "race": "t",
                        "victoryState": 2,
                        "alliances": [0, 0, 0, 0, 0, 0, 0, 0],
                    },
                ],
                "netPlayers": [
                    { "stormId": 0, "wasDropped": false, "hasQuit": true },
                ],
                "localPlayerLoseType": "targetedDisconnect",
            })
        );
    }

    #[test]
    fn maximal_raw_report_fits_relay_cap() {
        let players = (0..8u8)
            .map(|i| RawPlayerResult {
                user_id: Some(u32::MAX.into()),
                bw_player_id: i,
                storm_id: Some(i),
                race: AssignedRace::Protoss,
                victory_state: VictoryState::Disconnected,
                alliances: [AllianceState::AlliedVictory; 8],
            })
            .collect::<Vec<_>>();
        let net_players = (0..8u8)
            .map(|i| RawNetPlayer {
                storm_id: i,
                was_dropped: true,
                has_quit: true,
            })
            .collect::<Vec<_>>();
        let report = RawGameResultsReport {
            version: 2,
            user_id: u32::MAX.into(),
            result_code: "0123456789abcdef0123456789abcdef",
            time: u64::MAX,
            players: &players,
            net_players: &net_players,
            local_player_lose_type: Some(PlayerLoseType::MassDisconnect),
        };

        let bytes = serde_json::to_vec(&report).unwrap();
        assert!(
            bytes.len() < 4096,
            "maximal raw report was {} bytes, expected comfortably under 4096",
            bytes.len(),
        );
    }
}
