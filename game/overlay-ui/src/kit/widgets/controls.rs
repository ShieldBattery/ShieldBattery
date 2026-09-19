//! The controls that carry a setting: a segmented choice, a strip of tabs, a switch and a
//! slider.

use std::ops::RangeInclusive;

use egui::{Rect, Response, Sense, Shape, Stroke, StrokeKind, Ui, Vec2, pos2, vec2};

use crate::colors::{
    BLUE60, BLUE70, BLUE80, BLUE95, BLUE99, GREY_BLUE40, GREY_BLUE60, GREY_BLUE70,
};
use crate::kit::text::{self, BodyWeight, TextSpec};
use crate::kit::theme;
use crate::kit::widgets::{active_halo, focus_ring, state_overlay};

/// Track height of a switch, which also sets its knob.
const SWITCH_HEIGHT: f32 = 24.0;
const SWITCH_WIDTH: f32 = 44.0;

/// How long a knob takes to travel when a switch is flipped.
const SWITCH_TRAVEL_SECS: f32 = 0.12;

/// Height of a slider's track.
const SLIDER_TRACK: f32 = 5.0;
/// Thickness of the bar a scrub track's playhead rides.
const SCRUB_BAR: f32 = 5.0;
/// Radius of a scrub track's playhead.
const SCRUB_HEAD: f32 = 5.5;
/// Corner radius of the bar, which is round enough at this thickness to read as a capsule.
const SCRUB_RADIUS: u8 = 2;
/// Radius of a slider's knob.
const SLIDER_KNOB: f32 = 8.0;
/// Room kept to the right of a slider for its value, and the size that value is set at.
const SLIDER_VALUE_WIDTH: f32 = 46.0;
const SLIDER_VALUE_SIZE: f32 = 18.0;

/// Height of a segmented chip and of a stepper's ends, which is the kit's own smallest control.
const CHIP_HEIGHT: f32 = theme::HIT_PANEL;

/// Horizontal padding inside a segmented chip, and the least it keeps once the row runs out of
/// room.
const SEGMENT_PAD_X: f32 = 14.0;
const SEGMENT_PAD_X_MIN: f32 = 4.0;

/// Gap between two chips of one control, narrow enough that the row reads as one choice rather
/// than as a handful of buttons beside each other.
const SEGMENT_GAP: f32 = theme::SPACE_XS;

/// The style a chip's label is set in: small, a touch heavier than body copy, and tracked apart so
/// a one-word choice does not read as a clump.
fn segment_spec() -> TextSpec {
    text::body(12.5, BodyWeight::Medium).with_letter_spacing(0.8)
}

/// How wide a row of these chips wants to be, for a caller sizing a row around one.
pub fn segmented_width(ui: &Ui, labels: &[&str]) -> f32 {
    let spec = segment_spec();
    let text: f32 = labels
        .iter()
        .map(|label| spec.galley(ui, label).size().x)
        .sum();
    text + SEGMENT_PAD_X * 2.0 * labels.len() as f32
        + SEGMENT_GAP * labels.len().saturating_sub(1) as f32
}

/// A row of mutually exclusive choices, one of which is always taken, sized to its labels.
///
/// Returns a response that reports `changed` when the selection moved, so a caller can persist the
/// setting without comparing values itself.
pub fn segmented(ui: &mut Ui, selected: &mut usize, labels: &[&str]) -> Response {
    let width = segmented_width(ui, labels).min(ui.available_width());
    segmented_sized(ui, selected, labels, vec2(width, CHIP_HEIGHT))
}

