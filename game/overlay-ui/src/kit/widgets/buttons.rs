//! Buttons, the keycap chip, and the hold-to-confirm gesture destructive actions go through.

use egui::{
    Color32, CornerRadius, Rect, Response, Sense, Shape, Stroke, StrokeKind, Ui, Vec2, vec2,
};

use crate::colors::{AMBER95, BLUE10, BLUE70};
use crate::kit::text;
use crate::kit::theme;
use crate::kit::tiers::gradient_round_rect;
use crate::kit::widgets::{focus_ring, state_overlay};

/// Which surface a button belongs to, which decides its chrome as much as its size.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ButtonVariant {
    /// The button of a hero panel: gradient fill, blue edge.
    Tier1,
    /// The button of a modal: two strokes with a gap between them.
    Tier2,
    /// The one action a modal wants the player to take, filled amber.
    Tier2Primary,
    /// Chrome-less, for the actions that must not pull the eye.
    Ghost,
}

impl ButtonVariant {
    fn height(self) -> f32 {
        match self {
            ButtonVariant::Tier1 | ButtonVariant::Ghost => theme::HIT_PANEL,
            ButtonVariant::Tier2 | ButtonVariant::Tier2Primary => theme::HIT_DIALOG,
        }
    }

    fn label_size(self) -> f32 {
        match self {
            ButtonVariant::Tier1 | ButtonVariant::Ghost => 13.0,
            ButtonVariant::Tier2 | ButtonVariant::Tier2Primary => 14.0,
        }
    }

    fn min_width(self) -> f32 {
        match self {
            ButtonVariant::Ghost => 0.0,
            ButtonVariant::Tier1 => 84.0,
            ButtonVariant::Tier2 | ButtonVariant::Tier2Primary => 104.0,
        }
    }

    fn corner_radius(self) -> CornerRadius {
        match self {
            ButtonVariant::Tier2 | ButtonVariant::Tier2Primary => {
                theme::radius(theme::RADIUS_TIGHT)
            }
            _ => theme::radius(theme::RADIUS_PANEL),
        }
    }
}

/// A button with its variant's chrome, sized to its label.
pub fn button(ui: &mut Ui, label: &str, variant: ButtonVariant) -> Response {
    button_sized(ui, label, variant, variant.min_width())
}

/// A button that is at least `min_width` wide, for rows that want their buttons to line up.
pub fn button_sized(ui: &mut Ui, label: &str, variant: ButtonVariant, min_width: f32) -> Response {
    let spec = text::button_label(variant.label_size()).with_color(Color32::PLACEHOLDER);
    let galley = spec.galley(ui, label);
    let width = (galley.size().x + theme::SPACE_XL * 2.0).max(min_width);
    let (rect, response) = ui.allocate_exact_size(vec2(width, variant.height()), Sense::click());
    if !ui.is_rect_visible(rect) {
        return response;
    }

    let corner_radius = variant.corner_radius();
    let hovered = response.hovered();
    let label_color = match variant {
        ButtonVariant::Tier2Primary => BLUE10,
        ButtonVariant::Ghost if !hovered => theme::TEXT_DIM,
        _ => theme::TEXT_PRIMARY,
    };
    paint_button_body(ui, rect, variant, hovered);
    state_overlay(ui, &response, rect, corner_radius);
    focus_ring(ui, &response, rect, corner_radius);

    let text_pos = rect.center() - galley.size() * 0.5;
    ui.painter().galley(text_pos, galley, label_color);
    response
}

