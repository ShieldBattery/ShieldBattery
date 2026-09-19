//! The app's settings, as the in-game options screen shows them.
//!
//! The app hands the DLL both of its settings objects once at launch, keyed and encoded the way its
//! own TypeScript keeps them; the options screen is a flat view-model of whole numbers and enums.
//! This is the one place that knows which key feeds which row and what each of the app's encodings
//! means, so nothing downstream has to.
//!
//! A key the app did not send, or sent as something that cannot be read as the row's kind of value,
//! leaves that row on the default a fresh install plays on: one unreadable setting must not cost
//! the screen the other fifty. Every such key is named once, together, in a single log line.

use overlay_ui::options::{
    ANNOUNCERS, APM_ALERT_VALUE, BRIGHTNESS, CONSOLE_SKINS, CURSOR_SIZE_EIGHTHS, DisplayMode,
    FPS_LIMIT, GRAB_PAN_SENSITIVITY, MOUSE_SENSITIVITY, MinimapPosition, MinimapTerrain,
    NamedChoice, OptionsView, SCROLL_SPEED, SD_GRAPHICS_FILTER, StartingFog, UNIT_SKINS,
    UnitPortraits, VOLUME,
};
use serde_json::{Map, Value};

/// SC:R keeps brightness as an integer gamma percentage between these bounds. The options screen's
/// own 0-100 scale is that range stretched over it, which is the scale the app's own slider shows
/// too, so a player reads the same number in both places.
const GAMMA_MIN: f64 = 60.0;
const GAMMA_MAX: f64 = 140.0;

/// How many parts of the cursor's full size the app's cursor scale is a fraction of; see
/// [`CURSOR_SIZE_EIGHTHS`].
const CURSOR_SIZE_PARTS: f64 = 8.0;

/// Which of the app's two settings objects a key lives in.
#[derive(Copy, Clone)]
enum Source {
    /// The settings SC:R itself owns, which the app mirrors into the game's own settings file.
    Scr,
    /// ShieldBattery's own settings, which SC:R knows nothing about.
    Local,
}

