//! The in-game chat history scenario.
//!
//! The log is a modal the chat-history dialog's replacement raises, so selecting this scenario also
//! spawns that dialog in the emulated host — otherwise the screen would have nothing to draw on.
//!
//! Lines are synthesized deterministically from the knobs, so the same knob settings always produce
//! the same screen and an offline render is reproducible. The switches are the things that decide
//! how a line lays out rather than what it says: who it came from, who it went to, how long it runs,
//! and whether it carries BW's inline color codes.

use egui::vec2;
use overlay_ui::chat_history::{ChatHistoryView, ChatLineKindView, ChatLineView, ChatScopeView};
use overlay_ui::kit::theme;
use serde::{Deserialize, Serialize};

use crate::knobs::Knobs as AllKnobs;

/// The senders lines are dealt out to, with the slot each takes its color from. The local player is
/// first, so a peer's line is never dealt their name and the accent tag stays a reliable read of
/// whose line it is.
const SENDERS: [&str; 4] = ["tec27", "Zerglot", "a-very-long-player-name", "pachi"];

/// Which of [`SENDERS`] the local player is.
const LOCAL_SENDER: usize = 0;

/// The messages the generator cycles through. Short enough that a line fits on one row, which is
/// what makes the long-line and color-code knobs worth having.
const MESSAGES: [&str; 6] = [
    "gl hf",
    "watch the drop",
    "he is going for a fast expand",
    "nice one",
    "scout top right",
    "gg",
];

/// A message long enough to wrap several times, for checking the hanging indent.
const LONG_MESSAGE: &str = "i think they are massing carriers behind the natural, we should push \
     now before the fleet beacon finishes or we will not get another window this game";

/// A message carrying BW's own inline color codes, for checking they are read rather than drawn.
const COLORED_MESSAGE: &str =
    "\x06red \x07green \x03yellow \x02pale blue \x1dcyan \x04back to white";

/// The system notices the generator cycles through.
const SYSTEM_MESSAGES: [&str; 2] = ["pachi has left the game.", "Zerglot is allied with tec27."];

/// The chat history's emulation knobs.
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    /// How many lines the log holds. Zero draws the empty state.
    pub lines: u32,
    /// Whether the lines are dealt across every scope, or all addressed to everyone.
    pub mixed_scopes: bool,
    /// Whether some lines are the local player's own.
    pub own_messages: bool,
    /// Whether some lines are system notices rather than chat.
    pub system_lines: bool,
    /// Whether a line long enough to wrap is dealt in.
    pub long_lines: bool,
    /// Whether a line carrying BW's inline color codes is dealt in.
    pub color_codes: bool,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            lines: 18,
            mixed_scopes: true,
            own_messages: true,
            system_lines: true,
            long_lines: true,
            color_codes: true,
        }
    }
}

/// A one-click preview state: a busy game's log, a quiet one, and a game where nothing has been
/// said yet.
#[derive(Clone, Copy)]
pub enum Preset {
    Busy,
    Quiet,
    Empty,
}

impl Preset {
    pub const ALL: [Preset; 3] = [Preset::Busy, Preset::Quiet, Preset::Empty];

    pub fn label(self) -> &'static str {
        match self {
            Preset::Busy => "busy",
            Preset::Quiet => "quiet",
            Preset::Empty => "empty",
        }
    }

    /// Presets this scenario's knobs, and spawns the native dialog whose replacement the log is:
    /// the modal is raised by host state rather than by anything the scenario owns.
    pub fn apply(self, knobs: &mut AllKnobs) {
        knobs.host.chat_history_spawned = true;
        self.apply_knobs(&mut knobs.chat_history);
    }

    /// Presets only what this scenario owns, for the preset row inside its own knob section, where
    /// the dialog has already been spawned by the selector.
    pub fn apply_knobs(self, k: &mut Knobs) {
        match self {
            Preset::Busy => {
                *k = Knobs {
                    lines: 24,
                    ..Knobs::default()
                };
            }
            Preset::Quiet => {
                *k = Knobs {
                    lines: 4,
                    mixed_scopes: false,
                    own_messages: true,
                    system_lines: false,
                    long_lines: false,
                    color_codes: false,
                };
            }
            Preset::Empty => k.lines = 0,
        }
    }
}

