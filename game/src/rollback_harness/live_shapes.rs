//! The shapes of a live game's ticks that one plain step per tick never takes, for the replay
//! harness to drive the rollback engine through as well.
//!
//! A live game ([`crate::rollback_live`]) runs a step only within the prediction limit of the
//! newest step whose turns are all known. When a slot's turns stop arriving, the present runs
//! ahead on predictions until it reaches the limit, and from then on every tick enters BW's step,
//! whose turn receive finds nothing to dispatch, so the frame stays where it is. Once the turns
//! come in, the simulation has fallen behind its schedule and steps extra frames per tick until it
//! is back on it. And turns keep arriving while a tick runs: the receive of every step it takes
//! drains whatever came in since the last one, after the tick chose how far back to roll and where
//! to stop.
//!
//! The harness models a live client's knowledge of the turns with a clock that advances one frame
//! per tick, stalled or not. A delayed player's command is known once the clock is its delay past
//! the frame it was issued for, and the frames whose commands are all known can be run up to the
//! prediction limit past. Three debug knobs shape the ticks around that:
//!
//! - `SB_ROLLBACK_HARNESS_STALL=<every>:<ticks>[:<release>[:<storm ids>]]` stops the given players'
//!   turns (`+`-separated storm ids; every player's unless given) arriving every `<every>` frames,
//!   until `<ticks>` ticks have stalled at the prediction limit (`SB_ROLLBACK_PREDICT`, as live
//!   games take it). Their turns then arrive `<release>` frames' worth a tick (at least 2, since
//!   the clock moves on one a tick), or all at once with 0 or nothing given, so the frames they
//!   leave unknown lag the present while it catches up.
//!   A stalled tick enters BW's step with the turn receive finding nothing, as a live one does.
//! - `SB_ROLLBACK_HARNESS_CATCH_UP=<frames>` is how many frames a tick steps beyond the one it would
//!   anyway while the present is behind the clock, as a live game catching up with its schedule
//!   does (as many as a live game, unless set).
//! - `SB_ROLLBACK_HARNESS_MID_TICK=1` delivers what a tick's clock advance makes known between two
//!   of its steps on about half the ticks, instead of before the tick plans its rollback.
//!
//! All of them compose with the harness's forced depth, delays, vision and selection.

use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;

use crate::bw;
use crate::bw::players::StormPlayerId;

const STALL_ENV_VAR: &str = "SB_ROLLBACK_HARNESS_STALL";
const CATCH_UP_ENV_VAR: &str = "SB_ROLLBACK_HARNESS_CATCH_UP";
const MID_TICK_ENV_VAR: &str = "SB_ROLLBACK_HARNESS_MID_TICK";

/// The most steps after the first a tick delivers its knowledge after, when it delivers it between
/// steps.
const MAX_DELIVERY_STEP: u32 = 3;

/// Every storm player.
const ALL_PLAYERS: u16 = (1 << bw::MAX_STORM_PLAYERS) - 1;

/// What the harness knows of the players' commands at some point in a tick.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub(super) struct Knowledge {
    /// The frame count the clock has reached: a command a player with a delay of `K` frames issued
    /// for the step that produces frame `f` is known once `f + K <= clock`.
    clock: u32,
    /// Storm players (a bit mask) whose turns have stopped arriving.
    withheld: u16,
    /// The newest frame the withheld players' commands are known through.
    withheld_known_through: u32,
}

impl Knowledge {
    fn at_clock(clock: u32) -> Knowledge {
        Knowledge {
            clock,
            withheld: 0,
            withheld_known_through: 0,
        }
    }

    /// Whether the command `storm` issued for the step that produces `frame` is known. `delay` is
    /// that player's delay, and `max_delay` the longest any player has. A leave waits for every
    /// player's commands through its frame (see [`super::command_delay`]).
    pub(super) fn knows(
        &self,
        storm: StormPlayerId,
        is_leave: bool,
        frame: u32,
        delay: u32,
        max_delay: u32,
    ) -> bool {
        if is_leave {
            return frame <= self.known_until(max_delay);
        }
        let withheld = self.withheld & (1 << storm.0) != 0 && frame > self.withheld_known_through;
        !withheld && frame.saturating_add(delay) <= self.clock
    }