/// Everything the options screen shows, read out of the settings the app sent.
pub fn options_view_from_settings(
    scr: &Map<String, Value>,
    local: &Map<String, Value>,
) -> OptionsView {
    let mut settings = Settings {
        scr,
        local,
        unread: Vec::new(),
    };
    let mut view = OptionsView::default();

    // Input.
    view.mouse_sensitivity_on = settings
        .flag(Source::Scr, "mouseSensitivityOn")
        .unwrap_or(view.mouse_sensitivity_on);
    view.mouse_sensitivity = settings
        .number(Source::Scr, "mouseSensitivity")
        .map_or(view.mouse_sensitivity, |value| {
            MOUSE_SENSITIVITY.clamp(value)
        });
    view.mouse_scaling_on = settings
        .flag(Source::Scr, "mouseScalingOn")
        .unwrap_or(view.mouse_scaling_on);
    view.hardware_cursor_on = settings
        .flag(Source::Scr, "hardwareCursorOn")
        .unwrap_or(view.hardware_cursor_on);
    view.mouse_confine_on = settings
        .flag(Source::Scr, "mouseConfineOn")
        .unwrap_or(view.mouse_confine_on);
    view.keyboard_scroll_speed = settings
        .number(Source::Scr, "keyboardScrollSpeed")
        .map_or(view.keyboard_scroll_speed, |value| {
            SCROLL_SPEED.clamp(value)
        });
    view.mouse_scroll_speed = settings
        .number(Source::Scr, "mouseScrollSpeed")
        .map_or(view.mouse_scroll_speed, |value| SCROLL_SPEED.clamp(value));
    // The app names this for what it gates: grab pan itself always works, and the setting decides
    // whether the custom sensitivity applies instead of the game's own fixed sweep.
    view.grab_pan_on = settings
        .flag(Source::Local, "grabPanSensitivityOn")
        .unwrap_or(view.grab_pan_on);
    view.grab_pan_sensitivity = settings
        .number(Source::Local, "grabPanSensitivity")
        .map_or(view.grab_pan_sensitivity, |value| {
            GRAB_PAN_SENSITIVITY.clamp(value)
        });
    view.grab_pan_inverted = settings
        .flag(Source::Local, "grabPanInverted")
        .unwrap_or(view.grab_pan_inverted);
    view.legacy_cursor_sizing = settings
        .flag(Source::Local, "legacyCursorSizing")
        .unwrap_or(view.legacy_cursor_sizing);
    view.custom_cursor_size_on = settings
        .flag(Source::Local, "useCustomCursorSize")
        .unwrap_or(view.custom_cursor_size_on);
    // The app keeps the cursor scale as a fraction of the cursor's full size, moving in eighths.
    view.cursor_size_eighths = settings
        .float(Source::Local, "customCursorSize")
        .map_or(view.cursor_size_eighths, |size| {
            CURSOR_SIZE_EIGHTHS.clamp((size * CURSOR_SIZE_PARTS).round() as u32)
        });

    // Sound.
    view.music_on = settings
        .flag(Source::Scr, "musicOn")
        .unwrap_or(view.music_on);
    view.music_volume = settings
        .number(Source::Scr, "musicVolume")
        .map_or(view.music_volume, |value| VOLUME.clamp(value));
    view.sound_on = settings
        .flag(Source::Scr, "soundOn")
        .unwrap_or(view.sound_on);
    view.sound_volume = settings
        .number(Source::Scr, "soundVolume")
        .map_or(view.sound_volume, |value| VOLUME.clamp(value));
    view.unit_speech_on = settings
        .flag(Source::Scr, "unitSpeechOn")
        .unwrap_or(view.unit_speech_on);
    view.unit_acknowledgements_on = settings
        .flag(Source::Scr, "unitAcknowledgementsOn")
        .unwrap_or(view.unit_acknowledgements_on);
    view.background_sounds_on = settings
        .flag(Source::Scr, "backgroundSoundsOn")
        .unwrap_or(view.background_sounds_on);
    view.building_sounds_on = settings
        .flag(Source::Scr, "buildingSoundsOn")
        .unwrap_or(view.building_sounds_on);
    view.game_subtitles_on = settings
        .flag(Source::Scr, "gameSubtitlesOn")
        .unwrap_or(view.game_subtitles_on);
    view.cinematic_subtitles_on = settings
        .flag(Source::Scr, "cinematicSubtitlesOn")
        .unwrap_or(view.cinematic_subtitles_on);
    view.original_voice_overs_on = settings
        .flag(Source::Scr, "originalVoiceOversOn")
        .unwrap_or(view.original_voice_overs_on);
    view.announcer = settings
        .choice(Source::Scr, "selectedAnnouncer", ANNOUNCERS)
        .unwrap_or(view.announcer);

    // Video.
    view.display_mode = settings
        .decoded(Source::Scr, "displayMode", |value| match value {
            0 => Some(DisplayMode::Windowed),
            1 => Some(DisplayMode::WindowedFullscreen),
            2 => Some(DisplayMode::Fullscreen),
            _ => None,
        })
        .unwrap_or(view.display_mode);
    view.brightness = settings
        .number(Source::Scr, "gamma")
        .map_or(view.brightness, |gamma| {
            let across = (f64::from(gamma).clamp(GAMMA_MIN, GAMMA_MAX) - GAMMA_MIN)
                / (GAMMA_MAX - GAMMA_MIN);
            BRIGHTNESS.clamp((across * f64::from(BRIGHTNESS.max)).round() as u32)
        });
    view.fps_limit_on = settings
        .flag(Source::Scr, "fpsLimitOn")
        .unwrap_or(view.fps_limit_on);
    // A cap below the screen's lowest notch is what the app holds while the custom limit is off,
    // so it reads as that notch rather than as a cap no game could run under.
    view.fps_limit = settings
        .number(Source::Scr, "fpsLimit")
        .map_or(view.fps_limit, |value| FPS_LIMIT.clamp(value));
    view.vsync_on = settings
        .flag(Source::Scr, "vsyncOn")
        .unwrap_or(view.vsync_on);
    view.hd_graphics_on = settings
        .flag(Source::Scr, "hdGraphicsOn")
        .unwrap_or(view.hd_graphics_on);
    view.sd_graphics_filter = settings
        .number(Source::Scr, "sdGraphicsFilter")
        .map_or(view.sd_graphics_filter, |value| {
            SD_GRAPHICS_FILTER.clamp(value)
        });
    view.environment_effects_on = settings
        .flag(Source::Scr, "environmentEffectsOn")
        .unwrap_or(view.environment_effects_on);
    view.real_time_lighting_on = settings
        .flag(Source::Scr, "realTimeLightingOn")
        .unwrap_or(view.real_time_lighting_on);
    view.smooth_unit_turning_on = settings
        .flag(Source::Scr, "smoothUnitTurningOn")
        .unwrap_or(view.smooth_unit_turning_on);
    view.shadow_stacking_on = settings
        .flag(Source::Scr, "shadowStackingOn")
        .unwrap_or(view.shadow_stacking_on);
    view.pillarbox_on = settings
        .flag(Source::Scr, "pillarboxOn")
        .unwrap_or(view.pillarbox_on);
    view.show_fps = settings
        .flag(Source::Scr, "showFps")
        .unwrap_or(view.show_fps);

    // Gameplay.
    view.game_timer_on = settings
        .flag(Source::Scr, "gameTimerOn")
        .unwrap_or(view.game_timer_on);
    view.color_cycling_on = settings
        .flag(Source::Scr, "colorCyclingOn")
        .unwrap_or(view.color_cycling_on);
    // Portraits count down from the most that is drawn to the least.
    view.unit_portraits = settings
        .decoded(Source::Scr, "unitPortraits", |value| match value {
            2 => Some(UnitPortraits::Animated),
            1 => Some(UnitPortraits::Still),
            0 => Some(UnitPortraits::Disabled),
            _ => None,
        })
        .unwrap_or(view.unit_portraits);
    // The minimap has two places it can stand, so the app carries the one that is not standard as
    // a flag.
    view.minimap_position = settings.flag(Source::Scr, "minimapPosition").map_or(
        view.minimap_position,
        |bottom_left| {
            if bottom_left {
                MinimapPosition::BottomLeft
            } else {
                MinimapPosition::Standard
            }
        },
    );
    // Named for what it does to the minimap rather than for what the minimap then shows.
    view.minimap_terrain = settings.flag(Source::Local, "minimapTerrainHidden").map_or(
        view.minimap_terrain,
        |hidden| {
            if hidden {
                MinimapTerrain::Hidden
            } else {
                MinimapTerrain::Shown
            }
        },
    );
    view.starting_fog = settings
        .keyed(Source::Local, "startingFog", |value| match value {
            "transparent" => Some(StartingFog::ShowTerrainAndResources),
            "showResources" => Some(StartingFog::ShowResources),
            "legacy" => Some(StartingFog::Legacy),
            _ => None,
        })
        .unwrap_or(view.starting_fog);
    view.apm_display_on = settings
        .flag(Source::Scr, "apmDisplayOn")
        .unwrap_or(view.apm_display_on);
    view.apm_alert_on = settings
        .flag(Source::Scr, "apmAlertOn")
        .unwrap_or(view.apm_alert_on);
    view.apm_alert_value = settings
        .number(Source::Scr, "apmAlertValue")
        .map_or(view.apm_alert_value, |value| APM_ALERT_VALUE.clamp(value));
    view.apm_alert_color_on = settings
        .flag(Source::Scr, "apmAlertColorOn")
        .unwrap_or(view.apm_alert_color_on);
    view.apm_alert_sound_on = settings
        .flag(Source::Scr, "apmAlertSoundOn")
        .unwrap_or(view.apm_alert_sound_on);
    view.console_skin = settings
        .choice(Source::Scr, "consoleSkin", CONSOLE_SKINS)
        .unwrap_or(view.console_skin);
    view.unit_skin = settings
        .choice(Source::Scr, "selectedSkin", UNIT_SKINS)
        .unwrap_or(view.unit_skin);
    view.show_bonus_skins = settings
        .flag(Source::Scr, "showBonusSkins")
        .unwrap_or(view.show_bonus_skins);

    if !settings.unread.is_empty() {
        warn!(
            "In-game options screen is showing defaults for settings the app did not send, or \
             sent as something it could not read: {}",
            settings.unread.join(", "),
        );
    }
    view
}

