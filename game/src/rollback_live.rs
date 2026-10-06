//! Drives the rollback engine ([`crate::rollback`]) inside live netcode v2 games.
//!
//! The turn state keeps every slot's turns by step in an [`InputTable`] and runs a step whose
//! remote turns have not all arrived with a no-op standing in for each missing one, up to a limit
//! of steps past the newest step whose turns are all known. Every tick asks the turn state which
//! step, if any, ran on a prediction that an arrived turn has since contradicted (or ran without a
//! leave that has since become due), restores the newest snapshot from before it, and simulates
//! forward to the present again. Steps that are simulated again take their turns from the same
//! table and send nothing.
//!
//! A game rolls back when its netcode v2 session does, which the server decides for every client
//! in the session alike ([`arm_for_session`]). Such a game sends no native sync commands; it reports
//! hashes of confirmed positions for the relay to compare instead ([`hash_reports`]).
//!
//! Debug builds read knobs from the environment once at startup, which tune a game that rolls
//! back; release builds run the defaults:
//!
//! - `SB_ROLLBACK_PREDICT=<limit>` runs up to `limit` steps ahead of the known turns (8 unless
//!   set). 0 predicts nothing and waits for every turn, like lockstep.
//! - `SB_ROLLBACK_TARGET=<frames>` is the rollback this client takes on in place of input delay
//!   (2 unless set, and never more than the limit): it keeps fewer of its own turns in flight,
//!   stepping each frame earlier against the times its turns are sent, until it runs about that
//!   many frames past the newest turns it knows. See
//!   [`TurnState::lead`](netcode_v2::TurnState::lead), and [`crate::rollback::pacing`] for when
//!   its turns are sent.
//! - `SB_ROLLBACK_MIN_BUFFER=<turns>` acts as if the relay asked for a latency buffer of at least
//!   that many turns, which a relay only does for slower links than a test machine's.
//! - `SB_ROLLBACK_SHADOW=<depth>` additionally rolls back at least `depth` steps every tick,
//!   whether anything was mispredicted or not, to exercise re-simulation constantly.
//! - `SB_ROLLBACK_LIVE_DELAY=<storm id>:<frames>,...` holds back the turns of the given slots for
//!   that many frames' worth of time after they arrive, as if their link were that much slower.
//! - `SB_ROLLBACK_SEND_DELAY=<frames>[@<frame>]` holds back every turn this client sends for that
//!   many frames' worth of time before it leaves, as if its uplink were that much slower, from the
//!   given game frame on (240, ten seconds in, unless set). Starting late keeps the delay out of the
//!   session clock's anchor, which is taken when the slowest player's lockstep start arrives.
//! - `SB_ROLLBACK_MONKEY=<actions per minute>` selects random units of the local player and
//!   right-clicks random map positions with them, so a game can be tested without anyone playing.
//! - `SB_ROLLBACK_WITHHOLD_HASHES_FROM=<position>` sends no state hash reports from that position
//!   on while playing on, as a client hiding its state would, for the relay to name.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use overlay_ui::net_quality::RecentRollback;
use parking_lot::Mutex;
use serde::Serialize;

use crate::bw::{self, Bw};
use crate::bw_scr::BwScr;
use crate::game_thread;
use crate::netcode_v2::{self, InputCounts, InputTable};
use crate::rollback::pacing::{Pacing, PacingCounts};
use crate::rollback::snapshot::{SNAPSHOTS, Snapshots};
use crate::rollback::tick::{self, TickPlan};
use crate::rollback::{game_end, hash_reports, sounds};
use rally_point_client::proto::messages::{LeadReport, RollbackStats};

#[cfg(debug_assertions)]
const PREDICT_ENV_VAR: &str = "SB_ROLLBACK_PREDICT";
#[cfg(debug_assertions)]
const SHADOW_ENV_VAR: &str = "SB_ROLLBACK_SHADOW";
#[cfg(debug_assertions)]
const DELAY_ENV_VAR: &str = "SB_ROLLBACK_LIVE_DELAY";
#[cfg(debug_assertions)]
const SEND_DELAY_ENV_VAR: &str = "SB_ROLLBACK_SEND_DELAY";
#[cfg(debug_assertions)]
const MONKEY_ENV_VAR: &str = "SB_ROLLBACK_MONKEY";
#[cfg(debug_assertions)]
const WITHHOLD_HASHES_ENV_VAR: &str = "SB_ROLLBACK_WITHHOLD_HASHES_FROM";
#[cfg(debug_assertions)]
const TARGET_ENV_VAR: &str = "SB_ROLLBACK_TARGET";
#[cfg(debug_assertions)]
const MIN_BUFFER_ENV_VAR: &str = "SB_ROLLBACK_MIN_BUFFER";

/// The prediction limit unless a debug knob sets one.
const DEFAULT_PREDICTION_LIMIT: u32 = 8;

/// The rollback target unless a debug knob sets one. Corrections are hard to see at up to three
/// frames of rollback and visible from four, so a client aims at two, which leaves it a frame of
/// insurance against small delays before they show.
const DEFAULT_ROLLBACK_TARGET: u32 = 2;

/// How many steps at the start of a game run in lockstep, lining the clients' simulations up
/// before each keeps its own schedule: one second. The relays anchor the session clock where it
/// ends, so it is shared with them.
const LOCKSTEP_START_STEPS: u32 = rally_point_client::proto::rollback::LOCKSTEP_START_STEPS as u32;

/// The most frames a tick steps beyond the one it would anyway, when the simulation has fallen
/// behind its schedule.
const MAX_CATCH_UP_PER_TICK: u32 = 2;

/// The game loop's interval between logic steps at the Fastest game speed, which is also the
/// session clock's step.
const FRAME_DURATION: Duration = crate::rollback::pacing::STEP;

/// How many ticks go between the summaries logged.
const SUMMARY_TICKS: u32 = 720;

