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
//! the rest of the game reads, and the one a replay moves along when it seeks. A replay seek
//! restores a keyframe from frames already simulated, behind or ahead of where the replay is, and
//! simulates on from there, printing again every line of the frames it passes. Replays are
//! deterministic, so those frames print exactly what they printed the first time: the store keeps
//! the first pass, drops the lines of any frame it has already recorded, and shows only the lines
//! said up to the frame the replay is at. It is emptied only when the game itself starts over.

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

/// A printed chat line without the sender's name the game prints ahead of it, as `Name: words`
/// with color codes around the name. The line comes back whole when it doesn't start that way.
pub fn strip_sender_prefix<'a>(text: &'a str, sender_name: &str) -> &'a str {
    let Some(colon) = text.find(':') else {
        return text;
    };
    let printed_name: String = text[..colon].chars().filter(|c| !c.is_control()).collect();
    if printed_name.trim() == sender_name {
        text[colon + 1..].trim_start_matches(|c: char| c.is_control() || c == ' ')
    } else {
        text
    }
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
///
/// A replay's lines are also in frame order: a line is only recorded for a frame past every frame
/// already recorded, and is stamped with the frame count during that frame's step, which is the
/// frame itself or, once BW has advanced it, the one after.
#[derive(Default)]
pub struct ChatHistory {
    lines: VecDeque<ChatLine>,
    generation: u64,
    /// The last frame of a replay whose logic step has finished, so that every line it prints is
    /// already here.
    recorded_through: Option<u32>,
    /// The frame a replay's logic step in progress started from, which is the frame its lines
    /// belong to even once BW has advanced the frame count partway through the step.
    step_from: Option<u32>,
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

    /// How many of the oldest lines were said on or before `frame`: the part of a replay's history
    /// the replay has reached.
    pub fn len_through(&self, frame: u32) -> usize {
        self.lines.partition_point(|line| line.game_frame <= frame)
    }

