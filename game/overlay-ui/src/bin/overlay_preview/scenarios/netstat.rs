//! The network-stats diagnostic overlay scenario.

use egui::vec2;
use overlay_ui::netstat::{NetEventView, NetStatRowView, NetStatsView, RowDeparture};
use serde::{Deserialize, Serialize};

/// One of the buffer-directive series shapes the history strips can be emulated with, so their
/// drawing is exercised against a flat line, a single step, a steady ramp and a repeating sawtooth
/// without needing a live relay retuning the pipe.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BufferShape {
    Flat,
    Step,
    Ramp,
    Sawtooth,
}

impl BufferShape {
    const ALL: [BufferShape; 4] = [
        BufferShape::Flat,
        BufferShape::Step,
        BufferShape::Ramp,
        BufferShape::Sawtooth,
    ];

    fn label(self) -> &'static str {
        match self {
            BufferShape::Flat => "flat",
            BufferShape::Step => "step",
            BufferShape::Ramp => "ramp",
            BufferShape::Sawtooth => "sawtooth",
        }
    }

    /// The shape's normalized `[0, 1]` value at fractional position `t`.
    fn value_at(self, t: f32) -> f32 {
        match self {
            BufferShape::Flat => 0.5,
            BufferShape::Step => {
                if t < 0.5 {
                    0.2
                } else {
                    0.85
                }
            }
            BufferShape::Ramp => t,
            BufferShape::Sawtooth => (t * 3.0).fract(),
        }
    }
}

/// The fractional position of sample `i` of `count`, in `[0, 1]`; a single-sample series sits at 0.
fn sample_t(i: usize, count: usize) -> f32 {
    if count <= 1 {
        0.0
    } else {
        i as f32 / (count - 1) as f32
    }
}

/// Builds a buffer-depth strip (turn counts) for a shape, mapping its normalized value onto a 2..6
/// turn range so the stepped strip has something to draw.
fn buffer_samples_from_shape(shape: BufferShape, count: usize) -> Vec<u32> {
    (0..count)
        .map(|i| (2.0 + shape.value_at(sample_t(i, count)) * 4.0).round() as u32)
        .collect()
}

/// Builds a worst-arrival-gap strip (milliseconds) for a shape, scaling its normalized value up to
/// `peak_ms` over a calm ~20 ms floor, so a healthy shape reads low and a spiky one lifts the trace.
fn gap_samples_from_shape(shape: BufferShape, count: usize, peak_ms: u64) -> Vec<u64> {
    (0..count)
        .map(|i| 20 + (shape.value_at(sample_t(i, count)) * peak_ms as f32) as u64)
        .collect()
}

/// The network-stats overlay's emulation knobs.
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    /// The rally-point2 session id shown in the operator header.
    pub session_id: u64,
    /// This client's current home relay id shown in the operator header.
    pub relay_id: u32,
    /// The current relay's region label; blank emulates "no region" (`None`).
    pub region: String,
    pub turn_rate: u32,
    pub buffer_turns: u32,
    pub buffer_change_count: u32,
    /// Seconds since the last buffer change; a negative value emulates "never changed" (`None`).
    pub buffer_last_change_secs: i64,
    pub link_up: bool,
    pub link_down_count: u32,
    /// Seconds since the last link transition; a negative value emulates "never changed" (`None`).
    pub link_last_change_secs: i64,
    /// How many samples each history strip carries; fewer than two draws the "gathering" placeholder
    /// (a cold-start game).
    pub sample_count: usize,
    /// The peak worst-gap the arrival-gap strip reaches (milliseconds).
    pub gap_peak_ms: u64,
    /// How many remote-slot rows to synthesize.
    pub row_count: usize,
    /// The recent-stall milliseconds applied to every other synthesized row (the rest stay clean),
    /// so the stall columns' colouring and formatting can be eyeballed.
    pub stall_ms: u64,
    /// How many trailing synthesized rows render as departed (alternating left/drop tags), so the
    /// muted departed-row styling can be eyeballed.
    pub departed_count: usize,
    pub shape: BufferShape,
    /// Whether synthesized rows carry a home relay (`r1 local-a`) or an em dash.
    pub homes_known: bool,
    /// Whether to include a buffer-change line in the event ticker.
    pub event_buffer: bool,
    /// Whether to include a link loss + restore in the event ticker.
    pub event_link: bool,
    /// Whether to include a re-home line in the event ticker.
    pub event_rehome: bool,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            session_id: 1_783_817_817_540_254,
            relay_id: 1,
            region: "local-a".to_string(),
            turn_rate: 24,
            buffer_turns: 3,
            buffer_change_count: 2,
            buffer_last_change_secs: 15,
            link_up: true,
            link_down_count: 1,
            link_last_change_secs: 30,
            sample_count: 90,
            gap_peak_ms: 1500,
            row_count: 3,
            stall_ms: 1500,
            departed_count: 0,
            shape: BufferShape::Step,
            homes_known: true,
            event_buffer: true,
            event_link: true,
            event_rehome: false,
        }
    }
}

