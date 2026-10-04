//! The network quality chip: a small ambient readout in the top-left corner of a game that rolls
//! back, with signal bars for how the connection plays and the two numbers behind them. Like the
//! other overlays here, it is a pure fn of [`NetQualityView`] plus an [`egui::Context`], so the
//! game DLL and the host preview draw the same thing.
//!
//! The numbers are frames, which at the Fastest game speed are about 42 ms each:
//!
//! - **D**, input delay: how many frames a command waits beyond the one every command waits for
//!   anyway (a command issued on one frame runs on the next, as in single player). 0 means no
//!   added delay.
//! - **R**, rollback: how many frames the simulation runs ahead of the newest step whose turns
//!   every player has sent. A turn that arrives late rewrites up to that many frames of what is on
//!   screen, so the bigger R is, the further units can visibly jump when a guess was wrong.
//!
//! Each player pays for their own connection with some mix of the two, so the bars rate the worse
//! of them rather than a sum.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use egui::emath::GuiRounding;
use egui::{
    Area, Color32, Context, CornerRadius, FontId, Galley, Id, Order, Painter, Pos2, Rect, Sense,
    Shadow, Shape, Stroke, StrokeKind, Vec2, pos2, vec2,
};

/// The screen height the chip's sizes are given at: one design unit is one pixel at 1080p, and the
/// chip scales with the screen from there, as the game's own text does.
pub const DESIGN_HEIGHT: f32 = 1080.0;

use crate::colors::{AMBER60, BLUE10, BLUE80, GREY_BLUE60, GREY_BLUE80, GREY99};
use crate::fonts::{body_medium, condensed};

/// What the chip shows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NetQualityView {
    /// Frames of input delay beyond the unavoidable one.
    pub delay: u32,
    /// Frames of rollback, already smoothed for display (see [`RecentRollback`]).
    pub rollback: u32,
    /// The height of the game's small font, if known, which sets where the game draws its FPS
    /// readout line (see [`fps_line_top`]). The chip moves up to stay clear of that line.
    pub fps_font_height: Option<u8>,
}

impl NetQualityView {
    /// How many of the four bars are lit: the worse of what the delay and the rollback each rate.
    pub fn bars(&self) -> u8 {
        delay_bars(self.delay).min(rollback_bars(self.rollback))
    }
}

/// Bars for `delay` frames of added input delay. A frame or so is lost in the noise of a hand on a
/// mouse; two or three (up to ~125 ms) are felt but play fine; from four (~170 ms) commands
/// noticeably trail the hand, and from seven (~290 ms) precise control suffers.
fn delay_bars(delay: u32) -> u8 {
    match delay {
        0..=1 => 4,
        2..=3 => 3,
        4..=6 => 2,
        _ => 1,
    }
}

/// Bars for `rollback` frames. Up to three frames is where rollback settles between distant
/// players, and its corrections stay within a few pixels; from four, fast units visibly jump when
/// a guess was wrong, and from six the simulation is near the prediction limit, where it stops
/// and waits for turns instead.
fn rollback_bars(rollback: u32) -> u8 {
    match rollback {
        0..=1 => 4,
        2..=3 => 3,
        4..=5 => 2,
        _ => 1,
    }
}

/// The color the lit bars take for a bar count. The count carries the rating without the color,
/// so a player who can't tell the hues apart loses nothing.
fn bar_color(bars: u8) -> Color32 {
    match bars {
        3.. => POSITIVE,
        2 => AMBER60,
        _ => NEGATIVE,
    }
}

/// How far back [`RecentRollback`] looks, ending at the newest tick.
const ROLLBACK_WINDOW: Duration = Duration::from_secs(3);
/// The percentile of the window's ticks that [`RecentRollback`] shows.
const ROLLBACK_PERCENTILE: usize = 90;

/// The rollback to show: the 90th percentile of what ticks ran with over the last few seconds.
///
/// Rollback moves by a frame or two from one tick to the next as turns arrive a little early or
/// late, which as a raw number is unreadable flicker. A high percentile settles near the top of
/// that jitter and holds still while the connection does. A burst of lateness lasting a tenth of
/// the window (~300 ms) or more raises it, and it falls back once the burst has mostly aged out.
/// A lone late turn, whose correction shows once and is gone, doesn't move it, where a peak would
/// hold that one turn up for the whole window and rate the connection by its worst moment.
/// Smoothing with an average would instead hide the bursts players actually see, and wobble
/// whenever the average sat near a rounding boundary.
#[derive(Debug, Default)]
pub struct RecentRollback {
    /// When each tick in the window ran and the rollback it ran with, oldest first.
    ticks: VecDeque<(Instant, u32)>,
}

