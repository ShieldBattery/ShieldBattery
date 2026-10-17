use std::collections::VecDeque;
use std::sync::LazyLock;

use crate::bw::commands;

/// How long one game frame lasts at Fastest, in milliseconds, which is the speed every
/// ShieldBattery game is played at. Rates are measured in game time, so a paused game, a replay
/// played fast and a stretch simulated again after a late turn all count the same as the game they
/// show.
const FRAME_MS: f64 = 42.0;

/// How many game frames make a minute.
const FRAMES_PER_MINUTE: f64 = 60_000.0 / FRAME_MS;

/// How many game frames the current rate counts actions in at a time: a quarter of a second, so the
/// number answers a player's clicks while they are still making them.
const BUCKET_FRAMES: u32 = 6;

/// How many of the newest whole buckets the current rate counts in full (six seconds), and how many
/// older ones it fades out over (eighteen). Weighed together they make fifteen seconds, about what
/// BWChart's "Dynamic" window averages over: short enough that a player picking up the pace after
/// standing idle shows it within seconds, long enough that one burst of clicks doesn't throw the
/// number around.
const FULL_BUCKETS: usize = 24;
const FADING_BUCKETS: usize = 72;

/// How many buckets the current rate reaches back over.
const WINDOW_BUCKETS: usize = FULL_BUCKETS + FADING_BUCKETS;

/// How much each bucket counts toward the current rate, newest first: fully for the newest
/// [`FULL_BUCKETS`], then falling along half a cosine to nothing over [`FADING_BUCKETS`].
static BUCKET_WEIGHTS: LazyLock<[f64; WINDOW_BUCKETS]> = LazyLock::new(|| {
    std::array::from_fn(|age| match age.checked_sub(FULL_BUCKETS) {
        None => 1.0,
        Some(fading) => {
            let along = (fading as f64 + 0.5) / FADING_BUCKETS as f64;
            0.5 * (1.0 + (std::f64::consts::PI * along).cos())
        }
    })
});

/// How long the game has to have run before its average rate means anything: a second.
const AVERAGE_MIN_FRAMES: u32 = 24;

/// Counts each player's actions, for their average rate over the game and their current rate.
///
/// The current rate is a weighted average of the actions in the newest whole buckets of
/// [`BUCKET_FRAMES`] frames, after BWChart's: BWChart averages a window centered on the moment it
/// plots, which a live game can't, as half of that window hasn't happened yet, so this one trails
/// instead and reads much the same curve some seconds later.
///
/// An action never counts for more than it did when it was made (see [`BUCKET_WEIGHTS`]), so the
/// rate never rises once a player stops, as it does under a weighting that peaks some time after
/// an action. Its oldest buckets fade out rather than leave all at once, so a burst eases out of the
/// number instead of dropping off a ledge a window's length later. Counting whole buckets has the
/// number move at most once a bucket, rather than with every frame. Until the window has filled,
/// the rate is weighed over the buckets there are, so it is fair from the game's first second.
#[derive(Clone)]
pub struct ApmStats {
    per_player: [PlayerApm; 8],
    /// Game frames counted so far.
    total_frames: u32,
    /// Frames counted into the bucket still filling.
    bucket_frames: u32,
    /// Whole buckets closed so far, which the window holds the newest [`WINDOW_BUCKETS`] of.
    closed_buckets: u32,
    /// For each player, the steps whose actions were counted, in a game that simulates steps
    /// again when turns arrive late (see [`ApmStats::counts_turn`]), the newest
    /// [`COUNTED_STEPS_KEPT`].
    counted_steps: [VecDeque<u32>; 8],
}

/// How many of a player's counted steps are remembered, far more than a rollback ever simulates
/// again.
const COUNTED_STEPS_KEPT: usize = 64;

#[derive(Copy, Clone, Debug)]
struct PlayerApm {
    total_actions: u32,
    /// Actions in the bucket still filling.
    filling: u32,
    /// Actions in each of the window's buckets, the slot after the newest holding the oldest.
    window: [u32; WINDOW_BUCKETS],
}

impl PlayerApm {
    const fn new() -> PlayerApm {
        PlayerApm {
            total_actions: 0,
            filling: 0,
            window: [0; WINDOW_BUCKETS],
        }
    }