/// The same row in exactly `size`, for a control standing in someone else's grid.
///
/// The row never grows past the size it was given: one that did would be clipped mid-word by
/// whatever it sits in. It gives up its padding first and elides its labels second, in that order
/// because which chip is lit is what the row is read for at a glance, and that survives both.
pub fn segmented_sized(ui: &mut Ui, selected: &mut usize, labels: &[&str], size: Vec2) -> Response {
    let (rect, mut response) = ui.allocate_exact_size(size, Sense::hover());
    if labels.is_empty() {
        return response;
    }
    let spec = segment_spec();
    let natural: Vec<f32> = labels
        .iter()
        .map(|label| spec.galley(ui, label).size().x)
        .collect();
    let count = labels.len();
    let gaps = SEGMENT_GAP * count.saturating_sub(1) as f32;
    let text_total: f32 = natural.iter().sum();
    let pad_x = ((size.x - gaps - text_total) / (count as f32 * 2.0))
        .clamp(SEGMENT_PAD_X_MIN, SEGMENT_PAD_X);
    let room = (size.x - gaps - pad_x * 2.0 * count as f32).max(0.0);
    let fitted = fitted_labels(&natural, room);
    // Whatever the labels did not need is shared out evenly, so the chips fill the width they were
    // given rather than leaving a ragged tail inside someone else's column.
    let slack = (room - fitted.iter().sum::<f32>()).max(0.0) / count as f32;

    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    let mut left = rect.left();
    for (index, label) in labels.iter().enumerate() {
        let width = fitted[index] + slack + pad_x * 2.0;
        let chip = Rect::from_min_size(pos2(left, rect.top()), vec2(width, size.y));
        left = chip.right() + SEGMENT_GAP;
        let chip_response = ui.interact(chip, response.id.with(index), Sense::click());
        if chip_response.clicked() && *selected != index {
            *selected = index;
            response.mark_changed();
        }
        if !ui.is_rect_visible(chip) {
            continue;
        }
        let active = *selected == index;
        if active {
            ui.painter()
                .rect_filled(chip, corner_radius, theme::alpha(BLUE60, 0.35));
            active_halo(ui, chip, corner_radius, BLUE60);
        }
        ui.painter().add(Shape::rect_stroke(
            chip,
            corner_radius,
            Stroke::new(
                theme::HAIRLINE,
                if active {
                    theme::alpha(BLUE80, 0.80)
                } else {
                    theme::alpha(BLUE70, 0.35)
                },
            ),
            StrokeKind::Inside,
        ));
        state_overlay(ui, &chip_response, chip, corner_radius);
        focus_ring(ui, &chip_response, chip, corner_radius);
        let color = if active { BLUE99 } else { GREY_BLUE70 };
        let job = spec.job_truncated(label, fitted[index] + slack);
        let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
        ui.painter()
            .galley(chip.center() - galley.size() * 0.5, galley, color);
    }
    response
}

/// How wide a stepper's square ends are.
const STEPPER_END: f32 = CHIP_HEIGHT;

/// A value with a step either side, for a choice from a list too long to lay out as chips.
///
/// Returns which way the player asked to move, and nothing on the frames they did not: the list is
/// the caller's, so walking it — and deciding whether it wraps — is theirs too.
pub fn stepper(ui: &mut Ui, label: &str, size: Vec2) -> i32 {
    // The ends take their ids from the control's own allocation rather than from the `Ui` they
    // stand in, so two steppers in one row of a layout are two controls rather than one reported
    // twice.
    let (rect, response) = ui.allocate_exact_size(size, Sense::hover());
    let back = Rect::from_min_size(rect.min, vec2(STEPPER_END, size.y));
    let forward = Rect::from_min_size(
        pos2(rect.right() - STEPPER_END, rect.top()),
        vec2(STEPPER_END, size.y),
    );
    let value = Rect::from_min_max(
        pos2(back.right() + SEGMENT_GAP, rect.top()),
        pos2(forward.left() - SEGMENT_GAP, rect.bottom()),
    );
    let mut delta = 0;
    if stepper_end(ui, response.id.with("back"), back, false).clicked() {
        delta -= 1;
    }
    if stepper_end(ui, response.id.with("forward"), forward, true).clicked() {
        delta += 1;
    }
    if value.is_positive() && ui.is_rect_visible(value) {
        let spec = text::body(15.0, BodyWeight::Regular);
        let job = spec.job_truncated(label, value.width());
        let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
        ui.painter()
            .galley(value.center() - galley.size() * 0.5, galley, spec.color);
    }
    delta
}

/// One end of a stepper: a chip with a triangle pointing the way it steps.
///
/// The triangle is painted rather than typed, so no font has to carry the glyph and no language
/// writes the control differently.
fn stepper_end(ui: &mut Ui, id: egui::Id, rect: Rect, forward: bool) -> Response {
    let response = ui.interact(rect, id, Sense::click());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, theme::alpha(BLUE70, 0.35)),
        StrokeKind::Inside,
    ));
    state_overlay(ui, &response, rect, corner_radius);
    focus_ring(ui, &response, rect, corner_radius);
    let color = if response.hovered() {
        BLUE99
    } else {
        GREY_BLUE70
    };
    let centre = rect.center();
    let half = 5.0;
    let tip = if forward { half } else { -half };
    ui.painter().add(Shape::convex_polygon(
        vec![
            pos2(centre.x + tip, centre.y),
            pos2(centre.x - tip, centre.y - half),
            pos2(centre.x - tip, centre.y + half),
        ],
        color,
        Stroke::NONE,
    ));
    response
}