impl RecentRollback {
    pub const fn new() -> RecentRollback {
        RecentRollback {
            ticks: VecDeque::new(),
        }
    }

    /// Notes that a tick at `now` ran with `rollback` frames.
    pub fn record(&mut self, now: Instant, rollback: u32) {
        while self
            .ticks
            .front()
            .is_some_and(|&(at, _)| now.saturating_duration_since(at) >= ROLLBACK_WINDOW)
        {
            self.ticks.pop_front();
        }
        self.ticks.push_back((now, rollback));
    }

    /// The rollback to show, or 0 before any tick has been recorded.
    ///
    /// The window ends at the newest tick rather than at the present, so while the simulation
    /// isn't stepping (it's waiting on a player, or the game is paused), the value holds where it
    /// was rather than reading as a perfect connection.
    pub fn shown(&self) -> u32 {
        let mut rollbacks: Vec<u32> = self.ticks.iter().map(|&(_, rollback)| rollback).collect();
        // Nearest rank: the smallest value at least this many of the window's ticks are within.
        let rank = (rollbacks.len() * ROLLBACK_PERCENTILE).div_ceil(100);
        if rank == 0 {
            return 0;
        }
        *rollbacks.select_nth_unstable(rank - 1).1
    }

    pub fn clear(&mut self) {
        self.ticks.clear();
    }
}

/// Where the chip's top-left corner sits on screen, unless the FPS line needs it higher.
const CHIP_POS: Pos2 = pos2(16.0, 16.0);
/// The least room left between the chip and the game's FPS line below it.
const FPS_LINE_GAP: f32 = 4.0;
/// The chip never goes closer to the top of the screen than this, however high the FPS line.
const CHIP_MIN_TOP: f32 = 4.0;
/// The chip is one fixed size in every state, so nothing beside it shifts as the numbers change.
const CHIP_SIZE: Vec2 = vec2(104.0, 24.0);
const CHIP_RADIUS: f32 = 4.0;
const CHIP_FILL: Color32 = alpha(BLUE10, 0.86);
/// The light halo just outside the chip's edge, in the app's dialog glow color: a ring at the edge
/// and fainter ones beyond it standing in for a blur. The chip sits over fog of war as often as over
/// terrain, where a dark fill alone disappears into the black, so the halo has to carry the chip's
/// shape by itself, and is brighter than the dialogs' for it.
const CHIP_GLOW: [Color32; 3] = [
    alpha(BLUE80, 0.60),
    alpha(BLUE80, 0.24),
    alpha(BLUE80, 0.08),
];
/// Lifts the chip off bright terrain, the way the halo lifts it off fog.
const CHIP_SHADOW: Shadow = Shadow {
    offset: [0, 2],
    blur: 10,
    spread: 0,
    color: Color32::from_black_alpha(89),
};
/// Space between the chip's side edges and its contents, and between the groups inside it.
const CHIP_PADDING: f32 = 8.0;
const CHIP_GAP: f32 = 8.0;

const BAR_COUNT: u8 = 4;
const BAR_WIDTH: f32 = 3.0;
const BAR_GAP: f32 = 2.0;
/// How much taller each bar is than the one before it; the first is this tall too.
const BAR_STEP: f32 = 3.0;
/// How much each bar's corners are cut off, which reads as a slight rounding. A true corner radius
/// can't go below a whole point, and on a bar this narrow one point rounds it into an oval.
const BAR_CORNER_CUT: f32 = 0.5;
const BARS_WIDTH: f32 = BAR_COUNT as f32 * BAR_WIDTH + (BAR_COUNT - 1) as f32 * BAR_GAP;
const BARS_HEIGHT: f32 = BAR_COUNT as f32 * BAR_STEP;
const BAR_UNLIT: Color32 = alpha(GREY_BLUE80, 0.22);
const POSITIVE: Color32 = Color32::from_rgb(0x69, 0xF0, 0xAE);
const NEGATIVE: Color32 = Color32::from_rgb(0xE6, 0x60, 0x60);

