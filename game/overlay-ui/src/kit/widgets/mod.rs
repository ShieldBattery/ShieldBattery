//! The overlay's controls.
//!
//! Every widget is a function over a `&mut Ui` that allocates its own space, paints itself from the
//! theme and returns what the caller needs to act on. They share their state painting through the
//! helpers here, so hover, press and focus look the same on a button as on a slider knob.

mod buttons;
mod charts;
mod controls;
mod icons;
mod menus;
mod panels;
mod tooltip;

pub use buttons::{
    ButtonPlate, ButtonVariant, HoldState, button, button_sized, button_with_kbd, chip_button,
    hold_to_confirm, hold_to_confirm_by_key, kbd, kbd_size, paint_button_kbd, paint_kbd,
    plate_button, plate_button_aligned,
};
pub use charts::{
    PlotResponse, Series, line_plot, line_plot_clickable, progress_bar, share_bar, sparkline,
    sparkline_to,
};
pub use controls::{
    SWITCH_SIZE, ScrubTrack, TrackMarker, scrub_track, scrub_track_marked, segmented,
    segmented_sized, segmented_width, slider, slider_sized, stepper, switch, tab_strip,
    tab_strip_width,
};
pub(crate) use icons::paint_icon_chip;
pub use icons::{
    IconSizes, ResourceGlyph, ResourceIcons, ResourceRace, paint_resource_glyph,
    paint_resource_icon, set_resource_icons,
};
pub use menus::{
    Glyph, ICON_BUTTON_SIZE, IconButtonState, MenuResponse, MenuRow, MenuSide, MenuTone,
    dropdown_button, icon_button, menu_separator, paint_glyph, popup_menu,
};
pub use panels::{
    PANEL_HEADER_HEIGHT, STATUS_DOT_DIAMETER, TagStyle, centered_paragraph, divider, panel_header,
    panel_header_with_close, pulsing_dots, stat_row, status_dot, tag, tag_exact, tag_height,
    tag_sized, text_cell,
};
pub use tooltip::{hint_card, tooltip, tooltip_above};

use egui::{
    Color32, Context, CornerRadius, Id, Rect, Response, Shape, Stroke, StrokeKind, Ui, Vec2,
};

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

/// Lays the hover or press wash over a control that has already painted itself, and has the host
/// play the game's button click when it is activated (see [`note_activation`]).
///
/// One overlay serves every fill in the kit: lightening or darkening whatever is underneath keeps a
/// pressed amber button and a pressed ghost button reading as the same gesture. Every control that
/// washes this way acts on a click, so this is also where a click is heard.
pub(crate) fn state_overlay(ui: &Ui, response: &Response, rect: Rect, corner_radius: CornerRadius) {
    if response.clicked() {
        note_activation(ui.ctx());
    }
    state_wash(ui, response, rect, corner_radius);
}

/// The wash of [`state_overlay`] alone, for a control whose click is not what makes it act.
pub(crate) fn state_wash(ui: &Ui, response: &Response, rect: Rect, corner_radius: CornerRadius) {
    let overlay = if response.is_pointer_button_down_on() {
        theme::PRESS_OVERLAY
    } else if response.hovered() {
        theme::HOVER_OVERLAY
    } else {
        return;
    };
    ui.painter().rect_filled(rect, corner_radius, overlay);
}

fn activation_id() -> Id {
    Id::new("sb_kit_control_activated")
}

/// Notes that a control acted this frame, which the host answers with the sound SC:R's own in-game
/// controls make: its button click, on release for a button and on press for a slider, and nothing
/// on hover. One click a frame however many controls acted, the way the game gives its click one
/// channel.
pub(crate) fn note_activation(ctx: &Context) {
    ctx.data_mut(|data| data.insert_temp(activation_id(), true));
}

/// Whether a control acted since the last call, which clears it. The shell asks once a frame.
pub fn take_activation(ctx: &Context) -> bool {
    ctx.data_mut(|data| data.remove_temp::<bool>(activation_id()))
        .unwrap_or(false)
}

/// Makes `response`'s control the one a dialog's keys work while nothing else on it holds focus: on
/// the frame the dialog opens, and again after a click elsewhere lets go of it. SC:R's dialogs open
/// with one of their buttons lit, usually the one that puts the dialog away, and `Space` or `Enter`
/// presses whichever is lit.
pub fn default_focus(response: &Response) {
    if response.ctx.memory(|memory| memory.focused().is_none()) {
        response.request_focus();
    }
}

/// Rings a control while it holds keyboard focus. In a modal dialog that owns the keyboard, focus
/// follows a moving pointer onto the control first, so one control is lit at a time and the keys
/// press the one the player is looking at; a pointer resting where a dialog opens takes nothing
/// from the control lit by default.
pub(crate) fn focus_ring(ui: &Ui, response: &Response, rect: Rect, corner_radius: CornerRadius) {
    let in_modal = ui.ctx().memory(|memory| memory.top_modal_layer().is_some());
    if in_modal
        && response.hovered()
        && !response.has_focus()
        && ui.input(|input| input.pointer.delta() != Vec2::ZERO)
    {
        response.request_focus();
    }
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
