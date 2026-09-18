//! The replay transport's presentation layer: a plain-data view-model and the egui render fn that
//! draws it. Like [`crate::netstat`] and [`crate::chat_history`], everything here is a pure fn of
//! [`TransportView`] plus an [`egui::Context`], so the same code renders in the injected game DLL
//! and in the host preview.
//!
//! The plate stands in for SC:R's own replay controls, so it sits where those sit — the right end
//! of the console band — in the kit's ambient chrome, with the play control the one filled thing
//! on it: it is the surface a viewer reaches for on purpose, and the control they reach for most
//! has to be findable without hunting.
//!
//! It has two forms of the same footprint. The **standard** one shows where the replay is and how
//! long it runs, with a track to scrub along. The **spoiler-free** one withholds both, because the
//! length of a replay and the position of the playhead in it are the two things that give a game
//! away before it is watched: five minutes left on the track says the fight about to start is the
//! last one. Nothing but an explicit click puts them back, never a hover.
//!
//! Playback state is not read off the game but tracked from the commands that change it, so the
//! numbers here are whatever the last speed command said — ours or SC:R's own plate's.

use egui::{
    Align, Align2, Area, Color32, Context, Id, Layout, Order, Rect, Response, Sense, Shape, Stroke,
    StrokeKind, Ui, Vec2, pos2, vec2,
};

use crate::colors::{BLUE60, BLUE80};
use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets::{self, TagStyle};
use crate::kit::{motion, theme, tiers};
use crate::tr;

/// How wide the plate is, in overlay points.
pub const PANEL_WIDTH: f32 = 324.0;

/// How tall the plate is. Fixed rather than grown from its contents: both forms take the same
/// footprint, so switching between them moves nothing on screen.
pub const PANEL_HEIGHT: f32 = 114.0;

/// How far the plate sits from the screen's right and bottom edges.
const EDGE_MARGIN: f32 = 16.0;

/// The room inside the plate's chrome. Every column below is measured against this rather than
/// against the space left over, so no value or translation can move a control.
const CONTENT_WIDTH: f32 = PANEL_WIDTH - 24.0;

/// Height of the row carrying the elapsed clock and the speed stepper.
const INFO_ROW: f32 = 24.0;
/// Height of the row carrying the scrub track, or what stands in for it.
const TRACK_ROW: f32 = 24.0;
/// Height of the row carrying the jumps and the play control, which is the tallest thing on it.
const CHIP_ROW: f32 = 30.0;
/// Gap between two rows.
const ROW_GAP: f32 = 8.0;

/// The room inside the plate's chrome, vertically.
const CONTENT_HEIGHT: f32 = INFO_ROW + ROW_GAP + TRACK_ROW + ROW_GAP + CHIP_ROW;

/// The rows and the panel margin together are the plate's height, so a row that grew would push it
/// off the footprint both forms share. Checked where the heights are written.
const _: () = assert!(CONTENT_HEIGHT + 20.0 == PANEL_HEIGHT);

/// The play/pause control, which is the one filled thing on the plate and the only one a viewer
/// reaches for without aiming.
const PLAY_SIZE: Vec2 = Vec2::new(42.0, 30.0);
/// Width of the elapsed clock's column. Wide enough for `1:05:30`, so an hour-long replay does not
/// widen the row.
const CLOCK_WIDTH: f32 = 62.0;
/// Text size of the elapsed clock, which is read all the way through a replay.
const CLOCK_SIZE: f32 = 20.0;
/// Width of the column holding the replay's length, and the size that number is set at: it is read
/// once, where the elapsed clock is read continuously.
const LENGTH_WIDTH: f32 = 46.0;
const LENGTH_SIZE: f32 = 13.0;
/// Side of one square control: an end of the speed stepper, or the eye.
const BOX_SIZE: f32 = 24.0;
/// Width of the column holding the rung playback is on, and the size it is set at.
const SPEED_WIDTH: f32 = 28.0;
const SPEED_SIZE: f32 = 17.0;
/// Width of the tag that says playback is stopped.
const PAUSED_TAG_WIDTH: f32 = 56.0;
/// Width of the button that puts the length back on screen.
const REVEAL_WIDTH: f32 = 62.0;
/// Height of a status tag or of an inline button on the track row, which sit centred in their row
/// rather than filling it: either the height of the controls beside them would read as another
/// control.
const TAG_HEIGHT: f32 = 20.0;
/// Gap between two things sharing a row.
const ITEM_GAP: f32 = 8.0;

