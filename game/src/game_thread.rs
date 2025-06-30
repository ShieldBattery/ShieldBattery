//! Hooks and other code that is running on the game/main thread (As opposed to async threads).

mod pathing;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use bw_dat::dialog::Dialog;
use bw_dat::{Unit, UnitId};
use byteorder::{ByteOrder, LittleEndian};
use fxhash::FxHashSet;
use hashbrown::HashMap;
use lazy_static::lazy_static;
use libc::c_void;
use once_cell::sync::OnceCell;
use tokio::sync::mpsc::UnboundedSender;

use crate::app_messages::{GameSetupInfo, MapInfo, SbUserId, StartingFog};
use crate::bw::players::{
    AllianceState, AssignedRace, BwPlayerId, FinalNetworkStatus, PlayerLoseType, PlayerResult,
    StormPlayerId, VictoryState,
};
use crate::bw::{Bw, GameType, get_bw};
use crate::bw_scr::BwScr;
use crate::forge::TRACK_WINDOW_POS;
use crate::replay;
use crate::snp;
use crate::{bw, forge};

lazy_static! {
    pub static ref SEND_FROM_GAME_THREAD: Mutex<Option<UnboundedSender<GameThreadMessage>>> =
        Mutex::new(None);
    pub static ref GAME_RECEIVE_REQUESTS: Mutex<Option<Receiver<GameThreadRequest>>> =
        Mutex::new(None);
}

/// Global for accessing game type/slots/etc from hooks.
static SETUP_INFO: OnceCell<GameSetupInfo> = OnceCell::new();
/// Global for shieldbattery-specific replay data.
/// Will not be initialized outside replays. (Or if the replay doesn't have that data)
static SBAT_REPLAY_DATA: OnceCell<replay::SbatReplayData> = OnceCell::new();
/// Contains game id, shieldbattery user id pairs after the slots have been randomized,
/// human player slots / obeservers only.
/// Once this is set it is expected to be valid for the entire game.
/// Could also be easily extended to have storm ids if mapping between them is needed.
static PLAYER_ID_MAPPING: OnceCell<Vec<PlayerIdMapping>> = OnceCell::new();

pub struct PlayerIdMapping {
    /// None at least for observers
    pub game_id: Option<BwPlayerId>,
    pub sb_user_id: SbUserId,
}

pub fn set_sbat_replay_data(data: replay::SbatReplayData) {
    if SBAT_REPLAY_DATA.set(data).is_err() {
        warn!("Tried to set shieldbattery replay data twice");
    }
}

pub fn sbat_replay_data() -> Option<&'static replay::SbatReplayData> {
    SBAT_REPLAY_DATA.get()
}

// Async tasks request game thread to do some work
pub struct GameThreadRequest {
    request_type: GameThreadRequestType,
    // These requests probably won't have any reason to return values on success.
    // If a single one does, it can send a GameThreadMessage.
    done: tokio::sync::oneshot::Sender<()>,
}

impl GameThreadRequest {
    pub fn new(
        request_type: GameThreadRequestType,
    ) -> (GameThreadRequest, tokio::sync::oneshot::Receiver<()>) {
        let (done, wait_done) = tokio::sync::oneshot::channel();
        (GameThreadRequest { request_type, done }, wait_done)
    }
}

pub enum GameThreadRequestType {
    Initialize,
    RunWndProc,
    StartGame,
    ExitCleanup,
    SetupInfo(Arc<GameSetupInfo>),
}

// Game thread sends something to async tasks
pub enum GameThreadMessage {
    WindowMove(i32, i32, i32, i32),
    Snp(snp::SnpMessage),
    /// Storm player id (which stays stable) -> game player id mapping.
    /// Once this message is sent, any game player ids used so far should be
    /// considered invalid and updated to match this mapping.
    PlayersRandomized([Option<BwPlayerId>; bw::MAX_STORM_PLAYERS]),
    Results(GameThreadResults),
    NetworkStall(Duration),
    ReplaySaved(PathBuf),
    /// Request async task to write debug info to provided parameter.
    DebugInfoRequest(DebugInfoRequest),
}

