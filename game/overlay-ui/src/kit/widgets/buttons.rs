//! Buttons, the keycap chip, and the hold-to-confirm gesture destructive actions go through.

use egui::{
    Color32, CornerRadius, Rect, Response, Sense, Shape, Stroke, StrokeKind, Ui, Vec2, vec2,
};

use crate::colors::{AMBER95, BLUE10, BLUE20, BLUE70, BLUE80, GREY_BLUE60, GREY_BLUE95};

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
    // An outline and nothing behind it: a row of these sits over live gameplay, and a row of filled
    // boxes would be a band across the screen rather than a set of controls.
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, theme::CHIP_STROKE),
        StrokeKind::Inside,
    ));
    state_overlay(ui, &response, rect, corner_radius);
    focus_ring(ui, &response, rect, corner_radius);
    let color = if response.hovered() {
        theme::TEXT_PRIMARY
    } else {
        spec.color
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

/// How far inside a plate button's outer edge its inner one sits: one point of edge and two of
/// gutter, which is what makes the pair read as a frame rather than as a doubled border.
const PLATE_GUTTER: f32 = 3.0;

/// The chrome of a button drawn as one rectangle just inside another.
///
/// The kit's other buttons take their colors from their tier; these take them from what the button
/// does, because a screen of them is a list of choices of different weights: the one to take, the
/// ones that are merely available, and the one that ends the game.
#[derive(Clone, Copy)]
pub struct ButtonPlate {
    /// The stroke around the whole control.
    pub outer: Color32,
    /// The stroke just inside it, or `None` for a control drawn with a single edge.
    pub inner: Option<Color32>,
    pub fill: Color32,
    pub label: Color32,
    /// Rings outside the control standing in for a colored glow, which is how the one action a
    /// screen wants taken is told apart from the ones beside it.
    pub glow: Option<Color32>,
}

impl ButtonPlate {
    /// The one action the screen wants taken.
    pub fn primary() -> ButtonPlate {
        ButtonPlate {
            outer: BLUE80,
            inner: Some(theme::alpha(BLUE80, 0.70)),
            fill: theme::alpha(Color32::from_rgb(24, 44, 90), 0.60),
            label: theme::ACCENT,
            glow: Some(theme::alpha(crate::colors::BLUE60, 0.35)),
        }
    }

    /// An action that is simply available.
    pub fn standard() -> ButtonPlate {
        ButtonPlate {
            outer: theme::alpha(BLUE70, 0.70),
            inner: Some(theme::alpha(BLUE70, 0.45)),
            fill: theme::alpha(BLUE20, 0.50),
            label: AMBER95,
            glow: None,
        }
    }

    /// An action that belongs to the game rather than to the overlay, and must not pull the eye
    /// past the ones that do.
    pub fn quiet() -> ButtonPlate {
        ButtonPlate {
            outer: theme::alpha(GREY_BLUE60, 0.55),
            inner: Some(theme::alpha(GREY_BLUE60, 0.35)),
            fill: theme::alpha(BLUE10, 0.45),
            label: GREY_BLUE95,
            glow: None,
        }
    }

    /// An action that cannot be taken back.
    pub fn destructive() -> ButtonPlate {
        ButtonPlate {
            outer: theme::alpha(theme::TEXT_NEGATIVE, 0.60),
            inner: Some(theme::alpha(theme::TEXT_NEGATIVE, 0.35)),
            fill: theme::alpha(BLUE10, 0.45),
            label: theme::TEXT_DANGER,
            glow: None,
        }
    }

    /// A destructive action that has just become available, which has to be noticed on a screen the
    /// player has already been reading for a while.
    pub fn destructive_lit() -> ButtonPlate {
        ButtonPlate {
            outer: theme::alpha(theme::TEXT_NEGATIVE, 0.70),
            inner: Some(theme::alpha(theme::TEXT_NEGATIVE, 0.40)),
            glow: Some(theme::alpha(theme::TEXT_NEGATIVE, 0.25)),
            ..ButtonPlate::destructive()
        }
    }

    /// An action that is not available yet, drawn as the outline of the button it will become so
    /// that nothing moves when it does.
    pub fn locked() -> ButtonPlate {
        ButtonPlate {
            outer: theme::alpha(GREY_BLUE60, 0.40),
            inner: None,
            fill: Color32::TRANSPARENT,
            label: theme::TEXT_LABEL,
            glow: None,
        }
    }
}

/// A button of exactly `size` wearing `plate`'s chrome.
///
/// Sized by the caller rather than by its label: these come in stacks and rows where every button
/// is the same width, and one that grew with a translated label would take the column apart. The
/// caller brings the type style, since the size and tracking differ between a menu's stack and a
/// single control in a row; the plate's own label color wins over the style's.
pub fn plate_button(
    ui: &mut Ui,
    spec: &text::TextSpec,
    label: &str,
    size: Vec2,
    plate: ButtonPlate,
) -> Response {
    let (rect, response) = ui.allocate_exact_size(size, Sense::click());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    paint_plate(ui, rect, plate, None);
    state_overlay(ui, &response, rect, corner_radius);
    focus_ring(ui, &response, rect, corner_radius);
    let job = spec
        .clone()
        .with_color(plate.label)
        .job_truncated(label, (size.x - PLATE_GUTTER * 2.0).max(0.0));
    let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
    ui.painter()
        .galley(rect.center() - galley.size() * 0.5, galley, plate.label);
    response
}

/// Paints a plate's glow, fill and edges, filling `sweep` of its inner rect from the left where one
/// is asked for.
fn paint_plate(ui: &Ui, rect: Rect, plate: ButtonPlate, sweep: Option<(f32, Color32)>) {
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    let painter = ui.painter();
    if let Some(glow) = plate.glow {
        for (step, alpha) in [(1.0f32, 1.0f32), (2.0, 0.6), (3.0, 0.32), (4.0, 0.15)] {
            painter.add(Shape::rect_stroke(
                rect.expand(step),
                corner_radius,
                Stroke::new(theme::HAIRLINE, glow.gamma_multiply(alpha)),
                StrokeKind::Outside,
            ));
        }
    }
    painter.rect_filled(rect, corner_radius, plate.fill);
    let inner_rect = rect.shrink(PLATE_GUTTER);
    let inner_radius = theme::radius(theme::RADIUS_TIGHT - 1);
    if let Some((progress, color)) = sweep
        && progress > 0.0
    {
        let mut swept = inner_rect;
        swept.set_right(inner_rect.left() + inner_rect.width() * progress);
        painter
            .with_clip_rect(swept)
            .rect_filled(inner_rect, inner_radius, color);
    }
    painter.add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, plate.outer),
        StrokeKind::Inside,
    ));
    if let Some(inner) = plate.inner {
        painter.add(Shape::rect_stroke(
            inner_rect,
            inner_radius,
            Stroke::new(theme::HAIRLINE, inner),
            StrokeKind::Inside,
        ));
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
pub fn hold_to_confirm(ui: &mut Ui, label: &str, size: Vec2) -> HoldState {
    let spec = text::button_label(14.0).with_color(theme::TEXT_DANGER);
    let galley = spec.galley(ui, label);
    let (rect, response) = ui.allocate_exact_size(size, Sense::click_and_drag());

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
        let sweep = theme::TEXT_NEGATIVE.gamma_multiply(0.30);
        paint_plate(
            ui,
            rect,
            ButtonPlate::destructive(),
            Some((progress, sweep)),
        );
        state_overlay(ui, &response, rect, corner_radius);
        focus_ring(ui, &response, rect, corner_radius);
        let text_pos = rect.center() - galley.size() * 0.5;
        ui.painter().galley(text_pos, galley, spec.color);
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
        (galley.size().x + theme::SPACE_MD).max(20.0),
        galley.size().y + theme::SPACE_XS + 2.0,
    );
    let (rect, response) = ui.allocate_exact_size(size, Sense::hover());
    if ui.is_rect_visible(rect) {
        let corner_radius = theme::radius(theme::RADIUS_CHIP);
        let painter = ui.painter();
        painter.add(Shape::rect_stroke(
            rect,
            corner_radius,
            Stroke::new(theme::HAIRLINE, theme::CHIP_STROKE),
            StrokeKind::Inside,
        ));
        painter.galley(rect.center() - galley.size() * 0.5, galley, theme::TEXT_DIM);
    }
    response
}
