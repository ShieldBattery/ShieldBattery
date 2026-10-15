use std::collections::VecDeque;

use crate::bw::commands;

/// How long one game frame lasts at Fastest, in milliseconds, which is the speed every
/// ShieldBattery game is played at. Rates are measured in game time, so a paused game, a replay
/// played fast and a stretch simulated again after a late turn all count the same as the game they
/// show.
const FRAME_MS: f64 = 42.0;

/// How many game frames make a minute.
const FRAMES_PER_MINUTE: f64 = 60_000.0 / FRAME_MS;

/// The time constant of each of the current rate's two stages, in game frames. Together they weigh
/// an action by how long ago it was made, its weight peaking this long after and averaging twice
/// this: about 20 seconds, short enough that a fight shows as a rise a watcher can see, long enough
/// that one burst of clicks doesn't throw the number around.
const RECENT_TIME_CONSTANT_FRAMES: f64 = 10_000.0 / FRAME_MS;

/// How long the game has to have run before its average rate means anything: a second.
const AVERAGE_MIN_FRAMES: u32 = 24;

/// Counts each player's actions, for their average rate over the game and their current rate.
///
/// The current rate is an exponentially weighted average of the player's actions over game time,
/// run twice: once, every action would bump the number the moment it is made and the number would
/// sag between actions, a sawtooth a watcher reads as noise; run twice, it rises and falls smoothly
/// through the same average. A weighted average starting from nothing reads low until it has
/// filled, so it is divided by the same filter's response to a steady one action per frame since
/// the game began: what is left is a rate, fair from the game's first second.
#[derive(Clone)]
pub struct ApmStats {
    per_player: [PlayerApm; 8],
    /// Game frames counted so far.
    total_frames: u32,
    /// The filter's response to one action every frame since the game began, at both stages.
    reference: Smoothed,
    /// For each player, the steps whose actions were counted, in a game that simulates steps
    /// again when turns arrive late (see [`ApmStats::counts_turn`]), the newest
    /// [`COUNTED_STEPS_KEPT`].
    counted_steps: [VecDeque<u32>; 8],
}

/// How many of a player's counted steps are remembered, far more than a rollback ever simulates
/// again.
const COUNTED_STEPS_KEPT: usize = 64;

#[derive(Copy, Clone, Debug, Default)]
struct PlayerApm {
    total_actions: u32,
    recent: Smoothed,
}

/// A count of actions put through the two stages of the current rate's average.
#[derive(Copy, Clone, Debug, Default)]
struct Smoothed {
    /// Actions, each weighted down by how long ago it was made.
    first: f64,
    /// The first stage, averaged over time the same way.
    second: f64,
}

impl Smoothed {
    /// Moves on by one frame, whose actions have been added to [`first`](Self::first).
    fn step(&mut self) {
        let keep = (-1.0 / RECENT_TIME_CONSTANT_FRAMES).exp();
        self.second = self.second * keep + self.first * (1.0 - keep);
        self.first *= keep;
    }
}

impl ApmStats {
    /// Allocations owned by these statistics, excluding the struct itself.
    pub(crate) fn heap_bytes(&self) -> usize {
        self.counted_steps
            .iter()
            .map(|steps| steps.capacity() * size_of::<u32>())
            .sum()
    }

    pub const fn new() -> ApmStats {
        ApmStats {
            per_player: [PlayerApm {
                total_actions: 0,
                recent: Smoothed {
                    first: 0.0,
                    second: 0.0,
                },
            }; 8],
            total_frames: 0,
            reference: Smoothed {
                first: 0.0,
                second: 0.0,
            },
            counted_steps: [const { VecDeque::new() }; 8],
        }
    }

    /// Whether the actions of `player`'s turn at `step` are still to be counted, in a game that
    /// simulates a step again when a turn for it arrives late. A step runs on an empty stand-in
    /// for a turn that hasn't arrived, so the first simulation of a step to run any of the
    /// player's actions is the one running their real turn, whether that is the step's first
    /// simulation or a later one; every later simulation runs the same actions again. Steps are
    /// told apart one by one: a backlog of turns arriving during a tick can have a later step run
    /// its real turn before the earlier ones are simulated again.
    pub fn counts_turn(&self, player: u8, step: u32) -> bool {
        self.counted_steps
            .get(player as usize)
            .is_some_and(|counted| !counted.contains(&step))
    }

