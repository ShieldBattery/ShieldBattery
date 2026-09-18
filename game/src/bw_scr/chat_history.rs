//! One game's record of everything the chat put on screen, which is what the overlay's chat log
//! reads back.
//!
//! SC:R's own log is filled from the Battle.net chat pipeline, and a netcode v2 game does not use
//! that pipeline: chat rides the relay and is rendered by injecting the classic chat command, so
//! nothing ever reaches the native list and it opens empty. This store is the replacement, and its
//! one rule is that it holds exactly what the player saw — lines are appended where the game renders
//! them, past the receive-side scope filter and past the mute/block filter, so a message the screen
//! suppressed can never turn up here.
//!
//! A line keeps the frame it was said on rather than a wall-clock instant: that is the coordinate
//! the rest of the game reads, and a replay that seeks backwards re-simulates from frame 0, which
//! also re-injects every message it passes. Such a seek clears the store, so the log holds one pass
//! over the game rather than a pass per seek.

use std::collections::VecDeque;

/// How many lines one game keeps. A long game between talkative players is a few hundred lines, so
/// this is well clear of any real game while still bounding what a flood of messages can cost.
pub const MAX_LINES: usize = 1000;

/// Who a message was addressed to, as the sender chose it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatScope {
    /// Everyone in the game.
    All,
    /// The sender's allies.
    Allies,
    /// The observers.
    Observers,
    /// A named set of players.
    ///
    /// `recipient` is the one player it went to, for the local player's own messages where the set
    /// named exactly one player whose name could be resolved. A message from a peer carries none:
    /// it reached this client because this client is one of its recipients, so there is no other
    /// name to put on it, and a team-addressed message in a shared-control game reaches a whole
    /// team at once.
    Players { recipient: Option<String> },
}

/// What a line of the history is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatLineKind {
    /// Something a player said.
    Player {
        /// The sender's game player id — 0-11 for a player, 0x80-0x83 for an observer — which is
        /// what their color is looked up by.
        sender_game_id: u8,
        /// The sender's name as the game holds it.
        sender_name: String,
        /// Whether the local player sent it.
        own: bool,
        /// Who it was addressed to.
        scope: ChatScope,
    },
    /// A notice the game itself printed — a player leaving, an alliance changing.
    System,
}

/// One line of the history.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatLine {
    /// The game frame the line was said on.
    pub game_frame: u32,
    pub kind: ChatLineKind,
    /// The line's text, BW's inline color codes and all. Nothing is stripped here: what the codes
    /// mean is a question for whatever draws the line, and a store that threw them away could never
    /// answer it.
    pub text: String,
}

/// Every line said this game, oldest first.
#[derive(Default)]
pub struct ChatHistory {
    lines: VecDeque<ChatLine>,
    generation: u64,
}

impl ChatHistory {
    pub fn new() -> ChatHistory {
        ChatHistory::default()
    }

    /// How many times the history has changed, which is how a reader caches a rendering of it
    /// without comparing a thousand lines. Moves on a clear as well as on an append, so a cleared
    /// history never looks like the one that was there before it.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// The lines, oldest first.
    pub fn lines(&self) -> impl ExactSizeIterator<Item = &ChatLine> + DoubleEndedIterator {
        self.lines.iter()
    }

    /// Appends a line, dropping the oldest once the cap is reached.
    pub fn push(&mut self, line: ChatLine) {
        if self.lines.len() >= MAX_LINES {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
        self.generation = self.generation.wrapping_add(1);
    }

    /// Empties the history, for a game starting or a replay seeking back to the beginning.
    pub fn clear(&mut self) {
        self.lines.clear();
        self.generation = self.generation.wrapping_add(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(frame: u32, text: &str) -> ChatLine {
        ChatLine {
            game_frame: frame,
            kind: ChatLineKind::Player {
                sender_game_id: 0,
                sender_name: "player-a".into(),
                own: false,
                scope: ChatScope::All,
            },
            text: text.into(),
        }
    }

    #[test]
    fn lines_come_back_in_the_order_they_were_said() {
        let mut history = ChatHistory::new();
        for i in 0..3 {
            history.push(line(i, &format!("message {i}")));
        }
        let texts: Vec<_> = history.lines().map(|line| line.text.as_str()).collect();
        assert_eq!(texts, ["message 0", "message 1", "message 2"]);
    }

    #[test]
    fn the_cap_drops_the_oldest_line_rather_than_the_newest() {
        let mut history = ChatHistory::new();
        for i in 0..(MAX_LINES as u32 + 5) {
            history.push(line(i, &format!("message {i}")));
        }
        assert_eq!(history.lines().len(), MAX_LINES);
        assert_eq!(history.lines().next().unwrap().text, "message 5");
        assert_eq!(
            history.lines().next_back().unwrap().text,
            format!("message {}", MAX_LINES + 4)
        );
    }

    #[test]
    fn every_change_moves_the_generation() {
        let mut history = ChatHistory::new();
        let start = history.generation();
        history.push(line(0, "hi"));
        let appended = history.generation();
        assert_ne!(appended, start);
        history.clear();
        assert_ne!(history.generation(), appended);
        assert_eq!(history.lines().len(), 0);
    }
}
