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
    FPS_LIMIT, FramePacing, GRAB_PAN_SENSITIVITY, MOUSE_SENSITIVITY, MinimapColorMode,
    MinimapPosition, MinimapTerrain, NamedChoice, OptionsView, ROLLBACK_TARGET, SCROLL_SPEED,
    SD_GRAPHICS_FILTER, SettingChange, StartingFog, UNIT_SKINS, UnitPortraits, VOLUME,
};
use serde_json::{Map, Value};

use crate::bw_scr::game_settings::SettingValue;

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
///
/// `launched_monitor` is the display the game was launched on, as an index into the host's own list
/// of them: the app names its displays by ids this machine's enumeration does not carry, so which
/// one a chosen `monitorId` stands for is only known from where the launch put the game.
pub fn options_view_from_settings(
    scr: &Map<String, Value>,
    local: &Map<String, Value>,
    launched_monitor: usize,
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
    // The app keeps "Default (primary monitor)" as no id at all, so a missing key is a choice the
    // player made rather than one the app failed to send.
    view.monitor = match settings.raw(Source::Local, "monitorId") {
        None => None,
        Some(id) if id.is_number() => Some(launched_monitor),
        Some(_) => settings.miss("monitorId"),
    };
    view.frame_pacing = settings
        .keyed(Source::Local, "framePacing", |value| match value {
            "display" => Some(FramePacing::Display),
            "variableRefresh" => Some(FramePacing::VariableRefresh),
            "off" => Some(FramePacing::Off),
            _ => None,
        })
        .unwrap_or(view.frame_pacing);
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
    // A launch with the HD art left out is a developer's setting, so its absence is no unread key.
    view.hd_graphics_available = !local
        .get("disableHd")
        .and_then(Value::as_bool)
        .unwrap_or(false);
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
    view.show_latency = settings
        .flag(Source::Scr, "showTurnRate")
        .unwrap_or(view.show_latency);
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
    view.minimap_color_mode = settings
        .decoded(Source::Local, "minimapColorMode", |value| match value {
            0 => Some(MinimapColorMode::Standard),
            1 => Some(MinimapColorMode::PresetOnMinimapOnly),
            2 => Some(MinimapColorMode::Preset),
            _ => None,
        })
        .unwrap_or(view.minimap_color_mode);
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

    // Network.
    view.rollback_target = settings
        .number(Source::Local, "rollbackTarget")
        .map_or(view.rollback_target, |value| ROLLBACK_TARGET.clamp(value));
    view.turn_rate_24_delay_on = settings
        .flag(Source::Local, "emulateTurnRate24Delay")
        .unwrap_or(view.turn_rate_24_delay_on);

    if !settings.unread.is_empty() {
        warn!(
            "In-game options screen is showing defaults for settings the app did not send, or \
             sent as something it could not read: {}",
            settings.unread.join(", "),
        );
    }
    view
}

/// One setting as the app keeps it: which of its two settings objects, under which key, encoded as
/// the app encodes it.
pub struct AppSetting {
    /// Whether the key is one of ShieldBattery's own settings rather than one of SC:R's.
    pub local: bool,
    pub key: &'static str,
    pub value: Value,
}