    /// The newest frame whose commands are all known.
    pub(super) fn known_until(&self, max_delay: u32) -> u32 {
        let known = self.clock.saturating_sub(max_delay);
        match self.withheld {
            0 => known,
            _ => known.min(self.withheld_known_through),
        }
    }
}

struct StallSpec {
    /// Frames from the end of one stretch of withheld turns to the start of the next.
    every: u32,
    /// Ticks stalled at the prediction limit before the turns arrive again.
    ticks: u32,
    /// Frames of the withheld players' turns that arrive per tick once they do, or 0 for all of
    /// them at once.
    release: u32,
    players: u16,
}

/// A stretch of the stall knob's players' turns not arriving.
struct WithheldTurns {
    players: u16,
    known_through: u32,
    stalled_ticks: u32,
    arriving: bool,
}

struct Shapes {
    stall: Option<StallSpec>,
    catch_up: u32,
    mid_tick: bool,
    /// Frames the present is behind the clock.
    behind: u32,
    withheld: Option<WithheldTurns>,
    /// The frame count from which the next stretch of withheld turns may start, or 0 before the
    /// first tick has set it.
    next_withholding: u32,
    /// The knowledge the last tick ended with.
    last: Option<Knowledge>,
    /// State of the random number generator picking where knowledge arrives mid-tick (xorshift32,
    /// never 0). Fixed, so a rerun of the same settings takes the same shapes.
    random: u32,
}

static SHAPES: Mutex<Shapes> = Mutex::new(Shapes {
    stall: None,
    catch_up: crate::rollback_live::MAX_CATCH_UP_PER_TICK,
    mid_tick: false,
    behind: 0,
    withheld: None,
    next_withholding: 0,
    last: None,
    random: 0x2545_f491,
});

/// Whether any knob here is set, so the harness consults this module at all.
static ARMED: AtomicBool = AtomicBool::new(false);

/// Whether stalls are armed, so that a command can be unknown with no delay on its player.
static STALLS_ARMED: AtomicBool = AtomicBool::new(false);

pub(super) fn armed() -> bool {
    ARMED.load(Ordering::Relaxed)
}

pub(super) fn stalls_armed() -> bool {
    STALLS_ARMED.load(Ordering::Relaxed)
}

/// Reads the knobs. Called once while the DLL initializes.
pub(super) fn init_from_env() {
    let mut shapes = SHAPES.lock();
    if let Ok(spec) = std::env::var(STALL_ENV_VAR) {
        match parse_stall(&spec) {
            Some(stall) => {
                info!(
                    "{STALL_ENV_VAR}: withholding the turns of players {:#x} every {} frames for \
                     {} ticks stalled at the prediction limit, then {} frames of them a tick",
                    stall.players, stall.every, stall.ticks, stall.release,
                );
                shapes.stall = Some(stall);
                STALLS_ARMED.store(true, Ordering::Relaxed);
            }
            None => error!(
                "{STALL_ENV_VAR}={spec:?} is not <every>:<ticks>[:<release>[:<storm ids>]] with \
                 <every> and <ticks> at least 1 and <release> 0 or at least 2; ignoring it"
            ),
        }
    }
    if let Ok(spec) = std::env::var(CATCH_UP_ENV_VAR) {
        match spec.parse::<u32>() {
            Ok(frames) => {
                info!("{CATCH_UP_ENV_VAR}: catching up at most {frames} extra frames a tick");
                shapes.catch_up = frames;
            }
            Err(_) => error!("{CATCH_UP_ENV_VAR}={spec:?} is not a frame count; ignoring it"),
        }
    }
    if let Ok(spec) = std::env::var(MID_TICK_ENV_VAR) {
        match spec.as_str() {
            "1" => {
                info!("{MID_TICK_ENV_VAR}: delivering knowledge between a tick's steps");
                shapes.mid_tick = true;
            }
            "0" => (),
            _ => error!("{MID_TICK_ENV_VAR}={spec:?} is not 0 or 1; ignoring it"),
        }
    }
    ARMED.store(shapes.stall.is_some() || shapes.mid_tick, Ordering::Relaxed);
}

