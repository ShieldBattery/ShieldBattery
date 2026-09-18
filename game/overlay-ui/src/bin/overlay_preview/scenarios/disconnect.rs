//! The disconnect overlay scenario: waiting-on-players rows and the self-reconnecting notice.

use egui::{Color32, vec2};
use overlay_ui::disconnect::{DisconnectRowView, DisconnectView, PeerState, SelfState};
use overlay_ui::kit::theme;
use serde::{Deserialize, Serialize};

/// One emulated disconnect row's adjustable state.
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct RowKnob {
    /// The rally-point2 slot id this row reports as; surfaced in the click log so a click is
    /// traceable to a row.
    pub slot: u8,
    pub name: String,
    /// Which of the three states the row reports.
    pub state: RowState,
    /// Which of the design's player colors the row's bar is drawn in.
    pub color_slot: usize,
    /// Whether the row's player is on the local player's side.
    pub teammate: bool,
    /// Base elapsed seconds; the auto-tick offset is added on top for the live view.
    pub seconds: u64,
    pub drop_unlocked: bool,
    pub drop_requested: bool,
}

/// What a knob row reports its player's connection as.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RowState {
    Connected,
    Stalled,
    Reconnecting,
}

impl RowState {
    const ALL: [RowState; 3] = [
        RowState::Connected,
        RowState::Stalled,
        RowState::Reconnecting,
    ];

    fn label(self) -> &'static str {
        match self {
            RowState::Connected => "connected",
            RowState::Stalled => "stalled",
            RowState::Reconnecting => "reconnecting",
        }
    }

    fn view(self) -> PeerState {
        match self {
            RowState::Connected => PeerState::Connected,
            RowState::Stalled => PeerState::Stalled,
            RowState::Reconnecting => PeerState::Reconnecting,
        }
    }
}

impl Default for RowKnob {
    fn default() -> RowKnob {
        RowKnob {
            slot: 0,
            name: "Player 1".to_string(),
            state: RowState::Reconnecting,
            color_slot: 0,
            teammate: false,
            seconds: 10,
            drop_unlocked: false,
            drop_requested: false,
        }
    }
}

impl RowKnob {
    fn generated(slot: u8) -> RowKnob {
        RowKnob {
            slot,
            name: format!("Player {}", slot + 1),
            color_slot: slot as usize,
            ..RowKnob::default()
        }
    }
}

/// The disconnect overlay's emulation knobs.
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    pub rows: Vec<RowKnob>,
    /// `true` => the prominent self-reconnecting notice replaces the roster.
    pub self_reconnecting: bool,
    /// How long this client's own link has been down, which is what that notice's clock reads.
    pub self_seconds: u64,
    /// Whether this is a real connection problem rather than a passing stall, which is what decides
    /// whether the surface takes the player's input or only sits over the game.
    pub blocks_input: bool,
    /// While set, every row's elapsed counter advances in real time from its base value.
    pub auto_tick: bool,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            rows: Preset::Confirmed.rows(),
            self_reconnecting: false,
            self_seconds: 14,
            blocks_input: true,
            auto_tick: false,
        }
    }
}

/// A one-click state of the disconnect overlay: the brief stall tier, a relay-confirmed
/// disconnect still counting down, one whose manual drop has unlocked, and this client's own link
/// being down.
#[derive(Clone, Copy)]
pub enum Preset {
    Stall,
    Confirmed,
    Droppable,
    SelfReconnecting,
}

impl Preset {
    pub const ALL: [Preset; 4] = [
        Preset::Stall,
        Preset::Confirmed,
        Preset::Droppable,
        Preset::SelfReconnecting,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Preset::Stall => "stall",
            Preset::Confirmed => "confirmed",
            Preset::Droppable => "droppable",
            Preset::SelfReconnecting => "self-reconnecting",
        }
    }

    /// The roster this preset deals out. Every preset carries the whole roster, connected players
    /// and all, because that is what the dialog draws.
    fn rows(self) -> Vec<RowKnob> {
        let mango = RowKnob {
            slot: 0,
            name: "Mango".to_string(),
            state: RowState::Connected,
            color_slot: 2,
            teammate: true,
            seconds: 0,
            drop_unlocked: false,
            drop_requested: false,
        };
        let aurora = |state: RowState, seconds: u64, unlocked: bool| RowKnob {
            slot: 1,
            name: "Aurora".to_string(),
            state,
            color_slot: 1,
            teammate: false,
            seconds,
            drop_unlocked: unlocked,
            drop_requested: false,
        };
        let sharkfin = |state: RowState, seconds: u64, unlocked: bool, requested: bool| RowKnob {
            slot: 2,
            name: "Sharkfin".to_string(),
            state,
            color_slot: 5,
            teammate: false,
            seconds,
            drop_unlocked: unlocked,
            drop_requested: requested,
        };
        match self {
            Preset::Stall => vec![
                mango,
                aurora(RowState::Stalled, 3, false),
                sharkfin(RowState::Connected, 0, false, false),
            ],
            Preset::Confirmed | Preset::SelfReconnecting => vec![
                mango,
                aurora(RowState::Reconnecting, 31, false),
                sharkfin(RowState::Reconnecting, 18, false, false),
            ],
            Preset::Droppable => vec![
                mango,
                aurora(RowState::Reconnecting, 31, false),
                sharkfin(RowState::Reconnecting, 52, true, false),
            ],
        }
    }

    pub fn apply(self, knobs: &mut Knobs) {
        knobs.self_reconnecting = matches!(self, Preset::SelfReconnecting);
        // Only a relay-confirmed problem stops the simulation; the stall tier is a notice over a
        // game that is still the player's.
        knobs.blocks_input = !matches!(self, Preset::Stall);
        knobs.rows = self.rows();
    }
}