const NUMERAL_SIZE: f32 = 16.0;
/// The line box the numerals are centered in, which is taller than the glyphs themselves.
const NUMERAL_LINE_HEIGHT: f32 = 22.0;
const NUMERAL_COLOR: Color32 = GREY99;
/// The delay's numerals are right-aligned in a slot that fits two digits, the rollback's in one
/// that fits one, so a number changing never moves anything else.
const DELAY_DIGITS_WIDTH: f32 = 16.0;
const ROLLBACK_DIGITS_WIDTH: f32 = 8.0;
const UNIT_SIZE: f32 = 11.0;
const UNIT_COLOR: Color32 = GREY_BLUE60;
const UNIT_GAP: f32 = 4.0;
/// Width of the whole delay group: its digits, the gap and the unit letter.
const DELAY_GROUP_WIDTH: f32 = 30.0;
/// How far below center the text sits. Digits and capitals have no descenders, so text centered
/// by its line box reads as sitting high.
const OPTICAL_NUDGE: f32 = 1.0;

/// The height of the coordinate space the game draws its readouts in, which is the screen's height
/// at any resolution.
const GAME_UI_HEIGHT: f32 = 480.0;
/// Where the game draws its readout lines, in its own coordinates: the turn rate line (which the
/// chip replaces) at this spot, and the FPS line one small-font line below it. The FPS line stays
/// put whether or not the turn rate line is drawn.
const GAME_READOUT_TOP: f32 = 10.0;

/// Where the game's FPS readout line starts, in design units, for a small font `font_height` tall.
pub fn fps_line_top(font_height: u8) -> f32 {
    (GAME_READOUT_TOP + f32::from(font_height)) * DESIGN_HEIGHT / GAME_UI_HEIGHT
}

/// The top of the chip, in design units: its usual spot, or higher if the FPS line for a small
/// font `fps_font_height` tall would otherwise run into it.
fn chip_top(fps_font_height: Option<u8>) -> f32 {
    let clear_of_fps = fps_font_height.map_or(f32::INFINITY, |height| {
        fps_line_top(height) - FPS_LINE_GAP - CHIP_SIZE.y
    });
    CHIP_POS.y.min(clear_of_fps).max(CHIP_MIN_TOP)
}

/// Draws the chip in its corner, sized for the screen's height.
pub fn render_net_quality(view: &NetQualityView, ctx: &Context) {
    // Sizes are scaled where they're used rather than by transforming the finished shapes, so that
    // text is laid out at the size it shows at and stays crisp.
    let scale = ctx.content_rect().height() / DESIGN_HEIGHT;
    let origin = pos2(CHIP_POS.x, chip_top(view.fps_font_height)) * scale;
    Area::new(Id::new("net_quality"))
        .order(Order::Background)
        .fixed_pos(origin)
        .interactable(false)
        .show(ctx, |ui| {
            let (rect, _) = ui.allocate_exact_size(CHIP_SIZE * scale, Sense::hover());
            paint_chip(ui.painter(), rect, scale, view);
        });
}

