//! The controls that carry a setting: a segmented choice, a switch and a slider.

use std::ops::RangeInclusive;

use egui::{Color32, Rect, Response, Sense, Shape, Stroke, StrokeKind, Ui, pos2, vec2};

use crate::colors::{BLUE60, BLUE95, GREY_BLUE40, GREY_BLUE60};
use crate::kit::text;
use crate::kit::theme;
use crate::kit::tiers::gradient_round_rect;
use crate::kit::widgets::{active_halo, focus_ring, state_overlay};

/// Track height of a switch, which also sets its knob.
const SWITCH_HEIGHT: f32 = 24.0;
const SWITCH_WIDTH: f32 = 44.0;

/// How long a knob takes to travel when a switch is flipped.
const SWITCH_TRAVEL_SECS: f32 = 0.12;

/// Height of a slider's track.
const SLIDER_TRACK: f32 = 4.0;
/// Radius of a slider's knob.
const SLIDER_KNOB: f32 = 7.0;
/// Room kept to the right of a slider for its value.
const SLIDER_VALUE_WIDTH: f32 = 52.0;

/// A row of mutually exclusive choices, one of which is always taken.
///
/// Returns a response that reports `changed` when the selection moved, so a caller can persist the
/// setting without comparing values itself.
pub fn segmented(ui: &mut Ui, selected: &mut usize, labels: &[&str]) -> Response {
    let spec = text::button_label(13.0).with_color(Color32::PLACEHOLDER);
    let galleys: Vec<_> = labels.iter().map(|label| spec.galley(ui, label)).collect();
    let mut widths: Vec<f32> = galleys
        .iter()
        .map(|galley| (galley.size().x + theme::SPACE_LG * 2.0).max(72.0))
        .collect();
    // A control that grew past its panel would be clipped mid-label, so the segments give up their
    // padding proportionally rather than the row spilling over.
    let wanted: f32 = widths.iter().sum();
    let available = ui.available_width();
    if wanted > available && available > 0.0 {
        let scale = available / wanted;
        for width in &mut widths {
            *width *= scale;
        }
    }
    let total: f32 = widths.iter().sum();
    let (rect, mut response) =
        ui.allocate_exact_size(vec2(total, theme::HIT_PANEL), Sense::hover());

    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    ui.painter().add(gradient_round_rect(
        rect,
        corner_radius,
        [theme::TIER2_FILL_TOP, theme::TIER2_FILL_BOTTOM],
    ));

    let mut left = rect.left();
    for (index, galley) in galleys.into_iter().enumerate() {
        let segment =
            Rect::from_min_size(pos2(left, rect.top()), vec2(widths[index], rect.height()));
        left = segment.right();
        let segment_response = ui.interact(segment, response.id.with(index), Sense::click());
        if segment_response.clicked() && *selected != index {
            *selected = index;
            response.mark_changed();
        }
        let is_selected = *selected == index;
        if is_selected {
            ui.painter()
                .rect_filled(segment, corner_radius, BLUE60.gamma_multiply(0.28));
            active_halo(ui, segment.shrink(1.0), corner_radius, BLUE60);
        } else if index > 0 {
            // A divider only between unselected neighbours: next to a lit segment its own edge
            // already separates them.
            ui.painter().add(Shape::line_segment(
                [
                    pos2(segment.left(), segment.top() + theme::SPACE_SM),
                    pos2(segment.left(), segment.bottom() - theme::SPACE_SM),
                ],
                Stroke::new(theme::HAIRLINE, theme::TIER0_DIVIDER),
            ));
        }
        state_overlay(ui, &segment_response, segment, corner_radius);
        focus_ring(ui, &segment_response, segment, corner_radius);
        let color = if is_selected {
            theme::TEXT_PRIMARY
        } else {
            theme::TEXT_DIM
        };
        ui.painter()
            .galley(segment.center() - galley.size() * 0.5, galley, color);
    }

    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, theme::TIER2_STROKE_OUTER),
        StrokeKind::Inside,
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

/// A value between two bounds, with the value itself shown in condensed numerals beside it.
pub fn slider(ui: &mut Ui, value: &mut f32, range: RangeInclusive<f32>) -> Response {
    let width = ui.available_width().clamp(160.0, 320.0);
    let (rect, mut response) =
        ui.allocate_exact_size(vec2(width, theme::HIT_PANEL), Sense::click_and_drag());
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
        let new_value = range.start() + fraction * span;
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
    painter.rect_filled(track, corner_radius, theme::alpha(GREY_BLUE40, 0.65));
    let mut filled = track;
    filled.set_right(track.left() + track.width() * fraction);
    painter.rect_filled(filled, corner_radius, BLUE60);

    let centre = pos2(filled.right(), track.center().y);
    for (step, alpha) in [(3.0f32, 0.30f32), (6.0, 0.14), (9.0, 0.06)] {
        painter.circle_filled(centre, SLIDER_KNOB + step, BLUE60.gamma_multiply(alpha));
    }
    painter.circle_filled(centre, SLIDER_KNOB, BLUE95);
    focus_ring(ui, &response, track.expand(SLIDER_KNOB), corner_radius);

    let decimals = usize::from(span < 20.0);
    let readout = text::numeral(15.0).galley(ui, &format!("{value:.decimals$}"));
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