    /// Notes that `player`'s turn at `step` had actions, which were counted.
    pub fn counted_turn(&mut self, player: u8, step: u32) {
        if let Some(counted) = self.counted_steps.get_mut(player as usize) {
            if counted.len() == COUNTED_STEPS_KEPT {
                counted.pop_front();
            }
            counted.push_back(step);
        }
    }

    /// Moves on by one game frame, closing the frame whose actions have just been counted.
    pub fn new_frame(&mut self) {
        self.total_frames = self.total_frames.saturating_add(1);
        self.reference.first += 1.0;
        self.reference.step();
        for player_apm in &mut self.per_player {
            player_apm.recent.step();
        }
    }

    /// Counts `bytes` as an action of `player`'s, returning whether it is one.
    pub fn action(&mut self, player: u8, bytes: &[u8]) -> bool {
        if !bytes.first().is_some_and(|&id| is_player_action(id)) {
            return false;
        }
        let player_apm = match self.per_player.get_mut(player as usize) {
            Some(s) => s,
            None => return false,
        };

        player_apm.total_actions = player_apm.total_actions.saturating_add(1);
        player_apm.recent.first += 1.0;
        true
    }

    /// A player's actions per minute over every frame counted so far, or `None` before a whole
    /// second of the game has been counted.
    pub fn player_average_apm(&self, player: u8) -> Option<u32> {
        let player_apm = self.per_player.get(player as usize)?;
        if self.total_frames < AVERAGE_MIN_FRAMES {
            return None;
        }
        let minutes = f64::from(self.total_frames) / FRAMES_PER_MINUTE;
        Some((f64::from(player_apm.total_actions) / minutes).round() as u32)
    }

    /// A player's actions per minute lately, weighted toward the last few tens of seconds.
    pub fn player_recent_apm(&self, player: u8) -> u32 {
        let Some(player_apm) = self.per_player.get(player as usize) else {
            return 0;
        };
        if self.reference.second <= 0.0 {
            return 0;
        }
        let per_frame = player_apm.recent.second / self.reference.second;
        (per_frame * FRAMES_PER_MINUTE).round() as u32
    }
}