/// How many ticks that moved the camera a game logs, which is enough to tell what moved it.
const MAX_CAMERA_MOVES_LOGGED: u32 = 20;

/// Ticks this game logged moving the camera.
static CAMERA_MOVES_LOGGED: AtomicU32 = AtomicU32::new(0);

/// How a game that rolls back runs: the defaults, with whatever the debug knobs change.
struct Settings {
    /// Steps a step may run past the newest one whose turns are all known.
    limit: u32,
    /// Frames of lateness to absorb by rolling back rather than with input delay.
    rollback_target: u32,
    /// The latency buffer to act as if the relay asked for at least.
    min_buffer_turns: u32,
    /// Steps every tick rolls back at least, or 0.
    shadow_depth: u32,
    /// How long each storm slot's turns are held back after they arrive.
    held: [Duration; bw::MAX_STORM_PLAYERS],
    /// How long this client's own turns are held back before they leave, and the game frame
    /// from which they are.
    send_delay: (Duration, u32),
    /// Frames between the monkey's commands, or 0 for no monkey.
    #[cfg(debug_assertions)]
    monkey_interval: u32,
    /// The first position whose state hash report is not sent.
    withhold_hashes_from: u32,
}

static SETTINGS: Mutex<Settings> = Mutex::new(Settings {
    limit: DEFAULT_PREDICTION_LIMIT,
    rollback_target: DEFAULT_ROLLBACK_TARGET,
    min_buffer_turns: 0,
    shadow_depth: 0,
    held: [Duration::ZERO; bw::MAX_STORM_PLAYERS],
    send_delay: (Duration::ZERO, 0),
    #[cfg(debug_assertions)]
    monkey_interval: 0,
    withhold_hashes_from: u32::MAX,
});

/// Whether the current game rolls back.
static ARMED: AtomicBool = AtomicBool::new(false);

/// Frames between snapshots.
static SPACING: AtomicU32 = AtomicU32::new(tick::DEFAULT_SNAPSHOT_SPACING);

/// State of the monkey's random number generator (xorshift32, never 0).
#[cfg(debug_assertions)]
static MONKEY_RANDOM: AtomicU32 = AtomicU32::new(0);

/// When the simulation steps each frame, against the relays' session clock (see [`Pacing`]). Set
/// by the tick that runs the first step after the game's lockstep start, which kept every client's
/// simulation in step with the others' until then.
static PACING: Mutex<Option<Pacing>> = Mutex::new(None);

/// The rollback this client runs, for the network quality readout.
static RECENT_ROLLBACK: Mutex<RecentRollback> = Mutex::new(RecentRollback::new());

/// The rollback the network quality readout shows: a high percentile of how many frames this
/// client ran past the newest step whose turns were all known over the last few seconds, so that
/// the number holds still between bursts instead of moving every tick.
pub fn shown_rollback() -> u32 {
    RECENT_ROLLBACK.lock().shown()
}

/// How many ticks the client watches the rollback it runs before deciding whether to move its
/// lead: two seconds. A burst of lateness shorter than a tenth of that is rolled back over, up to
/// the prediction limit, and the lead only follows lateness that holds.
const LEAD_WINDOW_TICKS: usize = 48;

/// The rollback the ticks since the lead last moved ran with.
struct LeadWindow {
    rollbacks: [u32; LEAD_WINDOW_TICKS],
    ticks: usize,
    /// The newest step whose turns were all known as of the last tick noted.
    known_until: u32,
}

static LEAD_WINDOW: Mutex<LeadWindow> = Mutex::new(LeadWindow::new());

impl LeadWindow {
    const fn new() -> LeadWindow {
        LeadWindow {
            rollbacks: [0; LEAD_WINDOW_TICKS],
            ticks: 0,
            known_until: 0,
        }
    }

    /// Notes the rollback a tick ran with, `ahead` frames past `known_until`, the newest step
    /// whose turns were all known, and returns how far to move the lead once a whole window is in.
    ///
    /// The target is the rollback the client means to run steadily, and the frame past it is
    /// insurance against small delays: corrections stay hard to see up to a frame past the target,
    /// and only become visible beyond it. So the lead moves down (more input delay) once the
    /// window's median is past the target, or more than a tenth of its ticks ran past the
    /// insurance frame, by whichever excess is larger but at most [`MAX_LEAD_DROP`] frames; and it
    /// moves up once even its 90th percentile is short of the target, by that shortfall. Moving
    /// the lead by a frame moves the whole distribution by a frame, so one move never leads
    /// straight to the opposite one.
    ///
    /// Only ticks by which more turns became known count. The lead follows how late turns arrive,
    /// and while none arrive at all (a peer that stopped sending, or a lost link) the rollback just
    /// sits at the prediction limit, which says nothing about lateness: following it would pile
    /// input delay on for when turns resume.
    fn note(&mut self, ahead: u32, known_until: u32, target: u32) -> i32 {
        if known_until <= self.known_until {
            return 0;
        }
        self.known_until = known_until;
        self.rollbacks[self.ticks] = ahead;
        self.ticks += 1;
        if self.ticks < LEAD_WINDOW_TICKS {
            return 0;
        }
        self.ticks = 0;
        self.rollbacks.sort_unstable();
        let median = self.rollbacks[LEAD_WINDOW_TICKS / 2];
        let p90 = self.rollbacks[(LEAD_WINDOW_TICKS * 9).div_ceil(10) - 1];
        let excess = median
            .saturating_sub(target)
            .max(p90.saturating_sub(target + 1));
        if excess != 0 {
            -(excess.min(MAX_LEAD_DROP) as i32)
        } else {
            target.saturating_sub(p90) as i32
        }
    }
}

/// The most frames one window moves the lead down by. A drop takes effect at once, the game
/// putting its next steps off a frame a tick (frames the player sees repeat), and a window can run
/// at the prediction limit for no longer than one peer's link takes to fade for a couple of
/// seconds: following its whole excess would pile on as much input delay as the limit allows, just
/// as the fade ends, and rises take it back off only a couple of frames a window. Lateness that
/// holds keeps moving the lead down, window after window.
const MAX_LEAD_DROP: u32 = 2;

