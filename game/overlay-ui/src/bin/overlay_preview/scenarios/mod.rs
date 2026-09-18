//! The set of overlay states the preview can put on the emulated screen.
//!
//! Exactly one scenario is active at a time, matching the game: a screen is either up or it isn't,
//! and stacking two of them would hide whichever anchors to the same corner.

pub mod disconnect;
pub mod kitchen_sink;
pub mod net_quality;
pub mod netstat;

use egui::Context;
use overlay_ui::disconnect::DisconnectClicks;
use serde::{Deserialize, Serialize};

use crate::knobs::Knobs;

/// Which overlay the emulated screen is showing.
#[derive(Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum ScenarioKind {
    #[default]
    Disconnect,
    NetQuality,
    NetStat,
    KitchenSink,
}

impl ScenarioKind {
    pub const ALL: [ScenarioKind; 4] = [
        ScenarioKind::Disconnect,
        ScenarioKind::NetQuality,
        ScenarioKind::NetStat,
        ScenarioKind::KitchenSink,
    ];

    pub fn label(self) -> &'static str {
        match self {
            ScenarioKind::Disconnect => "Disconnect",
            ScenarioKind::NetQuality => "Network quality",
            ScenarioKind::NetStat => "Network stats",
            ScenarioKind::KitchenSink => "Kitchen sink",
        }
    }

    /// The name this scenario takes in a rendered file name.
    pub fn slug(self) -> &'static str {
        match self {
            ScenarioKind::Disconnect => "disconnect",
            ScenarioKind::NetQuality => "net-quality",
            ScenarioKind::NetStat => "netstat",
            ScenarioKind::KitchenSink => "kitchen-sink",
        }
    }
}

/// One named state of one scenario, as the offline renderer walks them.
#[derive(Clone, Copy)]
pub enum Preset {
    Disconnect(disconnect::Preset),
    NetQuality(net_quality::Preset),
    NetStat(netstat::Preset),
    KitchenSink(kitchen_sink::Preset),
}

impl Preset {
    pub fn kind(self) -> ScenarioKind {
        match self {
            Preset::Disconnect(_) => ScenarioKind::Disconnect,
            Preset::NetQuality(_) => ScenarioKind::NetQuality,
            Preset::NetStat(_) => ScenarioKind::NetStat,
            Preset::KitchenSink(_) => ScenarioKind::KitchenSink,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Preset::Disconnect(preset) => preset.label(),
            Preset::NetQuality(preset) => preset.label(),
            Preset::NetStat(preset) => preset.label(),
            Preset::KitchenSink(preset) => preset.label(),
        }
    }

    /// Selects this preset's scenario and presets its knobs.
    pub fn apply(self, knobs: &mut Knobs) {
        knobs.scenario = self.kind();
        match self {
            Preset::Disconnect(preset) => preset.apply(&mut knobs.disconnect),
            Preset::NetQuality(preset) => preset.apply(&mut knobs.net_quality),
            Preset::NetStat(preset) => preset.apply(&mut knobs.netstat),
            Preset::KitchenSink(preset) => preset.apply(&mut knobs.kitchen_sink),
        }
    }
}

/// Every scenario preset, in selector order.
pub fn all_presets() -> Vec<Preset> {
    disconnect::Preset::ALL
        .into_iter()
        .map(Preset::Disconnect)
        .chain(net_quality::Preset::ALL.into_iter().map(Preset::NetQuality))
        .chain(netstat::Preset::ALL.into_iter().map(Preset::NetStat))
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
    pub net_quality: net_quality::SimState,
}

impl UiState {
    pub fn new(knobs: &Knobs) -> UiState {
        UiState {
            disconnect: disconnect::UiState::new(&knobs.disconnect),
            net_quality: net_quality::SimState::new(),
        }
    }
}

/// Draws the active scenario on the game context.
///
/// `elapsed` is the host's running time in seconds, which scenarios with live counters tick from.
pub fn render(knobs: &Knobs, state: &mut UiState, elapsed: f64, ctx: &Context) -> Outcome {
    match knobs.scenario {
        ScenarioKind::Disconnect => Outcome {
            disconnect_clicks: disconnect::render(&knobs.disconnect, elapsed, ctx),
        },
        ScenarioKind::NetQuality => {
            net_quality::render(&knobs.net_quality, &mut state.net_quality, ctx);
            Outcome::default()
        }
        ScenarioKind::NetStat => {
            netstat::render(&knobs.netstat, ctx);
            Outcome::default()
        }
        ScenarioKind::KitchenSink => {
            kitchen_sink::render(&knobs.kitchen_sink, ctx);
            Outcome::default()
        }
    }
}

/// Whether the active scenario changes from frame to frame on its own, so the host has to keep
/// asking for frames: the game context can't predict numbers the host feeds in.
pub fn is_live(knobs: &Knobs) -> bool {
    match knobs.scenario {
        ScenarioKind::Disconnect => knobs.disconnect.auto_tick,
        ScenarioKind::NetQuality => knobs.net_quality.simulate,
        ScenarioKind::NetStat | ScenarioKind::KitchenSink => false,
    }
}

/// What the active scenario reported back this frame, the way the DLL collects intents from a
/// rendered overlay.
#[derive(Default)]
pub struct Outcome {
    /// What was clicked in the disconnect overlay.
    pub disconnect_clicks: DisconnectClicks,
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
        ScenarioKind::NetQuality => {
            net_quality::knobs_ui(&mut knobs.net_quality, &state.net_quality, ui)
        }
        ScenarioKind::NetStat => netstat::knobs_ui(&mut knobs.netstat, ui),
        ScenarioKind::KitchenSink => {
            kitchen_sink::knobs_ui(&mut knobs.kitchen_sink, &mut knobs.screen.compact_ramp, ui)
        }
    };
    changed
}