fn paint_chip(painter: &Painter, rect: Rect, scale: f32, view: &NetQualityView) {
    // The chip's edges, its halo and its bars land on whole physical pixels. At any screen height
    // but 1080 the scaled sizes fall between pixels, and edges that small would otherwise be
    // smeared across two of them.
    let pixels_per_point = painter.pixels_per_point();
    let snap = |units: f32| (units * scale * pixels_per_point).round().max(1.0) / pixels_per_point;
    let rect = rect.round_to_pixels(pixels_per_point);
    let radius = |units: f32| CornerRadius::same(snap(units).round() as u8);

    let shadow = Shadow {
        offset: CHIP_SHADOW
            .offset
            .map(|x| (f32::from(x) * scale).round() as i8),
        blur: (f32::from(CHIP_SHADOW.blur) * scale).round() as u8,
        ..CHIP_SHADOW
    };
    painter.add(shadow.as_shape(rect, radius(CHIP_RADIUS)));
    painter.rect_filled(rect, radius(CHIP_RADIUS), CHIP_FILL);
    let ring_width = snap(1.0);
    for (ring, color) in CHIP_GLOW.into_iter().enumerate() {
        let ring = ring as f32;
        painter.rect_stroke(
            rect.expand(ring * ring_width),
            radius(CHIP_RADIUS + ring),
            Stroke::new(ring_width, color),
            StrokeKind::Outside,
        );
    }

    let bars = view.bars();
    let lit_color = bar_color(bars);
    let bar_width = snap(BAR_WIDTH);
    let bar_pitch = bar_width + snap(BAR_GAP);
    let bar_step = snap(BAR_STEP);
    let bars_left = rect.left() + snap(CHIP_PADDING);
    let bars_bottom = rect.top() + snap((CHIP_SIZE.y + BARS_HEIGHT) / 2.0);
    // At least half a pixel, or the cut vanishes into the edge's antialiasing.
    let corner_cut = (BAR_CORNER_CUT * scale).max(0.5 / pixels_per_point);
    for i in 0..BAR_COUNT {
        let left = bars_left + f32::from(i) * bar_pitch;
        let height = f32::from(i + 1) * bar_step;
        let bar = Rect::from_min_max(
            pos2(left, bars_bottom - height),
            pos2(left + bar_width, bars_bottom),
        );
        let color = if i < bars { lit_color } else { BAR_UNLIT };
        painter.add(cut_corner_rect(bar, corner_cut, color));
    }

    let delay_left = bars_left + (BARS_WIDTH + CHIP_GAP) * scale;
    let rollback_left = delay_left + (DELAY_GROUP_WIDTH + CHIP_GAP) * scale;
    let line_top = rect.center().y + (OPTICAL_NUDGE - NUMERAL_LINE_HEIGHT / 2.0) * scale;
    paint_value(
        painter,
        scale,
        line_top,
        delay_left,
        DELAY_DIGITS_WIDTH,
        view.delay,
        "D",
    );
    paint_value(
        painter,
        scale,
        line_top,
        rollback_left,
        ROLLBACK_DIGITS_WIDTH,
        view.rollback,
        "R",
    );
}

/// Draws `value` right-aligned in a slot `digits_width` design units wide starting at `left`,
/// followed by its unit letter, the two sharing a baseline within the line box that starts at
/// `line_top`.
fn paint_value(
    painter: &Painter,
    scale: f32,
    line_top: f32,
    left: f32,
    digits_width: f32,
    value: u32,
    unit: &str,
) {
    let numeral = painter.layout_no_wrap(
        value.to_string(),
        FontId::new(NUMERAL_SIZE * scale, condensed()),
        NUMERAL_COLOR,
    );
    let unit = painter.layout_no_wrap(
        unit.to_string(),
        FontId::new(UNIT_SIZE * scale, body_medium()),
        UNIT_COLOR,
    );
    let Some(metrics) = numeral.rows.first().and_then(|row| row.row.glyphs.first()) else {
        return;
    };
    // Where the numeral's baseline falls when its glyphs are centered in the line box, the way a
    // browser places text inside a taller line.
    let baseline =
        line_top + (NUMERAL_LINE_HEIGHT * scale - metrics.font_height) / 2.0 + metrics.font_ascent;
    let digits_right = left + digits_width * scale;
    let numeral_pos = pos2(
        digits_right - numeral.size().x,
        baseline - galley_baseline(&numeral),
    );
    let unit_pos = pos2(
        digits_right + UNIT_GAP * scale,
        baseline - galley_baseline(&unit),
    );
    painter.galley(numeral_pos, numeral, NUMERAL_COLOR);
    painter.galley(unit_pos, unit, UNIT_COLOR);
}

/// `rect` filled with `color`, its corners cut off `cut` deep.
fn cut_corner_rect(rect: Rect, cut: f32, color: Color32) -> Shape {
    let (left, right, top, bottom) = (rect.left(), rect.right(), rect.top(), rect.bottom());
    Shape::convex_polygon(
        vec![
            pos2(left + cut, top),
            pos2(right - cut, top),
            pos2(right, top + cut),
            pos2(right, bottom - cut),
            pos2(right - cut, bottom),
            pos2(left + cut, bottom),
            pos2(left, bottom - cut),
            pos2(left, top + cut),
        ],
        color,
        Stroke::NONE,
    )
}

/// How far below its top a single-line galley's baseline is.
fn galley_baseline(galley: &Galley) -> f32 {
    galley
        .rows
        .first()
        .map(|row| row.pos.y + row.row.glyphs.first().map_or(0.0, |glyph| glyph.pos.y))
        .unwrap_or(0.0)
}