    /// Closes the bucket that was filling into the window's slot `slot`, putting the oldest out.
    fn close_bucket(&mut self, slot: usize) {
        self.window[slot] = self.filling;
        self.filling = 0;
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
            per_player: [PlayerApm::new(); 8],
            total_frames: 0,
            bucket_frames: 0,
            closed_buckets: 0,
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
        self.bucket_frames += 1;
        if self.bucket_frames < BUCKET_FRAMES {
            return;
        }
        let slot = self.closed_buckets as usize % WINDOW_BUCKETS;
        for player_apm in &mut self.per_player {
            player_apm.close_bucket(slot);
        }
        self.bucket_frames = 0;
        self.closed_buckets = self.closed_buckets.saturating_add(1);
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
        player_apm.filling = player_apm.filling.saturating_add(1);
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

    /// A player's actions per minute lately, over the last fifteen seconds or so of whole buckets,
    /// or 0 before the first bucket has closed.
    pub fn player_recent_apm(&self, player: u8) -> u32 {
        let Some(player_apm) = self.per_player.get(player as usize) else {
            return 0;
        };
        let buckets = (self.closed_buckets as usize).min(WINDOW_BUCKETS);
        if buckets == 0 {
            return 0;
        }
        let newest = self.closed_buckets as usize - 1;
        let (mut actions, mut weight) = (0.0, 0.0);
        for (age, bucket_weight) in BUCKET_WEIGHTS.iter().take(buckets).enumerate() {
            let slot = (newest - age) % WINDOW_BUCKETS;
            actions += f64::from(player_apm.window[slot]) * bucket_weight;
            weight += bucket_weight;
        }
        let frames = weight * f64::from(BUCKET_FRAMES);
        (actions * FRAMES_PER_MINUTE / frames).round() as u32
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

    /// Steady clicking reads as a steady number: the individual actions don't show through, and the
    /// number only moves as a bucket closes.
    #[test]
    fn steady_clicking_reads_steadily() {
        let mut apm = ApmStats::new();
        let rates = play(&mut apm, 3 * 60 * 24, 6);
        let last_seconds = &rates[rates.len() - 5 * 24..];
        let (low, high) = (
            last_seconds.iter().min().unwrap(),
            last_seconds.iter().max().unwrap(),
        );
        assert!(high - low <= 2, "{low}..{high}");
        let moves = last_seconds
            .windows(2)
            .filter(|pair| pair[0] != pair[1])
            .count();
        assert!(moves <= 6, "{moves} moves in five seconds");
    }

    /// The rate never rises once a player stops, after a burst far above their usual pace as much
    /// as after a steady one, and it falls away over the window's own length.
    #[test]
    fn stopping_never_raises_the_rate() {
        let mut apm = ApmStats::new();
        play(&mut apm, 60 * 24, 12);
        play(&mut apm, 10 * 24, 3);
        let window_frames = (WINDOW_BUCKETS as u32 + 1) * BUCKET_FRAMES;
        let fading = play(&mut apm, window_frames + 1, 0);
        for pair in fading.windows(2) {
            assert!(pair[1] <= pair[0], "rose while idle: {pair:?}");
        }
        assert_eq!(fading[window_frames as usize], 0);
    }

    /// A burst eases out of the rate as it ages, rather than dropping off a ledge all at once a
    /// window's length after it.
    #[test]
    fn a_burst_eases_out() {
        let mut apm = ApmStats::new();
        play(&mut apm, 60 * 24, 12);
        play(&mut apm, 10 * 24, 3);
        let easing = play(&mut apm, 60 * 24, 12);
        // The burst runs about 360 a minute over the pace around it. Leaving a fifteen-second
        // window at full weight, it would take a fifteenth of that off the rate every second.
        let per_second = easing
            .windows(24)
            .map(|second| second[0].saturating_sub(second[23]))
            .max()
            .unwrap();
        assert!(
            per_second < 20,
            "dropped off a ledge: {per_second} in a second"
        );
    }

    /// A player picking the pace back up after standing idle reads near it within fifteen seconds.
    #[test]
    fn the_pace_after_idling_shows_quickly() {
        let mut apm = ApmStats::new();
        play(&mut apm, 60 * 24, 0);
        let rates = play(&mut apm, 15 * 24, 6);
        let reached = f64::from(*rates.last().unwrap());
        assert!(reached > STEADY_APM * 0.85, "{reached}");
    }

    /// A burst shows in the rate while it lasts, rather than some time after it.
    #[test]
    fn a_burst_shows_while_it_lasts() {
        let mut apm = ApmStats::new();
        play(&mut apm, 60 * 24, 12);
        let before = apm.player_recent_apm(0);
        let during = play(&mut apm, 10 * 24, 3);
        let after = play(&mut apm, 10 * 24, 0);
        let peak_during = *during.iter().max().unwrap();
        assert!(peak_during > before + 50, "{before} -> {peak_during}");
        assert!(after.iter().all(|&rate| rate <= peak_during));
    }

    #[test]
    fn nothing_is_read_before_the_game_has_run() {
        let apm = ApmStats::new();
        assert_eq!(apm.player_recent_apm(0), 0);
    }
}