/// A one-click preview state: a healthy session, a degraded one, one just after a re-home, and a
/// cold start with no history yet.
#[derive(Clone, Copy)]
pub enum Preset {
    Healthy,
    Degraded,
    PostRehome,
    ColdStart,
}

impl Preset {
    pub const ALL: [Preset; 4] = [
        Preset::Healthy,
        Preset::Degraded,
        Preset::PostRehome,
        Preset::ColdStart,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Preset::Healthy => "healthy",
            Preset::Degraded => "degraded",
            Preset::PostRehome => "post-rehome",
            Preset::ColdStart => "cold-start",
        }
    }

    /// Presets the emulation knobs to this state, leaving the session id alone (its exact value
    /// doesn't change how anything renders).
    pub fn apply(self, n: &mut Knobs) {
        match self {
            Preset::Healthy => {
                n.relay_id = 1;
                n.region = "local-a".to_string();
                n.buffer_turns = 2;
                n.buffer_change_count = 0;
                n.buffer_last_change_secs = -1;
                n.link_up = true;
                n.link_down_count = 0;
                n.link_last_change_secs = -1;
                n.sample_count = 90;
                n.gap_peak_ms = 60;
                n.row_count = 2;
                n.stall_ms = 0;
                n.departed_count = 0;
                n.shape = BufferShape::Flat;
                n.homes_known = true;
                n.event_buffer = false;
                n.event_link = false;
                n.event_rehome = false;
            }
            Preset::Degraded => {
                n.relay_id = 1;
                n.region = "local-a".to_string();
                n.buffer_turns = 5;
                n.buffer_change_count = 3;
                n.buffer_last_change_secs = 12;
                n.link_up = false;
                n.link_down_count = 2;
                n.link_last_change_secs = 4;
                n.sample_count = 110;
                n.gap_peak_ms = 1800;
                n.row_count = 3;
                n.stall_ms = 2400;
                n.departed_count = 1;
                n.shape = BufferShape::Sawtooth;
                n.homes_known = true;
                n.event_buffer = true;
                n.event_link = true;
                n.event_rehome = false;
            }
            Preset::PostRehome => {
                n.relay_id = 2;
                n.region = "local-b".to_string();
                n.buffer_turns = 3;
                n.buffer_change_count = 1;
                n.buffer_last_change_secs = 40;
                n.link_up = true;
                n.link_down_count = 1;
                n.link_last_change_secs = 22;
                n.sample_count = 100;
                n.gap_peak_ms = 700;
                n.row_count = 2;
                n.stall_ms = 300;
                n.departed_count = 0;
                n.shape = BufferShape::Step;
                n.homes_known = true;
                n.event_buffer = false;
                n.event_link = true;
                n.event_rehome = true;
            }
            Preset::ColdStart => {
                n.relay_id = 1;
                n.region = "local-a".to_string();
                n.buffer_turns = 2;
                n.buffer_change_count = 0;
                n.buffer_last_change_secs = -1;
                n.link_up = true;
                n.link_down_count = 0;
                n.link_last_change_secs = -1;
                n.sample_count = 1;
                n.gap_peak_ms = 60;
                n.row_count = 2;
                n.stall_ms = 0;
                n.departed_count = 0;
                n.shape = BufferShape::Flat;
                n.homes_known = false;
                n.event_buffer = false;
                n.event_link = false;
                n.event_rehome = false;
            }
        }
    }
}

