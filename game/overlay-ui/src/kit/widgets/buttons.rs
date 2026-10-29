//! Buttons, the keycap chip, and the hold-to-confirm gesture destructive actions go through.

use egui::{
    Align, Color32, CornerRadius, Rect, Response, Sense, Shape, Stroke, StrokeKind, Ui, Vec2, pos2,
    vec2,
};

use crate::colors::{AMBER95, BLUE10, BLUE20, BLUE70, BLUE80, GREY_BLUE60, GREY_BLUE95};

use crate::kit::text;
use crate::kit::theme;
use crate::kit::tiers::gradient_round_rect;
use crate::kit::widgets::{focus_ring, note_activation, state_overlay, state_wash};

/// Which surface a button belongs to, which decides its chrome as much as its size.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ButtonVariant {
    /// The button of a hero panel: gradient fill, blue edge.
    Tier1,
    /// The button of a modal: two strokes with a gap between them.
    Tier2,
    /// The one action a modal wants the player to take, on the lit plate of
    /// [`ButtonPlate::primary`] so a dialog's footer and the game menu's stack mark it alike.
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
        ButtonVariant::Tier2Primary => ButtonPlate::primary().label,
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

/// A button with its variant's chrome, marked with the keycap of the key that presses it (see
/// [`paint_button_kbd`]).
///
/// Sized to its label like [`button`], with the keycap's room kept on both sides so the label stays
/// centered and clear of the cap however long a translation runs.
pub fn button_with_kbd(ui: &mut Ui, label: &str, variant: ButtonVariant, key: &str) -> Response {
    let spec = text::button_label(variant.label_size());
    let label_width = spec.galley(ui, label).size().x;
    let kbd_room = kbd_size(ui, key).x + PLATE_GUTTER + theme::SPACE_SM * 2.0;
    let width = (label_width + (kbd_room + theme::SPACE_SM) * 2.0).max(variant.min_width());
    let response = button_sized(ui, label, variant, width);
    paint_button_kbd(ui, response.rect, key);
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
    let galley = spec.layout(
        ui.ctx(),
        spec.job_truncated(label, (size.x - theme::SPACE_SM).max(0.0)),
    );
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
            // one control rather than as two rectangles that happen to share a center.
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
        ButtonVariant::Tier2Primary => paint_plate(ui, rect, ButtonPlate::primary(), None),
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

    /// The one of a set of choices that is currently taken, drawn as a lit plate so a column of
    /// them says where the reader is without a second marker.
    pub fn selected() -> ButtonPlate {
        ButtonPlate {
            outer: theme::alpha(BLUE80, 0.70),
            inner: Some(theme::alpha(BLUE80, 0.40)),
            fill: theme::alpha(Color32::from_rgb(24, 44, 90), 0.60),
            label: AMBER95,
            glow: None,
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
    plate_button_aligned(ui, spec, label, size, plate, Align::Center, PLATE_GUTTER)
}

/// [`plate_button`] with its label set against one edge of the plate, `inset` in from it, for a
/// plate standing in a column of plain rows whose labels it has to line up with.
pub fn plate_button_aligned(
    ui: &mut Ui,
    spec: &text::TextSpec,
    label: &str,
    size: Vec2,
    plate: ButtonPlate,
    align: Align,
    inset: f32,
) -> Response {
    let (rect, response) = ui.allocate_exact_size(size, Sense::click());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    paint_plate(ui, rect, plate, None);
    state_overlay(ui, &response, rect, corner_radius);
    focus_ring(ui, &response, rect, corner_radius);
    let spec = spec.clone().with_color(plate.label);
    let galley = spec.layout(
        ui.ctx(),
        spec.job_truncated(label, (size.x - inset * 2.0).max(0.0)),
    );
    let x = match align {
        Align::LEFT => rect.left() + inset,
        Align::Center => rect.center().x - galley.size().x * 0.5,
        Align::RIGHT => rect.right() - inset - galley.size().x,
    };
    ui.painter().galley(
        pos2(x, rect.center().y - galley.size().y * 0.5),
        galley,
        plate.label,
    );
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

/// One leg of a hold button's sweep: where it set out from, where it is going, and when.
#[derive(Clone, Copy, Default)]
struct Sweep {
    from: f32,
    to: f32,
    /// When the leg began, on egui's clock.
    started: f64,
    /// How long the leg takes, which is the distance it covers at the sweep's one speed.
    duration: f32,
}

impl Sweep {
    /// Where the sweep stands at `now`.
    fn at(&self, now: f64) -> f32 {
        if self.duration <= 0.0 {
            return self.to;
        }
        let fraction = ((now - self.started) as f32 / self.duration).clamp(0.0, 1.0);
        self.from + (self.to - self.from) * fraction
    }

    /// A new leg towards `to`, setting out from wherever this one stands at `now`, at the speed
    /// that covers the whole sweep in `full` seconds.
    fn turned(&self, to: f32, full: f32, now: f64) -> Sweep {
        let from = self.at(now);
        Sweep {
            from,
            to,
            started: now,
            duration: full * (to - from).abs(),
        }
    }
}

/// A destructive action that has to be held down to fire.
///
/// A click cannot do it and neither can a slip: the sweep takes the full hold time to cross the
/// button, and letting go before it arrives unwinds it. For an action drawn over a live game where a
/// misclick would cost a player the game.
pub fn hold_to_confirm(ui: &mut Ui, label: &str, size: Vec2) -> HoldState {
    hold_to_confirm_by_key(ui, label, size, false)
}

/// [`hold_to_confirm`] for a button a key can hold as well: `key_held` is whether the key that
/// presses it is down, which sweeps it the same as the pointer does. The host decides what counts as
/// that key being held, which should be a press made while the button was there to see: a key
/// already down when the button appears is not a choice made about it.
pub fn hold_to_confirm_by_key(ui: &mut Ui, label: &str, size: Vec2, key_held: bool) -> HoldState {
    let spec = text::button_label(14.0).with_color(theme::TEXT_DANGER);
    let galley = spec.galley(ui, label);
    let (rect, response) = ui.allocate_exact_size(size, Sense::click_and_drag());

    let held = response.is_pointer_button_down_on() || key_held;
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    // The sweep always moves at the same speed: a full hold takes the whole hold time and a full
    // unwind the whole release time, so a press that lands on a half-unwound sweep finishes in
    // half the time rather than crawling the remaining distance over the full hold time. The
    // sweep keeps its own clock rather than using egui's value animation, which reads where a
    // changing value stands off the duration it is handed on the frame the target changes: a leg
    // that begins mid-sweep would then be measured against its own, shorter length and start from
    // the wrong place.
    let target: f32 = if held { 1.0 } else { 0.0 };
    let now = ui.input(|input| input.time);
    let sweep_id = response.id.with("sweep");
    let progress = ui.data_mut(|data| {
        let mut sweep = data.get_temp::<Sweep>(sweep_id).unwrap_or_default();
        if sweep.to != target {
            let full = if held {
                theme::MOTION_HOLD_SECS
            } else {
                theme::MOTION_HOLD_RELEASE_SECS
            };
            sweep = sweep.turned(target, full, now);
        }
        data.insert_temp(sweep_id, sweep);
        sweep.at(now)
    });
    // A completed hold fires once and then waits for the pointer to come up, so keeping the button
    // pressed cannot confirm the same action over and over.
    let latch_id = response.id.with("fired");
    let already_fired = ui
        .data(|data| data.get_temp::<bool>(latch_id))
        .unwrap_or(false);
    let confirmed = held && progress >= 1.0 && !already_fired;
    if confirmed {
        ui.data_mut(|data| data.insert_temp(latch_id, true));
        note_activation(ui.ctx());
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
        // A tap lets go long before the hold completes and does nothing, so it is not heard.
        state_wash(ui, &response, rect, corner_radius);
        focus_ring(ui, &response, rect, corner_radius);
        let text_pos = rect.center() - galley.size() * 0.5;
        ui.painter().galley(text_pos, galley, spec.color);
    }

    // Neither the sweep nor its unwind has anything else asking for frames, and the unwind's first
    // frame is the one where the sweep still sits at full: without a repaint there it would wait
    // for the next mouse move to begin.
    if held || progress > 0.0 {
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
    let (rect, response) = ui.allocate_exact_size(kbd_size(ui, key), Sense::hover());
    if ui.is_rect_visible(rect) {
        paint_kbd(ui, rect, key);
    }
    response
}

/// [`kbd`] as a control, for a key that does what clicking its keycap does: washed under the pointer
/// and while pressed, as any control is.
pub fn kbd_button(ui: &mut Ui, key: &str) -> Response {
    let (rect, response) = ui.allocate_exact_size(kbd_size(ui, key), Sense::click());
    if ui.is_rect_visible(rect) {
        paint_kbd(ui, rect, key);
        state_overlay(ui, &response, rect, theme::radius(theme::RADIUS_CHIP));
    }
    response
}

/// How big the keycap chip for `key` is.
pub fn kbd_size(ui: &Ui, key: &str) -> Vec2 {
    let galley = kbd_spec().galley(ui, key);
    vec2(
        (galley.size().x + theme::SPACE_MD).max(20.0),
        galley.size().y + theme::SPACE_XS + 2.0,
    )
}

/// Paints the keycap chip for `key` into `rect`, without taking room in the layout.
pub fn paint_kbd(ui: &Ui, rect: Rect, key: &str) {
    let galley = kbd_spec().galley(ui, key);
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

/// Marks `button` with the keycap of the key that presses it, set in from its right edge clear of a
/// plate's inner edge: a button's own label says what it does, and the key it answers to is a fact
/// about it beside that.
pub fn paint_button_kbd(ui: &Ui, button: Rect, key: &str) {
    let size = kbd_size(ui, key);
    let rect = Rect::from_min_size(
        pos2(
            button.right() - PLATE_GUTTER - theme::SPACE_SM - size.x,
            button.center().y - size.y * 0.5,
        ),
        size,
    );
    paint_kbd(ui, rect, key);
}

fn kbd_spec() -> text::TextSpec {
    text::body(11.0, text::BodyWeight::Medium).with_color(theme::TEXT_DIM)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A leg that sets out mid-sweep covers only what is left, at the same speed as a full one: a
    /// press landing on a half-unwound sweep fills in half the hold time, and a release taken
    /// halfway through a hold unwinds in half the release time.
    #[test]
    fn a_leg_takes_time_in_proportion_to_the_distance_left() {
        let idle = Sweep::default();
        assert_eq!(idle.at(10.0), 0.0);
        let hold = idle.turned(1.0, 3.0, 10.0);
        assert_eq!(hold.duration, 3.0);
        assert_eq!(hold.at(11.5), 0.5);
        // Released halfway: the unwind starts where the hold stood and takes half the release time.
        let release = hold.turned(0.0, 0.15, 11.5);
        assert_eq!(release.from, 0.5);
        assert_eq!(release.duration, 0.075);
        assert_eq!(release.at(11.5 + 0.075), 0.0);
        // Pressed again a third of the way into the unwind: the hold sets out from there, not
        // from full, and covers the rest at the hold's own speed.
        let pressed = release.turned(1.0, 3.0, 11.525);
        assert!((pressed.from - 1.0 / 3.0).abs() < 1e-3);
        assert!((pressed.duration - 2.0).abs() < 1e-3);
    }
}