/// The settings objects the app sent, and what could not be read out of them.
struct Settings<'a> {
    scr: &'a Map<String, Value>,
    local: &'a Map<String, Value>,
    /// Every key that was missing, of the wrong kind, or carrying a value with no meaning on the
    /// options screen. Collected rather than logged as each one is met: a client older than a batch
    /// of these settings would otherwise write a line for every one of them.
    unread: Vec<&'static str>,
}

impl<'a> Settings<'a> {
    fn raw(&self, source: Source, key: &str) -> Option<&'a Value> {
        match source {
            Source::Scr => self.scr.get(key),
            Source::Local => self.local.get(key),
        }
    }

    /// Records `key` as unread and hands back nothing, so the caller keeps the default.
    fn miss<T>(&mut self, key: &'static str) -> Option<T> {
        self.unread.push(key);
        None
    }

    /// An on/off setting. A number is read as well as a bool, because SC:R's own settings carry
    /// some of their flags (vsync among them) as a number standing for one.
    fn flag(&mut self, source: Source, key: &'static str) -> Option<bool> {
        let value = self.raw(source, key);
        let read = value
            .and_then(Value::as_bool)
            .or_else(|| value.and_then(whole).map(|number| number != 0));
        read.or_else(|| self.miss(key))
    }

    /// A setting the screen carries as a whole number. The range it belongs to is applied by the
    /// caller, which is what finally decides the value.
    fn number(&mut self, source: Source, key: &'static str) -> Option<u32> {
        let read = self.raw(source, key).and_then(whole);
        read.or_else(|| self.miss(key))
    }

    /// A setting the app keeps as a fraction.
    fn float(&mut self, source: Source, key: &'static str) -> Option<f64> {
        let read = self.raw(source, key).and_then(Value::as_f64);
        read.or_else(|| self.miss(key))
    }

    /// A number standing for one of a handful of choices. A number `decode` has no choice for is
    /// as unread as a missing key: the app and the overlay disagree about the encoding, and the
    /// screen would otherwise show a choice nobody made.
    fn decoded<T>(
        &mut self,
        source: Source,
        key: &'static str,
        decode: fn(u32) -> Option<T>,
    ) -> Option<T> {
        let read = self.raw(source, key).and_then(whole).and_then(decode);
        read.or_else(|| self.miss(key))
    }

    /// The same, for a choice the app keeps as a string.
    fn keyed<T>(
        &mut self,
        source: Source,
        key: &'static str,
        decode: fn(&str) -> Option<T>,
    ) -> Option<T> {
        let read = self
            .raw(source, key)
            .and_then(Value::as_str)
            .and_then(decode);
        read.or_else(|| self.miss(key))
    }

    /// Where the id the app sent sits in one of the screen's named lists. An id no entry carries —
    /// a pack from a patch newer than this DLL — leaves the row on the entry every install has.
    fn choice(&mut self, source: Source, key: &'static str, list: &[NamedChoice]) -> Option<usize> {
        let read = self
            .raw(source, key)
            .and_then(Value::as_str)
            .and_then(|id| list.iter().position(|entry| entry.id == id));
        read.or_else(|| self.miss(key))
    }
}