/// Width of the whole speed stepper: one step down, the rung it is on, one step up.
const STEPPER_WIDTH: f32 = BOX_SIZE * 2.0 + SPEED_WIDTH + ITEM_GAP * 2.0;

/// What the standard form's info row spends on the two ends it pins its contents to, the rest being
/// the slack between them. Checked where the widths are written, because a row that overran would
/// widen the plate and take the two forms apart.
const _: () = assert!(CLOCK_WIDTH + STEPPER_WIDTH < CONTENT_WIDTH);

/// What the spoiler-free form adds to that row: the tag saying playback is stopped.
const _: () = assert!(CLOCK_WIDTH + ITEM_GAP + PAUSED_TAG_WIDTH + STEPPER_WIDTH < CONTENT_WIDTH);

/// How wide the scrub track is, being the track row less the length and the eye beside it.
const TRACK_WIDTH: f32 = CONTENT_WIDTH - LENGTH_WIDTH - BOX_SIZE - ITEM_GAP * 2.0;

/// How wide the spoiler-free form's own label runs before the button that undoes it.
const HIDDEN_LABEL_WIDTH: f32 = CONTENT_WIDTH - REVEAL_WIDTH - ITEM_GAP;

/// Gap between two jump chips, and between the innermost of them and the play control.
const CHIP_GAP: f32 = 5.0;
/// Height of a jump chip, which sits centred in the taller row the play control sets.
const CHIP_HEIGHT: f32 = 28.0;

/// How far each jump chip moves the playhead, in seconds, left to right.
pub const JUMP_STEPS: [i32; 6] = [-300, -60, -10, 10, 60, 300];

/// Width of one jump chip, the row being exactly as wide as the plate's contents: six of them and
/// the play control they sit around, with a gap between each.
const CHIP_WIDTH: f32 = (CONTENT_WIDTH - PLAY_SIZE.x - CHIP_GAP * 6.0) / 6.0;

/// Text size of a jump chip's label.
const CHIP_SIZE: f32 = 10.5;

/// The jump row is six chips around one play control, and the chips are sized from that. Checked
/// where either changes.
const _: () = assert!(JUMP_STEPS.len() == 6);

/// How far the seek keys move the playhead, in seconds.
pub const SEEK_STEP_SECS: i32 = 10;

/// How far they move it with `Shift` held.
pub const SEEK_STEP_LONG_SECS: i32 = 60;

/// Milliseconds one frame takes at each of the classic game speeds, which is what turns a frame
/// count into game time. Constant: this is the recorded speed the replay's frames were simulated
/// at, not the rate it is being played back at.
pub const FRAME_DELAY_MS: [u32; 7] = [167, 111, 83, 67, 56, 48, 42];

/// The ladder position at which the frame delay is divided by the playback multiplier.
const FASTEST_SPEED_INDEX: u32 = 6;

/// The ladder position at which it is multiplied by it instead, which is how a replay is played
/// back slower than it was recorded.
const SLOWEST_SPEED_INDEX: u32 = 0;

/// One rung of the playback speed ladder: how it reads on the plate, and the pair the speed command
/// carries to select it.
///
/// The pair is not a rate. The game rebuilds its frame-delay table from the two: at every index
/// but the slowest the classic delay for that index is divided by the multiplier, and at the
/// slowest it is multiplied instead. So a rung slower than the recorded speed is expressed by
/// stepping down the classic ladder with a multiplier of 1: the slowest classic speed runs one
/// frame in 167 ms against the fastest's 42 ms, which is a quarter of the pace, and the third
/// rung's 83 ms is half of it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SpeedStep {
    /// The classic game-speed ladder position, 0 (slowest) to 6 (fastest).
    pub speed_index: u32,
    /// What the frame delay at that position is scaled by.
    pub multiplier: u32,
    /// How the step reads on the plate, without its multiplication sign.
    pub label: &'static str,
}