/// An on/off switch. The knob glows while it is on, so the state survives a glance over gameplay.
pub fn switch(ui: &mut Ui, on: &mut bool) -> Response {
    let (rect, mut response) =
        ui.allocate_exact_size(vec2(SWITCH_WIDTH, theme::HIT_PANEL), Sense::click());
    if response.clicked() {
        *on = !*on;
        response.mark_changed();
    }

    let track = Rect::from_center_size(rect.center(), vec2(SWITCH_WIDTH, SWITCH_HEIGHT));
    let corner_radius = theme::radius((SWITCH_HEIGHT * 0.5) as u8);
    let travel = ui
        .ctx()
        .animate_bool_with_time(response.id.with("knob"), *on, SWITCH_TRAVEL_SECS);
    if !ui.is_rect_visible(rect) {
        return response;
    }

    let track_fill = if *on {
        BLUE60.gamma_multiply(0.45)
    } else {
        theme::alpha(GREY_BLUE40, 0.55)
    };
    ui.painter().rect_filled(track, corner_radius, track_fill);
    ui.painter().add(Shape::rect_stroke(
        track,
        corner_radius,
        Stroke::new(
            theme::HAIRLINE,
            if *on {
                BLUE60.gamma_multiply(0.85)
            } else {
                theme::TIER0_STROKE
            },
        ),
        StrokeKind::Inside,
    ));

    let knob_radius = SWITCH_HEIGHT * 0.5 - 3.0;
    let inset = knob_radius + 3.0;
    let centre = pos2(
        track.left() + inset + (track.width() - inset * 2.0) * travel,
        track.center().y,
    );
    if *on {
        for (step, alpha) in [(2.0f32, 0.35f32), (4.0, 0.16), (6.0, 0.07)] {
            ui.painter()
                .circle_filled(centre, knob_radius + step, BLUE60.gamma_multiply(alpha));
        }
    }
    let knob_color = if *on { BLUE95 } else { GREY_BLUE60 };
    ui.painter().circle_filled(centre, knob_radius, knob_color);
    state_overlay(ui, &response, track, corner_radius);
    focus_ring(ui, &response, track, corner_radius);
    response
}

/// What a scrub track reported back.
pub struct ScrubTrack {
    pub response: Response,
    /// Where the pointer is asking to move to, from 0 to 1, while it is pressing the track.
    /// `None` on every frame the player is not moving it.
    pub target: Option<f32>,
}

/// A track carrying a playhead: the part already behind it is filled, and a click or a drag
/// anywhere along it asks to move there.
///
/// While the pointer is down the head is drawn where the pointer is rather than where `fraction`
/// says, because whatever is being scrubbed takes time to follow: a head that snapped back to the
/// old position every frame could not be dragged at all.
pub fn scrub_track(ui: &mut Ui, fraction: f32, size: Vec2) -> ScrubTrack {
    let (rect, response) = ui.allocate_exact_size(size, Sense::click_and_drag());
    let bar = Rect::from_min_max(
        pos2(rect.left() + SCRUB_HEAD, rect.center().y - SCRUB_BAR * 0.5),
        pos2(rect.right() - SCRUB_HEAD, rect.center().y + SCRUB_BAR * 0.5),
    );
    let target = response.interact_pointer_pos().map(|pointer| {
        ((pointer.x - bar.left()) / bar.width().max(f32::MIN_POSITIVE)).clamp(0.0, 1.0)
    });
    let drawn = target.unwrap_or(fraction).clamp(0.0, 1.0);
    if !ui.is_rect_visible(rect) {
        return ScrubTrack { response, target };
    }

    let corner_radius = theme::radius(SCRUB_RADIUS);
    let painter = ui.painter();
    painter.rect_filled(bar, corner_radius, theme::alpha(GREY_BLUE60, 0.30));
    let mut played = bar;
    played.set_right(bar.left() + bar.width() * drawn);
    if played.width() > 0.0 {
        painter.rect_filled(played, corner_radius, BLUE60);
    }

    let head = pos2(played.right(), bar.center().y);
    if response.hovered() || response.is_pointer_button_down_on() {
        for (step, alpha) in [(2.0f32, 0.35f32), (4.0, 0.16), (6.0, 0.07)] {
            painter.circle_filled(head, SCRUB_HEAD + step, BLUE60.gamma_multiply(alpha));
        }
    }
    painter.circle_filled(head, SCRUB_HEAD, BLUE99);
    focus_ring(ui, &response, rect, corner_radius);
    ScrubTrack { response, target }
}