/// Knob-panel state that is not worth persisting.
#[derive(Default)]
pub struct UiState {
    /// The slot id the next added row takes, so slot ids stay unique and readable.
    next_slot: u8,
    /// The slots clicked in the most recent frame that had any, for feedback.
    last_clicked: Vec<u8>,
    /// Whether the abandon hold has ever been held to the end this session.
    abandoned: bool,
}

impl UiState {
    pub fn new(knobs: &Knobs) -> UiState {
        UiState {
            next_slot: knobs.rows.iter().map(|r| r.slot).max().map_or(0, |m| m + 1),
            last_clicked: Vec::new(),
            abandoned: false,
        }
    }

    pub fn note_clicks(&mut self, clicked: Vec<u8>, abandoned: bool) {
        if !clicked.is_empty() {
            self.last_clicked = clicked;
        }
        self.abandoned |= abandoned;
    }
}

/// Builds the view the game would hand the overlay, with `elapsed` seconds of auto-tick folded in.
pub fn build_view(knobs: &Knobs, elapsed: f64) -> DisconnectView {
    let tick = if knobs.auto_tick { elapsed as u64 } else { 0 };
    DisconnectView {
        rows: knobs
            .rows
            .iter()
            .map(|row| DisconnectRowView {
                slot: row.slot,
                name: row.name.clone(),
                color: theme::player_color(row.color_slot),
                teammate: row.teammate,
                seconds: match row.state {
                    RowState::Connected => 0,
                    _ => row.seconds + tick,
                },
                state: row.state.view(),
                drop_unlocked: row.drop_unlocked,
                drop_requested: row.drop_requested,
            })
            .collect(),
        self_state: if knobs.self_reconnecting {
            SelfState::Reconnecting
        } else {
            SelfState::Healthy
        },
        self_seconds: knobs.self_seconds + tick,
    }
}

/// The scenario's knob section. Returns whether anything changed.
pub fn knobs_ui(knobs: &mut Knobs, state: &mut UiState, ui: &mut egui::Ui) -> bool {
    let mut changed = false;

    ui.horizontal_wrapped(|ui| {
        ui.label("Preset:");
        for preset in Preset::ALL {
            if ui.button(preset.label()).clicked() {
                preset.apply(knobs);
                state.next_slot = knobs.rows.iter().map(|r| r.slot).max().map_or(0, |m| m + 1);
                changed = true;
            }
        }
    });

    ui.add_space(4.0);
    egui::Grid::new("disconnect_knobs")
        .num_columns(2)
        .spacing(vec2(8.0, 6.0))
        .show(ui, |ui| {
            ui.label("Self reconnecting");
            changed |= ui
                .checkbox(&mut knobs.self_reconnecting, "show self notice")
                .changed();
            ui.end_row();

            ui.label("Blocks input");
            changed |= ui
                .checkbox(&mut knobs.blocks_input, "a real connection problem")
                .on_hover_text(
                    "A confirmed problem stops the simulation and takes every input; a passing \
                     stall must not lock the player out of their own game.",
                )
                .changed();
            ui.end_row();

            ui.label("Self elapsed");
            changed |= ui
                .add(egui::DragValue::new(&mut knobs.self_seconds).range(0..=6000))
                .changed();
            ui.end_row();

            ui.label("Auto-tick counters");
            changed |= ui
                .checkbox(&mut knobs.auto_tick, "advance seconds live")
                .changed();
            ui.end_row();
        });

    ui.add_space(8.0);
    ui.horizontal(|ui| {
        ui.strong("Rows");
        if ui.button("+ add").clicked() {
            let slot = state.next_slot;
            state.next_slot = state.next_slot.wrapping_add(1);
            knobs.rows.push(RowKnob::generated(slot));
            changed = true;
        }
        if ui.button("clear").clicked() {
            knobs.rows.clear();
            changed = true;
        }
    });

    let mut remove = None;
    for (idx, row) in knobs.rows.iter_mut().enumerate() {
        ui.push_id(idx, |ui| {
            ui.add_space(4.0);
            egui::Frame::group(ui.style()).show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(format!("slot {}", row.slot));
                    changed |= ui.text_edit_singleline(&mut row.name).changed();
                    if ui.button("x").clicked() {
                        remove = Some(idx);
                    }
                });
                ui.horizontal(|ui| {
                    for state in RowState::ALL {
                        changed |= ui
                            .selectable_value(&mut row.state, state, state.label())
                            .changed();
                    }
                });
                ui.horizontal(|ui| {
                    ui.label("seconds");
                    changed |= ui
                        .add(egui::DragValue::new(&mut row.seconds).range(0..=6000))
                        .changed();
                    ui.label("color");
                    changed |= ui
                        .add(egui::DragValue::new(&mut row.color_slot).range(0..=5))
                        .changed();
                    changed |= ui.checkbox(&mut row.teammate, "teammate").changed();
                });
                ui.horizontal(|ui| {
                    changed |= ui
                        .checkbox(&mut row.drop_unlocked, "drop unlocked")
                        .changed();
                    changed |= ui
                        .checkbox(&mut row.drop_requested, "drop requested")
                        .changed();
                });
            });
        });
    }
    if let Some(idx) = remove {
        knobs.rows.remove(idx);
        changed = true;
    }

    ui.add_space(8.0);
    if state.last_clicked.is_empty() {
        ui.label("Last Drop click: (none)");
    } else {
        ui.colored_label(
            Color32::from_rgb(0xff, 0xd9, 0x82),
            format!("Last Drop click: slots {:?}", state.last_clicked),
        );
    }
    if state.abandoned {
        ui.colored_label(
            Color32::from_rgb(0xff, 0x8a, 0x8a),
            "Abandon hold completed at least once",
        );
    }

    changed
}