/// Whether a command with this id is something a player does to play the game, which is what APM
/// counts.
///
/// Left out: what the game and the network send on a player's behalf (keep-alives, sync, latency,
/// turn rate and network speed), what a player says rather than does (chat and minimap pings), what
/// changes the game around the match rather than playing it (alliances, shared vision, game speed,
/// pausing, cheats, saving, loading, restarting, opening the game), leaving, and a replay's own
/// controls.
fn is_player_action(id: u8) -> bool {
    !matches!(
        id,
        commands::id::NOP
            | commands::id::SYNC
            | commands::id::SET_TURN_RATE
            | commands::id::SET_NETWORK_SPEED
            | commands::id::SET_LATENCY
            | commands::id::CHAT
            | commands::id::MINIMAP_PING
            | commands::id::ALLIANCE
            | commands::id::VISION
            | commands::id::GAME_SPEED
            | commands::id::PAUSE
            | commands::id::RESUME
            | commands::id::CHEAT
            | commands::id::SAVE_GAME
            | commands::id::LOAD_GAME
            | commands::id::RESTART_GAME
            | commands::id::MAKE_GAME_PUBLIC
            | commands::id::LEAVE_GAME
            | commands::id::REPLAY_SPEED
            | commands::id::REPLAY_SEEK
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Setting alliances and vision from the alliances screen is not playing the game, so a player
    /// who does it a few times mid-fight keeps the rate their hands earned.
    #[test]
    fn alliance_and_vision_changes_are_not_actions() {
        let mut apm = ApmStats::new();
        assert!(!apm.action(1, &[commands::id::ALLIANCE, 0x44, 0, 0x40, 0]));
        assert!(!apm.action(1, &[commands::id::VISION, 0x0a, 0]));
        assert!(apm.action(1, MOVE));
        assert_eq!(apm.per_player[1].total_actions, 1);
    }

    const MOVE: &[u8] = &[0x14, 0, 0];

    /// What the command hook does with one turn of a game that simulates steps again.
    fn run_turn(apm: &mut ApmStats, player: u8, step: u32, commands: &[&[u8]]) {
        if !apm.counts_turn(player, step) {
            return;
        }
        let mut counted = false;
        for command in commands {
            counted |= apm.action(player, command);
        }
        if counted {
            apm.counted_turn(player, step);
        }
    }

    #[test]
    fn a_step_simulated_again_counts_each_turn_once() {
        let mut apm = ApmStats::new();
        run_turn(&mut apm, 1, 5, &[MOVE, MOVE]);
        // Step 6 runs on the empty stand-in for a turn that hasn't arrived.
        run_turn(&mut apm, 1, 6, &[&[commands::id::NOP]]);
        // The turn for step 6 arrives late, and steps 5 and 6 are simulated again.
        run_turn(&mut apm, 1, 5, &[MOVE, MOVE]);
        run_turn(&mut apm, 1, 6, &[MOVE]);
        // Another player's late turn has steps 5 and 6 simulated once more.
        run_turn(&mut apm, 1, 5, &[MOVE, MOVE]);
        run_turn(&mut apm, 1, 6, &[MOVE]);
        assert_eq!(apm.per_player[1].total_actions, 3);
    }

    #[test]
    fn a_step_running_its_real_turn_after_a_later_one_still_counts() {
        let mut apm = ApmStats::new();
        // Steps 7 to 9 ran on stand-ins; their turns and step 10's arrive during a tick, after it
        // chose how far back to roll, so step 10 runs its real turn before they run theirs.
        run_turn(&mut apm, 1, 10, &[MOVE]);
        for step in 7..10 {
            run_turn(&mut apm, 1, step, &[MOVE]);
        }
        run_turn(&mut apm, 1, 10, &[MOVE]);
        assert_eq!(apm.per_player[1].total_actions, 4);
    }

    #[test]
    fn the_average_rate_spreads_every_action_over_the_whole_game() {
        let mut apm = ApmStats::new();
        assert_eq!(apm.player_average_apm(0), None);
        // Two minutes of fastest-speed frames, with 300 actions in the first of them and none in
        // the second.
        for frame in 0..2857 {
            if frame < 300 {
                apm.action(0, MOVE);
            }
            apm.new_frame();
        }
        assert_eq!(apm.player_average_apm(0), Some(150));
        assert_eq!(apm.player_average_apm(1), Some(0));
    }

    /// Runs `frames` frames with an action every `every` frames, or none when `every` is 0,
    /// returning the current rate after each frame.
    fn play(apm: &mut ApmStats, frames: u32, every: u32) -> Vec<u32> {
        (0..frames)
            .map(|frame| {
                if every != 0 && frame % every == 0 {
                    apm.action(0, MOVE);
                }
                apm.new_frame();
                apm.player_recent_apm(0)
            })
            .collect()
    }

    /// An action every 6 frames at Fastest is 238 a minute.
    const STEADY_APM: f64 = FRAMES_PER_MINUTE / 6.0;

    /// A player keeping a steady pace reads at that pace, and from early on rather than climbing
    /// toward it for the first minute.
    #[test]
    fn a_steady_pace_reads_as_itself_from_the_start() {
        let mut apm = ApmStats::new();
        let rates = play(&mut apm, 4 * 60 * 24, 6);
        // Ten seconds in.
        let early = f64::from(rates[240]);
        assert!((early - STEADY_APM).abs() / STEADY_APM < 0.05, "{early}");
        let settled = f64::from(*rates.last().unwrap());
        assert!(
            (settled - STEADY_APM).abs() / STEADY_APM < 0.02,
            "{settled}"
        );
    }

    /// Steady clicking reads as a steady number: the individual actions don't show through as a
    /// sawtooth.
    #[test]
    fn steady_clicking_reads_steadily() {
        let mut apm = ApmStats::new();
        let rates = play(&mut apm, 3 * 60 * 24, 6);
        let last_second = &rates[rates.len() - 24..];
        let (low, high) = (
            last_second.iter().min().unwrap(),
            last_second.iter().max().unwrap(),
        );
        assert!(high - low <= 2, "{low}..{high}");
    }

    /// A fight's burst of actions eases out of the rate rather than dropping off a ledge, and is
    /// mostly gone a minute later.
    #[test]
    fn a_burst_fades_smoothly() {
        let mut apm = ApmStats::new();
        play(&mut apm, 60 * 24, 6);
        let peak = apm.player_recent_apm(0);
        let fading = play(&mut apm, 60 * 24, 0);
        for pair in fading.windows(2) {
            assert!(pair[1] <= pair[0], "rose while idle: {pair:?}");
            assert!(pair[0] - pair[1] <= 2, "dropped off a ledge: {pair:?}");
        }
        assert!(f64::from(*fading.last().unwrap()) < f64::from(peak) * 0.1);
    }

    #[test]
    fn nothing_is_read_before_the_game_has_run() {
        let apm = ApmStats::new();
        assert_eq!(apm.player_recent_apm(0), 0);
    }
}
