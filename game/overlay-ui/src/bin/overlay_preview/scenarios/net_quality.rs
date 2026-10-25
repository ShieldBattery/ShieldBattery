//! The network quality chip scenario: the delay and rollback readout in the top-left corner, either
//! as set or fed a simulated jittery rollback through the chip's own smoothing.

use std::time::{Duration, Instant};

use egui::{Color32, Context, pos2, vec2};
use overlay_ui::net_quality::{DESIGN_HEIGHT, NetQualityView, RecentRollback, fps_line_top};
use serde::{Deserialize, Serialize};

/// The network quality chip's knobs.
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    pub delay: u32,
    /// The rollback shown as is, unless `simulate` is set.
    pub rollback: u32,
    /// How much of the rollback the game runs on purpose (3 through a melee game's opening at the
    /// default target).
    pub intended_rollback: u32,
    /// Feeds a rollback that jitters above `rollback` (with occasional bursts) through the chip's
    /// smoothing, a sample per game tick, to judge how the shown number moves in a real game.
    pub simulate: bool,
    /// How far the simulated rollback jitters above `rollback`, in frames.
    pub jitter: u32,
    /// Seconds between simulated bursts of lateness, or 0 for none.
    pub burst_every_secs: f32,
    /// How many frames a simulated burst adds.
    pub burst_frames: u32,
    /// Whether to place the chip clear of the game's FPS line, as it is in game.
    pub fps_line: bool,
    /// The height of the game's small font, which sets where its FPS line sits.
    pub fps_font_height: u8,
    /// Draws a stand-in for the game's FPS line where the game would draw it.
    pub show_fps_line: bool,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            delay: 1,
            rollback: 2,
            intended_rollback: 0,
            simulate: false,
            jitter: 1,
            burst_every_secs: 8.0,
            burst_frames: 4,
            fps_line: true,
            fps_font_height: 8,
            show_fps_line: true,
        }
    }
}

/// A one-click state of the chip, one per bar count.
#[derive(Clone, Copy)]
pub enum Preset {
    Good,
    Fair,
    Poor,
    Bad,
}

impl Preset {
    pub const ALL: [Preset; 4] = [Preset::Good, Preset::Fair, Preset::Poor, Preset::Bad];

    pub fn label(self) -> &'static str {
        match self {
            Preset::Good => "good",
            Preset::Fair => "fair",
            Preset::Poor => "poor",
            Preset::Bad => "bad",
        }
    }

    pub fn apply(self, knobs: &mut Knobs) {
        knobs.simulate = false;
        (knobs.delay, knobs.rollback) = match self {
            Preset::Good => (1, 1),
            Preset::Fair => (2, 3),
            Preset::Poor => (4, 5),
            Preset::Bad => (7, 8),
        };
    }
}

/// The simulated rollback's running state, which outlives a frame but isn't worth persisting.
pub struct SimState {
    /// The chip's smoothing, fed by the simulated rollback.
    recent_rollback: RecentRollback,
    /// The same, less the rollback run on purpose, for the bars.
    recent_rated_rollback: RecentRollback,
    /// The game tick the simulation last produced a sample for.
    last_tick: Instant,
    /// When the simulation's last burst started.
    last_burst: Instant,
    /// The most recent simulated raw rollback, shown beside the knobs.
    last_raw_rollback: u32,
    /// State of the simulation's pseudo-random jitter.
    rng: u32,
}

impl SimState {
    pub fn new() -> SimState {
        SimState {
            recent_rollback: RecentRollback::new(),
            recent_rated_rollback: RecentRollback::new(),
            last_tick: Instant::now(),
            last_burst: Instant::now(),
            last_raw_rollback: 0,
            rng: 0x2545_f491,
        }
    }
}