/// How many ticks go between the frames a rise in the lead takes effect by (see
/// [`TurnState::follow_lead`](netcode_v2::TurnState::follow_lead)): four frames a second, each
/// one extra step the game takes in a single tick.
const LEAD_FOLLOW_TICKS: u32 = 6;

/// Ticks since the lead in effect last followed the lead.
static LEAD_FOLLOW_WAIT: AtomicU32 = AtomicU32::new(0);

/// What the ticks since the last summary did.
#[derive(Default)]
struct Summary {
    ticks: u32,
    rollbacks: u32,
    resimulated: u32,
    /// The most steps any tick simulated again.
    deepest: u32,
    /// Summed over ticks, how many steps the present was past the newest known step.
    predicted_depth: u64,
    deepest_prediction: u32,
    /// Ticks whose present step could not run because it was too far ahead of the known turns.
    capped: u32,
    /// Frames stepped to catch up with the schedule.
    caught_up: u32,
    /// Ticks after which the next step was put off because the simulation was ahead of its
    /// schedule.
    held_back: u32,
    /// The lead in force at the end of the stretch.
    lead: i32,
    /// The pipe depth in force at the end of the stretch.
    pipe_depth: u32,
    /// What the pacing did against the relay's reports.
    pacing: PacingCounts,
    /// The session clock's stopped time at the end of the stretch, in microseconds.
    clock_stopped_us: u64,
    /// The newest report the relay sent in the stretch.
    lead_report: Option<LeadReport>,
    inputs: InputCounts,
    restore: Duration,
    snapshot: Duration,
    steps: Duration,
    worst_steps: Duration,
    /// The longest a tick that wasn't stalled took from start to end, everything included.
    worst_tick: Duration,
    /// Ticks that weren't stalled and took longer than [`SLOW_TICK`].
    slow_ticks: u32,
    /// This client's own turns sent while it was stalled on its own downlink.
    stalled_sends: u32,
}

/// A tick that takes longer than this costs a frame rate in the hundreds a noticeable dip.
const SLOW_TICK: Duration = Duration::from_millis(4);

static SUMMARY: Mutex<Option<Summary>> = Mutex::new(None);

/// Entries in [`GameStats::rollback_histogram`]: rollbacks of 0 to 10 frames, then 11 or more.
const ROLLBACK_HISTOGRAM_LEN: usize = 12;
/// Entries in [`GameStats::pipe_histogram`]: pipes of 0 to 13 turns, then 14 or more.
const PIPE_HISTOGRAM_LEN: usize = 15;

/// What a game that rolls back did from the end of its lockstep start through
/// [`through_turn`](Self::through_turn), for the statistics sent to the relay and the server. Every
/// count only grows, so two copies taken at different times can be subtracted.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStats {
    /// Which layout this is.
    pub version: u32,
    pub through_turn: u32,
    pub rollback_target: u32,
    pub prediction_limit: u32,
    pub ticks: u32,
    /// Ticks by the rollback shown: how many frames the frame shown was past the newest one whose
    /// turns were all known.
    pub rollback_histogram: [u32; ROLLBACK_HISTOGRAM_LEN],
    /// Ticks by pipe depth, this client's own input delay in turns.
    pub pipe_histogram: [u32; PIPE_HISTOGRAM_LEN],
    /// Ticks stalled at the prediction limit.
    pub capped_ticks: u32,
    /// Ticks that restored a snapshot.
    pub rollbacks: u32,
    pub resimulated_frames: u32,
    /// The most frames one rollback simulated again.
    pub deepest_rollback: u32,
    /// Steps that first ran with at least one turn predicted.
    pub predicted_steps: u32,
    pub mispredicted_turns: u32,
    pub confirmed_predictions: u32,
    /// Extra frames stepped to catch up with the schedule.
    pub caught_up_frames: u32,
    /// Ticks after which the next step was put off, the simulation being ahead of its schedule.
    pub held_back_ticks: u32,
    /// Times the rollback it ran moved the lead.
    pub lead_changes: u32,
    /// Lead reports that moved the schedule, and their net effect (negative is earlier).
    pub schedule_corrections: u32,
    pub schedule_corrected_us: i64,
    pub holds_undone: u32,
    /// How long the session clock has been stopped in all.
    pub clock_stopped_us: u64,
    pub lead_reports: u32,
    /// The highest 90th percentile lateness a lead report carried, and the sum of them all.
    pub lead_p90_max_us: i32,
    pub lead_p90_sum_us: i64,
    /// The longest a tick that wasn't stalled took, and how many took over [`SLOW_TICK`].
    pub worst_tick_us: u64,
    pub slow_ticks: u32,
    pub restore_us: u64,
    pub snapshot_us: u64,
    pub step_us: u64,
}

/// Which layout of [`GameStats`] this DLL sends.
const GAME_STATS_VERSION: u32 = 1;

/// What the current game has done since its lockstep start, if it rolls back.
static GAME_STATS: Mutex<Option<GameStats>> = Mutex::new(None);

/// A copy of what the current game has done since its lockstep start, or `None` when it doesn't
/// roll back or hasn't got that far.
pub fn game_stats() -> Option<GameStats> {
    GAME_STATS.lock().clone()
}

