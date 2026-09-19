//! The shell's own scenario: a frame with no screen of its own, for walking through the modal
//! stack, the input capture and the native dialog replacements.
//!
//! The observer panel set does not exist yet, so the one ambient surface the shell can put on screen
//! stands in for it: with the network-stats panel up and the mode set to observing, a frame here is
//! an ambient panel under whatever modal the native dialogs raise.

use overlay_ui::options::{OptionsSection, OptionsView};
use serde::{Deserialize, Serialize};

use crate::knobs::Knobs as AllKnobs;
use crate::scenarios::netstat;

/// The shell scenario's own knobs.
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    /// Whether an ambient panel is on screen under the modal layer.
    pub ambient_panel: bool,
    /// Whether the options screen is on the modal stack. Raised by the shell rather than by a
    /// native dialog, the way the in-game menu's own Options button raises it.
    pub options_open: bool,
    /// Which page of the options screen the shell is put on.
    pub options_section: OptionsSection,
    /// The settings the emulated host reports, standing in for what the game holds.
    pub options: OptionsView,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            ambient_panel: true,
            options_open: false,
            options_section: OptionsSection::default(),
            options: OptionsView::default(),
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
    /// The options screen over the menu that opens it, on one of its pages.
    Options(OptionsSection),
}

impl Preset {
    pub const ALL: [Preset; 7] = [
        Preset::Observer,
        Preset::GameMenu,
        Preset::ChatHistory,
        Preset::Options(OptionsSection::Gameplay),
        Preset::Options(OptionsSection::Input),
        Preset::Options(OptionsSection::Sound),
        Preset::Options(OptionsSection::Video),
    ];

    pub fn label(self) -> String {
        match self {
            Preset::Observer => "observer".to_string(),
            Preset::GameMenu => "game-menu".to_string(),
            Preset::ChatHistory => "chat-history".to_string(),
            Preset::Options(section) => format!("options-{}", section.slug()),
        }
    }

    /// Selects this preset's host state as well as its own knobs: a modal here is raised by a native
    /// dialog spawning, which is host state rather than anything the scenario owns.
    pub fn apply(self, knobs: &mut AllKnobs) {
        // The options screen stacks over the menu it is opened from, so the menu comes up under it.
        knobs.host.game_menu_spawned = matches!(self, Preset::GameMenu | Preset::Options(_));
        knobs.host.chat_history_spawned = matches!(self, Preset::ChatHistory);
        knobs.host.mode = overlay_ui::shell::Mode::Observing;
        knobs.shell.ambient_panel = matches!(self, Preset::Observer);
        knobs.shell.options_open = matches!(self, Preset::Options(_));
        if let Preset::Options(section) = self {
            knobs.shell.options_section = section;
        }
    }
}

/// Brings the shell's modal stack in line with the options knob, the way the in-game menu's own
/// Options button brings it in line with a click.
pub fn sync_options_modal(knobs: &Knobs, shell: &mut overlay_ui::shell::Shell) {
    use overlay_ui::shell::ModalId;

    let open = shell.open_modals().any(|modal| modal == ModalId::Options);
    if knobs.options_open && !open {
        shell.open_modal(ModalId::Options);
        // Only as the screen comes up: after that the nav inside it owns which page is on, and a
        // knob re-applied every frame would take every click straight back.
        shell.set_options_section(knobs.options_section);
    } else if !knobs.options_open && open {
        shell.close_modal(ModalId::Options);
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
    ui.add_space(8.0);
    changed |= ui
        .checkbox(&mut knobs.options_open, "options")
        .on_hover_text(
            "Raises the options screen the way the in-game menu's own Options button raises it.",
        )
        .changed();
    ui.horizontal_wrapped(|ui| {
        ui.label("section:");
        for section in OptionsSection::ALL {
            changed |= ui
                .selectable_value(&mut knobs.options_section, section, section.slug())
                .changed();
        }
    });
    ui.label("What the emulated host reports the game's settings as:");
    for (label, value) in [
        ("music", &mut knobs.options.music_on),
        ("hd graphics", &mut knobs.options.hd_graphics_on),
        ("apm alert", &mut knobs.options.apm_alert_on),
        (
            "custom mouse sensitivity",
            &mut knobs.options.mouse_sensitivity_on,
        ),
    ] {
        changed |= ui.checkbox(value, label).changed();
    }
    changed
}