/// Builds the view the game would hand the overlay.
pub fn build_view(k: &Knobs) -> NetStatsView {
    let rows = (0..k.row_count)
        .map(|i| {
            let stalled = i % 2 == 1;
            let recent = if stalled { k.stall_ms } else { 0 };
            let home = k.homes_known.then(|| {
                let relay = 1 + (i as u64 % 2);
                let region = if relay == 1 { "local-a" } else { "local-b" };
                format!("r{relay} {region}")
            });
            let departed = i >= k.row_count.saturating_sub(k.departed_count);
            let departure = departed.then_some(if i % 2 == 0 {
                RowDeparture::Left
            } else {
                RowDeparture::Dropped
            });
            NetStatRowView {
                name: format!("Player {}", i + 1),
                home,
                // A departed player's last turn keeps aging, so give departed rows a minutes-old
                // age.
                last_turn_age_ms: Some(if departure.is_some() {
                    63_000 + i as u64 * 1000
                } else {
                    (if stalled { 900 } else { 40 }) + i as u64 * 5
                }),
                ewma_interval_ms: Some(1000 / k.turn_rate.max(1) as u64 + i as u64 * 3),
                max_gap_ms: if stalled { 1600 } else { 90 },
                recent_stall_ms: recent,
                lifetime_stall_ms: recent * 12,
                episode_count: if stalled { 3 + i as u32 } else { 0 },
                departure,
            }
        })
        .collect();

    // Synthesize a few ticker lines from the event toggles, oldest first.
    let mut events = Vec::new();
    if k.event_link {
        events.push(NetEventView {
            elapsed_secs: 478,
            text: "link lost".to_string(),
        });
        events.push(NetEventView {
            elapsed_secs: 481,
            text: "link back (2.1s)".to_string(),
        });
    }
    if k.event_buffer {
        events.push(NetEventView {
            elapsed_secs: 543,
            text: format!(
                "buffer {} → {} turns",
                k.buffer_turns.saturating_sub(1).max(1),
                k.buffer_turns
            ),
        });
    }
    if k.event_rehome {
        let to = k.relay_id.max(1);
        events.push(NetEventView {
            elapsed_secs: 761,
            text: format!("re-homed relay {} → {}", to.saturating_sub(1).max(1), to),
        });
    }

    NetStatsView {
        session_id: k.session_id,
        relay_id: k.relay_id as u64,
        region: (!k.region.trim().is_empty()).then(|| k.region.clone()),
        buffer_turns: k.buffer_turns,
        buffer_change_count: k.buffer_change_count,
        buffer_last_change_secs: (k.buffer_last_change_secs >= 0)
            .then_some(k.buffer_last_change_secs as u64),
        link_up: k.link_up,
        link_down_count: k.link_down_count,
        link_last_change_secs: (k.link_last_change_secs >= 0)
            .then_some(k.link_last_change_secs as u64),
        buffer_samples: buffer_samples_from_shape(k.shape, k.sample_count),
        gap_samples_ms: gap_samples_from_shape(k.shape, k.sample_count, k.gap_peak_ms),
        events,
        phase_applied_us: 0,
        phase_target_us: 0,
        rows,
    }
}