impl GameStats {
    /// The stats as the relay takes them.
    pub fn to_proto(&self) -> RollbackStats {
        RollbackStats {
            version: self.version,
            through_turn: self.through_turn,
            rollback_target: self.rollback_target,
            prediction_limit: self.prediction_limit,
            ticks: self.ticks,
            rollback_histogram: self.rollback_histogram.to_vec(),
            pipe_histogram: self.pipe_histogram.to_vec(),
            capped_ticks: self.capped_ticks,
            rollbacks: self.rollbacks,
            resimulated_frames: self.resimulated_frames,
            deepest_rollback: self.deepest_rollback,
            predicted_steps: self.predicted_steps,
            mispredicted_turns: self.mispredicted_turns,
            confirmed_predictions: self.confirmed_predictions,
            caught_up_frames: self.caught_up_frames,
            held_back_ticks: self.held_back_ticks,
            lead_changes: self.lead_changes,
            schedule_corrections: self.schedule_corrections,
            schedule_corrected_us: self.schedule_corrected_us,
            holds_undone: self.holds_undone,
            clock_stopped_us: self.clock_stopped_us,
            lead_reports: self.lead_reports,
            lead_p90_max_us: self.lead_p90_max_us,
            lead_p90_sum_us: self.lead_p90_sum_us,
            worst_tick_us: self.worst_tick_us,
            slow_ticks: self.slow_ticks,
            restore_us: self.restore_us,
            snapshot_us: self.snapshot_us,
            step_us: self.step_us,
        }
    }
}

fn micros_u64(duration: Duration) -> u64 {
    u64::try_from(duration.as_micros()).unwrap_or(u64::MAX)
}

/// Reads the debug knobs. Called once while the DLL initializes, before the game thread exists.
#[cfg(debug_assertions)]
pub fn init_from_env() {
    let mut held = [Duration::ZERO; bw::MAX_STORM_PLAYERS];
    if let Ok(spec) = std::env::var(DELAY_ENV_VAR) {
        for entry in spec.split(',').filter(|x| !x.is_empty()) {
            let parsed = entry.split_once(':').and_then(|(storm, steps)| {
                Some((storm.parse::<usize>().ok()?, steps.parse().ok()?))
            });
            match parsed {
                Some((storm, frames)) if storm < bw::MAX_STORM_PLAYERS => {
                    held[storm] = FRAME_DURATION * frames;
                }
                _ => {
                    error!(
                        "{DELAY_ENV_VAR} entry {entry:?} is not <storm id>:<frames>; ignoring it"
                    )
                }
            }
        }
    }
    let send_delay = std::env::var(SEND_DELAY_ENV_VAR)
        .ok()
        .and_then(|spec| {
            let (frames, from) = spec.split_once('@').unwrap_or((&spec, "240"));
            let parsed = frames.parse::<u32>().ok().zip(from.parse::<u32>().ok());
            if parsed.is_none() {
                error!("{SEND_DELAY_ENV_VAR}={spec:?} is not <frames>[@<frame>]; ignoring it");
            }
            parsed
        })
        .map_or((Duration::ZERO, 0), |(frames, from)| {
            (FRAME_DURATION * frames, from)
        });
    let monkey_interval = read_count(MONKEY_ENV_VAR)
        .filter(|&apm| apm != 0)
        // Each action is a select and a right click, and a minute is 24 * 60 frames.
        .map_or(0, |apm| (24 * 60 * 2 / apm).max(1));
    let seed = std::process::id()
        ^ std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |x| x.subsec_nanos());
    MONKEY_RANDOM.store(seed | 1, Ordering::Relaxed);
    let limit = read_count(PREDICT_ENV_VAR).unwrap_or(DEFAULT_PREDICTION_LIMIT);
    let settings = Settings {
        limit,
        rollback_target: read_count(TARGET_ENV_VAR)
            .unwrap_or(DEFAULT_ROLLBACK_TARGET)
            .min(limit),
        min_buffer_turns: read_count(MIN_BUFFER_ENV_VAR).unwrap_or(0),
        shadow_depth: read_count(SHADOW_ENV_VAR).unwrap_or(0),
        held,
        send_delay,
        monkey_interval,
        withhold_hashes_from: read_count(WITHHOLD_HASHES_ENV_VAR).unwrap_or(u32::MAX),
    };
    *SETTINGS.lock() = settings;
    if let Some(spacing) = crate::rollback_harness::snapshot_spacing_from_env() {
        SPACING.store(spacing, Ordering::Release);
    }
}

#[cfg(debug_assertions)]
fn read_count(var: &str) -> Option<u32> {
    let spec = std::env::var(var).ok()?;
    match spec.parse::<u32>() {
        Ok(x) => Some(x),
        Err(_) => {
            error!("{var}={spec:?} is not a count; ignoring it");
            None
        }
    }
}

/// The highest rollback target a player can choose in their settings.
const MAX_PLAYER_ROLLBACK_TARGET: u32 = 4;

/// Takes the rollback target the player chose in their settings, for the games this process runs,
/// unless a debug knob set one. Called with the settings the app sends before a game starts.
pub fn set_player_rollback_target(target: u32) {
    #[cfg(debug_assertions)]
    if std::env::var_os(TARGET_ENV_VAR).is_some() {
        info!("Ignoring the rollback target setting ({target}), since {TARGET_ENV_VAR} is set");
        return;
    }
    let mut settings = SETTINGS.lock();
    settings.rollback_target = target.min(MAX_PLAYER_ROLLBACK_TARGET).min(settings.limit);
}

/// How long a debug knob holds back each turn this client sends in a game that rolls back, and the
/// game frame from which it does, if it does.
pub fn own_send_delay() -> Option<(Duration, u32)> {
    let (delay, from) = SETTINGS.lock().send_delay;
    (!delay.is_zero()).then_some((delay, from))
}

/// Whether native sync (0x37) is off for this client: it neither sends sync commands nor checks
/// its peers' ones, and a no-op stands in for each turn's sync command. Off exactly in a game that
/// rolls back, since native sync hashes state that a re-simulation does not reproduce, and a
/// predicted step would hash state its peers never had.
pub(crate) fn native_sync_off() -> bool {
    ARMED.load(Ordering::Acquire)
}

/// Whether this DLL can run a game that rolls back: analysis resolved everything the engine
/// snapshots and hooks. Rolling back without any one of them either diverges or shows the players
/// something only a prediction did, so a DLL missing one refuses the session instead.
pub fn supported() -> bool {
    match crate::bw::get_bw().rollback_missing_analysis() {
        None => true,
        Some(missing) => {
            error!("Can't roll back: analysis did not find {missing}");
            false
        }
    }
}