fn parse_stall(spec: &str) -> Option<StallSpec> {
    let mut parts = spec.split(':');
    let every = parts.next()?.trim().parse::<u32>().ok()?;
    let ticks = parts.next()?.trim().parse::<u32>().ok()?;
    let release = match parts.next() {
        Some(x) => x.trim().parse::<u32>().ok()?,
        None => 0,
    };
    let players = match parts.next() {
        Some(ids) => {
            let mut mask = 0u16;
            for id in ids.split('+') {
                let id = id.trim().parse::<usize>().ok()?;
                if id >= bw::MAX_STORM_PLAYERS {
                    return None;
                }
                mask |= 1 << id;
            }
            mask
        }
        None => ALL_PLAYERS,
    };
    if parts.next().is_some() || every == 0 || ticks == 0 || release == 1 || players == 0 {
        return None;
    }
    Some(StallSpec {
        every,
        ticks,
        release,
        players,
    })
}

/// How one tick is shaped.
pub(super) struct TickShape {
    /// What is known when the tick plans: what it rolls back for and confirms.
    pub(super) at_start: Knowledge,
    /// What is known from [`deliver_after_steps`](Self::deliver_after_steps) on.
    pub(super) delivered: Knowledge,
    /// How many of the tick's steps run before [`delivered`](Self::delivered) is known, or 0 when
    /// it is known from the start.
    pub(super) deliver_after_steps: u32,
    /// The frame the tick plans to end on.
    pub(super) present: u32,
    /// The prediction limit, when stalls are armed: a step that has not run before stalls when
    /// the frame it produces is more than this past the newest frame whose commands are all known.
    pub(super) limit: Option<u32>,
}

/// Shapes the tick that starts from frame `current`, the knowledge of a harness without these knobs
/// being the tick's present. `max_delay` is the longest delay any player has.
pub(super) fn plan_tick(current: u32, max_delay: u32) -> TickShape {
    let mut guard = SHAPES.lock();
    let shapes = &mut *guard;
    let clock = current + 1 + shapes.behind;
    if shapes.next_withholding == 0
        && let Some(stall) = &shapes.stall
    {
        shapes.next_withholding = current + stall.every;
    }
    let withheld = match (&shapes.stall, shapes.withheld.take()) {
        (Some(stall), None) if current >= shapes.next_withholding => {
            // From here on nothing more of their turns arrives than the last tick knew of.
            let known_through = clock.saturating_sub(1).saturating_sub(max_delay);
            debug!(
                "{STALL_ENV_VAR}: frame {current} withholds the turns of players {:#x} after \
                 frame {known_through}",
                stall.players,
            );
            Some(WithheldTurns {
                players: stall.players,
                known_through,
                stalled_ticks: 0,
                arriving: false,
            })
        }
        (Some(stall), Some(mut withheld)) if withheld.arriving => {
            let caught_up = clock.saturating_sub(max_delay);
            withheld.known_through = match stall.release {
                0 => caught_up,
                release => withheld
                    .known_through
                    .saturating_add(release)
                    .min(caught_up),
            };
            if withheld.known_through >= caught_up {
                debug!("{STALL_ENV_VAR}: frame {current} has every withheld turn again");
                shapes.next_withholding = current + stall.every;
                None
            } else {
                Some(withheld)
            }
        }
        (_, withheld) => withheld,
    };
    let delivered = match &withheld {
        Some(x) => Knowledge {
            clock,
            withheld: x.players,
            withheld_known_through: x.known_through,
        },
        None => Knowledge::at_clock(clock),
    };
    shapes.withheld = withheld;
    let at_start = shapes.last.unwrap_or(delivered);
    let deliver_after_steps = match shapes.mid_tick && at_start != delivered {
        true => {
            let random = next_random(&mut shapes.random);
            match random & 1 {
                0 => 0,
                _ => 1 + (random >> 1) % MAX_DELIVERY_STEP,
            }
        }
        false => 0,
    };
    let at_start = match deliver_after_steps {
        0 => delivered,
        _ => at_start,
    };
    shapes.last = Some(delivered);
    let present = current + 1 + shapes.behind.min(shapes.catch_up);
    let limit = shapes
        .stall
        .is_some()
        .then(|| crate::rollback_live::prediction_limit().max(1));
    TickShape {
        at_start,
        delivered,
        deliver_after_steps,
        present,
        limit,
    }
}