/// A color at a fraction of full opacity.
const fn alpha(color: Color32, alpha: f32) -> Color32 {
    Color32::from_rgba_unmultiplied_const(
        color.r(),
        color.g(),
        color.b(),
        (alpha * 255.0 + 0.5) as u8,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bars(delay: u32, rollback: u32) -> u8 {
        NetQualityView {
            delay,
            rollback,
            fps_font_height: None,
        }
        .bars()
    }

    #[test]
    fn fps_line_scales_from_game_coordinates() {
        // One game unit is 2.25 design units, the 480-tall game space stretched to 1080.
        assert_eq!(fps_line_top(8), 40.5);
        assert_eq!(fps_line_top(14), 54.0);
    }

    #[test]
    fn chip_moves_up_only_as_far_as_the_fps_line_needs() {
        assert_eq!(chip_top(None), 16.0);
        assert_eq!(chip_top(Some(16)), 16.0);
        assert_eq!(chip_top(Some(8)), 40.5 - FPS_LINE_GAP - CHIP_SIZE.y);
        assert_eq!(chip_top(Some(0)), CHIP_MIN_TOP);
    }

    #[test]
    fn bars_rate_the_worse_of_delay_and_rollback() {
        assert_eq!(bars(0, 0), 4);
        assert_eq!(bars(1, 1), 4);
        // Distant players settle at three frames of rollback, which still rates well.
        assert_eq!(bars(0, 3), 3);
        assert_eq!(bars(3, 0), 3);
        assert_eq!(bars(1, 4), 2);
        assert_eq!(bars(4, 1), 2);
        assert_eq!(bars(0, 6), 1);
        assert_eq!(bars(7, 0), 1);
        assert_eq!(bars(13, 8), 1);
    }

    #[test]
    fn color_follows_the_bar_count() {
        assert_eq!(bar_color(4), POSITIVE);
        assert_eq!(bar_color(3), POSITIVE);
        assert_eq!(bar_color(2), AMBER60);
        assert_eq!(bar_color(1), NEGATIVE);
    }

    /// When the `tick`th tick runs, at the Fastest game speed.
    fn tick_at(start: Instant, tick: u64) -> Instant {
        start + Duration::from_millis(42 * tick)
    }

    #[test]
    fn shown_rollback_settles_on_the_top_of_jitter() {
        let start = Instant::now();
        let mut recent = RecentRollback::new();
        for tick in 0..240 {
            recent.record(tick_at(start, tick), 2 + (tick % 2) as u32);
            if tick > 0 {
                assert_eq!(recent.shown(), 3, "tick {tick}");
            }
        }
    }

    #[test]
    fn shown_rollback_ignores_a_lone_late_turn() {
        let start = Instant::now();
        let mut recent = RecentRollback::new();
        for tick in 0..240 {
            recent.record(tick_at(start, tick), if tick == 100 { 7 } else { 1 });
            if tick >= 10 {
                assert_eq!(recent.shown(), 1, "tick {tick}");
            }
        }
    }

    #[test]
    fn shown_rollback_follows_a_burst_until_it_ages_out() {
        let start = Instant::now();
        let mut recent = RecentRollback::new();
        // A full window of a steady connection, then half a second of lateness.
        let (burst_start, burst_end) = (72, 84);
        let mut shown = Vec::new();
        for tick in 0..300 {
            let late = (burst_start..burst_end).contains(&tick);
            recent.record(tick_at(start, tick as u64), if late { 6 } else { 1 });
            shown.push(recent.shown());
        }
        // A window of 72 ticks takes 8 late ones to tip its 90th percentile.
        assert_eq!(shown[burst_start + 6], 1);
        assert_eq!(shown[burst_start + 7], 6);
        // The whole burst is still in the window two seconds after it ends.
        assert_eq!(shown[burst_end + 48], 6);
        assert_eq!(shown[burst_end + 72], 1);
    }

    #[test]
    fn shown_rollback_holds_once_ticks_stop() {
        let start = Instant::now();
        let mut recent = RecentRollback::new();
        assert_eq!(recent.shown(), 0);
        for tick in 0..24 {
            recent.record(tick_at(start, tick), 5);
        }
        assert_eq!(recent.shown(), 5);
        // Ticks resuming long after take over from the held value at once.
        recent.record(start + ROLLBACK_WINDOW * 10, 1);
        assert_eq!(recent.shown(), 1);
    }
}