/// What the app should save for a change made on the options screen: the exact inverse of
/// [`options_view_from_settings`], so a value written here reads back as the row it came from.
///
/// `None` for the monitor, which the app knows by an id of its own that the game never sees; the
/// caller sends the display's bounds for the app to look that id up by.
pub fn app_setting(change: SettingChange) -> Option<AppSetting> {
    let scr = |key, value: Value| AppSetting {
        local: false,
        key,
        value,
    };
    let local = |key, value: Value| AppSetting {
        local: true,
        key,
        value,
    };
    Some(match change {
        SettingChange::MouseSensitivityOn(on) => scr("mouseSensitivityOn", on.into()),
        SettingChange::MouseSensitivity(value) => scr("mouseSensitivity", value.into()),
        SettingChange::MouseScalingOn(on) => scr("mouseScalingOn", on.into()),
        SettingChange::HardwareCursorOn(on) => scr("hardwareCursorOn", on.into()),
        SettingChange::MouseConfineOn(on) => scr("mouseConfineOn", on.into()),
        SettingChange::KeyboardScrollSpeed(value) => scr("keyboardScrollSpeed", value.into()),
        SettingChange::MouseScrollSpeed(value) => scr("mouseScrollSpeed", value.into()),
        SettingChange::GrabPanOn(on) => local("grabPanSensitivityOn", on.into()),
        SettingChange::GrabPanSensitivity(value) => local("grabPanSensitivity", value.into()),
        SettingChange::GrabPanInverted(on) => local("grabPanInverted", on.into()),
        SettingChange::LegacyCursorSizing(on) => local("legacyCursorSizing", on.into()),
        SettingChange::CustomCursorSizeOn(on) => local("useCustomCursorSize", on.into()),
        SettingChange::CursorSizeEighths(eighths) => local(
            "customCursorSize",
            (f64::from(eighths) / CURSOR_SIZE_PARTS).into(),
        ),
        SettingChange::MusicOn(on) => scr("musicOn", on.into()),
        SettingChange::MusicVolume(value) => scr("musicVolume", value.into()),
        SettingChange::SoundOn(on) => scr("soundOn", on.into()),
        SettingChange::SoundVolume(value) => scr("soundVolume", value.into()),
        SettingChange::UnitSpeechOn(on) => scr("unitSpeechOn", on.into()),
        SettingChange::UnitAcknowledgementsOn(on) => scr("unitAcknowledgementsOn", on.into()),
        SettingChange::BackgroundSoundsOn(on) => scr("backgroundSoundsOn", on.into()),
        SettingChange::BuildingSoundsOn(on) => scr("buildingSoundsOn", on.into()),
        SettingChange::GameSubtitlesOn(on) => scr("gameSubtitlesOn", on.into()),
        SettingChange::CinematicSubtitlesOn(on) => scr("cinematicSubtitlesOn", on.into()),
        SettingChange::OriginalVoiceOversOn(on) => scr("originalVoiceOversOn", on.into()),
        SettingChange::Announcer(id) => scr("selectedAnnouncer", id.into()),
        SettingChange::DisplayMode(mode) => scr("displayMode", display_mode_value(mode).into()),
        SettingChange::Monitor(_) => return None,
        SettingChange::Brightness(value) => scr("gamma", brightness_to_gamma(value).into()),
        SettingChange::FramePacing(pacing) => local("framePacing", frame_pacing_id(pacing).into()),
        SettingChange::FpsLimitOn(on) => scr("fpsLimitOn", on.into()),
        SettingChange::FpsLimit(value) => scr("fpsLimit", value.into()),
        // SC:R keeps vertical sync as a number standing for a flag, and so does the app.
        SettingChange::VsyncOn(on) => scr("vsyncOn", u32::from(on).into()),
        SettingChange::HdGraphicsOn(on) => scr("hdGraphicsOn", on.into()),
        SettingChange::SdGraphicsFilter(value) => scr("sdGraphicsFilter", value.into()),
        SettingChange::EnvironmentEffectsOn(on) => scr("environmentEffectsOn", on.into()),
        SettingChange::RealTimeLightingOn(on) => scr("realTimeLightingOn", on.into()),
        SettingChange::SmoothUnitTurningOn(on) => scr("smoothUnitTurningOn", on.into()),
        SettingChange::ShadowStackingOn(on) => scr("shadowStackingOn", on.into()),
        SettingChange::PillarboxOn(on) => scr("pillarboxOn", on.into()),
        SettingChange::ShowFps(on) => scr("showFps", on.into()),
        SettingChange::GameTimerOn(on) => scr("gameTimerOn", on.into()),
        SettingChange::ColorCyclingOn(on) => scr("colorCyclingOn", on.into()),
        SettingChange::UnitPortraits(portraits) => {
            scr("unitPortraits", unit_portraits_value(portraits).into())
        }
        SettingChange::ShowLatency(on) => scr("showTurnRate", on.into()),
        SettingChange::MinimapPosition(position) => scr(
            "minimapPosition",
            (position == MinimapPosition::BottomLeft).into(),
        ),
        SettingChange::MinimapTerrain(terrain) => local(
            "minimapTerrainHidden",
            (terrain == MinimapTerrain::Hidden).into(),
        ),
        SettingChange::StartingFog(fog) => local("startingFog", starting_fog_id(fog).into()),
        SettingChange::MinimapColorMode(mode) => {
            local("minimapColorMode", minimap_color_mode_value(mode).into())
        }
        SettingChange::ApmDisplayOn(on) => scr("apmDisplayOn", on.into()),
        SettingChange::ApmAlertOn(on) => scr("apmAlertOn", on.into()),
        SettingChange::ApmAlertValue(value) => scr("apmAlertValue", value.into()),
        SettingChange::ApmAlertColorOn(on) => scr("apmAlertColorOn", on.into()),
        SettingChange::ApmAlertSoundOn(on) => scr("apmAlertSoundOn", on.into()),
        SettingChange::ConsoleSkin(id) => scr("consoleSkin", id.into()),
        SettingChange::UnitSkin(id) => scr("selectedSkin", id.into()),
        SettingChange::ShowBonusSkins(on) => scr("showBonusSkins", on.into()),
        SettingChange::RollbackTarget(value) => local("rollbackTarget", value.into()),
        SettingChange::TurnRate24DelayOn(on) => local("emulateTurnRate24Delay", on.into()),
    })
}