/// A value between two bounds, with the value itself shown in condensed numerals beside it.
pub fn slider(ui: &mut Ui, value: &mut f32, range: RangeInclusive<f32>) -> Response {
    let width = ui.available_width().clamp(160.0, 320.0);
    slider_sized(ui, value, range, 0.0, vec2(width, theme::HIT_PANEL))
}

/// The same slider in exactly `size`, moving in whole `step`s.
///
/// A step of zero is a value that moves continuously. Anything else is a setting the game keeps in
/// notches, and a slider that let the player land between two of them would report a value the game
/// would quietly round away.
pub fn slider_sized(
    ui: &mut Ui,
    value: &mut f32,
    range: RangeInclusive<f32>,
    step: f32,
    size: Vec2,
) -> Response {
    let (rect, mut response) = ui.allocate_exact_size(size, Sense::click_and_drag());
    let track = Rect::from_min_max(
        pos2(
            rect.left() + SLIDER_KNOB,
            rect.center().y - SLIDER_TRACK * 0.5,
        ),
        pos2(
            rect.right() - SLIDER_VALUE_WIDTH - SLIDER_KNOB,
            rect.center().y + SLIDER_TRACK * 0.5,
        ),
    );
    let span = (range.end() - range.start()).max(f32::MIN_POSITIVE);

    if let Some(pointer) = response.interact_pointer_pos() {
        let fraction =
            ((pointer.x - track.left()) / track.width().max(f32::MIN_POSITIVE)).clamp(0.0, 1.0);
        let new_value = snap(range.start() + fraction * span, *range.start(), step);
        if new_value != *value {
            *value = new_value;
            response.mark_changed();
        }
    }
    *value = value.clamp(*range.start(), *range.end());
    let fraction = ((*value - range.start()) / span).clamp(0.0, 1.0);

    if !ui.is_rect_visible(rect) {
        return response;
    }
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    let painter = ui.painter();
    painter.rect_filled(track, corner_radius, theme::alpha(GREY_BLUE60, 0.35));
    let mut filled = track;
    filled.set_right(track.left() + track.width() * fraction);
    painter.rect_filled(filled, corner_radius, BLUE60);

    let centre = pos2(filled.right(), track.center().y);
    for (ring, alpha) in [(3.0f32, 0.30f32), (6.0, 0.14), (9.0, 0.06)] {
        painter.circle_filled(centre, SLIDER_KNOB + ring, BLUE60.gamma_multiply(alpha));
    }
    painter.circle_filled(centre, SLIDER_KNOB, BLUE99);
    focus_ring(ui, &response, track.expand(SLIDER_KNOB), corner_radius);

    // A stepped slider reports whole notches, so its readout has no decimals to show.
    let decimals = usize::from(step <= 0.0 && span < 20.0);
    let readout = text::numeral(SLIDER_VALUE_SIZE).galley(ui, &format!("{value:.decimals$}"));
    ui.painter().galley(
        pos2(
            rect.right() - readout.size().x,
            rect.center().y - readout.size().y * 0.5,
        ),
        readout,
        theme::TEXT_PRIMARY,
    );
    response
}

/// `value` moved to the nearest notch of `step` counted from `origin`, or left alone when the
/// slider has no notches.
fn snap(value: f32, origin: f32, step: f32) -> f32 {
    if step <= 0.0 {
        return value;
    }
    origin + ((value - origin) / step).round() * step
}

/// Horizontal padding inside a tab chip, and the least it may keep once the strip runs out of room.
const TAB_PAD_X: f32 = 10.0;
const TAB_PAD_X_MIN: f32 = 3.0;

/// Vertical padding inside a tab chip.
const TAB_PAD_Y: f32 = 4.0;

/// Gap between two chips. Narrow enough that the row reads as one control rather than as a handful
/// of buttons that happen to be beside each other.
const TAB_GAP: f32 = theme::SPACE_XS;

/// How wide a strip of these labels wants to be, for a caller reserving room for one beside
/// something else.
pub fn tab_strip_width(ui: &Ui, labels: &[&str]) -> f32 {
    let spec = text::column_label();
    let text: f32 = labels
        .iter()
        .map(|label| spec.galley(ui, label).size().x)
        .sum();
    text + chrome_width(labels.len(), TAB_PAD_X)
}