    /// Appends a line, dropping the oldest once the cap is reached.
    pub fn push(&mut self, line: ChatLine) {
        if self.lines.len() >= MAX_LINES {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
        self.generation = self.generation.wrapping_add(1);
    }

    /// Appends a line a replay printed, unless it belongs to a frame already recorded, which a
    /// replay prints again only because a seek has it simulate that frame again.
    pub fn push_replayed(&mut self, line: ChatLine) {
        let frame = self.step_from.unwrap_or(line.game_frame);
        if self
            .recorded_through
            .is_some_and(|recorded| frame <= recorded)
        {
            return;
        }
        self.push(line);
    }

    /// Marks the start of a replay's logic step from frame count `frame`.
    pub fn begin_replay_step(&mut self, frame: u32) {
        self.step_from = Some(frame);
    }

    /// Marks the end of the replay logic step [`begin_replay_step`](Self::begin_replay_step)
    /// started, every line of whose frame has now been recorded.
    pub fn finish_replay_step(&mut self) {
        if let Some(frame) = self.step_from.take() {
            self.recorded_through = Some(self.recorded_through.map_or(frame, |x| x.max(frame)));
        }
    }

    /// Empties the history, for a game starting over.
    pub fn clear(&mut self) {
        self.lines.clear();
        self.recorded_through = None;
        self.step_from = None;
        self.generation = self.generation.wrapping_add(1);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_printed_line_loses_its_senders_name() {
        use super::strip_sender_prefix;
        assert_eq!(
            strip_sender_prefix("Blergh100: gl hf", "Blergh100"),
            "gl hf"
        );
        assert_eq!(
            strip_sender_prefix("ssjgoku: glhf: again", "ssjgoku"),
            "glhf: again"
        );
        // A line that isn't that sender's keeps everything, colon and all.
        assert_eq!(
            strip_sender_prefix("Note: something", "ssjgoku"),
            "Note: something"
        );
        assert_eq!(strip_sender_prefix("no colon", "ssjgoku"), "no colon");
    }

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

    /// What a replay says during its frames' command handling: each frame and the line said on it.
    const REPLAY_CHAT: [(u32, &str); 4] = [(5, "gl"), (20, "hf"), (20, "again"), (40, "gg")];

    /// Plays the replay's frames `from..to` the way the hooks record them: each frame's lines are
    /// printed as its commands run, then its logic step runs.
    fn play(history: &mut ChatHistory, from: u32, to: u32) {
        for frame in from..to {
            for &(_, text) in REPLAY_CHAT.iter().filter(|x| x.0 == frame) {
                history.push_replayed(line(frame, text));
            }
            history.begin_replay_step(frame);
            history.finish_replay_step();
        }
    }

    /// The lines a replay at frame count `frame` shows.
    fn shown(history: &ChatHistory, frame: u32) -> Vec<&str> {
        history
            .lines()
            .take(history.len_through(frame))
            .map(|line| line.text.as_str())
            .collect()
    }

    #[test]
    fn a_replay_seeking_back_hides_the_lines_after_it() {
        let mut history = ChatHistory::new();
        play(&mut history, 0, 50);
        assert_eq!(shown(&history, 50), ["gl", "hf", "again", "gg"]);
        assert_eq!(shown(&history, 20), ["gl", "hf", "again"]);
        assert_eq!(shown(&history, 19), ["gl"]);
        assert_eq!(shown(&history, 0), Vec::<&str>::new());
    }

    #[test]
    fn a_replay_playing_through_recorded_frames_again_says_nothing_twice() {
        let mut history = ChatHistory::new();
        play(&mut history, 0, 30);
        let generation = history.generation();
        // Back to a keyframe at frame 10, and on past where the first pass got to.
        play(&mut history, 10, 30);
        assert_eq!(history.generation(), generation);
        play(&mut history, 30, 50);
        assert_eq!(shown(&history, 50), ["gl", "hf", "again", "gg"]);
    }

    #[test]
    fn a_replay_jumping_forward_over_recorded_frames_shows_what_they_said() {
        let mut history = ChatHistory::new();
        play(&mut history, 0, 50);
        // Back to the start, then forward to a keyframe at frame 30.
        play(&mut history, 0, 3);
        assert_eq!(shown(&history, 3), Vec::<&str>::new());
        play(&mut history, 30, 50);
        assert_eq!(shown(&history, 30), ["gl", "hf", "again"]);
        assert_eq!(shown(&history, 50), ["gl", "hf", "again", "gg"]);
    }

    #[test]
    fn a_line_printed_after_the_frame_count_advanced_belongs_to_its_step() {
        let mut history = ChatHistory::new();
        play(&mut history, 0, 10);
        history.begin_replay_step(10);
        history.push_replayed(line(11, "late in the step"));
        history.finish_replay_step();
        // Back to frame 10: its step prints the line again, and frame 11's commands are new.
        history.begin_replay_step(10);
        history.push_replayed(line(11, "late in the step"));
        history.finish_replay_step();
        history.push_replayed(line(11, "on frame 11"));
        assert_eq!(
            shown(&history, 11),
            ["gl", "late in the step", "on frame 11"]
        );
    }

    #[test]
    fn a_replay_starting_over_records_everything_again() {
        let mut history = ChatHistory::new();
        play(&mut history, 0, 50);
        history.clear();
        play(&mut history, 0, 50);
        assert_eq!(shown(&history, 50), ["gl", "hf", "again", "gg"]);
    }

    #[test]
    fn a_live_game_keeps_every_line() {
        let mut history = ChatHistory::new();
        history.push(line(20, "hf"));
        history.push(line(20, "hf"));
        history.push(line(5, "said while frame 5 was shown again"));
        let texts: Vec<_> = history.lines().map(|line| line.text.as_str()).collect();
        assert_eq!(texts, ["hf", "hf", "said while frame 5 was shown again"]);
    }
}