/// Notes how a tick that started from `current` went: the frame it reached, and whether it stalled
/// at the prediction limit.
pub(super) fn finish_tick(current: u32, reached: u32, stalled: bool) {
    let mut shapes = SHAPES.lock();
    let clock = current + 1 + shapes.behind;
    shapes.behind = clock.saturating_sub(reached);
    let ticks = shapes.stall.as_ref().map_or(0, |x| x.ticks);
    if stalled && let Some(withheld) = &mut shapes.withheld {
        withheld.stalled_ticks += 1;
        if withheld.stalled_ticks >= ticks && !withheld.arriving {
            debug!(
                "{STALL_ENV_VAR}: the withheld turns arrive after {} stalled ticks at frame \
                 {reached}",
                withheld.stalled_ticks,
            );
            withheld.arriving = true;
        }
    }
}

/// Frames the present is behind the clock.
pub(super) fn frames_behind() -> u32 {
    SHAPES.lock().behind
}

/// Forgets the shapes in progress, for a game (or a replay seek) starting over.
pub(super) fn reset() {
    let mut shapes = SHAPES.lock();
    shapes.behind = 0;
    shapes.withheld = None;
    shapes.next_withholding = 0;
    shapes.last = None;
}

fn next_random(state: &mut u32) -> u32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    x
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stall_spec_parses_with_and_without_its_optional_parts() {
        let spec = parse_stall("600:20").unwrap();
        assert_eq!((spec.every, spec.ticks, spec.release), (600, 20, 0));
        assert_eq!(spec.players, ALL_PLAYERS);
        let spec = parse_stall("300:5:2:0+3").unwrap();
        assert_eq!((spec.every, spec.ticks, spec.release), (300, 5, 2));
        assert_eq!(spec.players, 0b1001);
        assert!(parse_stall("0:5").is_none());
        assert!(parse_stall("300:0").is_none());
        assert!(parse_stall("300:5:2:12").is_none());
        assert!(parse_stall("300:5:2:1:9").is_none());
        assert!(parse_stall("300:5:1").is_none());
    }

    #[test]
    fn withheld_players_commands_wait_for_their_turns_and_leaves_wait_for_everyone() {
        let knowledge = Knowledge {
            clock: 100,
            withheld: 0b10,
            withheld_known_through: 90,
        };
        let (zero, one) = (StormPlayerId(0), StormPlayerId(1));
        assert!(knowledge.knows(zero, false, 100, 0, 3));
        assert!(!knowledge.knows(zero, false, 98, 3, 3));
        assert!(knowledge.knows(one, false, 90, 0, 3));
        assert!(!knowledge.knows(one, false, 91, 0, 3));
        assert_eq!(knowledge.known_until(3), 90);
        assert!(knowledge.knows(zero, true, 90, 0, 3));
        assert!(!knowledge.knows(zero, true, 91, 0, 3));
        assert_eq!(Knowledge::at_clock(100).known_until(3), 97);
    }
}