pub enum DebugInfoRequest {
    /// (OnceLock is effectively oneshot channel for the result)
    Network(Arc<OnceLock<crate::network_manager::DebugInfo>>),
}

/// Sends a message from game thread to the async system.
pub fn send_game_msg_to_async(message: GameThreadMessage) {
    let send_global = SEND_FROM_GAME_THREAD.lock().unwrap();
    if let Some(ref send) = *send_global {
        let _ = send.send(message);
    } else {
        debug!("Game thread messaging not active");
    }
}

pub fn run_event_loop() -> ! {
    debug!("Main thread reached event loop");
    let mut receive_requests = GAME_RECEIVE_REQUESTS.lock().unwrap();
    let receive_requests = receive_requests
        .take()
        .expect("Channel to receive requests not set?");
    while let Ok(msg) = receive_requests.recv() {
        unsafe {
            handle_game_request(msg.request_type);
        }
        let _ = msg.done.send(());
    }
    // We can't return from here, as it would put us back in middle of BW's initialization code
    crate::wait_async_exit();
}

unsafe fn handle_game_request(request: GameThreadRequestType) {
    unsafe {
        use self::GameThreadRequestType::*;
        match request {
            Initialize => init_bw(),
            RunWndProc => forge::run_wnd_proc(),
            SetupInfo(info) => {
                if SETUP_INFO.set(Arc::unwrap_or_clone(info)).is_err() {
                    warn!("Received second SetupInfo");
                }
            }
            StartGame => {
                let bw = get_bw();
                bw.play_sound("SND_LAST_FRIGATE_PISSED");
                bw.set_game_started();
                forge::game_started();
                bw.run_game_loop();
                debug!("Game loop ended");
                TRACK_WINDOW_POS.store(false, Ordering::Release);
                send_game_results();
                forge::hide_window();
            }
            // Saves registry settings etc.
            ExitCleanup => {
                get_bw().clean_up_for_exit();
            }
        }
    }
}

pub fn set_player_id_mapping(mapping: Vec<PlayerIdMapping>) {
    if PLAYER_ID_MAPPING.set(mapping).is_err() {
        warn!("Player id mapping set twice");
    }
}

pub fn player_id_mapping() -> &'static [PlayerIdMapping] {
    PLAYER_ID_MAPPING.get().map(|x| &**x).unwrap_or_else(|| {
        warn!("Tried to access player id mapping before it was set");
        &[]
    })
}

/// Collects and forwards game results to the async thread if they haven't already been sent. Should
/// only be called from the game thread.
pub fn send_game_results() {
    let bw = get_bw();
    if bw.trigger_game_results_sent() {
        let results = unsafe { game_results() };
        send_game_msg_to_async(GameThreadMessage::Results(results));
    }
}

#[derive(Debug)]
pub struct GameThreadResults {
    pub game_type: GameType,
    pub player_results: HashMap<BwPlayerId, PlayerResult>,
    pub network_results: HashMap<StormPlayerId, FinalNetworkStatus>,
    /// The type of loss the local player received (if any)
    pub local_player_lose_type: Option<PlayerLoseType>,
    /// The length of the game
    pub time: Duration,
}

