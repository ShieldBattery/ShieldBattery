//! The Gameplay page: the interface, the minimap, player colors, skins, and the APM alert.

use egui::Ui;

use crate::options::fields::{
    group_header, group_note, hint, segmented_row, slider_row, stepper_row, switch_row,
};
use crate::options::{
    APM_ALERT_VALUE, CONSOLE_SKINS, MinimapColorMode, MinimapPosition, MinimapTerrain,
    OptionsOutcome, OptionsView, SettingChange, StartingFog, UNIT_SKINS, UnitPortraits,
};
use crate::tr;

pub(super) fn draw(ui: &mut Ui, view: &OptionsView, outcome: &mut OptionsOutcome) {
    group_header(ui, &tr!("options.groupInterface", "Interface"), false);
    if let Some(portraits) = segmented_row(
        ui,
        &tr!("options.portraits", "Portraits"),
        &UnitPortraits::ALL,
        view.unit_portraits,
        UnitPortraits::label,
        false,
    ) {
        outcome
            .changes
            .push(SettingChange::UnitPortraits(portraits));
    }
    switch_row(
        ui,
        &tr!("options.gameTimer", "Game timer"),
        view.game_timer_on,
        false,
        outcome,
        SettingChange::GameTimerOn,
    );
    switch_row(
        ui,
        &tr!("options.apmDisplay", "APM display"),
        view.apm_display_on,
        false,
        outcome,
        SettingChange::ApmDisplayOn,
    );
    switch_row(
        ui,
        &tr!("options.showLatency", "Show latency"),
        view.show_latency,
        false,
        outcome,
        SettingChange::ShowLatency,
    );
    switch_row(
        ui,
        &tr!("options.colorCycling", "Enable color cycling"),
        view.color_cycling_on,
        false,
        outcome,
        SettingChange::ColorCyclingOn,
    );

    group_header(ui, &tr!("options.groupMapMinimap", "Map & minimap"), true);
    if let Some(position) = segmented_row(
        ui,
        &tr!("options.minimapPosition", "Minimap position"),
        &MinimapPosition::ALL,
        view.minimap_position,
        MinimapPosition::label,
        false,
    ) {
        outcome
            .changes
            .push(SettingChange::MinimapPosition(position));
    }
    if let Some(terrain) = segmented_row(
        ui,
        &tr!("options.minimapTerrain", "Minimap terrain"),
        &MinimapTerrain::ALL,
        view.minimap_terrain,
        MinimapTerrain::label,
        false,
    ) {
        outcome.changes.push(SettingChange::MinimapTerrain(terrain));
    }
    if let Some(fog) = segmented_row(
        ui,
        &tr!("options.startingFog", "Starting fog of war"),
        &StartingFog::ALL,
        view.starting_fog,
        StartingFog::label,
        false,
    ) {
        outcome.changes.push(SettingChange::StartingFog(fog));
    }
    // The fog is laid over the map once, as the game begins.
    hint(
        ui,
        &tr!("options.startingFogHint", "Takes effect next game"),
    );

    group_header(ui, &tr!("options.groupPlayerColors", "Player colors"), true);
    group_note(
        ui,
        &tr!(
            "options.playerColorsDescription",
            "How player colors appear in your games. Cycle between modes in-game with Shift+Tab."
        ),
    );
    if let Some(mode) = segmented_row(
        ui,
        &tr!("options.colorOverrides", "Color overrides"),
        &MinimapColorMode::ALL,
        view.minimap_color_mode,
        MinimapColorMode::label,
        false,
    ) {
        outcome.changes.push(SettingChange::MinimapColorMode(mode));
    }

    group_header(ui, &tr!("options.groupSkins", "Skins"), true);
    group_note(
        ui,
        &tr!(
            "options.skinsDescription",
            "Must be purchased from Blizzard."
        ),
    );
    switch_row(
        ui,
        &tr!("options.showBonusSkins", "Show bonus skins"),
        view.show_bonus_skins,
        false,
        outcome,
        SettingChange::ShowBonusSkins,
    );
    if let Some(index) = stepper_row(
        ui,
        &tr!("options.unitSkin", "Ingame skin"),
        UNIT_SKINS,
        view.unit_skin,
        !view.show_bonus_skins,
    ) {
        outcome
            .changes
            .push(SettingChange::UnitSkin(UNIT_SKINS[index].id));
    }
    if let Some(index) = stepper_row(
        ui,
        &tr!("options.consoleSkin", "Console skin"),
        CONSOLE_SKINS,
        view.console_skin,
        false,
    ) {
        outcome
            .changes
            .push(SettingChange::ConsoleSkin(CONSOLE_SKINS[index].id));
    }
    hint(ui, &tr!("options.skinsHint", "Skins take effect next game"));

    group_header(ui, &tr!("options.groupApmAlert", "APM alert"), true);
    switch_row(
        ui,
        &tr!("options.apmAlert", "Alert when APM falls below"),
        view.apm_alert_on,
        false,
        outcome,
        SettingChange::ApmAlertOn,
    );
    slider_row(
        ui,
        &tr!("options.apmValue", "APM value"),
        view.apm_alert_value,
        APM_ALERT_VALUE,
        !view.apm_alert_on,
        outcome,
        SettingChange::ApmAlertValue,
    );
    switch_row(
        ui,
        &tr!("options.apmColorText", "Color text"),
        view.apm_alert_color_on,
        !view.apm_alert_on,
        outcome,
        SettingChange::ApmAlertColorOn,
    );
    switch_row(
        ui,
        &tr!("options.apmSound", "Play sound"),
        view.apm_alert_sound_on,
        !view.apm_alert_on,
        outcome,
        SettingChange::ApmAlertSoundOn,
    );
}
