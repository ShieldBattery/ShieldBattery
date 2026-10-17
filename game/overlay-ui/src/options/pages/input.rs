//! The Input page: scrolling, mouse sensitivity, the cursor, and the legacy mouse settings.

use egui::Ui;

use crate::options::fields::{group_header, group_note, hint, slider_row, switch_row};
use crate::options::{
    CURSOR_SIZE_EIGHTHS, DisplayMode, GRAB_PAN_SENSITIVITY, MOUSE_SENSITIVITY, OptionsOutcome,
    OptionsView, SCROLL_SPEED, SettingChange,
};
use crate::tr;

pub(super) fn draw(ui: &mut Ui, view: &OptionsView, outcome: &mut OptionsOutcome) {
    group_header(ui, &tr!("options.groupScrolling", "Scrolling"), false);
    slider_row(
        ui,
        &tr!("options.keyboardScrollSpeed", "Keyboard scroll speed"),
        view.keyboard_scroll_speed,
        SCROLL_SPEED,
        false,
        outcome,
        SettingChange::KeyboardScrollSpeed,
    );
    slider_row(
        ui,
        &tr!("options.mouseScrollSpeed", "Mouse scroll speed"),
        view.mouse_scroll_speed,
        SCROLL_SPEED,
        false,
        outcome,
        SettingChange::MouseScrollSpeed,
    );
    switch_row(
        ui,
        &tr!("options.grabPan", "Custom grab pan sensitivity"),
        view.grab_pan_on,
        false,
        outcome,
        SettingChange::GrabPanOn,
    );
    hint(
        ui,
        &tr!(
            "options.grabPanTooltip",
            "Adjusts how fast the camera moves when panning with the middle mouse button. When \
             disabled, matches the legacy StarCraft: Remastered behavior."
        ),
    );
    slider_row(
        ui,
        &tr!("options.grabPanSensitivity", "Grab pan sensitivity"),
        view.grab_pan_sensitivity,
        GRAB_PAN_SENSITIVITY,
        !view.grab_pan_on,
        outcome,
        SettingChange::GrabPanSensitivity,
    );
    hint(
        ui,
        &tr!("options.grabPanHint", "Slower \u{2190} \u{2192} faster"),
    );
    switch_row(
        ui,
        &tr!("options.grabPanInverted", "Reverse pan direction"),
        view.grab_pan_inverted,
        !view.grab_pan_on,
        outcome,
        SettingChange::GrabPanInverted,
    );

    group_header(
        ui,
        &tr!("options.groupMouseSensitivity", "Mouse sensitivity"),
        true,
    );
    switch_row(
        ui,
        &tr!("options.customMouseSensitivity", "Custom mouse sensitivity"),
        view.mouse_sensitivity_on,
        false,
        outcome,
        SettingChange::MouseSensitivityOn,
    );
    slider_row(
        ui,
        &tr!("options.mouseSensitivity", "Mouse sensitivity"),
        view.mouse_sensitivity,
        MOUSE_SENSITIVITY,
        !view.mouse_sensitivity_on,
        outcome,
        SettingChange::MouseSensitivity,
    );

    // The cursor's size is only the game's to choose while the system draws the cursor for it.
    let software_cursor = !view.hardware_cursor_on;
    group_header(ui, &tr!("options.groupCursor", "Cursor"), true);
    // SC:R keeps the cursor in a fullscreen window whatever the setting says, and greys its own
    // checkbox out there too: the setting only decides anything for a window.
    let windowed = view.display_mode == DisplayMode::Windowed;
    switch_row(
        ui,
        &tr!("options.lockCursor", "Lock cursor to window"),
        view.mouse_confine_on,
        !windowed,
        outcome,
        SettingChange::MouseConfineOn,
    );
    if !windowed {
        hint(
            ui,
            &tr!(
                "options.lockCursorWindowedOnly",
                "Can only be disabled in Windowed mode"
            ),
        );
    }
    switch_row(
        ui,
        &tr!("options.hardwareCursor", "Hardware cursor"),
        view.hardware_cursor_on,
        false,
        outcome,
        SettingChange::HardwareCursorOn,
    );
    hint(
        ui,
        &tr!(
            "options.hardwareCursorTooltip",
            "Recommended for best performance and input responsiveness"
        ),
    );
    switch_row(
        ui,
        &tr!("options.customCursorSize", "Use custom cursor size"),
        view.custom_cursor_size_on,
        software_cursor,
        outcome,
        SettingChange::CustomCursorSizeOn,
    );
    slider_row(
        ui,
        &tr!("options.cursorSize", "Cursor size"),
        view.cursor_size_eighths,
        CURSOR_SIZE_EIGHTHS,
        software_cursor || !view.custom_cursor_size_on,
        outcome,
        SettingChange::CursorSizeEighths,
    );
    hint(
        ui,
        &tr!(
            "options.cursorSizeHint",
            "Smallest \u{2190} \u{2192} largest"
        ),
    );
    // The size is applied as the game loads its cursor art, which it does once per game.
    hint(
        ui,
        &tr!("options.cursorSizeNextGameHint", "Takes effect next game"),
    );
    switch_row(
        ui,
        &tr!("options.legacyCursorSizing", "Use legacy cursor sizing"),
        view.legacy_cursor_sizing,
        software_cursor,
        outcome,
        SettingChange::LegacyCursorSizing,
    );
    hint(
        ui,
        &tr!(
            "options.legacyCursorSizingTooltip",
            "Uses the original StarCraft: Remastered cursor sizes, which have inconsistent scales \
             at higher resolutions."
        ),
    );
    // The sizing is a patch the DLL applies while it installs its hooks, before the game has drawn
    // a cursor, so a change here is only seen by the next game the app launches.
    hint(
        ui,
        &tr!("options.legacyCursorSizingHint", "Takes effect next game"),
    );

    group_header(ui, &tr!("options.groupLegacy", "Legacy settings"), true);
    group_note(
        ui,
        &tr!(
            "options.legacyDescription",
            "These settings are available for compatibility with the StarCraft: Remastered \
             settings, but are not recommended for use because they cause performance issues."
        ),
    );
    switch_row(
        ui,
        &tr!("options.mouseScaling", "Use mouse scaling"),
        view.mouse_scaling_on,
        view.hardware_cursor_on,
        outcome,
        SettingChange::MouseScalingOn,
    );
}