/// Builds the view the game would hand the overlay, oldest line first.
pub fn build_view(k: &Knobs) -> ChatHistoryView {
    let lines = (0..k.lines)
        .map(|i| build_line(k, i as usize))
        .collect::<Vec<_>>();
    ChatHistoryView { lines }
}

/// Builds line `index`, dealing sender, scope and text out of the knobs by position so the log is
/// the same every time it is built.
fn build_line(k: &Knobs, index: usize) -> ChatLineView {
    // Roughly a message every twenty seconds of game time, which is what puts a readable spread of
    // stamps down the column rather than a run of identical ones.
    let game_seconds = 17 + index as u64 * 23;
    if k.system_lines && index % 7 == 6 {
        return ChatLineView {
            game_seconds,
            kind: ChatLineKindView::System,
            text: SYSTEM_MESSAGES[(index / 7) % SYSTEM_MESSAGES.len()].to_string(),
        };
    }
    let own = k.own_messages && index % 2 == 1;
    let sender = if own {
        LOCAL_SENDER
    } else {
        1 + (index / 2) % (SENDERS.len() - 1)
    };
    let text = if k.long_lines && index % 9 == 4 {
        LONG_MESSAGE.to_string()
    } else if k.color_codes && index % 9 == 2 {
        COLORED_MESSAGE.to_string()
    } else {
        MESSAGES[index % MESSAGES.len()].to_string()
    };
    ChatLineView {
        game_seconds,
        kind: ChatLineKindView::Player {
            name: SENDERS[sender].to_string(),
            color: theme::player_color(sender),
            own,
            scope: scope_for(k, index, own),
        },
        text,
    }
}

/// Which scope line `index` was sent with.
///
/// Only the local player's own directed messages name a recipient, the way the game knows them: a
/// peer's directed message reached this client because this client was one of its recipients, so
/// there is no other name to put on it.
fn scope_for(k: &Knobs, index: usize, own: bool) -> ChatScopeView {
    if !k.mixed_scopes {
        return ChatScopeView::All;
    }
    match index % 5 {
        1 => ChatScopeView::Allies,
        2 => ChatScopeView::Observers,
        3 | 4 => ChatScopeView::Players {
            recipient: (own && index % 5 == 3)
                .then(|| SENDERS[1 + (index / 2) % (SENDERS.len() - 1)].to_string()),
        },
        _ => ChatScopeView::All,
    }
}

/// The scenario's knob section. Returns whether anything changed.
pub fn knobs_ui(k: &mut Knobs, ui: &mut egui::Ui) -> bool {
    let mut changed = false;

    ui.horizontal_wrapped(|ui| {
        ui.label("Preset:");
        for preset in Preset::ALL {
            if ui.button(preset.label()).clicked() {
                preset.apply_knobs(k);
                changed = true;
            }
        }
    });

    ui.add_space(4.0);
    egui::Grid::new("chat_history_knobs")
        .num_columns(2)
        .spacing(vec2(8.0, 6.0))
        .show(ui, |ui| {
            ui.label("Lines");
            changed |= ui
                .add(egui::DragValue::new(&mut k.lines).range(0..=200))
                .changed();
            ui.end_row();
        });

    changed |= ui
        .checkbox(&mut k.mixed_scopes, "mix scopes")
        .on_hover_text("Deals allies, observers and directed messages in among the public ones.")
        .changed();
    changed |= ui
        .checkbox(&mut k.own_messages, "own messages")
        .on_hover_text("Some lines are the local player's, which wear the accent scope tag.")
        .changed();
    changed |= ui
        .checkbox(&mut k.system_lines, "system lines")
        .on_hover_text("Notices the game itself printed, which have no sender and no scope.")
        .changed();
    changed |= ui
        .checkbox(&mut k.long_lines, "long lines")
        .on_hover_text("A message long enough to wrap, for checking the hanging indent.")
        .changed();
    changed |= ui
        .checkbox(&mut k.color_codes, "color codes")
        .on_hover_text("A message carrying BW's inline color codes.")
        .changed();

    ui.add_space(4.0);
    if ui
        .button("burst new lines")
        .on_hover_text(
            "Appends five lines at the bottom, the way a busy game would. The list follows them \
             only if it was already at the bottom.",
        )
        .clicked()
    {
        k.lines = k.lines.saturating_add(5);
        changed = true;
    }

    changed
}