unsafe fn game_results() -> GameThreadResults {
    unsafe {
        let bw = get_bw();
        let game = bw.game();
        let players = bw.players();

        let mut player_results = HashMap::new();
        for id in player_id_mapping().iter().filter_map(|m| m.game_id) {
            if id.is_observer() {
                // Observers should already be filtered out of the player ID mapping but just to be safe
                continue;
            }

            let victory_state = (*game).victory_state[id.0 as usize]
                .try_into()
                .unwrap_or_else(|e| {
                    warn!("Failed to convert victory state for player {id:?}: {e:?}");
                    VictoryState::Playing
                });
            let race = (*players.add(id.0 as usize))
                .race
                .try_into()
                .unwrap_or_else(|e| {
                    warn!("Failed to convert race for player {id:?}: {e:?}");
                    AssignedRace::Zerg
                });
            let alliances = (&(*game).alliances)[id.0 as usize][0..8]
                .iter()
                .map(|&x| {
                    x.try_into().unwrap_or_else(|e| {
                        warn!("Failed to convert alliance state for player {id:?}: {e:?}",);
                        AllianceState::Unallied
                    })
                })
                .collect::<Vec<_>>()
                .try_into()
                .unwrap();
            player_results.insert(
                id,
                PlayerResult {
                    victory_state,
                    race,
                    alliances,
                },
            );
        }

        let network_results = (0..8)
            .map(|i| {
                (
                    StormPlayerId(i as u8),
                    FinalNetworkStatus {
                        was_dropped: (*game).player_was_dropped[i] != 0,
                        has_quit: bw.storm_player_flags()[i] == 0,
                    },
                )
            })
            .collect::<HashMap<_, _>>();

        GameThreadResults {
            game_type: (*bw.game_data()).game_type(),
            player_results,
            network_results,
            local_player_lose_type: (*game).player_lose_type.try_into().ok(),
            // Assuming fastest speed
            time: Duration::from_millis(((*game).frame_count as u64).saturating_mul(42)),
        }
    }
}

pub static HAS_INIT_BW: AtomicBool = AtomicBool::new(false);

// Does the rest of initialization that is being done in main thread before running forge's
// window proc.
unsafe fn init_bw() {
    unsafe {
        let bw = get_bw();
        // Trigger a redraw here just to ensure things are as up-to-date as possible before a
        // somewhat long blocking operation
        bw.force_redraw_during_init();
        bw.init_sprites();
        (*bw.game()).is_bw = 1;
        HAS_INIT_BW.store(true, Ordering::Release);
        debug!("Process initialized");
    }
}

/// Bw impl is expected to hook the point after init_game_data and call this.
pub unsafe fn after_init_game_data() {
    unsafe {
        // Let async thread know about player randomization.
        // The function that bw_1161/bw_scr refer to as init_game_data mainly initializes global
        // data structures used in a game. Player randomization seems to have been done before that,
        // so if it ever in future ends up being the case that the async thread has a point where it
        // uses wrong game player ids, a more exact point for this hook should be decided.
        //
        // But for now it should be fine, and this should also be late enough in initialization that
        // any possible alternate branches for save/replay/ums randomization should have been executed
        // as well.
        let bw = get_bw();
        let mut mapping = [None; bw::MAX_STORM_PLAYERS];
        let players = bw.players();
        debug!("After randomization:");
        for i in 0..16 {
            let player = *players.add(i);
            debug!(
                "Slot {} has id {}, player_type {}, storm_id {}",
                i, player.id, player.player_type, player.storm_id
            );
            let storm_id = player.storm_id;
            if let Some(out) = mapping.get_mut(storm_id as usize) {
                *out = Some(BwPlayerId(i as u8));
            }
        }

        let game_data = bw.game_data();
        let had_allies_enabled = (*game_data).game_template.allies_enabled != 0;
        bw::set_had_allies_enabled(had_allies_enabled);
        if setup_info()
            .and_then(|s| s.disable_alliance_changes)
            .unwrap_or(false)
        {
            (*game_data).game_template.allies_enabled = 0;
        }

        send_game_msg_to_async(GameThreadMessage::PlayersRandomized(mapping));
        // Create fog-of-war sprites for any neutral buildings
        if !is_ums()
            && matches!(
                bw.starting_fog(),
                StartingFog::Transparent | StartingFog::ShowResources
            )
        {
            for unit in bw.active_units() {
                if unit.player() == 11 && unit.is_landed_building() {
                    bw.create_fow_sprite(unit);
                }
            }
        }
    }
}

/// Returns whether the current game is a Use Map Settings game.
pub fn is_ums() -> bool {
    unsafe { (*get_bw().game_data()).game_type().is_ums() }
}

/// Returns whether the current game is a "Team" game (that is, has shared control among one or more
/// users for each "player" slot, like Team Melee).
pub fn is_team_game() -> bool {
    unsafe { (*get_bw().game_data()).game_type().is_team_game() }
}

pub fn is_replay() -> bool {
    SETUP_INFO.get().map(|x| x.is_replay()).unwrap_or(false)
}

pub fn setup_info() -> Option<&'static GameSetupInfo> {
    SETUP_INFO.get()
}