/// A JSON number as a whole number, however the app wrote it. The cast saturates at both ends, so a
/// value from outside the range is pulled to the nearest end of it rather than wrapping.
fn whole(value: &Value) -> Option<u32> {
    value.as_f64().map(|number| number.round() as u32)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// Every key the app sends, each carrying something other than its default, so a key wired to
    /// the wrong row is caught by the row that then fails to move.
    fn full_settings() -> (Map<String, Value>, Map<String, Value>) {
        let scr = json!({
            "mouseSensitivityOn": true,
            "mouseSensitivity": 35,
            "mouseScalingOn": true,
            "hardwareCursorOn": true,
            "mouseConfineOn": true,
            "keyboardScrollSpeed": 4,
            "mouseScrollSpeed": 3,
            "musicOn": false,
            "musicVolume": 20,
            "soundOn": false,
            "soundVolume": 80,
            "unitSpeechOn": false,
            "unitAcknowledgementsOn": false,
            "backgroundSoundsOn": false,
            "buildingSoundsOn": false,
            "gameSubtitlesOn": true,
            "cinematicSubtitlesOn": true,
            "originalVoiceOversOn": true,
            "selectedAnnouncer": "Jini",
            "displayMode": 2,
            "gamma": 140,
            "fpsLimitOn": true,
            "fpsLimit": 240,
            "sdGraphicsFilter": 2,
            "vsyncOn": 1,
            "hdGraphicsOn": false,
            "environmentEffectsOn": false,
            "realTimeLightingOn": true,
            "smoothUnitTurningOn": false,
            "shadowStackingOn": true,
            "pillarboxOn": true,
            "showFps": true,
            "gameTimerOn": true,
            "colorCyclingOn": false,
            "unitPortraits": 2,
            "minimapPosition": true,
            "apmDisplayOn": true,
            "apmAlertOn": true,
            "apmAlertValue": 120,
            "apmAlertColorOn": true,
            "apmAlertSoundOn": true,
            "consoleSkin": "KRC_Gold",
            "selectedSkin": "carbot",
            "showBonusSkins": true,
        });
        let local = json!({
            "grabPanSensitivityOn": false,
            "grabPanSensitivity": 75,
            "grabPanInverted": true,
            "legacyCursorSizing": true,
            "useCustomCursorSize": true,
            "customCursorSize": 0.625,
            "minimapTerrainHidden": true,
            "startingFog": "legacy",
        });
        (as_map(scr), as_map(local))
    }

    fn as_map(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            other => panic!("not a settings object: {other}"),
        }
    }

    /// What [`full_settings`] says, row by row.
    #[test]
    fn every_setting_the_app_sends_reaches_its_row() {
        let (scr, local) = full_settings();
        let expected = OptionsView {
            mouse_sensitivity_on: true,
            mouse_sensitivity: 35,
            mouse_scaling_on: true,
            hardware_cursor_on: true,
            mouse_confine_on: true,
            keyboard_scroll_speed: 4,
            mouse_scroll_speed: 3,
            grab_pan_on: false,
            grab_pan_sensitivity: 75,
            grab_pan_inverted: true,
            legacy_cursor_sizing: true,
            custom_cursor_size_on: true,
            cursor_size_eighths: 5,

            music_on: false,
            music_volume: 20,
            sound_on: false,
            sound_volume: 80,
            unit_speech_on: false,
            unit_acknowledgements_on: false,
            background_sounds_on: false,
            building_sounds_on: false,
            game_subtitles_on: true,
            cinematic_subtitles_on: true,
            original_voice_overs_on: true,
            announcer: 5,

            display_mode: DisplayMode::Fullscreen,
            // Which display the game is on is read off the machine rather than out of either
            // settings object, so it stays where a fresh view has it.
            monitor: 0,
            brightness: 100,
            fps_limit_on: true,
            fps_limit: 240,
            vsync_on: true,
            hd_graphics_on: false,
            sd_graphics_filter: 2,
            environment_effects_on: false,
            real_time_lighting_on: true,
            smooth_unit_turning_on: false,
            shadow_stacking_on: true,
            pillarbox_on: true,
            show_fps: true,

            game_timer_on: true,
            color_cycling_on: false,
            unit_portraits: UnitPortraits::Animated,
            minimap_position: MinimapPosition::BottomLeft,
            minimap_terrain: MinimapTerrain::Hidden,
            starting_fog: StartingFog::Legacy,
            apm_display_on: true,
            apm_alert_on: true,
            apm_alert_value: 120,
            apm_alert_color_on: true,
            apm_alert_sound_on: true,
            console_skin: 5,
            unit_skin: 2,
            show_bonus_skins: true,
        };
        assert_eq!(options_view_from_settings(&scr, &local), expected);
        // Every row moved off its default, so none of them was read from a key that isn't there.
        assert_ne!(expected, OptionsView::default());
    }

    /// The app's encodings for the settings that are neither a plain flag nor a plain number.
    #[test]
    fn the_apps_encodings_read_as_the_screens_choices() {
        for (encoded, mode) in [
            (0, DisplayMode::Windowed),
            (1, DisplayMode::WindowedFullscreen),
            (2, DisplayMode::Fullscreen),
        ] {
            assert_eq!(
                view_of_scr("displayMode", json!(encoded)).display_mode,
                mode
            );
        }
        for (encoded, portraits) in [
            (0, UnitPortraits::Disabled),
            (1, UnitPortraits::Still),
            (2, UnitPortraits::Animated),
        ] {
            assert_eq!(
                view_of_scr("unitPortraits", json!(encoded)).unit_portraits,
                portraits
            );
        }
        for (encoded, position) in [
            (true, MinimapPosition::BottomLeft),
            (false, MinimapPosition::Standard),
        ] {
            assert_eq!(
                view_of_scr("minimapPosition", json!(encoded)).minimap_position,
                position
            );
        }
        for (encoded, terrain) in [
            (true, MinimapTerrain::Hidden),
            (false, MinimapTerrain::Shown),
        ] {
            assert_eq!(
                view_of_local("minimapTerrainHidden", json!(encoded)).minimap_terrain,
                terrain
            );
        }
        for (encoded, fog) in [
            ("transparent", StartingFog::ShowTerrainAndResources),
            ("showResources", StartingFog::ShowResources),
            ("legacy", StartingFog::Legacy),
        ] {
            assert_eq!(
                view_of_local("startingFog", json!(encoded)).starting_fog,
                fog
            );
        }
        // Vsync is a number standing for a flag, which is how SC:R's own settings carry it.
        assert!(view_of_scr("vsyncOn", json!(1)).vsync_on);
        assert!(!view_of_scr("vsyncOn", json!(0)).vsync_on);
        // The unit skin list's first entry is the id for wearing no skin at all, which is a value
        // the app really sends rather than the fallback for one it does not.
        assert_eq!(view_of_scr("selectedSkin", json!("")).unit_skin, 0);
    }

    /// A client that sends nothing at all — one older than every setting here — leaves the screen
    /// showing what a fresh install plays on.
    #[test]
    fn settings_the_app_did_not_send_keep_their_defaults() {
        let empty = Map::new();
        assert_eq!(
            options_view_from_settings(&empty, &empty),
            OptionsView::default()
        );
        // One missing key costs its own row and nothing else.
        let (mut scr, local) = full_settings();
        scr.remove("apmAlertValue");
        let view = options_view_from_settings(&scr, &local);
        assert_eq!(view.apm_alert_value, OptionsView::default().apm_alert_value);
        assert!(view.apm_alert_on);
    }

    /// A value of the wrong kind, or one that means nothing to the screen, is treated as a value
    /// the app did not send rather than as something to be coerced into a row.
    #[test]
    fn values_that_cannot_be_read_keep_their_defaults() {
        let defaults = OptionsView::default();
        assert_eq!(
            view_of_scr("musicOn", json!("yes")).music_on,
            defaults.music_on
        );
        assert_eq!(
            view_of_scr("displayMode", json!(7)).display_mode,
            defaults.display_mode
        );
        assert_eq!(
            view_of_local("startingFog", json!("fog-from-a-later-build")).starting_fog,
            defaults.starting_fog
        );
        assert_eq!(
            view_of_scr("consoleSkin", json!("a-skin-from-a-later-patch")).console_skin,
            defaults.console_skin
        );
    }

    /// Whatever the app holds in a slider setting, the screen shows a value that slider can be left
    /// on: the app's own notches are finer than the screen's in places, and a settings file written
    /// by hand answers to nothing at all.
    #[test]
    fn slider_values_land_on_a_notch_inside_the_bounds() {
        assert_eq!(
            view_of_scr("mouseSensitivity", json!(37)).mouse_sensitivity,
            35
        );
        assert_eq!(
            view_of_scr("mouseSensitivity", json!(4000)).mouse_sensitivity,
            100
        );
        assert_eq!(view_of_scr("apmAlertValue", json!(-30)).apm_alert_value, 0);
        // The app holds a cap of zero while the custom limit is off.
        assert_eq!(view_of_scr("fpsLimit", json!(0)).fps_limit, FPS_LIMIT.min);
        assert_eq!(view_of_scr("fpsLimit", json!(144)).fps_limit, 144);
        // Gamma is stretched onto the screen's own brightness scale, ends and middle alike.
        assert_eq!(view_of_scr("gamma", json!(60)).brightness, 0);
        assert_eq!(view_of_scr("gamma", json!(100)).brightness, 50);
        assert_eq!(view_of_scr("gamma", json!(140)).brightness, 100);
        // The cursor scale is a fraction of the cursor's full size, counted in eighths.
        assert_eq!(
            view_of_local("customCursorSize", json!(0.25)).cursor_size_eighths,
            2
        );
        assert_eq!(
            view_of_local("customCursorSize", json!(1.0)).cursor_size_eighths,
            8
        );
    }

    fn view_of_scr(key: &str, value: Value) -> OptionsView {
        let mut scr = Map::new();
        scr.insert(key.to_string(), value);
        options_view_from_settings(&scr, &Map::new())
    }

    fn view_of_local(key: &str, value: Value) -> OptionsView {
        let mut local = Map::new();
        local.insert(key.to_string(), value);
        options_view_from_settings(&Map::new(), &local)
    }
}