/// The chip's view: the knobs as is, or the simulated rollback through the chip's smoothing,
/// advanced one sample per game tick of real time since the last frame.
pub fn build_view(knobs: &Knobs, sim: &mut SimState) -> NetQualityView {
    let fps_font_height = knobs.fps_line.then_some(knobs.fps_font_height);
    if !knobs.simulate {
        return NetQualityView {
            delay: knobs.delay,
            rollback: knobs.rollback,
            rated_rollback: knobs.rollback.saturating_sub(knobs.intended_rollback),
            fps_font_height,
        };
    }
    const TICK: Duration = Duration::from_millis(42);
    const BURST_LENGTH: Duration = Duration::from_millis(400);
    let now = Instant::now();
    // Restarts the simulation's clock after a stretch with no frames, rather than replaying every
    // tick it missed.
    if now.saturating_duration_since(sim.last_tick) > Duration::from_secs(1) {
        sim.last_tick = now;
    }
    while now.saturating_duration_since(sim.last_tick) >= TICK {
        sim.last_tick += TICK;
        let tick = sim.last_tick;
        if knobs.burst_every_secs > 0.0
            && tick.saturating_duration_since(sim.last_burst).as_secs_f32()
                >= knobs.burst_every_secs
        {
            sim.last_burst = tick;
        }
        // xorshift32: plenty for jitter that only has to look irregular.
        sim.rng ^= sim.rng << 13;
        sim.rng ^= sim.rng >> 17;
        sim.rng ^= sim.rng << 5;
        let mut raw = knobs.rollback + sim.rng % (knobs.jitter + 1);
        if knobs.burst_every_secs > 0.0
            && tick.saturating_duration_since(sim.last_burst) < BURST_LENGTH
        {
            raw += knobs.burst_frames;
        }
        sim.last_raw_rollback = raw;
        sim.recent_rollback.record(tick, raw);
        sim.recent_rated_rollback
            .record(tick, raw.saturating_sub(knobs.intended_rollback));
    }
    NetQualityView {
        delay: knobs.delay,
        rollback: sim.recent_rollback.shown(),
        rated_rollback: sim.recent_rated_rollback.shown(),
        fps_font_height,
    }
}

/// Draws text where the game draws its FPS readout for a small font `font_height` tall, in about
/// the game's size, to judge the chip's spacing against it. The game draws the line at x = 10 of
/// its 480-tall coordinate space.
fn paint_fps_line_stand_in(ctx: &Context, font_height: u8) {
    let scale = ctx.content_rect().height() / DESIGN_HEIGHT;
    let game_unit = DESIGN_HEIGHT / 480.0;
    let pos = pos2(10.0 * game_unit, fps_line_top(font_height)) * scale;
    let size = (f32::from(font_height) * game_unit * scale).max(1.0);
    ctx.layer_painter(egui::LayerId::new(
        egui::Order::Background,
        egui::Id::new("fps_line_stand_in"),
    ))
    .text(
        pos,
        egui::Align2::LEFT_TOP,
        "FPS: 163",
        egui::FontId::proportional(size),
        Color32::WHITE,
    );
}

/// Draws what the game itself would draw around the chip, which the shell does not.
pub fn paint_stand_ins(knobs: &Knobs, ctx: &Context) {
    if knobs.show_fps_line {
        paint_fps_line_stand_in(ctx, knobs.fps_font_height);
    }
}

/// The scenario's knob section. Returns whether anything changed.
pub fn knobs_ui(n: &mut Knobs, sim: &SimState, ui: &mut egui::Ui) -> bool {
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
    egui::Grid::new("net_quality_knobs")
        .num_columns(2)
        .spacing(vec2(8.0, 6.0))
        .show(ui, |ui| {
            ui.label("FPS line");
            ui.horizontal(|ui| {
                changed |= ui.checkbox(&mut n.fps_line, "keep clear").changed();
                changed |= ui.checkbox(&mut n.show_fps_line, "draw").changed();
            });
            ui.end_row();
            ui.label("Small font height");
            changed |= ui
                .add(egui::Slider::new(&mut n.fps_font_height, 0..=20))
                .changed();
            ui.end_row();
            ui.label("Delay (D)");
            changed |= ui.add(egui::Slider::new(&mut n.delay, 0..=13)).changed();
            ui.end_row();
            ui.label(if n.simulate {
                "Base rollback"
            } else {
                "Rollback (R)"
            });
            changed |= ui.add(egui::Slider::new(&mut n.rollback, 0..=8)).changed();
            ui.end_row();
            ui.label("Rollback on purpose");
            changed |= ui
                .add(egui::Slider::new(&mut n.intended_rollback, 0..=5))
                .changed();
            ui.end_row();
            ui.label("Simulate");
            changed |= ui
                .checkbox(&mut n.simulate, "jitter + bursts through the smoothing")
                .changed();
            ui.end_row();
            if n.simulate {
                ui.label("Jitter");
                changed |= ui.add(egui::Slider::new(&mut n.jitter, 0..=4)).changed();
                ui.end_row();
                ui.label("Burst every (s)");
                changed |= ui
                    .add(egui::Slider::new(&mut n.burst_every_secs, 0.0..=20.0))
                    .changed();
                ui.end_row();
                ui.label("Burst frames");
                changed |= ui
                    .add(egui::Slider::new(&mut n.burst_frames, 0..=8))
                    .changed();
                ui.end_row();
                ui.label("Raw rollback");
                ui.label(sim.last_raw_rollback.to_string());
                ui.end_row();
            }
        });
    changed
}
