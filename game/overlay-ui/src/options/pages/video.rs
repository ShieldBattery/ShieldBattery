//! The Video page: the display, frame rate and input delay, and graphics.

use egui::Ui;

use crate::options::fields::{
    group_header, hint, note_row, segmented_row, slider_row, stepper_row_with, switch_row, warning,
};
use crate::options::{
    BRIGHTNESS, DisplayMode, FPS_LIMIT, FramePacing, MonitorView, OptionsLists, OptionsOutcome,
    OptionsView, SD_GRAPHICS_FILTER, SettingChange,
};
use crate::tr;

pub(super) fn draw(
    ui: &mut Ui,
    view: &OptionsView,
    lists: &OptionsLists,
    outcome: &mut OptionsOutcome,
) {
    let windowed = view.display_mode == DisplayMode::Windowed;

    group_header(ui, &tr!("options.groupDisplay", "Display"), false);
    if let Some(mode) = segmented_row(
        ui,
        &tr!("options.displayMode", "Display mode"),
        &DisplayMode::ALL,
        view.display_mode,
        DisplayMode::label,
        false,
    ) {
        outcome.changes.push(SettingChange::DisplayMode(mode));
    }
    // A windowed game is played wherever its window is dragged, so which display it goes on is not
    // a question while it is in one. The window's own placement is decided as the game launches,
    // and nothing here can move a window that already exists.
    if !windowed {
        let monitors = &lists.monitors;
        // The first entry is the main display, whichever one that is, and the rest are the host's
        // list after it.
        if let Some(index) = stepper_row_with(
            ui,
            &tr!("options.monitor", "Monitor"),
            monitors.len() + 1,
            view.monitor.map_or(0, |monitor| monitor + 1),
            false,
            |index| match index.checked_sub(1) {
                None => tr!("options.monitorDefault", "Default (primary monitor)"),
                Some(monitor) => monitor_label(monitor, &monitors[monitor]),
            },
        ) {
            outcome
                .changes
                .push(SettingChange::Monitor(index.checked_sub(1)));
        }
        // The display is chosen as the game's window is created, long before the overlay exists.
        hint(ui, &tr!("options.monitorHint", "Takes effect next game"));
    }
    // Outside of fullscreen the desktop's own gamma is what the game is shown at.
    let fullscreen = view.display_mode == DisplayMode::Fullscreen;
    slider_row(
        ui,
        &tr!("options.brightness", "Brightness"),
        view.brightness,
        BRIGHTNESS,
        !fullscreen,
        outcome,
        SettingChange::Brightness,
    );
    if !fullscreen {
        hint(
            ui,
            &tr!(
                "options.brightnessFullscreenOnly",
                "Only available in Fullscreen"
            ),
        );
    }
    switch_row(
        ui,
        &tr!("options.pillarbox", "Pillarbox (4:3 aspect ratio)"),
        view.pillarbox_on,
        false,
        outcome,
        SettingChange::PillarboxOn,
    );

    group_header(
        ui,
        &tr!("options.groupFrameRate", "Frame rate and input delay"),
        true,
    );
    if let Some(pacing) = segmented_row(
        ui,
        &tr!("options.framePacing", "Frame pacing"),
        &FramePacing::ALL,
        view.frame_pacing,
        FramePacing::label,
        false,
    ) {
        outcome.changes.push(SettingChange::FramePacing(pacing));
    }
    hint(
        ui,
        &tr!(
            "options.framePacingPrompt",
            "G-SYNC or FreeSync turned on? Choose Variable refresh. Otherwise, or if you\u{2019}re \
             not sure, choose Match refresh."
        ),
    );
    let paced = view.frame_pacing != FramePacing::Off;
    if paced && windowed {
        warning(
            ui,
            &tr!(
                "options.framePacingWindowed",
                "Frame pacing can\u{2019}t help in a bordered window: Windows adds its own delay \
                 there."
            ),
        );
    }
    // Pacing decides when every frame is drawn, which leaves the game's own frame limit nothing to
    // limit.
    if paced {
        note_row(
            ui,
            &tr!("options.fpsLimit", "FPS limit"),
            &tr!("options.fpsLimitUnused", "Not used with frame pacing on"),
        );
    } else {
        switch_row(
            ui,
            &tr!("options.fpsLimitOn", "Custom FPS limit"),
            view.fps_limit_on,
            false,
            outcome,
            SettingChange::FpsLimitOn,
        );
        slider_row(
            ui,
            &tr!("options.fpsLimit", "FPS limit"),
            view.fps_limit,
            FPS_LIMIT,
            !view.fps_limit_on,
            outcome,
            SettingChange::FpsLimit,
        );
    }
    switch_row(
        ui,
        &tr!("options.verticalSync", "Vertical sync"),
        view.vsync_on,
        false,
        outcome,
        SettingChange::VsyncOn,
    );
    if view.vsync_on && windowed {
        warning(
            ui,
            &tr!(
                "options.verticalSyncWindowed",
                "Avoid vertical sync in a bordered window, where it adds a lot of input delay."
            ),
        );
    }
    switch_row(
        ui,
        &tr!("options.showFps", "Show FPS"),
        view.show_fps,
        false,
        outcome,
        SettingChange::ShowFps,
    );

    group_header(ui, &tr!("options.groupGraphics", "Graphics"), true);
    slider_row(
        ui,
        &tr!("options.sdGraphicsFilter", "SD graphics filter"),
        view.sd_graphics_filter,
        SD_GRAPHICS_FILTER,
        false,
        outcome,
        SettingChange::SdGraphicsFilter,
    );
    hint(
        ui,
        &tr!(
            "options.sdGraphicsFilterHint",
            "Sharp \u{2190} \u{2192} filtered"
        ),
    );
    switch_row(
        ui,
        &tr!("options.hdGraphics", "HD graphics"),
        view.hd_graphics_on,
        !view.hd_graphics_available,
        outcome,
        SettingChange::HdGraphicsOn,
    );
    if !view.hd_graphics_available {
        hint(
            ui,
            &tr!(
                "options.hdGraphicsUnavailableHint",
                "Unavailable while HD assets are disabled"
            ),
        );
    }
    switch_row(
        ui,
        &tr!("options.environmentEffects", "Environment effects"),
        view.environment_effects_on,
        false,
        outcome,
        SettingChange::EnvironmentEffectsOn,
    );
    switch_row(
        ui,
        &tr!("options.realTimeLighting", "Real-time lighting"),
        view.real_time_lighting_on,
        false,
        outcome,
        SettingChange::RealTimeLightingOn,
    );
    switch_row(
        ui,
        &tr!("options.smoothUnitTurning", "Smooth unit turning"),
        view.smooth_unit_turning_on,
        false,
        outcome,
        SettingChange::SmoothUnitTurningOn,
    );
    switch_row(
        ui,
        &tr!("options.shadowStacking", "Shadow stacking"),
        view.shadow_stacking_on,
        false,
        outcome,
        SettingChange::ShadowStackingOn,
    );
}

/// What the monitor row calls one display: the place it takes in the list, counted from one the way
/// the game's own video options count it, then the name the system gives it.
fn monitor_label(index: usize, monitor: &MonitorView) -> String {
    tr!(
        "options.monitorNumbered",
        "Monitor {{index}} - {{name}}",
        index = index + 1,
        name = monitor.name,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The monitor row counts displays the way the game's own video options do, from one.
    #[test]
    fn monitors_are_numbered_from_one() {
        let second = MonitorView {
            name: "DELL U2415".to_string(),
            bounds: (2560, 0, 1920, 1200),
        };
        assert_eq!(monitor_label(1, &second), "Monitor 2 - DELL U2415");
    }
}