impl SpeedStep {
    /// How fast playback runs at this rung, as a multiple of the fastest classic speed, which is
    /// the speed every ShieldBattery replay was recorded at.
    pub fn rate(self) -> f32 {
        let multiplier = self.multiplier.max(1) as f32;
        let classic = FRAME_DELAY_MS[(self.speed_index as usize).min(FRAME_DELAY_MS.len() - 1)];
        let delay = if self.speed_index == SLOWEST_SPEED_INDEX {
            classic as f32 * multiplier
        } else {
            classic as f32 / multiplier
        };
        FRAME_DELAY_MS[FASTEST_SPEED_INDEX as usize] as f32 / delay
    }
}

/// The speed steps the plate offers, slowest first.
pub const SPEED_LADDER: [SpeedStep; 7] = [
    SpeedStep {
        speed_index: SLOWEST_SPEED_INDEX,
        multiplier: 1,
        label: ".25",
    },
    SpeedStep {
        // The classic "fast" speed, whose 83 ms frame is half the pace of the fastest one.
        speed_index: 2,
        multiplier: 1,
        label: ".5",
    },
    SpeedStep {
        speed_index: FASTEST_SPEED_INDEX,
        multiplier: 1,
        label: "1",
    },
    SpeedStep {
        speed_index: FASTEST_SPEED_INDEX,
        multiplier: 2,
        label: "2",
    },
    SpeedStep {
        speed_index: FASTEST_SPEED_INDEX,
        multiplier: 4,
        label: "4",
    },
    SpeedStep {
        speed_index: FASTEST_SPEED_INDEX,
        multiplier: 8,
        label: "8",
    },
    SpeedStep {
        speed_index: FASTEST_SPEED_INDEX,
        multiplier: 16,
        label: "16",
    },
];

/// The rung a replay plays back at before anything has been asked of it: the speed it was recorded
/// at, unscaled.
pub const NORMAL_SPEED: SpeedStep = SPEED_LADDER[2];

/// The unscaled rung is what the ladder is read from and what a replay starts on, so its place in
/// the table is not free to move. Checked where the table is written.
const _: () =
    assert!(NORMAL_SPEED.speed_index == FASTEST_SPEED_INDEX && NORMAL_SPEED.multiplier == 1);

/// Which rung of the ladder a speed pair is standing on.
///
/// An exact match first, then the rung whose rate is closest: the game's own plate can set a pair
/// that is not on this ladder, and the answer to that is the nearest rung rather than no rung at
/// all, so the stepper keeps working from wherever playback actually is.
pub fn current_step(speed_index: u32, multiplier: u32) -> usize {
    let exact = SPEED_LADDER
        .iter()
        .position(|step| step.speed_index == speed_index && step.multiplier == multiplier);
    if let Some(index) = exact {
        return index;
    }
    let rate = SpeedStep {
        speed_index,
        multiplier,
        label: "",
    }
    .rate();
    let mut nearest = 0;
    let mut best = f32::INFINITY;
    for (index, step) in SPEED_LADDER.iter().enumerate() {
        // Compared as a ratio rather than a difference: the ladder doubles at every rung, so the
        // gap between 8 and 16 would otherwise swamp every gap below it.
        let distance = (step.rate() / rate).ln().abs();
        if distance < best {
            best = distance;
            nearest = index;
        }
    }
    nearest
}

/// The rung `delta` steps away from where playback is, stopping at the ends of the ladder rather
/// than wrapping: a caster holding the speed-up key must not land back on quarter speed.
pub fn step_speed(speed_index: u32, multiplier: u32, delta: i32) -> SpeedStep {
    let current = current_step(speed_index, multiplier) as i32;
    let last = SPEED_LADDER.len() as i32 - 1;
    SPEED_LADDER[current.saturating_add(delta).clamp(0, last) as usize]
}

/// Milliseconds one frame of a replay recorded at `game_speed` took.
pub fn frame_delay_ms(game_speed: u8) -> u32 {
    FRAME_DELAY_MS
        .get(game_speed as usize)
        .copied()
        .unwrap_or(FRAME_DELAY_MS[FASTEST_SPEED_INDEX as usize])
}

/// How far into the game a frame count is, in whole seconds.
pub fn frames_to_seconds(frames: u32, game_speed: u8) -> u64 {
    u64::from(frames) * u64::from(frame_delay_ms(game_speed)) / 1000
}

