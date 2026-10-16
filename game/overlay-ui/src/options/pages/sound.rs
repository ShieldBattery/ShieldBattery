//! The Sound page: volumes, the announcer, and the in-game sounds.

use egui::Ui;

use crate::options::fields::{group_header, group_note, hint, slider_row, stepper_row, switch_row};
use crate::options::{ANNOUNCERS, OptionsOutcome, OptionsView, SettingChange, VOLUME};
use crate::tr;

pub(super) fn draw(ui: &mut Ui, view: &OptionsView, outcome: &mut OptionsOutcome) {
    group_header(ui, &tr!("options.groupVolume", "Volume"), false);
    switch_row(
        ui,
        &tr!("options.music", "Music"),
        view.music_on,
        false,
        outcome,
        SettingChange::MusicOn,
    );
    slider_row(
        ui,
        &tr!("options.musicVolume", "Music volume"),
        view.music_volume,
        VOLUME,
        !view.music_on,
        outcome,
        SettingChange::MusicVolume,
    );
    switch_row(
        ui,
        &tr!("options.gameSounds", "Game sounds"),
        view.sound_on,
        false,
        outcome,
        SettingChange::SoundOn,
    );
    slider_row(
        ui,
        &tr!("options.soundVolume", "Sound volume"),
        view.sound_volume,
        VOLUME,
        !view.sound_on,
        outcome,
        SettingChange::SoundVolume,
    );

    group_header(ui, &tr!("options.groupAnnouncer", "Announcer"), true);
    group_note(
        ui,
        &tr!(
            "options.announcerPacks",
            "Packs (must be purchased from Blizzard)"
        ),
    );
    if let Some(index) = stepper_row(
        ui,
        &tr!("options.announcer", "Announcer"),
        ANNOUNCERS,
        view.announcer,
        false,
    ) {
        outcome
            .changes
            .push(SettingChange::Announcer(ANNOUNCERS[index].id));
    }
    hint(ui, &tr!("options.announcerHint", "Takes effect next game"));

    group_header(ui, &tr!("options.groupInGameSound", "In game"), true);
    switch_row(
        ui,
        &tr!("options.unitSpeech", "Unit speech"),
        view.unit_speech_on,
        false,
        outcome,
        SettingChange::UnitSpeechOn,
    );
    switch_row(
        ui,
        &tr!("options.unitAcknowledgements", "Unit acknowledgements"),
        view.unit_acknowledgements_on,
        false,
        outcome,
        SettingChange::UnitAcknowledgementsOn,
    );
    switch_row(
        ui,
        &tr!(
            "options.backgroundSounds",
            "Sound plays while in background"
        ),
        view.background_sounds_on,
        false,
        outcome,
        SettingChange::BackgroundSoundsOn,
    );
    switch_row(
        ui,
        &tr!("options.buildingSounds", "Building sounds"),
        view.building_sounds_on,
        false,
        outcome,
        SettingChange::BuildingSoundsOn,
    );
    switch_row(
        ui,
        &tr!("options.gameSubtitles", "Game subtitles"),
        view.game_subtitles_on,
        false,
        outcome,
        SettingChange::GameSubtitlesOn,
    );
    switch_row(
        ui,
        &tr!("options.cinematicSubtitles", "Cinematic subtitles"),
        view.cinematic_subtitles_on,
        false,
        outcome,
        SettingChange::CinematicSubtitlesOn,
    );
    switch_row(
        ui,
        &tr!("options.originalVoiceOvers", "Original unit voice overs"),
        view.original_voice_overs_on,
        false,
        outcome,
        SettingChange::OriginalVoiceOversOn,
    );
}
