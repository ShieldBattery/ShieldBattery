//! The shell's own scenario: a frame with no screen of its own, for walking through the modal
//! stack, the input capture and the native dialog replacements.
//!
//! The observer panel set does not exist yet, so the one ambient surface the shell can put on screen
//! stands in for it: with the network-stats panel up and the mode set to observing, a frame here is
//! an ambient panel under whatever modal the native dialogs raise.

use serde::{Deserialize, Serialize};

use crate::knobs::Knobs as AllKnobs;
use crate::scenarios::netstat;

/// The shell scenario's own knobs.
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    /// Whether an ambient panel is on screen under the modal layer.
    pub ambient_panel: bool,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            ambient_panel: true,
        }
    }
}

/// A one-click state of the shell.
#[derive(Clone, Copy)]
pub enum Preset {
    /// Observing, with an ambient panel up and nothing modal over it.
    Observer,
    /// The in-game menu's replacement, raised the way its native dialog spawning raises it.
    GameMenu,
    /// The chat log's replacement, raised the same way.
    ChatHistory,
}

impl Preset {
    pub const ALL: [Preset; 3] = [Preset::Observer, Preset::GameMenu, Preset::ChatHistory];

    pub fn label(self) -> &'static str {
        match self {
            Preset::Observer => "observer",
            Preset::GameMenu => "game-menu",
            Preset::ChatHistory => "chat-history",
        }
    }

    /// Selects this preset's host state as well as its own knobs: a modal here is raised by a native
    /// dialog spawning, which is host state rather than anything the scenario owns.
    pub fn apply(self, knobs: &mut AllKnobs) {
        knobs.host.game_menu_spawned = matches!(self, Preset::GameMenu);
        knobs.host.chat_history_spawned = matches!(self, Preset::ChatHistory);
        knobs.host.mode = overlay_ui::shell::Mode::Observing;
        knobs.shell.ambient_panel = matches!(self, Preset::Observer);
    }
}

/// The ambient panel this scenario puts under the modal layer, if any.
pub fn ambient_view(
    knobs: &Knobs,
    netstat_knobs: &netstat::Knobs,
) -> Option<overlay_ui::netstat::NetStatsView> {
    knobs
        .ambient_panel
        .then(|| netstat::build_view(netstat_knobs))
}

/// The scenario's knob section. Returns whether anything changed.
pub fn knobs_ui(knobs: &mut Knobs, ui: &mut egui::Ui) -> bool {
    let mut changed = false;
    ui.label(
        "Nothing here is a screen of its own: the modals come from the native dialogs in the \
         emulated host section above, and the ambient panel stands in for the observer panel set.",
    );
    ui.add_space(4.0);
    changed |= ui
        .checkbox(&mut knobs.ambient_panel, "ambient panel")
        .on_hover_text("Puts the network-stats panel on screen under the modal layer.")
        .changed();
    changed
}
