//! The overlay's controls.
//!
//! Every widget is a function over a `&mut Ui` that allocates its own space, paints itself from the
//! theme and returns what the caller needs to act on. They share their state painting through the
//! helpers here, so hover, press and focus look the same on a button as on a slider knob.

mod buttons;
mod charts;
mod controls;
mod panels;

pub use buttons::{ButtonVariant, HoldState, button, button_sized, hold_to_confirm, kbd};
pub use charts::{Series, line_plot, progress_bar, share_bar, sparkline, sparkline_to};
pub use controls::{segmented, slider, switch};
pub use panels::{
    TagStyle, divider, panel_header, panel_header_with_close, pulsing_dots, stat_row, tag,
    tag_sized, text_cell,
};

use egui::{Color32, CornerRadius, Rect, Response, Shape, Stroke, StrokeKind, Ui};

use crate::kit::theme;

/// Draws the rest of this `Ui` as disabled: inert, and at the design's disabled opacity.
///
/// egui's own disabling fades to its style's alpha, so the opacity is set afterwards rather than
/// multiplied on top of it, and one token decides how a disabled control looks everywhere.
pub fn set_disabled(ui: &mut Ui, disabled: bool) {
    if disabled {
        ui.disable();
        ui.set_opacity(theme::DISABLED_OPACITY);
    }
}

/// Lays the hover or press wash over a control that has already painted itself.
///
/// One overlay serves every fill in the kit: lightening or darkening whatever is underneath keeps a
/// pressed amber button and a pressed ghost button reading as the same gesture.
pub(crate) fn state_overlay(ui: &Ui, response: &Response, rect: Rect, corner_radius: CornerRadius) {
    let overlay = if response.is_pointer_button_down_on() {
        theme::PRESS_OVERLAY
    } else if response.hovered() {
        theme::HOVER_OVERLAY
    } else {
        return;
    };
    ui.painter().rect_filled(rect, corner_radius, overlay);
}

/// Rings a control while it holds keyboard focus.
pub(crate) fn focus_ring(ui: &Ui, response: &Response, rect: Rect, corner_radius: CornerRadius) {
    if !response.has_focus() {
        return;
    }
    ui.painter().add(Shape::rect_stroke(
        rect.expand(theme::HAIRLINE),
        corner_radius,
        theme::FOCUS_RING,
        StrokeKind::Outside,
    ));
}

/// Draws the halo that marks the active one of a set of tier-2 controls.
pub(crate) fn active_halo(ui: &Ui, rect: Rect, corner_radius: CornerRadius, color: Color32) {
    for (step, alpha) in [(1.0f32, 0.55f32), (2.0, 0.28), (3.0, 0.12)] {
        ui.painter().add(Shape::rect_stroke(
            rect.expand(step),
            corner_radius,
            Stroke::new(theme::HAIRLINE, color.gamma_multiply(alpha)),
            StrokeKind::Outside,
        ));
    }
}