/// How many frames a span of seconds covers.
pub fn seconds_to_frames(seconds: i64, game_speed: u8) -> i64 {
    seconds * 1000 / i64::from(frame_delay_ms(game_speed))
}

/// Everything the replay transport needs to draw itself. The host builds it from the replay header,
/// the game's frame counter and the playback state it tracks off the command stream.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct TransportView {
    /// How far playback has got, in frames.
    pub elapsed_frames: u32,
    /// The replay's last frame, from its header.
    pub end_frames: u32,
    /// The classic game speed the replay was recorded at, which is what its frames are timed by.
    pub game_speed: u8,
    /// Whether playback is stopped.
    pub paused: bool,
    /// The ladder position playback is running at.
    pub speed_index: u32,
    /// What the frame delay at that position is scaled by.
    pub multiplier: u32,
    /// Whether everything that gives the game's length away is withheld.
    pub spoiler_free: bool,
    /// Whether a seek has been asked for and has not taken effect yet. The game refuses a second
    /// one while the first is in flight, so a sender waits rather than losing it.
    pub seek_pending: bool,
}

impl TransportView {
    /// How far along the replay is, from 0 to 1. A replay whose header carries no end frame reads
    /// as not started, which leaves the playhead at the left rather than at either end of a track
    /// that means nothing.
    pub fn progress(&self) -> f32 {
        if self.end_frames == 0 {
            return 0.0;
        }
        (self.elapsed_frames as f32 / self.end_frames as f32).clamp(0.0, 1.0)
    }

    /// The frame `delta_secs` from where playback is, clamped to the replay.
    pub fn seek_target(&self, delta_secs: i32) -> u32 {
        let delta = seconds_to_frames(i64::from(delta_secs), self.game_speed);
        self.frame_at(i64::from(self.elapsed_frames) + delta)
    }

    /// The frame a fraction of the way through the replay.
    pub fn seek_fraction(&self, fraction: f32) -> u32 {
        self.frame_at((fraction.clamp(0.0, 1.0) * self.end_frames as f32) as i64)
    }

    /// `frame` clamped to the replay, which is where the game would clamp it to anyway.
    pub fn frame_at(&self, frame: i64) -> u32 {
        frame.clamp(0, i64::from(self.end_frames)) as u32
    }

    /// The rung playback is standing on.
    pub fn step(&self) -> SpeedStep {
        SPEED_LADDER[current_step(self.speed_index, self.multiplier)]
    }
}

/// What the player asked the transport for this frame. Every field is what they asked for rather
/// than what happened: the shell decides what reaches the game and when.
pub struct TransportOutcome {
    /// Where the plate is on screen, for the host's hit testing.
    pub rect: Rect,
    /// A frame to jump to.
    pub seek_to: Option<u32>,
    /// A speed step to move to.
    pub speed: Option<SpeedStep>,
    /// Whether playback should be stopped.
    pub paused: Option<bool>,
    /// Whether the length and the track should be withheld.
    pub spoiler_free: Option<bool>,
}

impl TransportOutcome {
    fn new() -> TransportOutcome {
        TransportOutcome {
            rect: Rect::NOTHING,
            seek_to: None,
            speed: None,
            paused: None,
            spoiler_free: None,
        }
    }
}

/// Draws the transport plate in the corner the game's own replay controls sit in, fading and
/// sliding it in and out. Returns nothing at all once it is gone, which is when the game's own
/// plate may come back.
pub fn render_transport_view(
    view: &TransportView,
    ctx: &Context,
    shown: bool,
) -> Option<TransportOutcome> {
    let id = Id::new("sb_replay_transport");
    let area = Area::new(id)
        .anchor(Align2::RIGHT_BOTTOM, vec2(-EDGE_MARGIN, -EDGE_MARGIN))
        .order(Order::Foreground);
    let inner = motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        tiers::tier0_panel(ui, |ui| {
            ui.set_width(CONTENT_WIDTH);
            draw_plate(ui, view)
        })
        .inner
    })?;
    let mut outcome = inner.inner;
    outcome.rect = inner.response.rect;
    Some(outcome)
}