/// Returns map name (Title, or something else the uploader has renamed it to in SB),
/// without any color chars (Even if the app also filters them out),
/// or characters illegal in filenames on Windows.
pub fn map_name_for_filename() -> String {
    let mut name: String = SETUP_INFO
        .get()
        .and_then(|x| match &x.map {
            MapInfo::Game(map) => Some(map.name.as_str()),
            MapInfo::Replay(_) => None,
        })
        .unwrap_or("(Unknown map name)")
        .into();
    name.retain(|c| match c {
        '/' | '\\' | '"' | '*' | '?' | '<' | '>' | ':' | '|' => false,
        x if x < (0x20 as char) => false,
        _ => true,
    });
    name
}

/// Bw impl is expected to call this after step_game,
/// the function that progresses game objects by a tick/frame/step.
/// In other words, if the game isn't paused/lagging, this gets ran 24 times in second
/// on fastest game speed.
/// This function can be used for hooks that change gameplay state after BW has done (most of)
/// its once-per-gameplay-frame processing but before anything gets rendered. It probably
/// isn't too useful to us unless we end up having a need to change game rules.
pub unsafe fn after_step_game() {
    unsafe {
        let bw = get_bw();
        add_fow_sprites_for_replay_vision_change(bw);
    }
}

pub unsafe fn add_fow_sprites_for_replay_vision_change(bw: &BwScr) {
    unsafe {
        if is_replay() && !is_ums() && bw.starting_fog() != StartingFog::Legacy {
            // One thing BW's step_game does is that it removes any fog sprites that were
            // no longer in fog. Unfortunately now that we show fog sprites for unexplored
            // resources as well, removing those fog sprites ends up being problematic if
            // the user switches vision off from a player who had those resources explored.
            // In such case the unexplored fog sprites would not appear and some of the
            // expansions would show up as empty while other unexplored bases keep their
            // fog sprites as usual.
            // To get around this issue, check which neutral buildings don't have fog
            // sprites and add them back.

            let mut fow_sprites = FxHashSet::with_capacity_and_hasher(256, Default::default());
            for fow in bw.fow_sprites() {
                let sprite = (*fow).sprite;
                let pos = bw.sprite_position(sprite);
                fow_sprites.insert((pos.x, pos.y, UnitId((*fow).unit_id)));
            }
            let replay_visions = bw.replay_visions();
            for unit in bw.active_units() {
                if unit.player() == 11 && unit.is_landed_building() {
                    // This currently adds fow sprites even for buildings that became
                    // neutral after player left. It's probably fine, but if it wasn't
                    // desired, checking that `sprite.player == 11` should only include
                    // buildings that existed from map start
                    if let Some(sprite) = unit.sprite() {
                        let is_visible = replay_visions.show_entire_map
                            || sprite.visibility_mask() & replay_visions.players != 0;
                        if !is_visible {
                            let pos = bw.sprite_position(*sprite as *mut c_void);
                            if fow_sprites.insert((pos.x, pos.y, unit.id())) {
                                bw.create_fow_sprite(unit);
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Reimplementation of replay command reading & processing since the default implementation
/// has buffer overflows for replays where there are too many commands in a frame.
///
/// A function pointer for the original function is still needed to handle replay ending
/// case which we don't need to touch.
pub unsafe fn step_replay_commands(orig: unsafe extern "C" fn()) {
    unsafe {
        let bw = get_bw();
        let game = bw.game();
        let replay = bw.replay_data();
        let command_lengths = bw.game_command_lengths();
        let frame = (*game).frame_count;
        let data_end = (*replay).data_start.add((*replay).data_length as usize);
        let remaining_length = (data_end as usize).saturating_sub((*replay).data_pos as usize);
        // Data is in format
        // u32 frame, u8 length, { u8 storm_player, u8 cmd[] }[length]
        // Repeated for each frame in replay, if the commands don't fit in a single frame
        // then there can be repeated blocks with equal frame number.
        let mut data = std::slice::from_raw_parts((*replay).data_pos, remaining_length);
        if data.is_empty() {
            // Let the original function handle replay ending
            orig();
            return;
        }

        loop {
            let (mut frame_data, rest) = match replay_next_frame(data) {
                Some(s) => s,
                None => {
                    warn!("Broken replay? Unable to read next frame");
                    (*replay).data_pos = data_end;
                    return;
                }
            };
            if frame_data.frame > frame {
                break;
            }
            data = rest;
            while let Some((storm_player, command)) = frame_data.next_command(command_lengths) {
                bw.process_replay_commands(command, storm_player);
            }
        }
        let new_pos = (data_end as usize - data.len()) as *mut u8;
        (*replay).data_pos = new_pos;
    }
}

struct ReplayFrame<'a> {
    frame: u32,
    // (u8 storm_player, u8 command[...]) pairs repeated.
    // (Command length must be known from the data)
    commands: &'a [u8],
}

fn replay_next_frame(input: &[u8]) -> Option<(ReplayFrame, &[u8])> {
    let &commands_len = input.get(4)?;
    let frame = LittleEndian::read_u32(input.get(..4)?);
    let rest = input.get(5..)?;
    let commands = rest.get(..commands_len as usize)?;
    let rest = rest.get(commands_len as usize..)?;
    Some((ReplayFrame { frame, commands }, rest))
}

impl<'a> ReplayFrame<'a> {
    pub fn next_command(&mut self, command_lengths: &[u32]) -> Option<(StormPlayerId, &'a [u8])> {
        let player = StormPlayerId(*self.commands.first()?);
        let data = self.commands.get(1..)?;
        let length = bw::commands::command_length(data, command_lengths)?;
        let command = data.get(..length)?;
        let rest = data.get(length..)?;
        self.commands = rest;
        Some((player, command))
    }
}

/// Bw impl is expected to hook the point before init_unit_data and call this.
/// (It happens to be easy function for SC:R analysis to find and in a nice
/// spot to inject game init hooks for things that require initialization to
/// have progressed a bit but not too much)
pub unsafe fn before_init_unit_data(bw: &BwScr) {
    unsafe {
        let game = bw.game();
        if let Some(ext) = sbat_replay_data() {
            // This makes team game replays work.
            // This hook is unfortunately after the game has calculated
            // max supply for team games (It can be over 200), so we'll have to fix
            // those as well.
            //
            // (I don't think we have a better way to check for team game replay right now
            // other than just assuming that non-team games have main players as [0, 0, 0, 0])
            if ext.team_game_main_players != [0, 0, 0, 0] {
                (*game).team_game_main_player = ext.team_game_main_players;
                (*game).starting_races = ext.starting_races;
                let team_count = ext
                    .team_game_main_players
                    .iter()
                    .take_while(|&&x| x != 0xff)
                    .count();
                let players_per_team = match team_count {
                    2 => 4,
                    3 => 3,
                    4 => 2,
                    _ => 0,
                };

                // Non-main players get 0 max supply.
                // Clear what bw had already initialized.
                // (Other players having unused max supply likely won't matter but you never know)
                for race_supplies in (*game).supplies.iter_mut() {
                    for max in race_supplies.max.iter_mut() {
                        *max = 0;
                    }
                }

                let mut pos = 0;
                for i in 0..team_count {
                    let main_player = ext.team_game_main_players[i] as usize;
                    let first_pos = pos;
                    let mut race_counts = [0; 3];
                    for _ in 0..players_per_team {
                        // The third team of 3-team game has only two slots, they
                        // get their first slot counted twice
                        let index = match pos < 8 {
                            true => pos,
                            false => first_pos,
                        };
                        let race = ext.starting_races[index];
                        race_counts[race as usize] += 1;
                        pos += 1;
                    }
                    for (race, &count) in race_counts.iter().enumerate() {
                        let count = count.max(1);
                        // This value is twice the displayed, so 200 max supply for each
                        // player in team. (Or 200 if none)
                        (*game).supplies[race].max[main_player] = count * 400;
                    }
                }
            }
        }
    }
}

pub unsafe fn after_status_screen_update(bw: &BwScr, status_screen: Dialog, unit: Unit) {
    unsafe {
        // Show "Stacked (n)" text for stacked buildings
        if unit.is_landed_building() {
            fn normalize_id(id: UnitId) -> UnitId {
                use bw_dat::unit;
                // For mineral fields, consider any mineral field unit as equivalent.
                // May be useful in some fastest maps.
                match id {
                    unit::MINERAL_FIELD_2 | unit::MINERAL_FIELD_3 => unit::MINERAL_FIELD_1,
                    x => x,
                }
            }

            // Find units that have same unit id and collide with this unit's center
            // (So they don't necessarily have to be perfectly stacked)
            let mut count = 0;
            let pos = unit.position();
            let id = normalize_id(unit.id());
            // Doing a loop like this through every active unit is definitely worse
            // than using some position searching structure, but building that structure
            // would still require looping through the units once.
            // If we have such structure in future for some other code it should be used
            // here too though.
            for other in bw.active_units() {
                if normalize_id(other.id()) == id && other.collision_rect().contains_point(&pos) {
                    count += 1;
                }
            }
            if count > 1 {
                // Show the text at where unit rank/status is usually, as long as it hasn't
                // been used.
                if let Some(rank_status) = status_screen.child_by_id(-20) {
                    let existing_text = rank_status.string();
                    if rank_status.is_hidden()
                        || existing_text.starts_with("Stacked")
                        || existing_text.is_empty()
                    {
                        use std::io::Write;

                        let mut buffer = [0; 32];
                        let buf_len = buffer.len();
                        let mut out = &mut buffer[..];
                        // TODO: Could use translations in other SC:R languages :)
                        let _ = write!(&mut out, "Stacked ({count})");
                        let len = buf_len - out.len();
                        rank_status.set_string(&buffer[..len]);
                        rank_status.show();
                    }
                }
            }
        }
    }
}

pub fn sb_game_logic_version() -> u16 {
    if is_replay() {
        sbat_replay_data()
            .map(|x| x.game_logic_version)
            .unwrap_or(0)
    } else {
        replay::GAME_LOGIC_VERSION
    }
}

pub unsafe fn order_harvest_gas(
    bw: &BwScr,
    unit: *mut bw::Unit,
    orig: unsafe extern "C" fn(*mut bw::Unit),
) {
    // Fix a rare issue where the worker won't not be able to exit a gas building
    // if it managed to enter it while on unwalkable terrain.
    //
    // This should be very rare as BW doesn't usually let ground units to move on unwalkable
    // terrain.
    if sb_game_logic_version() >= 3 {
        if let Some(unit) = Unit::from_ptr(unit) {
            // Check if unit is about to try exiting gas building on this step.
            if unit.order_state() == 5 && (**unit).order_timer == 0 {
                let game = bw_dat::Game::from_ptr(bw.game());
                let pathing = bw.pathing();
                let pos = unit.position();
                if pathing::is_at_unwalkable_region(pathing, &pos) {
                    debug!(
                        "Fixing gas worker position at {}, {}, during step {}",
                        pos.x,
                        pos.y,
                        game.frame_count(),
                    );
                    if let Some(new_pos) =
                        find_walkable_position_for_gas_worker(game, pathing, unit)
                    {
                        debug!("Moved gas worker to {}, {}", new_pos.x, new_pos.y);
                        bw.move_unit(unit, &new_pos);
                    }
                }
            }
        }
    }
    orig(unit)
}

fn find_walkable_position_for_gas_worker(
    game: bw_dat::Game,
    pathing: *mut bw::Pathing,
    unit: Unit,
) -> Option<bw::Point> {
    // Note: Using gas position as a starting point.
    // Moving the worker on top of gas building is fine, BW's unit placement algorithm
    // will find an empty spot from there as long as the starting position is walkable.
    let pos = unit.target()?.position();

    // BW tile walkability is in 8x8 pixel tile precision. Gas buildings are 128x64 pixels large,
    // and their position should be in middle at (64, 32), so searching [-72, +72] x range,
    // [-40, 40] y range should cover every possible tile at gas, and one tile around
    // them, in case the gas is entirely at unwalkable terrain.
    //
    // (This offset list was sorted to place x = 72 and y = 40 offsets last, and after than that
    // sorted by distance from (0, 0).
    #[rustfmt::skip]
    static SEARCH_OFFSETS: &[(i16, i16)] = &[
        (0, 0), (-8, 0), (0, -8), (0, 8), (8, 0), (-8, -8), (-8, 8), (8, -8), (8, 8), (-16, 0),
        (0, -16), (0, 16), (16, 0), (-16, -8), (-16, 8), (-8, -16), (-8, 16), (8, -16), (8, 16),
        (16, -8), (16, 8), (-16, -16), (-16, 16), (16, -16), (16, 16), (-24, 0), (0, -24), (0, 24),
        (24, 0), (-24, -8), (-24, 8), (-8, -24), (-8, 24), (8, -24), (8, 24), (24, -8), (24, 8),
        (-24, -16), (-24, 16), (-16, -24), (-16, 24), (16, -24), (16, 24), (24, -16), (24, 16),
        (-32, 0), (0, -32), (0, 32), (32, 0), (-32, -8), (-32, 8), (-8, -32), (-8, 32), (8, -32),
        (8, 32), (32, -8), (32, 8), (-24, -24), (-24, 24), (24, -24), (24, 24), (-32, -16),
        (-32, 16), (-16, -32), (-16, 32), (16, -32), (16, 32), (32, -16), (32, 16), (-40, 0),
        (-32, -24), (-32, 24), (-24, -32), (-24, 32), (24, -32), (24, 32), (32, -24), (32, 24),
        (40, 0), (-40, -8), (-40, 8), (40, -8), (40, 8), (-40, -16), (-40, 16), (40, -16),
        (40, 16), (-32, -32), (-32, 32), (32, -32), (32, 32), (-40, -24), (-40, 24), (40, -24),
        (40, 24), (-48, 0), (48, 0), (-48, -8), (-48, 8), (48, -8), (48, 8), (-48, -16), (-48, 16),
        (48, -16), (48, 16), (-40, -32), (-40, 32), (40, -32), (40, 32), (-48, -24), (-48, 24),
        (48, -24), (48, 24), (-56, 0), (56, 0), (-56, -8), (-56, 8), (56, -8), (56, 8), (-48, -32),
        (-48, 32), (48, -32), (48, 32), (-56, -16), (-56, 16), (56, -16), (56, 16), (-56, -24),
        (-56, 24), (56, -24), (56, 24), (-64, 0), (64, 0), (-64, -8), (-64, 8), (-56, -32),
        (-56, 32), (56, -32), (56, 32), (64, -8), (64, 8), (-64, -16), (-64, 16), (64, -16),
        (64, 16), (-64, -24), (-64, 24), (64, -24), (64, 24), (-64, -32), (-64, 32), (64, -32),
        (64, 32),

        (0, -40), (0, 40), (-8, -40), (-8, 40), (8, -40), (8, 40), (-16, -40), (-16, 40),
        (16, -40), (16, 40), (-24, -40), (-24, 40), (24, -40), (24, 40), (-32, -40), (-32, 40),
        (32, -40), (32, 40), (-40, -40), (-40, 40), (40, -40), (40, 40), (-48, -40), (-48, 40),
        (48, -40), (48, 40), (-56, -40), (-56, 40), (56, -40), (56, 40), (-72, 0), (72, 0),
        (-72, -8), (-72, 8), (72, -8), (72, 8), (-72, -16), (-72, 16), (72, -16), (72, 16),
        (-64, -40), (-64, 40), (64, -40), (64, 40), (-72, -24), (-72, 24), (72, -24), (72, 24),
        (-72, -32), (-72, 32), (72, -32), (72, 32), (-72, -40), (-72, 40), (72, -40), (72, 40)
    ];
    SEARCH_OFFSETS.iter().find_map(|offset| {
        let pos = bw::Point {
            x: pos.x.checked_add(offset.0)?,
            y: pos.y.checked_add(offset.1)?,
        };
        if pathing::is_outside_map_coords(game, &pos) {
            return None;
        }
        if pathing::is_at_unwalkable_region(pathing, &pos) {
            return None;
        }
        Some(pos)
    })
}