/// Where a change lands in SC:R's own settings registry, for the settings the registry's generic
/// write applies while the game runs. `None` for the ones it doesn't: ShieldBattery's own settings,
/// and the SC:R ones only a launch picks up (the monitor, HD graphics, skins, the announcer).
///
/// SC:R's values are the app's own: the app copies them into the game's settings file unconverted.
pub fn registry_setting(
    change: SettingChange,
) -> Option<(&'static str, &'static str, SettingValue)> {
    use SettingValue::{Bool, Int};
    let int = |value: u32| Int(i32::try_from(value).unwrap_or(i32::MAX));
    Some(match change {
        SettingChange::MouseSensitivityOn(on) => ("speed", "MouseUseSensitivity", Bool(on)),
        SettingChange::MouseSensitivity(value) => ("speed", "MouseSensitivity", int(value)),
        SettingChange::MouseScalingOn(on) => ("speed", "MouseScaling", Bool(on)),
        SettingChange::HardwareCursorOn(on) => ("speed", "MouseHardwareCursor", Bool(on)),
        SettingChange::MouseConfineOn(on) => ("speed", "MouseConfine", Bool(on)),
        SettingChange::KeyboardScrollSpeed(value) => ("speed", "m_kscroll", int(value)),
        SettingChange::MouseScrollSpeed(value) => ("speed", "m_mscroll", int(value)),
        SettingChange::MusicOn(on) => ("sound", "music_enabled", Bool(on)),
        SettingChange::MusicVolume(value) => ("sound", "music_volume", int(value)),
        SettingChange::SoundOn(on) => ("sound", "sfx_enabled", Bool(on)),
        SettingChange::SoundVolume(value) => ("sound", "sfx_volume", int(value)),
        SettingChange::UnitSpeechOn(on) => ("sound", "unitspeech", Bool(on)),
        SettingChange::UnitAcknowledgementsOn(on) => ("sound", "unitnoise", Bool(on)),
        SettingChange::BackgroundSoundsOn(on) => ("sound", "sound_in_background", Bool(on)),
        SettingChange::BuildingSoundsOn(on) => ("sound", "bldgnoise", Bool(on)),
        SettingChange::GameSubtitlesOn(on) => ("sound", "trigtext", Bool(on)),
        SettingChange::CinematicSubtitlesOn(on) => {
            ("language", "cinematicSubtitlesEnabled", Bool(on))
        }
        SettingChange::OriginalVoiceOversOn(on) => ("language", "originalUnitVO", Bool(on)),
        SettingChange::DisplayMode(mode) => ("video", "WindowMode", int(display_mode_value(mode))),
        SettingChange::Brightness(value) => ("video", "Gamma", int(brightness_to_gamma(value))),
        SettingChange::FpsLimitOn(on) => ("video", "FPSLimitEnabled", Bool(on)),
        SettingChange::FpsLimit(value) => ("video", "FPSLimit", int(value)),
        SettingChange::VsyncOn(on) => ("video", "VSync", Int(i32::from(on))),
        SettingChange::SdGraphicsFilter(value) => ("video", "SDFilterMode", int(value)),
        SettingChange::RealTimeLightingOn(on) => ("video", "RealtimeLightingEnabled", Bool(on)),
        SettingChange::EnvironmentEffectsOn(on) => ("game", "ShowFoliage", Bool(on)),
        SettingChange::SmoothUnitTurningOn(on) => ("game", "UseHDRotation", Bool(on)),
        SettingChange::ShadowStackingOn(on) => ("game", "ShadowStacking", Bool(on)),
        SettingChange::PillarboxOn(on) => ("game", "OriginalAspectRatio", Bool(on)),
        SettingChange::ShowFps(on) => ("game", "ShowFPS", Bool(on)),
        SettingChange::ShowLatency(on) => ("game", "ShowTurnRate", Bool(on)),
        SettingChange::GameTimerOn(on) => ("game", "GameTimer", Bool(on)),
        SettingChange::ColorCyclingOn(on) => ("game", "ColorCycle", Bool(on)),
        SettingChange::UnitPortraits(portraits) => (
            "game",
            "UnitPortraits",
            int(unit_portraits_value(portraits)),
        ),
        SettingChange::MinimapPosition(position) => (
            "game",
            "consoleSplit",
            Bool(position == MinimapPosition::BottomLeft),
        ),
        SettingChange::ApmDisplayOn(on) => ("game", "apm_Showing", Bool(on)),
        SettingChange::ApmAlertOn(on) => ("game", "apm_AlertUser", Bool(on)),
        SettingChange::ApmAlertValue(value) => ("game", "apm_AlertValue", int(value)),
        SettingChange::ApmAlertColorOn(on) => ("game", "apm_AlertUseColor", Bool(on)),
        SettingChange::ApmAlertSoundOn(on) => ("game", "apm_AlertUseSound", Bool(on)),
        _ => return None,
    })
}