fn draw_plate(ui: &mut Ui, view: &TransportView) -> TransportOutcome {
    // The rows are stacked by the gaps written here and by nothing else: the plate's height is the
    // footprint its two forms share, and egui's own spacing between items would add to it.
    ui.spacing_mut().item_spacing = Vec2::ZERO;
    let mut outcome = TransportOutcome::new();
    row(ui, INFO_ROW, |ui| draw_info_row(ui, view, &mut outcome));
    ui.add_space(ROW_GAP);
    row(ui, TRACK_ROW, |ui| {
        if view.spoiler_free {
            draw_hidden_length(ui, &mut outcome);
        } else {
            draw_track_row(ui, view, &mut outcome);
        }
    });
    ui.add_space(ROW_GAP);
    row(ui, CHIP_ROW, |ui| draw_jump_row(ui, view, &mut outcome));
    outcome
}

/// One row of the plate, laid out left to right with only the gaps its cells ask for.
fn row(ui: &mut Ui, height: f32, add: impl FnOnce(&mut Ui)) {
    ui.allocate_ui_with_layout(
        vec2(CONTENT_WIDTH, height),
        Layout::left_to_right(Align::Center),
        |ui| {
            ui.spacing_mut().item_spacing = Vec2::ZERO;
            ui.set_min_height(height);
            add(ui);
        },
    );
}

/// The row that says where playback is and how fast it is running: the elapsed clock at one end and
/// the speed stepper at the other, with the spoiler-free form's stopped tag beside the clock.
fn draw_info_row(ui: &mut Ui, view: &TransportView, outcome: &mut TransportOutcome) {
    clock(
        ui,
        view.elapsed_frames,
        view.game_speed,
        CLOCK_SIZE,
        CLOCK_WIDTH,
        theme::TEXT_PRIMARY,
    );
    let mut slack = CONTENT_WIDTH - CLOCK_WIDTH - STEPPER_WIDTH;
    if view.spoiler_free {
        ui.add_space(ITEM_GAP);
        // The slot is spent whether or not playback is stopped, so starting and stopping it does
        // not slide the stepper along the row.
        if view.paused {
            widgets::tag_exact(
                ui,
                &small_label(),
                &tr!("transport.paused", "Paused"),
                TagStyle::Amber,
                vec2(PAUSED_TAG_WIDTH, TAG_HEIGHT),
            );
        } else {
            ui.allocate_exact_size(vec2(PAUSED_TAG_WIDTH, TAG_HEIGHT), Sense::hover());
        }
        slack -= ITEM_GAP + PAUSED_TAG_WIDTH;
    }
    ui.add_space(slack);
    draw_speed_stepper(ui, view, outcome);
}

/// The speed stepper: one step down, the rung playback is on, one step up.
fn draw_speed_stepper(ui: &mut Ui, view: &TransportView, outcome: &mut TransportOutcome) {
    let step = view.step();
    // Arithmetic signs rather than words: every language writes them the same way, and a stepper
    // whose ends carried a translated verb would be a paragraph wide in some of them.
    if stepper_button(ui, "\u{2212}").clicked() {
        outcome.speed = Some(step_speed(view.speed_index, view.multiplier, -1));
    }
    ui.add_space(ITEM_GAP);
    widgets::text_cell(
        ui,
        &text::numeral(SPEED_SIZE),
        &tr!("transport.speed", "\u{d7}{{rate}}", rate = step.label),
        vec2(SPEED_WIDTH, INFO_ROW),
        Align::Center,
    );
    ui.add_space(ITEM_GAP);
    if stepper_button(ui, "+").clicked() {
        outcome.speed = Some(step_speed(view.speed_index, view.multiplier, 1));
    }
}

/// The track row of the standard form: where the replay is, how long it runs, and the one click
/// that stops saying so.
fn draw_track_row(ui: &mut Ui, view: &TransportView, outcome: &mut TransportOutcome) {
    let track = widgets::scrub_track(ui, view.progress(), vec2(TRACK_WIDTH, TRACK_ROW));
    if let Some(target) = track.target {
        outcome.seek_to = Some(view.seek_fraction(target));
    }
    ui.add_space(ITEM_GAP);
    clock(
        ui,
        view.end_frames,
        view.game_speed,
        LENGTH_SIZE,
        LENGTH_WIDTH,
        theme::TEXT_DIM,
    );
    ui.add_space(ITEM_GAP);
    if eye_button(ui).clicked() {
        outcome.spoiler_free = Some(true);
    }
}