/// A row of chips naming what one surface could be showing, the one it is showing lit. Returns the
/// chip that was clicked.
///
/// The strip never grows past `max_width`: a row that did would be clipped mid-word by whatever it
/// sits in. It gives up its padding first and elides its labels second, in that order because which
/// chip is lit is what the strip is read for at a glance, and that survives both.
pub fn tab_strip(ui: &mut Ui, selected: usize, labels: &[&str], max_width: f32) -> Option<usize> {
    if labels.is_empty() {
        return None;
    }
    let spec = text::column_label();
    let natural: Vec<f32> = labels
        .iter()
        .map(|label| spec.galley(ui, label).size().x)
        .collect();
    let text_total: f32 = natural.iter().sum();
    let count = labels.len();
    let gaps = TAB_GAP * count.saturating_sub(1) as f32;
    // The padding is what a crowded strip gives up first: a chip drawn tight is still a chip, and
    // a label cut short is a name the watcher has to guess at.
    let pad_x =
        ((max_width - gaps - text_total) / (count as f32 * 2.0)).clamp(TAB_PAD_X_MIN, TAB_PAD_X);
    let room = (max_width - chrome_width(count, pad_x)).max(0.0);
    let fitted = fitted_labels(&natural, room);

    let galleys: Vec<_> = labels
        .iter()
        .zip(&fitted)
        .zip(&natural)
        .map(|((label, fitted), natural)| {
            let job = if fitted < natural {
                spec.job_truncated(label, *fitted)
            } else {
                spec.job(label)
            };
            ui.ctx().fonts_mut(|fonts| fonts.layout_job(job))
        })
        .collect();
    // An elided galley can come back a hair over the width it was given, since the ellipsis is
    // added after the fit, so each chip is clamped rather than trusted.
    let widths: Vec<f32> = galleys
        .iter()
        .zip(&fitted)
        .map(|(galley, fitted)| galley.size().x.min(*fitted) + pad_x * 2.0)
        .collect();
    let height = galleys
        .iter()
        .map(|galley| galley.size().y)
        .fold(0.0, f32::max)
        + TAB_PAD_Y * 2.0;
    let (rect, response) = ui.allocate_exact_size(
        vec2(widths.iter().sum::<f32>() + gaps, height),
        Sense::hover(),
    );

    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    let mut clicked = None;
    let mut left = rect.left();
    for (index, galley) in galleys.into_iter().enumerate() {
        let chip = Rect::from_min_size(pos2(left, rect.top()), vec2(widths[index], height));
        left = chip.right() + TAB_GAP;
        let chip_response = ui.interact(chip, response.id.with(index), Sense::click());
        if chip_response.clicked() {
            clicked = Some(index);
        }
        let active = index == selected;
        if active {
            ui.painter()
                .rect_filled(chip, corner_radius, theme::alpha(BLUE60, 0.35));
        }
        ui.painter().add(Shape::rect_stroke(
            chip,
            corner_radius,
            Stroke::new(
                theme::HAIRLINE,
                theme::alpha(BLUE60, if active { 0.70 } else { 0.25 }),
            ),
            StrokeKind::Inside,
        ));
        state_overlay(ui, &chip_response, chip, corner_radius);
        focus_ring(ui, &chip_response, chip, corner_radius);
        let color = if active { BLUE99 } else { GREY_BLUE70 };
        ui.painter()
            .galley(chip.center() - galley.size() * 0.5, galley, color);
    }
    clicked
}

/// Everything a strip of `count` chips takes up besides its labels: the padding inside each chip
/// and the gaps between them.
fn chrome_width(count: usize, pad_x: f32) -> f32 {
    pad_x * 2.0 * count as f32 + TAB_GAP * count.saturating_sub(1) as f32
}

/// How much width each label gets out of `room`: every label that fits an equal share of it keeps
/// its whole width, and whatever it leaves over is shared out again among the ones that do not.
///
/// A strip that took the same fraction off every label instead would elide the short names too,
/// and a short name is the one a glance can still read whole.
fn fitted_labels(natural: &[f32], room: f32) -> Vec<f32> {
    let mut fitted: Vec<Option<f32>> = vec![None; natural.len()];
    let mut left = room;
    loop {
        let open = fitted.iter().filter(|width| width.is_none()).count();
        if open == 0 {
            return fitted
                .into_iter()
                .map(|width| width.unwrap_or(0.0))
                .collect();
        }
        let share = left / open as f32;
        let settled: Vec<usize> = (0..natural.len())
            .filter(|index| fitted[*index].is_none() && natural[*index] <= share)
            .collect();
        if settled.is_empty() {
            // Everything still open wants more than its share, so they all take exactly that.
            return (0..natural.len())
                .map(|index| fitted[index].unwrap_or(share))
                .collect();
        }
        for index in settled {
            fitted[index] = Some(natural[index]);
            left -= natural[index];
        }
    }
}
