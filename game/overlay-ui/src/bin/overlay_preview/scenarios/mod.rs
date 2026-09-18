//! The set of overlay states the preview can put on the emulated screen.
//!
//! Exactly one scenario is active at a time, matching the game: a screen is either up or it isn't,
//! and stacking two of them would hide whichever anchors to the same corner.
//!
//! A scenario's job is to build the view-models the shell draws from, not to draw them: the shell
//! decides which of them is modal, what the frame takes of the player's input and which rects it
//! owns, exactly as it does in the game. The kitchen sink is the exception, being a specimen sheet
//! of the kit rather than a screen the game ever shows.

pub mod chat_history;
pub mod disconnect;
pub mod kitchen_sink;
pub mod netstat;
pub mod shell;

use egui::Context;
use overlay_ui::shell::{
    DisconnectSurface, HitRect, InputCapture, Intent, ModalId, NativeDialog, Shell, Views,
};
use serde::{Deserialize, Serialize};

use crate::host_knobs;
use crate::knobs::Knobs;

/// Which overlay the emulated screen is showing.
#[derive(Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum ScenarioKind {
    #[default]
    Disconnect,
    NetStat,
    ChatHistory,
    Shell,
    KitchenSink,
}

impl ScenarioKind {
    pub const ALL: [ScenarioKind; 5] = [
        ScenarioKind::Disconnect,
        ScenarioKind::NetStat,
        ScenarioKind::ChatHistory,
        ScenarioKind::Shell,
        ScenarioKind::KitchenSink,
    ];

    pub fn label(self) -> &'static str {
        match self {
            ScenarioKind::Disconnect => "Disconnect",
            ScenarioKind::NetStat => "Network stats",
            ScenarioKind::ChatHistory => "Chat history",
            ScenarioKind::Shell => "Shell",
            ScenarioKind::KitchenSink => "Kitchen sink",
        }
    }

    /// The name this scenario takes in a rendered file name.
    pub fn slug(self) -> &'static str {
        match self {
            ScenarioKind::Disconnect => "disconnect",
            ScenarioKind::NetStat => "netstat",
            ScenarioKind::ChatHistory => "chat-history",
            ScenarioKind::Shell => "shell",
            ScenarioKind::KitchenSink => "kitchen-sink",
        }
    }
}

/// One named state of one scenario, as the offline renderer walks them.
#[derive(Clone, Copy)]
pub enum Preset {
    Disconnect(disconnect::Preset),
    NetStat(netstat::Preset),
    ChatHistory(chat_history::Preset),
    Shell(shell::Preset),
    KitchenSink(kitchen_sink::Preset),
}

impl Preset {
    pub fn kind(self) -> ScenarioKind {
        match self {
            Preset::Disconnect(_) => ScenarioKind::Disconnect,
            Preset::NetStat(_) => ScenarioKind::NetStat,
            Preset::ChatHistory(_) => ScenarioKind::ChatHistory,
            Preset::Shell(_) => ScenarioKind::Shell,
            Preset::KitchenSink(_) => ScenarioKind::KitchenSink,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Preset::Disconnect(preset) => preset.label(),
            Preset::NetStat(preset) => preset.label(),
            Preset::ChatHistory(preset) => preset.label(),
            Preset::Shell(preset) => preset.label(),
            Preset::KitchenSink(preset) => preset.label(),
        }
    }

    /// Selects this preset's scenario and presets its knobs.
    pub fn apply(self, knobs: &mut Knobs) {
        knobs.scenario = self.kind();
        match self {
            Preset::Disconnect(preset) => preset.apply(&mut knobs.disconnect),
            Preset::NetStat(preset) => preset.apply(&mut knobs.netstat),
            Preset::ChatHistory(preset) => preset.apply(knobs),
            Preset::Shell(preset) => preset.apply(knobs),
            Preset::KitchenSink(preset) => preset.apply(&mut knobs.kitchen_sink),
        }
    }
}

/// The presets that are also rendered offline in the pseudolocale: one per screen that draws
/// translated strings, picked as the busiest state each one has, since that is where long text runs
/// out of room first. The kitchen sink is left out — it is a specimen sheet of the kit, not a screen
/// whose copy is translated.
pub const PSEUDOLOCALE_PRESETS: [Preset; 4] = [
    Preset::Disconnect(disconnect::Preset::Droppable),
    Preset::NetStat(netstat::Preset::Degraded),
    Preset::ChatHistory(chat_history::Preset::Busy),
    Preset::Shell(shell::Preset::GameMenu),
];