/// What stands in for the track in the spoiler-free form: the reason it is not there, and the one
/// click that brings it back. A click and never a hover, because a pointer crossing the plate on
/// its way somewhere else must not spoil the game the viewer asked not to be told about.
fn draw_hidden_length(ui: &mut Ui, outcome: &mut TransportOutcome) {
    widgets::text_cell(
        ui,
        &small_label().with_color(theme::TEXT_DIM),
        &tr!("transport.lengthHidden", "Length hidden"),
        vec2(HIDDEN_LABEL_WIDTH, TRACK_ROW),
        Align::LEFT,
    );
    ui.add_space(ITEM_GAP);
    let reveal = widgets::chip_button(
        ui,
        &small_label(),
        &tr!("transport.reveal", "Reveal"),
        vec2(REVEAL_WIDTH, TAG_HEIGHT + 4.0),
    );
    if reveal.clicked() {
        outcome.spoiler_free = Some(false);
    }
}

/// The row of fixed jumps around the play control, which is how a viewer moves through a replay
/// without aiming at a track.
fn draw_jump_row(ui: &mut Ui, view: &TransportView, outcome: &mut TransportOutcome) {
    // Set in the body face rather than the numeral one, which every other number here uses: a jump
    // step is a signed label, and the condensed face draws its plus small and high above its minus,
    // which would leave the six chips reading as two different rows.
    let spec = text::body(CHIP_SIZE, BodyWeight::Semibold).with_color(theme::TEXT_SECONDARY);
    let half = JUMP_STEPS.len() / 2;
    for (index, delta) in JUMP_STEPS.into_iter().enumerate() {
        if index > 0 {
            ui.add_space(CHIP_GAP);
        }
        if index == half {
            if play_pause_button(ui, view.paused).clicked() {
                outcome.paused = Some(!view.paused);
            }
            ui.add_space(CHIP_GAP);
        }
        let chip =
            widgets::chip_button(ui, &spec, &jump_label(delta), vec2(CHIP_WIDTH, CHIP_HEIGHT));
        if chip.clicked() {
            outcome.seek_to = Some(view.seek_target(delta));
        }
    }
}

/// How a jump chip reads: the direction, how far, and the unit it is measured in.
fn jump_label(delta_secs: i32) -> String {
    let sign = if delta_secs < 0 { "\u{2212}" } else { "+" };
    let magnitude = delta_secs.unsigned_abs();
    if magnitude.is_multiple_of(60) {
        tr!(
            "transport.jumpMinutes",
            "{{step}}m",
            step = format!("{sign}{}", magnitude / 60)
        )
    } else {
        tr!(
            "transport.jumpSeconds",
            "{{step}}s",
            step = format!("{sign}{magnitude}")
        )
    }
}

/// One clock, in its own fixed column so a replay crossing an hour moves nothing beside it.
fn clock(ui: &mut Ui, frames: u32, game_speed: u8, size: f32, width: f32, color: Color32) {
    widgets::text_cell(
        ui,
        &text::numeral(size).with_color(color),
        &clock_text(frames_to_seconds(frames, game_speed)),
        vec2(width, TRACK_ROW),
        Align::LEFT,
    );
}

/// The small capitals the plate's own words are set in, which is every word on it: it is a plate of
/// numbers, and a label here is telling the viewer what a number means.
fn small_label() -> text::TextSpec {
    text::column_label().with_color(theme::TEXT_SECONDARY)
}

