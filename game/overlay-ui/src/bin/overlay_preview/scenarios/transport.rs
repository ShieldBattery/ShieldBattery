//! The replay transport scenario, with a fake replay behind it.
//!
//! The plate is the one overlay that acts on the game rather than reporting on it, so a preview
//! that only drew it would prove nothing: a seek that goes nowhere cannot show whether the playhead
//! follows the pointer, and a speed step that changes no clock cannot show whether the ladder is
//! wired up. So this scenario keeps a clock of its own and answers the shell's intents with it —
//! playback runs at the rate the last speed command asked for, a seek moves it, and a pause stops
//! it, exactly as the game would.

use egui::vec2;
use overlay_ui::transport::{self, TransportView};
use serde::{Deserialize, Serialize};

use crate::knobs::Knobs as AllKnobs;

/// The fake replay's knobs. Between them they decide what the plate has to show, which is what the
/// clock is wound from.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    /// How long the replay runs, in seconds.
    pub length_secs: u32,
    /// How far into it playback starts, in seconds.
    pub start_secs: u32,
    /// The classic game speed it was recorded at, which is what times its frames.
    pub game_speed: u8,
    /// Which rung of the speed ladder playback starts on.
    pub speed_step: usize,
    /// Whether playback starts stopped.
    pub paused: bool,
    /// Whether the fake game reports a seek still in flight, which is what holds the next one back.
    pub seek_pending: bool,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            // The lengths on the design's own card, so the plate can be compared against it.
            length_secs: 2493,
            start_secs: 1069,
            game_speed: 6,
            speed_step: 2,
            paused: false,
            seek_pending: false,
        }
    }
}

impl Knobs {
    /// The rung playback starts on, or the slowest one if the knob names a rung off the ladder.
    fn step(&self) -> transport::SpeedStep {
        transport::SPEED_LADDER[self.speed_step.min(transport::SPEED_LADDER.len() - 1)]
    }

    fn end_frames(&self) -> u32 {
        transport::seconds_to_frames(i64::from(self.length_secs), self.game_speed) as u32
    }

    fn start_frames(&self) -> u32 {
        transport::seconds_to_frames(i64::from(self.start_secs), self.game_speed)
            .clamp(0, i64::from(self.end_frames())) as u32
    }
}

/// The fake replay's playback state, which the plate drives and the host's clock advances.
pub struct Clock {
    frame: f64,
    paused: bool,
    speed_index: u32,
    multiplier: u32,
    /// The knobs this clock was wound from. A knob that moved rewinds it, so a preset or a typed
    /// length takes effect instead of being quietly outvoted by wherever playback had got to.
    source: Knobs,
    /// The host's running time at the last advance, which is what a step is measured from.
    last_secs: f64,
}

impl Clock {
    pub fn new(knobs: &Knobs) -> Clock {
        let step = knobs.step();
        Clock {
            frame: f64::from(knobs.start_frames()),
            paused: knobs.paused,
            speed_index: step.speed_index,
            multiplier: step.multiplier,
            source: *knobs,
            last_secs: 0.0,
        }
    }

    /// Advances playback to where `elapsed` says it should be, rewinding first if a knob moved.
    pub fn advance(&mut self, knobs: &Knobs, elapsed: f64) {
        if self.source != *knobs {
            let last_secs = self.last_secs;
            *self = Clock::new(knobs);
            self.last_secs = last_secs;
        }
        // A step is clamped because the preview is not always running: a window that was behind
        // another for a minute must not come back with the replay a minute further on.
        let step = (elapsed - self.last_secs).clamp(0.0, 0.5);
        self.last_secs = elapsed;
        if self.paused {
            return;
        }
        let rate = f64::from(self.step().rate());
        let per_second = 1000.0 / f64::from(transport::frame_delay_ms(knobs.game_speed));
        self.frame =
            (self.frame + step * per_second * rate).clamp(0.0, f64::from(knobs.end_frames()));
    }

    pub fn seek_to(&mut self, frame: u32) {
        self.frame = f64::from(frame);
    }