/// The scenario's knob section. Returns whether anything changed.
pub fn knobs_ui(n: &mut Knobs, ui: &mut egui::Ui) -> bool {
    let mut changed = false;

    ui.horizontal_wrapped(|ui| {
        ui.label("Preset:");
        for preset in Preset::ALL {
            if ui.button(preset.label()).clicked() {
                preset.apply(n);
                changed = true;
            }
        }
    });

    ui.add_space(4.0);
    egui::Grid::new("netstat_identity_knobs")
        .num_columns(2)
        .spacing(vec2(8.0, 6.0))
        .show(ui, |ui| {
            ui.label("Session id");
            changed |= ui.add(egui::DragValue::new(&mut n.session_id)).changed();
            ui.end_row();

            ui.label("Relay id");
            changed |= ui
                .add(egui::DragValue::new(&mut n.relay_id).range(0..=999))
                .changed();
            ui.end_row();

            ui.label("Region (blank = none)");
            changed |= ui.text_edit_singleline(&mut n.region).changed();
            ui.end_row();
        });

    egui::Grid::new("netstat_knobs")
        .num_columns(2)
        .spacing(vec2(8.0, 6.0))
        .show(ui, |ui| {
            ui.label("Turn rate");
            changed |= ui
                .add(egui::DragValue::new(&mut n.turn_rate).range(1..=48))
                .changed();
            ui.end_row();

            ui.label("Buffer turns");
            changed |= ui
                .add(egui::DragValue::new(&mut n.buffer_turns).range(1..=64))
                .changed();
            ui.end_row();

            ui.label("Buffer changes");
            changed |= ui
                .add(egui::DragValue::new(&mut n.buffer_change_count).range(0..=999))
                .changed();
            ui.end_row();

            ui.label("Buffer last change (s, <0 = never)");
            changed |= ui
                .add(egui::DragValue::new(&mut n.buffer_last_change_secs).range(-1..=6000))
                .changed();
            ui.end_row();

            ui.label("Link up");
            changed |= ui.checkbox(&mut n.link_up, "own link up").changed();
            ui.end_row();

            ui.label("Link downs");
            changed |= ui
                .add(egui::DragValue::new(&mut n.link_down_count).range(0..=999))
                .changed();
            ui.end_row();

            ui.label("Link last change (s, <0 = never)");
            changed |= ui
                .add(egui::DragValue::new(&mut n.link_last_change_secs).range(-1..=6000))
                .changed();
            ui.end_row();

            ui.label("Rows");
            changed |= ui
                .add(egui::DragValue::new(&mut n.row_count).range(0..=11))
                .changed();
            ui.end_row();

            ui.label("Stall ms (every other row)");
            changed |= ui
                .add(egui::DragValue::new(&mut n.stall_ms).range(0..=600_000))
                .changed();
            ui.end_row();

            ui.label("Departed rows (trailing)");
            changed |= ui
                .add(egui::DragValue::new(&mut n.departed_count).range(0..=11))
                .changed();
            ui.end_row();

            ui.label("Strip samples (<2 = gathering)");
            changed |= ui
                .add(egui::DragValue::new(&mut n.sample_count).range(0..=120))
                .changed();
            ui.end_row();

            ui.label("Gap peak ms");
            changed |= ui
                .add(egui::DragValue::new(&mut n.gap_peak_ms).range(0..=10_000))
                .changed();
            ui.end_row();
        });

    ui.horizontal_wrapped(|ui| {
        ui.label("Buffer shape");
        for shape in BufferShape::ALL {
            changed |= ui
                .selectable_value(&mut n.shape, shape, shape.label())
                .changed();
        }
    });

    changed |= ui
        .checkbox(&mut n.homes_known, "per-player homes known")
        .changed();
    ui.horizontal_wrapped(|ui| {
        ui.label("Events:");
        changed |= ui.checkbox(&mut n.event_buffer, "buffer").changed();
        changed |= ui.checkbox(&mut n.event_link, "link").changed();
        changed |= ui.checkbox(&mut n.event_rehome, "re-home").changed();
    });

    changed
}