/// Seconds as a game clock reads them, growing an hours field only once there is one.
fn clock_text(seconds: u64) -> String {
    let minutes = seconds / 60;
    let seconds = seconds % 60;
    if minutes >= 60 {
        format!("{}:{:02}:{seconds:02}", minutes / 60, minutes % 60)
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

/// One end of the speed stepper.
fn stepper_button(ui: &mut Ui, sign: &str) -> Response {
    widgets::chip_button(
        ui,
        &text::body(15.0, BodyWeight::Regular).with_color(theme::TEXT_SECONDARY),
        sign,
        vec2(BOX_SIZE, BOX_SIZE),
    )
}

/// The control that stops and starts playback, drawn rather than typed so no font has to carry the
/// glyphs. It shows what a click would do: a triangle while playback is stopped, two bars while it
/// is running. Filled rather than outlined, because it is the one control on the plate a viewer
/// reaches for without looking.
fn play_pause_button(ui: &mut Ui, paused: bool) -> Response {
    let (rect, response) = ui.allocate_exact_size(PLAY_SIZE, Sense::click());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    ui.painter().rect_filled(rect, corner_radius, BLUE60);
    // A light line just inside the top edge, which is what keeps a filled control from reading as a
    // flat patch of color.
    ui.painter().add(Shape::line_segment(
        [
            pos2(rect.left() + 2.0, rect.top() + theme::HAIRLINE * 0.5),
            pos2(rect.right() - 2.0, rect.top() + theme::HAIRLINE * 0.5),
        ],
        Stroke::new(theme::HAIRLINE, theme::alpha(BLUE80, 0.35)),
    ));
    widgets::state_overlay(ui, &response, rect, corner_radius);
    widgets::focus_ring(ui, &response, rect, corner_radius);
    let centre = rect.center();
    let glyph = theme::TEXT_PRIMARY;
    if paused {
        // Optically centred rather than geometrically: a triangle's mass sits behind its point, so
        // a centred bounding box reads as pushed to the right.
        let half = 6.0;
        let left = centre.x - half * 0.7;
        ui.painter().add(Shape::convex_polygon(
            vec![
                pos2(left, centre.y - half),
                pos2(left + half * 1.8, centre.y),
                pos2(left, centre.y + half),
            ],
            glyph,
            Stroke::NONE,
        ));
    } else {
        for offset in [-3.5f32, 3.5] {
            ui.painter().rect_filled(
                Rect::from_center_size(pos2(centre.x + offset, centre.y), vec2(3.0, 12.0)),
                theme::radius(1),
                glyph,
            );
        }
    }
    response
}

/// The control that hides the length, drawn as the eye it switches off.
fn eye_button(ui: &mut Ui) -> Response {
    let (rect, response) = ui.allocate_exact_size(vec2(BOX_SIZE, BOX_SIZE), Sense::click());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, theme::alpha(BLUE80, 0.25)),
        StrokeKind::Inside,
    ));
    widgets::state_overlay(ui, &response, rect, corner_radius);
    widgets::focus_ring(ui, &response, rect, corner_radius);
    let color = if response.hovered() {
        theme::TEXT_PRIMARY
    } else {
        theme::TEXT_SECONDARY
    };
    let centre = rect.center();
    let (half_width, half_height) = (9.0f32, 5.0f32);
    let stroke = Stroke::new(theme::HAIRLINE + 0.3, color);
    // Two parabolic arcs meeting at the corners, which is an almond close enough to an eye at this
    // size and needs no glyph to draw.
    let mut upper = Vec::with_capacity(9);
    let mut lower = Vec::with_capacity(9);
    for step in 0..=8u8 {
        let t = -1.0 + f32::from(step) / 4.0;
        let x = centre.x + t * half_width;
        let lid = half_height * (1.0 - t * t);
        upper.push(pos2(x, centre.y - lid));
        lower.push(pos2(x, centre.y + lid));
    }
    ui.painter().add(Shape::line(upper, stroke));
    ui.painter().add(Shape::line(lower, stroke));
    ui.painter().circle_filled(centre, 2.4, color);
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view() -> TransportView {
        TransportView {
            elapsed_frames: 15_000,
            end_frames: 60_000,
            game_speed: 6,
            paused: false,
            speed_index: 6,
            multiplier: 1,
            spoiler_free: false,
            seek_pending: false,
        }
    }

    #[test]
    fn the_plate_is_exactly_the_footprint_the_design_gives_it() {
        assert_eq!(tiers::panel_content_width(PANEL_WIDTH), CONTENT_WIDTH);
    }

    #[test]
    fn the_ladder_runs_from_a_quarter_speed_to_sixteen() {
        // The two rungs below normal come from the classic ladder's own delays (167 ms and 83 ms
        // against the fastest 42 ms), so they land within a hundredth of the labelled rate rather
        // than exactly on it.
        let expected = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0];
        for (step, expected) in SPEED_LADDER.iter().zip(expected) {
            let rate = step.rate();
            assert!(
                (rate - expected).abs() < 0.01,
                "{step:?} runs at {rate}, expected {expected}"
            );
        }
    }

    #[test]
    fn no_two_rungs_are_the_same_command() {
        for (index, step) in SPEED_LADDER.iter().enumerate() {
            for other in &SPEED_LADDER[index + 1..] {
                assert!(
                    step.speed_index != other.speed_index || step.multiplier != other.multiplier,
                    "{step:?} and {other:?} are the same command"
                );
            }
        }
    }

    #[test]
    fn stepping_stops_at_the_ends_of_the_ladder() {
        let slowest = SPEED_LADDER[0];
        assert_eq!(
            step_speed(slowest.speed_index, slowest.multiplier, -1),
            slowest
        );
        let fastest = SPEED_LADDER[SPEED_LADDER.len() - 1];
        assert_eq!(
            step_speed(fastest.speed_index, fastest.multiplier, 1),
            fastest
        );
    }

    #[test]
    fn stepping_from_a_pair_that_is_not_on_the_ladder_snaps_to_the_nearest_rung() {
        // Fastest tripled is not a rung the plate offers, but the game's own plate could have left
        // playback there; the step up from it is the rung above the one it is nearest.
        assert_eq!(step_speed(6, 3, 0).label, "4");
        assert_eq!(step_speed(6, 3, 1).label, "8");
    }

    #[test]
    fn game_time_comes_from_the_recorded_speed_and_not_the_playback_rate() {
        assert_eq!(frames_to_seconds(1000, 6), 42);
        assert_eq!(frames_to_seconds(1000, 0), 167);
        assert_eq!(seconds_to_frames(60, 6), 1428);
    }

    #[test]
    fn clocks_grow_an_hours_field_only_when_there_is_one() {
        assert_eq!(clock_text(0), "0:00");
        assert_eq!(clock_text(1068), "17:48");
        assert_eq!(clock_text(2492), "41:32");
        assert_eq!(clock_text(3930), "1:05:30");
    }

    #[test]
    fn a_seek_never_leaves_the_replay() {
        let view = view();
        assert_eq!(view.seek_target(-100_000), 0);
        assert_eq!(view.seek_target(100_000), view.end_frames);
        assert_eq!(view.seek_fraction(0.5), 30_000);
        assert_eq!(view.seek_fraction(2.0), view.end_frames);
    }

    #[test]
    fn a_replay_with_no_recorded_length_leaves_the_playhead_at_the_start() {
        let view = TransportView {
            end_frames: 0,
            ..view()
        };
        assert_eq!(view.progress(), 0.0);
        assert_eq!(view.seek_fraction(0.8), 0);
    }

    fn fresh_ctx() -> Context {
        let ctx = Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        ctx
    }

    /// Renders `view` a few times and returns the size the plate settled on: an area takes egui a
    /// couple of passes to resolve, and its entrance only finishes once the clock has moved.
    fn settled_size(ctx: &Context, view: &TransportView) -> Vec2 {
        let mut size = Vec2::ZERO;
        for pass in 0..6 {
            let raw = egui::RawInput {
                screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(1280.0, 720.0))),
                time: Some(f64::from(pass) * 0.25),
                ..Default::default()
            };
            ctx.begin_pass(raw);
            size = render_transport_view(view, ctx, true)
                .map(|outcome| outcome.rect.size())
                .unwrap_or(Vec2::ZERO);
            let mut out = ctx.end_pass();
            let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
            // Layout checks have no GPU texture store to update.
            out.textures_delta.clear();
        }
        size
    }

    /// Both forms share one footprint, so switching between them moves nothing on screen and the
    /// plate never covers more of the game than the design gave it.
    #[test]
    fn both_forms_take_the_designed_footprint() {
        let ctx = fresh_ctx();
        let standard = settled_size(&ctx, &view());
        assert_eq!(standard, vec2(PANEL_WIDTH, PANEL_HEIGHT));
        let spoiler_free = TransportView {
            spoiler_free: true,
            paused: true,
            speed_index: 0,
            multiplier: 4,
            elapsed_frames: 123_456,
            end_frames: 200_000,
            ..view()
        };
        assert_eq!(settled_size(&ctx, &spoiler_free), standard);
    }
}
