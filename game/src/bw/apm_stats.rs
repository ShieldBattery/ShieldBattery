use crate::bw::commands;

/// Show recent APM as a APM of sliding window of 15 seconds.
/// Collect action count from 24 frames (~1 sec on fastest) to a "block"
/// and then calculate APM based on last 15 of those blocks.
///
/// Not necessarily same what SC:R does by default.
const RECENT_ACTIONS_BLOCK_SIZE: usize = 24;
const RECENT_ACTIONS_BLOCKS: usize = 15;

pub struct ApmStats {
    per_player: [PlayerApm; 8],
    shared: SharedState,
}

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
        }
    }

    pub fn new_frame(&mut self) {
        self.shared.total_frames = self.shared.total_frames.saturating_add(1);
        if self.shared.total_frames % RECENT_ACTIONS_BLOCK_SIZE as u32 == 0 {
            self.shared.recent_actions_pos += 1;
            if self.shared.recent_actions_pos >= RECENT_ACTIONS_BLOCKS + 1 {
                self.shared.recent_actions_pos = 0;
            }
            let pos = self.shared.recent_actions_pos;
            for player_apm in &mut self.per_player {
                player_apm.recent_actions[pos] = 0;
            }
        }
    }

    pub fn action(&mut self, player: u8, bytes: &[u8]) {
        // TODO maybe make this to commands::is_game_action(bytes) ?
        // But this currently doesn't ignore lobby commands (Assuming they don't get sent here?)
        let process = bytes.get(0).copied()
            .filter(|&id| match id {
                commands::id::NOP | commands::id::SYNC | commands::id::SET_TURN_RATE |
                    commands::id::SET_NETWORK_SPEED | commands::id::SET_LATENCY |
                    commands::id::CHAT => false,
                _ => true,
            })
            .is_some();
        if !process {
            return;
        }
        let player_apm = match self.per_player.get_mut(player as usize) {
            Some(s) => s,
            None => return,
        };

        player_apm.total_actions = player_apm.total_actions.saturating_add(1);
        let pos = self.shared.recent_actions_pos;
        player_apm.recent_actions[pos] = player_apm.recent_actions[pos].saturating_add(1);
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