/// A compact chip that acts when it is clicked.
///
/// The chip is given its size rather than taking it from its label, because chips come in rows —
/// jump steps, quick actions — and a row whose cells resized with their contents would move under
/// the pointer. The caller brings the type style too, since a chip carrying a value is set in
/// numerals where one carrying a word is set in the button style; only its color is the chip's own,
/// so every chip lights the same way under the pointer.
pub fn chip_button(ui: &mut Ui, spec: &text::TextSpec, label: &str, size: Vec2) -> Response {
    let job = spec.job_truncated(label, (size.x - theme::SPACE_SM).max(0.0));
    let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
    let (rect, response) = ui.allocate_exact_size(size, Sense::click());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    let painter = ui.painter();
    painter.rect_filled(rect, corner_radius, theme::alpha(BLUE10, 0.80));
    painter.add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, theme::TIER0_STROKE),
        StrokeKind::Inside,
    ));
    state_overlay(ui, &response, rect, corner_radius);
    focus_ring(ui, &response, rect, corner_radius);
    let color = if response.hovered() {
        theme::TEXT_PRIMARY
    } else {
        theme::TEXT_DIM
    };
    ui.painter()
        .galley(rect.center() - galley.size() * 0.5, galley, color);
    response
}

fn paint_button_body(ui: &Ui, rect: Rect, variant: ButtonVariant, hovered: bool) {
    let painter = ui.painter();
    let corner_radius = variant.corner_radius();
    match variant {
        ButtonVariant::Ghost => {}
        ButtonVariant::Tier1 => {
            painter.add(gradient_round_rect(
                rect,
                corner_radius,
                [theme::TIER1_FILL_TOP, theme::TIER1_FILL_BOTTOM],
            ));
            painter.add(Shape::rect_stroke(
                rect,
                corner_radius,
                Stroke::new(theme::HAIRLINE, theme::TIER1_STROKE),
                StrokeKind::Inside,
            ));
        }
        ButtonVariant::Tier2 => {
            painter.add(gradient_round_rect(
                rect,
                corner_radius,
                [theme::TIER2_FILL_TOP, theme::TIER2_FILL_BOTTOM],
            ));
            // The outer stroke stays put and the inner one lights up on hover, so the pair reads as
            // one control rather than as two rectangles that happen to share a centre.
            painter.add(Shape::rect_stroke(
                rect,
                corner_radius,
                Stroke::new(theme::HAIRLINE, theme::TIER2_STROKE_OUTER),
                StrokeKind::Inside,
            ));
            let inner_alpha = if hovered { 1.0 } else { 0.45 };
            painter.add(Shape::rect_stroke(
                rect.shrink(theme::TIER2_STROKE_GAP),
                corner_radius,
                Stroke::new(theme::HAIRLINE, BLUE70.gamma_multiply(inner_alpha)),
                StrokeKind::Inside,
            ));
        }
        ButtonVariant::Tier2Primary => {
            painter.rect_filled(rect, corner_radius, theme::ACCENT);
            painter.add(Shape::rect_stroke(
                rect.shrink(theme::TIER2_STROKE_GAP),
                corner_radius,
                Stroke::new(theme::HAIRLINE, AMBER95.gamma_multiply(0.55)),
                StrokeKind::Inside,
            ));
            if hovered {
                for (step, alpha) in [(1.0f32, 0.35f32), (2.0, 0.18), (3.0, 0.08)] {
                    painter.add(Shape::rect_stroke(
                        rect.expand(step),
                        corner_radius,
                        Stroke::new(theme::HAIRLINE, theme::ACCENT.gamma_multiply(alpha)),
                        StrokeKind::Outside,
                    ));
                }
            }
        }
    }
}

/// Where a hold-to-confirm button is in its gesture.
#[derive(Clone, Copy, PartialEq)]
pub enum HoldState {
    Idle,
    /// The pointer is down and the sweep is this far across, from 0 to 1.
    Holding(f32),
    /// The hold completed. Reported once per gesture, so a caller can act on it directly.
    Confirmed,
}

