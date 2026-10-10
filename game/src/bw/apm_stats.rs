use std::collections::VecDeque;

use crate::bw::commands;

/// Show recent APM as a APM of sliding window of 15 seconds.
/// Collect action count from 24 frames (~1 sec on fastest) to a "block"
/// and then calculate APM based on last 15 of those blocks.
///
/// Not necessarily same what SC:R does by default.
const RECENT_ACTIONS_BLOCK_SIZE: usize = 24;
const RECENT_ACTIONS_BLOCKS: usize = 15;

#[derive(Clone)]
pub struct ApmStats {
    per_player: [PlayerApm; 8],
    shared: SharedState,
    /// For each player, the steps whose actions were counted, in a game that simulates steps
    /// again when turns arrive late (see [`ApmStats::counts_turn`]), the newest
    /// [`COUNTED_STEPS_KEPT`].
    counted_steps: [VecDeque<u32>; 8],
}

/// How many of a player's counted steps are remembered, far more than a rollback ever simulates
/// again.
const COUNTED_STEPS_KEPT: usize = 64;

#[derive(Clone)]
struct SharedState {
    total_frames: u32,
    // Index to PlayerApm.recent_actions which is currently being updated.
    recent_actions_pos: usize,
}

#[derive(Copy, Clone, Debug)]
struct PlayerApm {
    total_actions: u32,
    // The extra 1 entry is for window currently being updated.
    recent_actions: [u32; RECENT_ACTIONS_BLOCKS + 1],
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
                recent_actions: [0; RECENT_ACTIONS_BLOCKS + 1],
            }; 8],
            shared: SharedState {
                total_frames: 0,
                recent_actions_pos: 0,
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

    pub fn new_frame(&mut self) {
        self.shared.total_frames = self.shared.total_frames.saturating_add(1);
        if self
            .shared
            .total_frames
            .is_multiple_of(RECENT_ACTIONS_BLOCK_SIZE as u32)
        {
            self.shared.recent_actions_pos += 1;
            if self.shared.recent_actions_pos > RECENT_ACTIONS_BLOCKS {
                self.shared.recent_actions_pos = 0;
            }
            let pos = self.shared.recent_actions_pos;
            for player_apm in &mut self.per_player {
                player_apm.recent_actions[pos] = 0;
            }
        }
    }

    /// Counts `bytes` as an action of `player`'s, returning whether it is one.
    pub fn action(&mut self, player: u8, bytes: &[u8]) -> bool {
        // TODO maybe make this to commands::is_game_action(bytes) ?
        // But this currently doesn't ignore lobby commands (Assuming they don't get sent here?)
        let process = bytes
            .first()
            .copied()
            .filter(|&id| {
                !matches!(
                    id,
                    commands::id::NOP
                        | commands::id::SYNC
                        | commands::id::SET_TURN_RATE
                        | commands::id::SET_NETWORK_SPEED
                        | commands::id::SET_LATENCY
                        | commands::id::CHAT
                )
            })
            .is_some();
        if !process {
            return false;
        }
        let player_apm = match self.per_player.get_mut(player as usize) {
            Some(s) => s,
            None => return false,
        };

        player_apm.total_actions = player_apm.total_actions.saturating_add(1);
        let pos = self.shared.recent_actions_pos;
        player_apm.recent_actions[pos] = player_apm.recent_actions[pos].saturating_add(1);
        true
    }

    pub fn player_recent_apm(&self, player: u8) -> u32 {
        let player_apm = match self.per_player.get(player as usize) {
            Some(s) => s,
            None => return 0,
        };
        let mut sum = 0u32;
        let mut frames = 0u32;
        let filled_blocks = ((self.shared.total_frames as usize) / RECENT_ACTIONS_BLOCK_SIZE + 1)
            .min(player_apm.recent_actions.len());
        for i in 0..filled_blocks {
            sum = sum.saturating_add(player_apm.recent_actions[i]);
            if i == self.shared.recent_actions_pos {
                // Clamp frames here to multiple of to 8 so that the ui doesn't fluctuate too
                // much when the players issue commands infrequently.
                // Bit weird but looks better than having it show the exact value every frame.
                // Could also just reduce block size to 8 i guess.
                let amount = self.shared.total_frames % RECENT_ACTIONS_BLOCK_SIZE as u32;
                frames = frames.saturating_add(amount & !7);
            } else {
                frames = frames.saturating_add(RECENT_ACTIONS_BLOCK_SIZE as u32);
            }
        }
        // TODO: Hardcoded for fastest game speed (mostly fine as SB does not support other speeds)
        let ms_per_frame = 42;
        let frames_per_minute = 60000 / ms_per_frame;
        (sum as f32 * (frames_per_minute as f32 / frames as f32)).round() as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