/// Every scenario preset, in selector order.
pub fn all_presets() -> Vec<Preset> {
    disconnect::Preset::ALL
        .into_iter()
        .map(Preset::Disconnect)
        .chain(netstat::Preset::ALL.into_iter().map(Preset::NetStat))
        .chain(
            chat_history::Preset::ALL
                .into_iter()
                .map(Preset::ChatHistory),
        )
        .chain(shell::Preset::ALL.into_iter().map(Preset::Shell))
        .chain(
            kitchen_sink::Preset::ALL
                .into_iter()
                .map(Preset::KitchenSink),
        )
        .collect()
}

/// Knob-panel state that outlives a frame but isn't worth persisting.
pub struct UiState {
    pub disconnect: disconnect::UiState,
}

impl UiState {
    pub fn new(knobs: &Knobs) -> UiState {
        UiState {
            disconnect: disconnect::UiState::new(&knobs.disconnect),
        }
    }
}

/// Draws the active scenario on the game context, through the shell.
///
/// `elapsed` is the host's running time in seconds, which scenarios with live counters tick from.
pub fn render(knobs: &Knobs, elapsed: f64, ctx: &Context, shell: &mut Shell) -> Outcome {
    host_knobs::sync_native_dialogs(&knobs.host, shell);

    // The kitchen sink is not a shell surface: it is the kit laid out at once, drawn straight onto
    // the context under whatever the shell puts on top of it.
    if knobs.scenario == ScenarioKind::KitchenSink {
        kitchen_sink::render(&knobs.kitchen_sink, ctx);
    }

    let disconnect_view = (knobs.scenario == ScenarioKind::Disconnect)
        .then(|| disconnect::build_view(&knobs.disconnect, elapsed));
    let net_stats_view = match knobs.scenario {
        ScenarioKind::NetStat => Some(netstat::build_view(&knobs.netstat)),
        ScenarioKind::Shell => shell::ambient_view(&knobs.shell, &knobs.netstat),
        _ => None,
    };
    // Built only while the log's modal is on the stack, the way the DLL builds it: the view is a
    // copy of every line said this game, and nothing but that modal reads it.
    let chat_history_view = shell
        .open_modals()
        .any(|modal| modal == ModalId::ChatHistory)
        .then(|| chat_history::build_view(&knobs.chat_history));
    let mut views = Views {
        disconnect: disconnect_view.as_ref().map(|view| DisconnectSurface {
            view,
            blocks_input: knobs.disconnect.blocks_input,
        }),
        net_stats: net_stats_view.as_ref(),
        chat_history: chat_history_view.as_ref(),
    };

    let output = shell.frame(ctx, &knobs.host.host_frame(), &mut views);
    let mut outcome = Outcome {
        hit_rects: output.hit_rects,
        capture: output.capture,
        top_modal: shell.top_modal(),
        ..Outcome::default()
    };
    for intent in output.intents {
        match intent {
            Intent::DropPlayer { slot } => outcome.disconnect_clicks.push(slot),
            Intent::CloseNativeDialog(dialog) => outcome.close_native_dialogs.push(dialog),
        }
    }
    outcome
}

/// What the active scenario reported back this frame, the way the DLL collects intents from a
/// rendered overlay.
#[derive(Default)]
pub struct Outcome {
    /// Slots whose Drop button was clicked.
    pub disconnect_clicks: Vec<u8>,
    /// Native dialogs the shell wants dismissed, because the surface standing in for one was closed.
    /// The game DLL drives the real dialog's return control; the preview closes the switch that
    /// stands in for it.
    pub close_native_dialogs: Vec<NativeDialog>,
    /// The rects the shell reports as its own this frame, in the emulated screen's points.
    pub hit_rects: Vec<HitRect>,
    pub capture: InputCapture,
    pub top_modal: Option<ModalId>,
}

/// The selector plus the active scenario's knob section. Returns whether anything changed.
pub fn knobs_ui(knobs: &mut Knobs, state: &mut UiState, ui: &mut egui::Ui) -> bool {
    let mut changed = false;
    ui.horizontal_wrapped(|ui| {
        for kind in ScenarioKind::ALL {
            changed |= ui
                .selectable_value(&mut knobs.scenario, kind, kind.label())
                .changed();
        }
    });
    ui.separator();
    changed |= match knobs.scenario {
        ScenarioKind::Disconnect => {
            disconnect::knobs_ui(&mut knobs.disconnect, &mut state.disconnect, ui)
        }
        ScenarioKind::NetStat => netstat::knobs_ui(&mut knobs.netstat, ui),
        ScenarioKind::ChatHistory => chat_history::knobs_ui(&mut knobs.chat_history, ui),
        ScenarioKind::Shell => shell::knobs_ui(&mut knobs.shell, ui),
        ScenarioKind::KitchenSink => {
            kitchen_sink::knobs_ui(&mut knobs.kitchen_sink, &mut knobs.screen.compact_ramp, ui)
        }
    };
    changed
}