/// A destructive action that has to be held down to fire.
///
/// A click cannot do it and neither can a slip: the sweep takes the full hold time to cross the
/// button, and letting go before it arrives unwinds it. That is the only way the kit offers a
/// destructive action, because an overlay drawn over a live game cannot afford a misclick that
/// drops a player.
pub fn hold_to_confirm(ui: &mut Ui, label: &str) -> HoldState {
    let spec = text::button_label(14.0).with_color(Color32::PLACEHOLDER);
    let galley = spec.galley(ui, label);
    let width = (galley.size().x + theme::SPACE_XL * 2.0).max(140.0);
    let (rect, response) =
        ui.allocate_exact_size(vec2(width, theme::HIT_DIALOG), Sense::click_and_drag());

    let held = response.is_pointer_button_down_on();
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    let progress = ui.ctx().animate_value_with_time(
        response.id.with("sweep"),
        if held { 1.0 } else { 0.0 },
        if held {
            theme::MOTION_HOLD_SECS
        } else {
            theme::MOTION_HOLD_RELEASE_SECS
        },
    );
    // A completed hold fires once and then waits for the pointer to come up, so keeping the button
    // pressed cannot confirm the same action over and over.
    let latch_id = response.id.with("fired");
    let already_fired = ui
        .data(|data| data.get_temp::<bool>(latch_id))
        .unwrap_or(false);
    let confirmed = held && progress >= 1.0 && !already_fired;
    if confirmed {
        ui.data_mut(|data| data.insert_temp(latch_id, true));
    } else if !held && already_fired {
        ui.data_mut(|data| data.remove::<bool>(latch_id));
    }

    if ui.is_rect_visible(rect) {
        let painter = ui.painter();
        painter.add(gradient_round_rect(
            rect,
            corner_radius,
            [theme::TIER2_FILL_TOP, theme::TIER2_FILL_BOTTOM],
        ));
        if progress > 0.0 {
            let mut swept = rect;
            swept.set_right(rect.left() + rect.width() * progress);
            painter.with_clip_rect(swept).rect_filled(
                rect,
                corner_radius,
                theme::TEXT_NEGATIVE.gamma_multiply(0.55),
            );
        }
        painter.add(Shape::rect_stroke(
            rect,
            corner_radius,
            Stroke::new(theme::HAIRLINE, theme::TEXT_NEGATIVE.gamma_multiply(0.85)),
            StrokeKind::Inside,
        ));
        painter.add(Shape::rect_stroke(
            rect.shrink(theme::TIER2_STROKE_GAP),
            corner_radius,
            Stroke::new(theme::HAIRLINE, theme::TEXT_NEGATIVE.gamma_multiply(0.35)),
            StrokeKind::Inside,
        ));
        state_overlay(ui, &response, rect, corner_radius);
        focus_ring(ui, &response, rect, corner_radius);
        let text_pos = rect.center() - galley.size() * 0.5;
        ui.painter().galley(text_pos, galley, theme::TEXT_PRIMARY);
    }

    // Neither the sweep nor its unwind has anything else asking for frames.
    if held || (progress > 0.0 && progress < 1.0) {
        ui.ctx().request_repaint();
    }

    if confirmed {
        HoldState::Confirmed
    } else if progress > 0.0 {
        HoldState::Holding(progress)
    } else {
        HoldState::Idle
    }
}

/// A keycap chip, for telling the player which key opens or closes something.
pub fn kbd(ui: &mut Ui, key: &str) -> Response {
    let spec = text::body(11.0, text::BodyWeight::Medium).with_color(theme::TEXT_DIM);
    let galley = spec.galley(ui, key);
    let size = vec2(
        (galley.size().x + theme::SPACE_SM).max(20.0),
        galley.size().y + theme::SPACE_XS + 2.0,
    );
    let (rect, response) = ui.allocate_exact_size(size, Sense::hover());
    if ui.is_rect_visible(rect) {
        let corner_radius = theme::radius(theme::RADIUS_CHIP);
        let painter = ui.painter();
        painter.rect_filled(rect, corner_radius, theme::alpha(BLUE10, 0.80));
        painter.add(Shape::rect_stroke(
            rect,
            corner_radius,
            Stroke::new(theme::HAIRLINE, theme::TIER0_STROKE),
            StrokeKind::Inside,
        ));
        painter.galley(rect.center() - galley.size() * 0.5, galley, theme::TEXT_DIM);
    }
    response
}