/// Sets whether the game about to start rolls back, as its session says, and returns the input
/// table its turn state keeps its turns in when it does. The server tells every client in the
/// session the same, which matters because a game that rolls back turns native sync off.
pub fn arm_for_session(rollback: bool) -> Option<InputTable> {
    ARMED.store(rollback, Ordering::Release);
    if !rollback {
        return None;
    }
    let settings = SETTINGS.lock();
    info!(
        "This game rolls back, with native sync off: prediction limit {}, rollback target {}",
        settings.limit, settings.rollback_target,
    );
    #[cfg(debug_assertions)]
    info!(
        "Rollback debug knobs: minimum buffer {}, shadow depth {}, turns held back {:?}, own turns \
         held back {:?} from frame {}, monkey every {} frames, hash reports withheld from position \
         {}",
        settings.min_buffer_turns,
        settings.shadow_depth,
        settings.held,
        settings.send_delay.0,
        settings.send_delay.1,
        settings.monkey_interval,
        settings.withhold_hashes_from,
    );
    let mut table = InputTable::new(
        settings.limit,
        settings.rollback_target,
        LOCKSTEP_START_STEPS,
        settings.held,
    );
    table.set_min_buffer_turns(settings.min_buffer_turns);
    Some(table)
}

/// Drops the snapshots and forgets per-game state. Called when the game loop (re-)enters game
/// init.
pub fn reset_for_game_init() {
    SNAPSHOTS.lock().take();
    crate::rollback::reset_for_game_init();
    *SUMMARY.lock() = None;
    *PACING.lock() = None;
    RECENT_ROLLBACK.lock().clear();
    *GAME_STATS.lock() = None;
    *LEAD_WINDOW.lock() = LeadWindow::new();
    LEAD_FOLLOW_WAIT.store(0, Ordering::Relaxed);
    CAMERA_MOVES_LOGGED.store(0, Ordering::Relaxed);
}