    pub fn set_speed(&mut self, speed_index: u32, multiplier: u32, paused: bool) {
        self.speed_index = speed_index;
        self.multiplier = multiplier;
        self.paused = paused;
    }

    fn step(&self) -> transport::SpeedStep {
        transport::SPEED_LADDER[transport::current_step(self.speed_index, self.multiplier)]
    }
}

/// Builds the view the game would hand the overlay.
pub fn build_view(knobs: &Knobs, clock: &Clock, spoiler_free: bool) -> TransportView {
    TransportView {
        elapsed_frames: clock.frame as u32,
        end_frames: knobs.end_frames(),
        game_speed: knobs.game_speed,
        paused: clock.paused,
        speed_index: clock.speed_index,
        multiplier: clock.multiplier,
        spoiler_free,
        seek_pending: knobs.seek_pending,
    }
}

/// A one-click state of the plate: the two forms the design draws.
#[derive(Clone, Copy)]
pub enum Preset {
    /// The standard form, playing fast enough that the clock visibly moves.
    Playing,
    /// The spoiler-free form with playback stopped, which is how a viewer sets a replay up before
    /// watching it.
    SpoilerFree,
}

impl Preset {
    pub const ALL: [Preset; 2] = [Preset::Playing, Preset::SpoilerFree];

    pub fn label(self) -> &'static str {
        match self {
            Preset::Playing => "playing",
            Preset::SpoilerFree => "spoiler-free",
        }
    }

    /// Presets the fake replay, and the host state the plate only exists in: it is drawn for a
    /// replay and nothing else, and the shell decides whether it is on screen.
    pub fn apply(self, knobs: &mut AllKnobs) {
        knobs.host.mode = overlay_ui::shell::Mode::Replay;
        knobs.host.panels.transport = true;
        knobs.host.panels.spoiler_free = matches!(self, Preset::SpoilerFree);
        self.apply_knobs(&mut knobs.transport);
    }

    /// Presets only the fake replay, for the preset row inside the scenario's own knob section.
    pub fn apply_knobs(self, k: &mut Knobs) {
        match self {
            Preset::Playing => {
                *k = Knobs {
                    speed_step: 4,
                    ..Knobs::default()
                };
            }
            Preset::SpoilerFree => {
                *k = Knobs {
                    paused: true,
                    ..Knobs::default()
                };
            }
        }
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
    ui.label(
        "The clock is the fake replay's: it runs at whatever speed the plate last asked for, and \
         a seek moves it. Changing a knob rewinds it.",
    );

    ui.add_space(4.0);
    egui::Grid::new("transport_knobs")
        .num_columns(2)
        .spacing(vec2(8.0, 6.0))
        .show(ui, |ui| {
            ui.label("Length (s)");
            changed |= ui
                .add(egui::DragValue::new(&mut k.length_secs).range(1..=36_000))
                .changed();
            ui.end_row();

            ui.label("Start at (s)");
            changed |= ui
                .add(egui::DragValue::new(&mut k.start_secs).range(0..=36_000))
                .changed();
            ui.end_row();

            ui.label("Recorded speed (0-6)");
            changed |= ui
                .add(egui::DragValue::new(&mut k.game_speed).range(0..=6))
                .changed();
            ui.end_row();
        });

    ui.horizontal_wrapped(|ui| {
        ui.label("Starting speed:");
        for (index, step) in transport::SPEED_LADDER.iter().enumerate() {
            changed |= ui
                .selectable_value(&mut k.speed_step, index, step.label)
                .changed();
        }
    });
    changed |= ui.checkbox(&mut k.paused, "starts paused").changed();
    changed |= ui
        .checkbox(&mut k.seek_pending, "seek in flight")
        .on_hover_text(
            "The game is still working through a seek, which is what holds the next one back \
             instead of having it refused.",
        )
        .changed();
    ui.label(
        "Spoiler-free lives with the panel prefs in the emulated host section, and L moves it.",
    );

    changed
}