fn display_mode_value(mode: DisplayMode) -> u32 {
    match mode {
        DisplayMode::Windowed => 0,
        DisplayMode::WindowedFullscreen => 1,
        DisplayMode::Fullscreen => 2,
    }
}

fn unit_portraits_value(portraits: UnitPortraits) -> u32 {
    match portraits {
        UnitPortraits::Animated => 2,
        UnitPortraits::Still => 1,
        UnitPortraits::Disabled => 0,
    }
}

fn minimap_color_mode_value(mode: MinimapColorMode) -> u32 {
    match mode {
        MinimapColorMode::Standard => 0,
        MinimapColorMode::PresetOnMinimapOnly => 1,
        MinimapColorMode::Preset => 2,
    }
}

pub fn frame_pacing_id(pacing: FramePacing) -> &'static str {
    match pacing {
        FramePacing::Display => "display",
        FramePacing::VariableRefresh => "variableRefresh",
        FramePacing::Off => "off",
    }
}

fn starting_fog_id(fog: StartingFog) -> &'static str {
    match fog {
        StartingFog::ShowTerrainAndResources => "transparent",
        StartingFog::ShowResources => "showResources",
        StartingFog::Legacy => "legacy",
    }
}

/// The options screen's 0-100 brightness as the gamma percentage SC:R keeps.
fn brightness_to_gamma(brightness: u32) -> u32 {
    let across = f64::from(brightness.min(BRIGHTNESS.max)) / f64::from(BRIGHTNESS.max);
    (GAMMA_MIN + across * (GAMMA_MAX - GAMMA_MIN)).round() as u32
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

/// How many frames in a row the game has to draw in one of HD and SD before the options screen
/// takes it as the mode the game is in. The mode is read off a frame's draw commands, and a single
/// frame's reading is not enough to move a switch the player can see.
const HD_SETTLE_FRAMES: u8 = 8;

/// The settings the game changes on its own keys while it runs (`F5` for HD, `Tab` and
/// `Shift+Tab` for the minimap), as read from the engine for one frame. `None` for one that could
/// not be read.
#[derive(Copy, Clone, Default)]
pub struct EngineSettings {
    pub hd_graphics_on: Option<bool>,
    pub minimap_terrain: Option<MinimapTerrain>,
    pub minimap_color_mode: Option<MinimapColorMode>,
}

/// Carries the changes the game makes to [`EngineSettings`] into the options screen's copy of them.
///
/// Only a change in what the engine reports is carried over, never the engine's value as such: a
/// setting the player has just moved on the screen is still on its way to the engine, and the
/// value the engine holds until then must not move it back. The first reading of each setting is
/// taken as the one the screen already shows, since both came from the same launch settings.
#[derive(Default)]
pub struct EngineSettingsFollower {
    hd_graphics_on: Option<bool>,
    /// A reading of HD that differs from [`hd_graphics_on`](Self::hd_graphics_on), and for how
    /// many frames in a row it has been read.
    hd_candidate: Option<(bool, u8)>,
    minimap_terrain: Option<MinimapTerrain>,
    minimap_color_mode: Option<MinimapColorMode>,
}

impl EngineSettingsFollower {
    /// Takes one frame's reading, writing any change the engine made into `view`.
    pub fn follow(&mut self, read: EngineSettings, view: &mut OptionsView) {
        if let Some(hd) = read.hd_graphics_on {
            match (self.hd_graphics_on, self.hd_candidate) {
                (None, _) => self.hd_graphics_on = Some(hd),
                (Some(held), _) if held == hd => self.hd_candidate = None,
                (Some(_), Some((candidate, frames))) if candidate == hd => {
                    let frames = frames + 1;
                    if frames >= HD_SETTLE_FRAMES {
                        self.hd_graphics_on = Some(hd);
                        self.hd_candidate = None;
                        view.hd_graphics_on = hd;
                    } else {
                        self.hd_candidate = Some((hd, frames));
                    }
                }
                (Some(_), _) => self.hd_candidate = Some((hd, 1)),
            }
        }
        if let Some(terrain) = read.minimap_terrain {
            if self.minimap_terrain.is_some_and(|held| held != terrain) {
                view.minimap_terrain = terrain;
            }
            self.minimap_terrain = Some(terrain);
        }
        if let Some(mode) = read.minimap_color_mode {
            if self.minimap_color_mode.is_some_and(|held| held != mode) {
                view.minimap_color_mode = mode;
            }
            self.minimap_color_mode = Some(mode);
        }
    }
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
            "showTurnRate": true,
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
            "minimapColorMode": 2,
            "monitorId": 2_528_732_444u64,
            "framePacing": "variableRefresh",
            "rollbackTarget": 4,
            "emulateTurnRate24Delay": true,
        });
        (as_map(scr), as_map(local))
    }

    /// Where the tests' launches put the game: not the first display, so a mapping that ignored it
    /// would be caught.
    const LAUNCHED_MONITOR: usize = 1;

    fn as_map(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            other => panic!("not a settings object: {other}"),
        }
    }

    /// Every change the screen can make but the monitor's, each to something other than its default.
    fn every_change() -> Vec<SettingChange> {
        vec![
            SettingChange::MouseSensitivityOn(true),
            SettingChange::MouseSensitivity(35),
            SettingChange::MouseScalingOn(true),
            SettingChange::HardwareCursorOn(true),
            SettingChange::MouseConfineOn(true),
            SettingChange::KeyboardScrollSpeed(5),
            SettingChange::MouseScrollSpeed(1),
            SettingChange::GrabPanOn(false),
            SettingChange::GrabPanSensitivity(95),
            SettingChange::GrabPanInverted(true),
            SettingChange::LegacyCursorSizing(true),
            SettingChange::CustomCursorSizeOn(true),
            SettingChange::CursorSizeEighths(5),
            SettingChange::MusicOn(false),
            SettingChange::MusicVolume(40),
            SettingChange::SoundOn(false),
            SettingChange::SoundVolume(15),
            SettingChange::UnitSpeechOn(false),
            SettingChange::UnitAcknowledgementsOn(false),
            SettingChange::BackgroundSoundsOn(true),
            SettingChange::BuildingSoundsOn(false),
            SettingChange::GameSubtitlesOn(false),
            SettingChange::CinematicSubtitlesOn(false),
            SettingChange::OriginalVoiceOversOn(true),
            SettingChange::Announcer(ANNOUNCERS[1].id),
            SettingChange::DisplayMode(DisplayMode::Fullscreen),
            SettingChange::Brightness(65),
            SettingChange::FramePacing(FramePacing::VariableRefresh),
            SettingChange::FpsLimitOn(true),
            SettingChange::FpsLimit(237),
            SettingChange::VsyncOn(true),
            SettingChange::HdGraphicsOn(false),
            SettingChange::SdGraphicsFilter(2),
            SettingChange::EnvironmentEffectsOn(false),
            SettingChange::RealTimeLightingOn(false),
            SettingChange::SmoothUnitTurningOn(false),
            SettingChange::ShadowStackingOn(true),
            SettingChange::PillarboxOn(true),
            SettingChange::ShowFps(true),
            SettingChange::GameTimerOn(false),
            SettingChange::ColorCyclingOn(false),
            SettingChange::UnitPortraits(UnitPortraits::Still),
            SettingChange::ShowLatency(true),
            SettingChange::MinimapPosition(MinimapPosition::BottomLeft),
            SettingChange::MinimapTerrain(MinimapTerrain::Hidden),
            SettingChange::StartingFog(StartingFog::Legacy),
            SettingChange::MinimapColorMode(MinimapColorMode::PresetOnMinimapOnly),
            SettingChange::ApmDisplayOn(true),
            SettingChange::ApmAlertOn(true),
            SettingChange::ApmAlertValue(123),
            SettingChange::ApmAlertColorOn(true),
            SettingChange::ApmAlertSoundOn(true),
            SettingChange::ConsoleSkin(CONSOLE_SKINS[2].id),
            SettingChange::UnitSkin(UNIT_SKINS[1].id),
            SettingChange::ShowBonusSkins(false),
            SettingChange::RollbackTarget(4),
            SettingChange::TurnRate24DelayOn(true),
        ]
    }

    /// A setting added to the screen and left out of [`every_change`] would never be checked for
    /// reading back. The monitor is the one the app saves by a display id only it knows.
    #[test]
    fn every_change_covers_every_setting() {
        let covered: Vec<_> = every_change().iter().map(std::mem::discriminant).collect();
        for change in SettingChange::one_per_setting() {
            if !matches!(change, SettingChange::Monitor(_)) {
                assert!(
                    covered.contains(&std::mem::discriminant(&change)),
                    "{change:?} is missing from every_change"
                );
            }
        }
    }

    #[test]
    fn a_saved_change_reads_back_as_the_row_it_came_from() {
        for change in every_change() {
            let saved = app_setting(change).expect("every change but the monitor is saved");
            let (mut scr, mut local) = full_settings();
            let target = if saved.local { &mut local } else { &mut scr };
            target.insert(saved.key.into(), saved.value);
            let mut expected =
                options_view_from_settings(&full_settings().0, &full_settings().1, 0);
            expected.apply(change);
            assert_eq!(
                options_view_from_settings(&scr, &local, 0),
                expected,
                "{change:?} did not read back"
            );
        }
    }

    #[test]
    fn brightness_lands_on_the_gamma_ends() {
        assert_eq!(brightness_to_gamma(0), 60);
        assert_eq!(brightness_to_gamma(50), 100);
        assert_eq!(brightness_to_gamma(100), 140);
    }

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
            // Which display a chosen monitor is comes from where the launch put the game.
            monitor: Some(LAUNCHED_MONITOR),
            brightness: 100,
            frame_pacing: FramePacing::VariableRefresh,
            fps_limit_on: true,
            fps_limit: 240,
            vsync_on: true,
            hd_graphics_on: false,
            hd_graphics_available: true,
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
            show_latency: true,
            minimap_position: MinimapPosition::BottomLeft,
            minimap_terrain: MinimapTerrain::Hidden,
            starting_fog: StartingFog::Legacy,
            minimap_color_mode: MinimapColorMode::Preset,
            apm_display_on: true,
            apm_alert_on: true,
            apm_alert_value: 120,
            apm_alert_color_on: true,
            apm_alert_sound_on: true,
            console_skin: 5,
            unit_skin: 2,
            show_bonus_skins: true,

            rollback_target: 4,
            turn_rate_24_delay_on: true,
        };
        assert_eq!(
            options_view_from_settings(&scr, &local, LAUNCHED_MONITOR),
            expected
        );
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
        for (encoded, mode) in [
            (0, MinimapColorMode::Standard),
            (1, MinimapColorMode::PresetOnMinimapOnly),
            (2, MinimapColorMode::Preset),
        ] {
            assert_eq!(
                view_of_local("minimapColorMode", json!(encoded)).minimap_color_mode,
                mode
            );
        }
        for (encoded, pacing) in [
            ("display", FramePacing::Display),
            ("variableRefresh", FramePacing::VariableRefresh),
            ("off", FramePacing::Off),
        ] {
            assert_eq!(
                view_of_local("framePacing", json!(encoded)).frame_pacing,
                pacing
            );
        }
        // No monitor id is the app's "Default (primary monitor)", which is a choice in its own
        // right; any id is a display, and the one it is is where the launch put the game.
        assert_eq!(
            options_view_from_settings(&Map::new(), &Map::new(), LAUNCHED_MONITOR).monitor,
            None
        );
        assert_eq!(
            view_of_local("monitorId", json!(7)).monitor,
            Some(LAUNCHED_MONITOR)
        );
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
            options_view_from_settings(&empty, &empty, LAUNCHED_MONITOR),
            OptionsView::default()
        );
        // One missing key costs its own row and nothing else.
        let (mut scr, local) = full_settings();
        scr.remove("apmAlertValue");
        let view = options_view_from_settings(&scr, &local, LAUNCHED_MONITOR);
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
        assert_eq!(
            view_of_local("framePacing", json!("a-mode-from-a-later-build")).frame_pacing,
            defaults.frame_pacing
        );
        assert_eq!(
            view_of_local("minimapColorMode", json!(7)).minimap_color_mode,
            defaults.minimap_color_mode
        );
        assert_eq!(
            view_of_local("monitorId", json!("primary")).monitor,
            defaults.monitor
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
        // Every value the app lets a player type is one the APM row holds as it is.
        assert_eq!(
            view_of_scr("apmAlertValue", json!(123)).apm_alert_value,
            123
        );
        assert_eq!(
            view_of_scr("apmAlertValue", json!(1500)).apm_alert_value,
            999
        );
        assert_eq!(view_of_local("rollbackTarget", json!(9)).rollback_target, 4);
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
        options_view_from_settings(&scr, &Map::new(), LAUNCHED_MONITOR)
    }

    fn view_of_local(key: &str, value: Value) -> OptionsView {
        let mut local = Map::new();
        local.insert(key.to_string(), value);
        options_view_from_settings(&Map::new(), &local, LAUNCHED_MONITOR)
    }

    fn hd_reading(on: bool) -> EngineSettings {
        EngineSettings {
            hd_graphics_on: Some(on),
            ..EngineSettings::default()
        }
    }

    /// `F5` switching the game to SD shows on the screen once the game has settled into it.
    #[test]
    fn the_game_switching_graphics_moves_the_switch_once_settled() {
        let mut follower = EngineSettingsFollower::default();
        let mut view = OptionsView {
            hd_graphics_on: true,
            ..OptionsView::default()
        };
        follower.follow(hd_reading(true), &mut view);
        for _ in 1..HD_SETTLE_FRAMES {
            follower.follow(hd_reading(false), &mut view);
            assert!(view.hd_graphics_on);
        }
        follower.follow(hd_reading(false), &mut view);
        assert!(!view.hd_graphics_on);
    }

    /// One frame read in the other mode is noise, not a switch.
    #[test]
    fn a_stray_graphics_reading_moves_nothing() {
        let mut follower = EngineSettingsFollower::default();
        let mut view = OptionsView {
            hd_graphics_on: true,
            ..OptionsView::default()
        };
        follower.follow(hd_reading(true), &mut view);
        for _ in 0..HD_SETTLE_FRAMES * 2 {
            follower.follow(hd_reading(false), &mut view);
            follower.follow(hd_reading(true), &mut view);
        }
        assert!(view.hd_graphics_on);
    }

    /// A setting the player moved on the screen stays where they put it while the engine still
    /// holds the old value, and the engine catching up moves nothing either.
    #[test]
    fn the_engine_lagging_the_screen_leaves_the_screen_alone() {
        let mut follower = EngineSettingsFollower::default();
        let mut view = OptionsView::default();
        let terrain = |terrain| EngineSettings {
            minimap_terrain: Some(terrain),
            ..EngineSettings::default()
        };
        follower.follow(terrain(MinimapTerrain::Shown), &mut view);
        view.minimap_terrain = MinimapTerrain::Hidden;
        follower.follow(terrain(MinimapTerrain::Shown), &mut view);
        assert_eq!(view.minimap_terrain, MinimapTerrain::Hidden);
        follower.follow(terrain(MinimapTerrain::Hidden), &mut view);
        assert_eq!(view.minimap_terrain, MinimapTerrain::Hidden);
        // Tab in the game shows the terrain again.
        follower.follow(terrain(MinimapTerrain::Shown), &mut view);
        assert_eq!(view.minimap_terrain, MinimapTerrain::Shown);
    }
}