/// Runs one tick of a live game that rolls back, or returns `None` to leave the tick to the replay
/// harness or a plain step: when live rollback is off, in replays, and before the game loop is
/// running a netcode v2 session.
pub unsafe fn run_game_logic_step(
    bw: &'static BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
) -> Option<usize> {
    unsafe {
        if !ARMED.load(Ordering::Relaxed) || game_thread::is_replay() || !bw.has_game_started() {
            return None;
        }
        let (shadow_depth, rollback_target, withhold_hashes_from) = {
            let settings = SETTINGS.lock();
            (
                settings.shadow_depth,
                settings.rollback_target,
                settings.withhold_hashes_from,
            )
        };
        let tick_start = Instant::now();
        let spacing = SPACING.load(Ordering::Relaxed);
        // Positions on the rollback timeline are turns, which a paused game keeps taking without
        // advancing frames; see `rollback::count_turns`.
        crate::rollback::count_turns(true);
        let current = crate::rollback::position(bw)?;
        // What the turn state's receive will be given for the step from `current`: BW's turn
        // counter, which reads one past the turns dispatched while a step takes its turns.
        let next_frame = current + 1;
        #[cfg(debug_assertions)]
        {
            let monkey_interval = SETTINGS.lock().monkey_interval;
            if monkey_interval != 0 && current.is_multiple_of(monkey_interval) {
                bw.rollback_issue_random_commands(next_random);
            }
        }
        let (
            resimulate_from,
            known_until,
            can_run,
            lead,
            pipe_depth,
            in_flight,
            own_downlink,
            lead_report,
        ) = netcode_v2::with_turn_state(|s| {
            let target = s.take_rollback_target(next_frame);
            (
                target,
                s.known_until(),
                s.can_run(next_frame),
                s.lead(),
                s.pipe_depth(),
                s.outstanding_turns(),
                s.waiting_on_own_downlink(tick_start),
                s.take_lead_report(),
            )
        })?;
        // A turn state without an input table is one that started before rollback was armed.
        let known_until = known_until?;

        let mut guard = SNAPSHOTS.lock();
        if guard.is_none() {
            *guard = Snapshots::build(bw);
        }
        let snapshots = guard.as_mut()?;
        if let (Some(target), Some(oldest)) = (resimulate_from, snapshots.oldest_frame())
            && target < oldest
        {
            // The ring only drops snapshots from before the newest known step, so a turn that
            // contradicts a prediction can only be for a step after the oldest snapshot.
            error!(
                "Live rollback asked to re-simulate from frame {target}, but the oldest snapshot \
                 is of frame {oldest}; this client will diverge"
            );
        }
        // The newest of this client's own turns sent, which the relay's reports count in: every
        // turn in flight past the present, usually `pipe_depth` of them, and more while a stall on
        // this client's own downlink keeps its turns leaving on schedule.
        let newest_sent = u64::from(current) + u64::from(in_flight);
        // A stall on this client's own downlink isn't the session waiting: its turns keep leaving
        // on schedule, so the schedule doesn't hold still through it.
        let session_stall = !can_run && !own_downlink;
        // A simulation that has fallen behind its schedule (a hitch, a pipe that just shrank, a
        // stall of its own, or the relay's reports moving its turns earlier) steps extra frames
        // until it is back on it, rather than making anyone wait for it.
        let (scheduled, timing_us, owed) = PACING
            .lock()
            .as_mut()
            .map(|pacing| {
                let slewed_us = pacing.tick(tick_start, session_stall, newest_sent);
                if let Some(report) = &lead_report {
                    pacing.on_report(report, newest_sent);
                }
                let nudge_us = pacing.phase_nudge_us(tick_start);
                let owed = pacing.due_turn(tick_start).saturating_sub(newest_sent);
                (
                    Some(pacing.target(tick_start, pipe_depth)),
                    slewed_us + nudge_us,
                    u32::try_from(owed).unwrap_or(u32::MAX),
                )
            })
            .unwrap_or((None, 0, 0));
        netcode_v2::with_turn_state(|s| s.set_owed_turns(owed));
        let catch_up = match (scheduled, can_run) {
            (Some(scheduled), true) => scheduled
                .saturating_sub(current + 1)
                .min(MAX_CATCH_UP_PER_TICK),
            _ => 0,
        };
        let present = current + 1 + catch_up;
        // While the present step cannot run, the step it stalls in polls for turns again and
        // again, and rolling back ahead of every poll would only burn time.
        let forced =
            (shadow_depth != 0 && can_run).then(|| present.saturating_sub(shadow_depth + 1));
        let rollback_to = [resimulate_from, forced].into_iter().flatten().min();
        let plan = TickPlan {
            rollback_to,
            present,
            confirmed: known_until.min(present),
            spacing,
        };
        let camera_before = bw.rollback_screen_position();
        let (ret, report) = tick::run_tick(bw, snapshots, current, &plan, |step| {
            let ret = step_game_logic(bw, param, orig);
            let game = bw.game();
            if !game.is_null() {
                game_end::record_outcome(
                    step.frame,
                    game_end::Outcome {
                        victory_state: (*game).victory_state,
                        alliances: (*game).alliances,
                        player_was_dropped: (*game).player_was_dropped,
                    },
                );
            }
            if hash_reports::is_report_position(step.frame)
                && let Some(hash) = bw.rollback_state_hash()
            {
                hash_reports::record(step.frame, hash);
            }
            ret
        });
        drop(guard);
        // Only the person watching moves the camera in a melee game, and never from inside a step,
        // so a tick that moves it has some camera state in what it restores or re-simulates.
        let camera_after = bw.rollback_screen_position();
        if camera_after != camera_before
            && CAMERA_MOVES_LOGGED.fetch_add(1, Ordering::Relaxed) < MAX_CAMERA_MOVES_LOGGED
        {
            warn!(
                "Live rollback tick from frame {current} moved the camera from {camera_before:?} \
                 to {camera_after:?} (restored {:?}, {} steps)",
                report.restored, report.steps,
            );
        }
        let reached = crate::rollback::position(bw).unwrap_or(current);
        // The rollback this client runs: how far the frame it now shows is past the newest frame
        // whose turns are all known. A tick stalled at the prediction limit shows the frame it was
        // already on, exactly the limit past them.
        let ahead = reached.saturating_sub(known_until);
        let mut lead_changed = false;
        if current >= LOCKSTEP_START_STEPS {
            RECENT_ROLLBACK.lock().record(Instant::now(), ahead);
            let adjustment = LEAD_WINDOW.lock().note(ahead, known_until, rollback_target);
            let follow = LEAD_FOLLOW_WAIT.fetch_add(1, Ordering::Relaxed) + 1 >= LEAD_FOLLOW_TICKS;
            if follow {
                LEAD_FOLLOW_WAIT.store(0, Ordering::Relaxed);
            }
            if adjustment != 0 || follow {
                lead_changed = netcode_v2::with_turn_state(|s| {
                    let moved = adjustment != 0 && s.adjust_lead(adjustment);
                    if follow {
                        s.follow_lead();
                    }
                    moved
                })
                .unwrap_or(false);
            }
        }
        let mut held_back = false;
        {
            // The slew the pacing applied to the schedule this tick, applied to the game loop's
            // own timing too, and the nudge keeping its ticks centered in their steps: the next
            // step comes that much sooner or later.
            let mut delay_ms = (timing_us / 1000) as i32;
            let mut pacing = PACING.lock();
            match &*pacing {
                None if reached > current && current >= LOCKSTEP_START_STEPS => {
                    let buffer = u32::try_from(lead + pipe_depth as i32).unwrap_or(pipe_depth);
                    *pacing = Some(Pacing::new(current, buffer, tick_start));
                }
                // A simulation ahead of its schedule (a pipe that just grew, the relay's reports
                // moving its turns later, or a game loop running its ticks early) puts its next
                // step off by a frame at a time until the schedule catches up.
                Some(x) if reached > x.target(tick_start, pipe_depth) => {
                    delay_ms += FRAME_DURATION.as_millis() as i32;
                    held_back = true;
                }
                _ => (),
            }
            if delay_ms != 0 {
                bw.rollback_set_next_game_step_tick(
                    bw.rollback_next_game_step_tick()
                        .wrapping_add_signed(delay_ms),
                );
            }
        }
        sounds::reconcile_sounds(bw, report.window_start, report.settled_through, present);
        game_end::confirm_outcomes_through(plan.confirmed);
        let reports = hash_reports::take_confirmed(plan.confirmed);
        if !reports.is_empty() {
            netcode_v2::with_turn_state(|s| {
                for &(position, hash) in &reports {
                    if position < withhold_hashes_from {
                        s.queue_state_hash(position, hash);
                    }
                }
            });
        }
        if let Some(dialog) = game_end::take_confirmed(plan.confirmed) {
            info!(
                "Opening the {dialog:?} dialog a step asked for, now that frames through {} are \
                 confirmed",
                plan.confirmed
            );
            bw.rollback_open_mission_dialog(dialog);
        }
        let (counts, stalled_sends) = netcode_v2::with_turn_state(|s| {
            s.forget_inputs_before(report.settled_through);
            (
                s.take_input_counts().unwrap_or_default(),
                s.take_stalled_sends(),
            )
        })
        .unwrap_or_default();

        let pacing_counts = PACING
            .lock()
            .as_mut()
            .map(|pacing| (pacing.take_counts(), pacing.pause_us()));
        // A stalled tick waits for turns inside its step, which isn't work.
        let tick_time = can_run.then(|| tick_start.elapsed());
        let resimulated = report
            .restored
            .map(|restored| current.saturating_sub(restored));
        let caught_up = reached.saturating_sub(current + 1);

        if current >= LOCKSTEP_START_STEPS {
            let mut stats = GAME_STATS.lock();
            let stats = stats.get_or_insert_with(|| GameStats {
                version: GAME_STATS_VERSION,
                rollback_target,
                prediction_limit: SETTINGS.lock().limit,
                ..GameStats::default()
            });
            stats.through_turn = present;
            stats.ticks += 1;
            stats.rollback_histogram[(ahead as usize).min(ROLLBACK_HISTOGRAM_LEN - 1)] += 1;
            stats.pipe_histogram[(pipe_depth as usize).min(PIPE_HISTOGRAM_LEN - 1)] += 1;
            stats.capped_ticks += u32::from(!can_run);
            if let Some(resimulated) = resimulated {
                stats.rollbacks += 1;
                stats.resimulated_frames += resimulated;
                stats.deepest_rollback = stats.deepest_rollback.max(resimulated);
            }
            stats.predicted_steps += counts.predicted_steps;
            stats.mispredicted_turns += counts.mispredicted_turns;
            stats.confirmed_predictions += counts.confirmed_predictions;
            stats.caught_up_frames += caught_up;
            stats.held_back_ticks += u32::from(held_back);
            stats.lead_changes += u32::from(lead_changed);
            if let Some((pacing, pause_us)) = pacing_counts {
                stats.schedule_corrections += pacing.corrections;
                stats.schedule_corrected_us += pacing.corrected_us;
                stats.holds_undone += pacing.holds_undone;
                stats.clock_stopped_us = pause_us;
            }
            if let Some(report) = &lead_report {
                stats.lead_reports += 1;
                stats.lead_p90_max_us = match stats.lead_reports {
                    1 => report.p90_us,
                    _ => stats.lead_p90_max_us.max(report.p90_us),
                };
                stats.lead_p90_sum_us += i64::from(report.p90_us);
            }
            if let Some(tick_time) = tick_time {
                stats.worst_tick_us = stats.worst_tick_us.max(micros_u64(tick_time));
                stats.slow_ticks += u32::from(tick_time > SLOW_TICK);
            }
            stats.restore_us += micros_u64(report.restore_time);
            stats.snapshot_us += micros_u64(report.snapshot_time);
            stats.step_us += micros_u64(report.step_time);
        }

        let mut summary_guard = SUMMARY.lock();
        let summary = summary_guard.get_or_insert_with(Summary::default);
        summary.ticks += 1;
        summary.stalled_sends += stalled_sends;
        if let Some(resimulated) = resimulated {
            summary.rollbacks += 1;
            summary.resimulated += resimulated;
            summary.deepest = summary.deepest.max(resimulated);
        }
        summary.predicted_depth += ahead as u64;
        summary.deepest_prediction = summary.deepest_prediction.max(ahead);
        if !can_run {
            summary.capped += 1;
        }
        summary.caught_up += caught_up;
        if held_back {
            summary.held_back += 1;
        }
        summary.lead = lead;
        summary.pipe_depth = pipe_depth;
        if let Some((pacing, pause_us)) = pacing_counts {
            summary.pacing.corrections += pacing.corrections;
            summary.pacing.corrected_us += pacing.corrected_us;
            summary.pacing.holds_undone += pacing.holds_undone;
            summary.clock_stopped_us = pause_us;
        }
        if lead_report.is_some() {
            summary.lead_report = lead_report;
        }
        summary.inputs.predicted_steps += counts.predicted_steps;
        summary.inputs.mispredicted_turns += counts.mispredicted_turns;
        summary.inputs.confirmed_predictions += counts.confirmed_predictions;
        summary.restore += report.restore_time;
        summary.snapshot += report.snapshot_time;
        summary.steps += report.step_time;
        summary.worst_steps = summary.worst_steps.max(report.step_time);
        if let Some(tick_time) = tick_time {
            summary.worst_tick = summary.worst_tick.max(tick_time);
            if tick_time > SLOW_TICK {
                summary.slow_ticks += 1;
            }
        }
        let summarized = summary.ticks >= SUMMARY_TICKS;
        if summarized {
            log_summary(summary, present);
            *summary = Summary::default();
        }
        drop(summary_guard);
        // The relay keeps the newest stats in its flight recording's rows, so they go out with each
        // summary rather than every tick.
        if summarized && let Some(stats) = game_stats() {
            netcode_v2::with_turn_state(|s| s.publish_rollback_stats(stats.to_proto()));
        }
        Some(ret)
    }
}

fn log_summary(summary: &Summary, present: u32) {
    let per_tick = |x: Duration| x.as_secs_f64() * 1000.0 / summary.ticks as f64;
    info!(
        "Live rollback over {} ticks to turn {present}: {} steps ran predicted, {} predicted \
         turns held and {} did not; {} rollbacks re-simulated {} frames (deepest {}); present \
         ahead of known turns by {:.2} frames on average (at most {}), {} ticks at the limit, {} \
         turns sent stalled on its own downlink; lead {} frames over a pipe of {}, {} frames \
         caught up, {} ticks held back; {}; per tick \
         restore {:.2} ms, snapshot {:.2} ms, steps {:.2} ms (worst {:.1} ms); worst whole tick \
         {:.1} ms, {} over {} ms; {}",
        summary.ticks,
        summary.inputs.predicted_steps,
        summary.inputs.confirmed_predictions,
        summary.inputs.mispredicted_turns,
        summary.rollbacks,
        summary.resimulated,
        summary.deepest,
        summary.predicted_depth as f64 / summary.ticks as f64,
        summary.deepest_prediction,
        summary.capped,
        summary.stalled_sends,
        summary.lead,
        summary.pipe_depth,
        summary.caught_up,
        summary.held_back,
        describe_pacing(summary),
        per_tick(summary.restore),
        per_tick(summary.snapshot),
        per_tick(summary.steps),
        summary.worst_steps.as_secs_f64() * 1000.0,
        summary.worst_tick.as_secs_f64() * 1000.0,
        summary.slow_ticks,
        SLOW_TICK.as_millis(),
        describe_frames(&crate::frame_timing::take_stats()),
    );
}

/// What the frames drawn over a summary's stretch took, for its log line.
fn describe_frames(frames: &crate::frame_timing::FrameStats) -> String {
    if frames.frames == 0 {
        return "no frames drawn".to_owned();
    }
    let ms = |us: u32| f64::from(us) / 1000.0;
    format!(
        "{} frames at {:.0} fps, worst {:.1} ms (draw {:.1} ms, render {:.1} ms, tick {:.1} ms), \
         {} over {} ms ({} with a rollback, {} with another step)",
        frames.frames,
        f64::from(frames.frames) * 1e6 / frames.interval_us.max(1) as f64,
        ms(frames.worst_us),
        ms(frames.worst_draw_us),
        ms(frames.worst_render_us),
        ms(frames.worst_tick_us),
        frames.slow,
        crate::frame_timing::SLOW_FRAME.as_millis(),
        frames.slow_with_rollback,
        frames.slow_with_step,
    )
}

/// What the pacing did over a summary's stretch, for its log line.
fn describe_pacing(summary: &Summary) -> String {
    let ms = |us: i64| us as f64 / 1000.0;
    let Some(report) = summary.lead_report else {
        return "no lead reports".to_owned();
    };
    format!(
        "{} schedule corrections (net {:+.1} ms), {} stall holds undone, session clock stopped \
         {:.1} ms; newest lead report median {:+.1} ms, p90 {:+.1} ms over {} turns",
        summary.pacing.corrections,
        ms(summary.pacing.corrected_us),
        summary.pacing.holds_undone,
        ms(summary.clock_stopped_us as i64),
        ms(report.median_us.into()),
        ms(report.p90_us.into()),
        report.samples,
    )
}

/// Runs one of BW's logic steps, measured by the rollback probe when it is armed.
unsafe fn step_game_logic(
    bw: &BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
) -> usize {
    unsafe {
        #[cfg(debug_assertions)]
        {
            crate::rollback_probe::run_game_logic_step(bw, param, orig)
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = bw;
            orig(param)
        }
    }
}

/// The monkey's next random number.
#[cfg(debug_assertions)]
fn next_random() -> u32 {
    let mut x = MONKEY_RANDOM.load(Ordering::Relaxed);
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    MONKEY_RANDOM.store(x, Ordering::Relaxed);
    x
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feeds a whole window of ticks running the given rollbacks in turn, and returns the lead
    /// move it ends with.
    fn window(target: u32, rollbacks: impl Fn(usize) -> u32) -> i32 {
        let mut window = LeadWindow::new();
        let mut adjustment = 0;
        for tick in 0..LEAD_WINDOW_TICKS {
            adjustment = window.note(rollbacks(tick), tick as u32 + 1, target);
        }
        adjustment
    }

    #[test]
    fn rollback_around_the_target_holds_the_lead() {
        assert_eq!(window(2, |tick| 1 + (tick % 3) as u32), 0);
        assert_eq!(window(2, |_| 2), 0);
        // The insurance frame past the target, now and then.
        assert_eq!(window(2, |tick| if tick % 5 == 0 { 3 } else { 2 }), 0);
    }

    #[test]
    fn rollback_past_the_target_most_of_the_time_adds_delay() {
        // Mostly a frame past the target, so its median is, though some ticks dip under it.
        assert_eq!(window(2, |tick| if tick % 4 == 0 { 1 } else { 3 }), -1);
    }

    #[test]
    fn rollback_often_past_the_insurance_frame_adds_delay() {
        // The median sits on the target, but more than a tenth of the ticks run at 5.
        assert_eq!(window(2, |tick| if tick % 6 == 0 { 5 } else { 2 }), -2);
    }

    #[test]
    fn a_window_at_the_prediction_limit_moves_the_lead_down_a_little_at_a_time() {
        assert_eq!(window(2, |_| 8), -(MAX_LEAD_DROP as i32));
        assert_eq!(window(2, |tick| if tick % 2 == 0 { 8 } else { 6 }), -2);
    }

    #[test]
    fn a_short_burst_is_rolled_back_over() {
        assert_eq!(window(2, |tick| if tick < 4 { 7 } else { 2 }), 0);
    }

    #[test]
    fn rollback_short_of_the_target_even_in_bursts_takes_delay_off() {
        assert_eq!(window(2, |tick| (tick % 2) as u32), 1);
        assert_eq!(window(3, |_| 0), 3);
    }

    #[test]
    fn game_stats_go_to_the_server_under_its_names() {
        let json = serde_json::to_value(GameStats::default()).unwrap();
        let fields = json.as_object().unwrap();
        for name in [
            "version",
            "throughTurn",
            "rollbackTarget",
            "predictionLimit",
            "ticks",
            "rollbackHistogram",
            "pipeHistogram",
            "cappedTicks",
            "rollbacks",
            "resimulatedFrames",
            "deepestRollback",
            "predictedSteps",
            "mispredictedTurns",
            "confirmedPredictions",
            "caughtUpFrames",
            "heldBackTicks",
            "leadChanges",
            "scheduleCorrections",
            "scheduleCorrectedUs",
            "holdsUndone",
            "clockStoppedUs",
            "leadReports",
            "leadP90MaxUs",
            "leadP90SumUs",
            "worstTickUs",
            "slowTicks",
            "restoreUs",
            "snapshotUs",
            "stepUs",
        ] {
            assert!(fields.contains_key(name), "{name}");
        }
        assert_eq!(fields.len(), 29);
        assert_eq!(fields["rollbackHistogram"].as_array().unwrap().len(), 12);
        assert_eq!(fields["pipeHistogram"].as_array().unwrap().len(), 15);
    }

    #[test]
    fn ticks_without_new_turns_say_nothing() {
        let mut window = LeadWindow::new();
        for _ in 0..LEAD_WINDOW_TICKS * 2 {
            assert_eq!(window.note(8, 1, 2), 0);
        }
    }
}
