//! The settings model behind the options screen: [`OptionsView`], what the game currently holds;
//! [`SettingChange`], one setting moved to a new value; and the ranges and choice lists the values
//! are drawn from.

use serde::{Deserialize, Serialize};

use crate::tr;

/// The bounds a slider setting moves between, and the notch it moves in.
///
/// The game keeps these settings in whole notches, so the bounds are the game's rather than
/// something chosen to look tidy: a value between two notches is one the game would round away
/// behind the player's back.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SliderRange {
    pub min: u32,
    pub max: u32,
    pub step: u32,
}

impl SliderRange {
    /// `value` brought inside the bounds and onto the nearest notch.
    pub fn clamp(self, value: u32) -> u32 {
        let value = value.clamp(self.min, self.max);
        let offset = value - self.min;
        let snapped = self.min + (offset + self.step / 2) / self.step * self.step;
        snapped.min(self.max)
    }

    /// Whether `value` is one of the values this setting can actually take.
    pub fn holds(self, value: u32) -> bool {
        value >= self.min && value <= self.max && (value - self.min).is_multiple_of(self.step)
    }
}

/// How sensitive the mouse is while the custom sensitivity is on.
pub const MOUSE_SENSITIVITY: SliderRange = SliderRange {
    min: 0,
    max: 100,
    step: 5,
};

/// The game's seven scroll notches, which both scroll speeds share.
pub const SCROLL_SPEED: SliderRange = SliderRange {
    min: 0,
    max: 6,
    step: 1,
};

/// Grab pan's own scale, which the game maps onto a gain rather than onto a speed.
pub const GRAB_PAN_SENSITIVITY: SliderRange = SliderRange {
    min: 0,
    max: 150,
    step: 5,
};

/// The cursor scale, in eighths. The app's slider runs from a quarter of the cursor's full size to
/// all of it in steps of an eighth; carrying it in eighths keeps the whole view-model in whole
/// numbers, which is what lets a change be compared and logged without worrying about how a float
/// rounded.
pub const CURSOR_SIZE_EIGHTHS: SliderRange = SliderRange {
    min: 2,
    max: 8,
    step: 1,
};

/// Either volume.
pub const VOLUME: SliderRange = SliderRange {
    min: 0,
    max: 100,
    step: 5,
};

/// The brightness slider's own scale, which the game maps onto its gamma range.
pub const BRIGHTNESS: SliderRange = SliderRange {
    min: 0,
    max: 100,
    step: 5,
};

/// The frame cap, once one is asked for.
pub const FPS_LIMIT: SliderRange = SliderRange {
    min: 100,
    max: 1000,
    step: 1,
};

/// The game's four SD filtering steps, from sharp to filtered.
pub const SD_GRAPHICS_FILTER: SliderRange = SliderRange {
    min: 0,
    max: 3,
    step: 1,
};

/// The rate the APM alert fires below. The app takes any whole number up to 999 here, typed rather
/// than dragged, so every one of them is a notch: a coarser slider would show a player's typed 125
/// as some other number, and hand that number back as theirs the moment the row was touched.
pub const APM_ALERT_VALUE: SliderRange = SliderRange {
    min: 0,
    max: 999,
    step: 1,
};

/// How many frames of the other players' lateness a game that rolls back hides by running ahead of
/// their commands, rather than by holding back the local player's own.
pub const ROLLBACK_TARGET: SliderRange = SliderRange {
    min: 0,
    max: 4,
    step: 1,
};

/// The rollback balance the app recommends, which its own slider marks.
pub const RECOMMENDED_ROLLBACK_TARGET: u32 = 2;

/// How the game is presented on the display.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum DisplayMode {
    #[default]
    Windowed,
    WindowedFullscreen,
    Fullscreen,
}

impl DisplayMode {
    pub const ALL: [DisplayMode; 3] = [
        DisplayMode::Windowed,
        DisplayMode::WindowedFullscreen,
        DisplayMode::Fullscreen,
    ];

    pub(super) fn label(self) -> String {
        match self {
            DisplayMode::Windowed => tr!("options.displayModeWindowed", "Windowed"),
            DisplayMode::WindowedFullscreen => tr!(
                "options.displayModeWindowedFullscreen",
                "Windowed (Fullscreen)"
            ),
            DisplayMode::Fullscreen => tr!("options.displayModeFullscreen", "Fullscreen"),
        }
    }
}

/// How much of a unit's portrait the console draws.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum UnitPortraits {
    Animated,
    Still,
    #[default]
    Disabled,
}

impl UnitPortraits {
    pub const ALL: [UnitPortraits; 3] = [
        UnitPortraits::Animated,
        UnitPortraits::Still,
        UnitPortraits::Disabled,
    ];

    pub(super) fn label(self) -> String {
        match self {
            UnitPortraits::Animated => tr!("options.portraitsAnimated", "Animated"),
            UnitPortraits::Still => tr!("options.portraitsStill", "Still"),
            UnitPortraits::Disabled => tr!("options.portraitsDisabled", "Disabled"),
        }
    }
}

/// Which corner of the console the minimap sits in.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum MinimapPosition {
    BottomLeft,
    #[default]
    Standard,
}

impl MinimapPosition {
    pub const ALL: [MinimapPosition; 2] = [MinimapPosition::BottomLeft, MinimapPosition::Standard];

    pub(super) fn label(self) -> String {
        match self {
            MinimapPosition::BottomLeft => {
                tr!("options.minimapPositionBottomLeft", "Bottom-left corner")
            }
            MinimapPosition::Standard => tr!("options.minimapPositionStandard", "Standard"),
        }
    }
}

/// Whether the minimap draws the map under the units.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum MinimapTerrain {
    #[default]
    Shown,
    Hidden,
}

impl MinimapTerrain {
    pub const ALL: [MinimapTerrain; 2] = [MinimapTerrain::Shown, MinimapTerrain::Hidden];

    pub(super) fn label(self) -> String {
        match self {
            MinimapTerrain::Shown => tr!("options.minimapTerrainShown", "Shown"),
            MinimapTerrain::Hidden => tr!("options.minimapTerrainHidden", "Hidden"),
        }
    }
}

/// How much of the map is visible before anything has scouted it.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum StartingFog {
    #[default]
    ShowTerrainAndResources,
    ShowResources,
    Legacy,
}

impl StartingFog {
    pub const ALL: [StartingFog; 3] = [
        StartingFog::ShowTerrainAndResources,
        StartingFog::ShowResources,
        StartingFog::Legacy,
    ];

    pub(super) fn label(self) -> String {
        match self {
            StartingFog::ShowTerrainAndResources => tr!(
                "options.startingFogTerrainAndResourcesShown",
                "Show terrain and resources"
            ),
            StartingFog::ShowResources => {
                tr!("options.startingFogResourcesShown", "Show resources")
            }
            StartingFog::Legacy => tr!("options.startingFogLegacy", "Legacy"),
        }
    }
}

/// Whether the game's own player colors are swapped for the color scheme the app resolved before
/// the game started, and where.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum MinimapColorMode {
    /// The game's own colors everywhere.
    #[default]
    Standard,
    /// The scheme's colors on the minimap, the game's own on the units.
    PresetOnMinimapOnly,
    /// The scheme's colors on the minimap and on the units.
    Preset,
}

impl MinimapColorMode {
    pub const ALL: [MinimapColorMode; 3] = [
        MinimapColorMode::Standard,
        MinimapColorMode::PresetOnMinimapOnly,
        MinimapColorMode::Preset,
    ];

    pub(super) fn label(self) -> String {
        match self {
            MinimapColorMode::Standard => tr!("options.colorOverridesOff", "Off"),
            MinimapColorMode::PresetOnMinimapOnly => {
                tr!(
                    "options.colorOverridesMinimapOnly",
                    "On for the minimap only"
                )
            }
            MinimapColorMode::Preset => tr!("options.colorOverridesEverywhere", "On everywhere"),
        }
    }
}

/// How the game times the frames it draws.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum FramePacing {
    /// One frame per refresh of the display, drawn just before the display shows it.
    Display,
    /// A little under the display's refresh rate, untimed, for a display that refreshes whenever a
    /// frame arrives.
    VariableRefresh,
    /// As many frames as the game's own frame limit allows.
    #[default]
    Off,
}

impl FramePacing {
    /// In the order the app offers them, which puts the one it recommends first.
    pub const ALL: [FramePacing; 3] = [
        FramePacing::Display,
        FramePacing::VariableRefresh,
        FramePacing::Off,
    ];

    pub(super) fn label(self) -> String {
        match self {
            FramePacing::Display => tr!("options.framePacingMatchRefresh", "Match refresh"),
            FramePacing::VariableRefresh => {
                tr!("options.framePacingVariableRefresh", "Variable refresh")
            }
            FramePacing::Off => tr!("options.framePacingOff", "Off"),
        }
    }
}

/// One entry of a list the game keeps by name: an announcer, a console skin, a unit skin.
///
/// `id` is the value the game's own settings file holds, so a host applies a choice without a
/// lookup table of its own.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct NamedChoice {
    pub id: &'static str,
    /// What the entry is called. These are the names of things Blizzard sells, which read the same
    /// in every language the overlay speaks, so they are written here rather than translated. The
    /// two entries that name no pack — the default announcer and no unit skin at all — are
    /// translated by [`NamedChoice::label`] instead.
    pub name: &'static str,
}

impl NamedChoice {
    /// What the stepper shows for this entry.
    pub fn label(&self) -> String {
        match self.id {
            "default" | "Default" => tr!("options.choiceDefault", "Default"),
            "" => tr!("options.choiceNone", "None"),
            _ => self.name.to_string(),
        }
    }
}

/// The announcers the game can be played with, in the order the app lists them.
pub const ANNOUNCERS: &[NamedChoice] = &[
    NamedChoice {
        id: "default",
        name: "Default",
    },
    NamedChoice {
        id: "Jaekyung",
        name: "Um Jae Kyung",
    },
    NamedChoice {
        id: "Yongjun",
        name: "Jeon Yong Jun",
    },
    NamedChoice {
        id: "Jungmin",
        name: "Kim Jungmin",
    },
    NamedChoice {
        id: "UmJeonKim",
        name: "Um, Jeon, Kim Trio",
    },
    NamedChoice {
        id: "Jini",
        name: "Hey Jini",
    },
];

/// The console skins the game can be played with, in the order the app lists them.
pub const CONSOLE_SKINS: &[NamedChoice] = &[
    NamedChoice {
        id: "Default",
        name: "Default",
    },
    NamedChoice {
        id: "bc2017",
        name: "BlizzCon 2017",
    },
    NamedChoice {
        id: "bc2018",
        name: "BlizzCon 2018",
    },
    NamedChoice {
        id: "SC_20thAnniversary",
        name: "StarCraft 20th Anniversary",
    },
    NamedChoice {
        id: "KRC_Silver",
        name: "Silver - Orchestra 2019",
    },
    NamedChoice {
        id: "KRC_Gold",
        name: "Gold - Orchestra 2019",
    },
    NamedChoice {
        id: "War3Spoils",
        name: "WarCraft 3 Spoils",
    },
];

/// The unit skins the game can be played with, in the order the app lists them.
pub const UNIT_SKINS: &[NamedChoice] = &[
    NamedChoice {
        id: "",
        name: "None",
    },
    NamedChoice {
        id: "presale",
        name: "Preorder",
    },
    NamedChoice {
        id: "carbot",
        name: "Carbot",
    },
];

/// Where `id` sits in `list`, or the first entry for a value the game has and the overlay does not
/// know a name for.
fn index_of(list: &[NamedChoice], id: &str) -> usize {
    list.iter().position(|entry| entry.id == id).unwrap_or(0)
}

/// One display the game can be put on, as the machine it is running on names it.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct MonitorView {
    /// What the display is called: the name its own hardware reports where there is one, and the
    /// system's name for the output where there is not.
    pub name: String,
    /// Where the display sits on the desktop, as `(x, y, width, height)`. The app knows its displays
    /// by ids of its own that this machine's enumeration does not carry, so this rectangle is what
    /// a choice made here is matched to one of them by.
    pub bounds: (i32, i32, u32, u32),
}

/// What the options screen shows that is not a setting: the lists read off the machine the game is
/// running on, and what the host knows about the game being played.
///
/// Kept beside [`OptionsView`] rather than in it: the view is copied every frame and compared
/// against the last one a host handed over, which a list of names cannot be, and everything in the
/// view is something a row can change.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct OptionsLists {
    /// Every display the game can be put on, in the order the host enumerated them.
    pub monitors: Vec<MonitorView>,
    /// Whether the game being played rolls back. The rollback balance means nothing to one that
    /// does not, so its row is only shown in one that does.
    pub rollback_game: bool,
}

/// Everything the options screen shows, as the game currently holds it.
///
/// [`OptionsView::default`] is what a fresh ShieldBattery install plays on, which is what the
/// screen falls back to before a host has said otherwise.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct OptionsView {
    // Input.
    pub mouse_sensitivity_on: bool,
    pub mouse_sensitivity: u32,
    pub mouse_scaling_on: bool,
    pub hardware_cursor_on: bool,
    pub mouse_confine_on: bool,
    pub keyboard_scroll_speed: u32,
    pub mouse_scroll_speed: u32,
    pub grab_pan_on: bool,
    pub grab_pan_sensitivity: u32,
    pub grab_pan_inverted: bool,
    pub legacy_cursor_sizing: bool,
    pub custom_cursor_size_on: bool,
    /// The cursor scale in eighths; see [`CURSOR_SIZE_EIGHTHS`].
    pub cursor_size_eighths: u32,

    // Sound.
    pub music_on: bool,
    pub music_volume: u32,
    pub sound_on: bool,
    pub sound_volume: u32,
    pub unit_speech_on: bool,
    pub unit_acknowledgements_on: bool,
    pub background_sounds_on: bool,
    pub building_sounds_on: bool,
    pub game_subtitles_on: bool,
    pub cinematic_subtitles_on: bool,
    pub original_voice_overs_on: bool,
    /// Which of [`ANNOUNCERS`] is selected.
    pub announcer: usize,

    // Video.
    pub display_mode: DisplayMode,
    /// Which of the host's [`OptionsLists::monitors`] the game is to be put on while it is not in
    /// a window, or `None` for whichever display the desktop treats as the main one, which is what
    /// a player who never chose one plays on.
    pub monitor: Option<usize>,
    pub brightness: u32,
    pub frame_pacing: FramePacing,
    pub fps_limit_on: bool,
    pub fps_limit: u32,
    pub vsync_on: bool,
    pub hd_graphics_on: bool,
    /// Whether the game has HD graphics to switch to. Not when it was launched with its HD art left
    /// out, which a game cannot then be switched to.
    pub hd_graphics_available: bool,
    pub sd_graphics_filter: u32,
    pub environment_effects_on: bool,
    pub real_time_lighting_on: bool,
    pub smooth_unit_turning_on: bool,
    pub shadow_stacking_on: bool,
    pub pillarbox_on: bool,
    pub show_fps: bool,

    // Gameplay.
    pub game_timer_on: bool,
    pub color_cycling_on: bool,
    pub unit_portraits: UnitPortraits,
    pub show_latency: bool,
    pub minimap_position: MinimapPosition,
    pub minimap_terrain: MinimapTerrain,
    pub starting_fog: StartingFog,
    pub minimap_color_mode: MinimapColorMode,
    pub apm_display_on: bool,
    pub apm_alert_on: bool,
    pub apm_alert_value: u32,
    pub apm_alert_color_on: bool,
    pub apm_alert_sound_on: bool,
    /// Which of [`CONSOLE_SKINS`] is selected.
    pub console_skin: usize,
    /// Which of [`UNIT_SKINS`] is selected.
    pub unit_skin: usize,
    pub show_bonus_skins: bool,

    // Network.
    /// See [`ROLLBACK_TARGET`].
    pub rollback_target: u32,
    pub turn_rate_24_delay_on: bool,
}

impl Default for OptionsView {
    fn default() -> OptionsView {
        OptionsView {
            mouse_sensitivity_on: false,
            mouse_sensitivity: 0,
            mouse_scaling_on: false,
            hardware_cursor_on: false,
            mouse_confine_on: false,
            keyboard_scroll_speed: 0,
            mouse_scroll_speed: 0,
            grab_pan_on: true,
            grab_pan_sensitivity: 40,
            grab_pan_inverted: false,
            legacy_cursor_sizing: false,
            custom_cursor_size_on: false,
            cursor_size_eighths: 2,

            music_on: true,
            music_volume: 50,
            sound_on: true,
            sound_volume: 50,
            unit_speech_on: true,
            unit_acknowledgements_on: true,
            background_sounds_on: true,
            building_sounds_on: true,
            game_subtitles_on: false,
            cinematic_subtitles_on: false,
            original_voice_overs_on: false,
            announcer: 0,

            display_mode: DisplayMode::Windowed,
            monitor: None,
            brightness: 50,
            frame_pacing: FramePacing::Off,
            fps_limit_on: false,
            fps_limit: FPS_LIMIT.min,
            vsync_on: false,
            hd_graphics_on: true,
            hd_graphics_available: true,
            sd_graphics_filter: 0,
            environment_effects_on: true,
            real_time_lighting_on: false,
            smooth_unit_turning_on: true,
            shadow_stacking_on: false,
            pillarbox_on: false,
            show_fps: false,

            game_timer_on: false,
            color_cycling_on: true,
            unit_portraits: UnitPortraits::Disabled,
            show_latency: false,
            minimap_position: MinimapPosition::Standard,
            minimap_terrain: MinimapTerrain::Shown,
            starting_fog: StartingFog::ShowTerrainAndResources,
            minimap_color_mode: MinimapColorMode::Standard,
            apm_display_on: false,
            apm_alert_on: false,
            apm_alert_value: 0,
            apm_alert_color_on: false,
            apm_alert_sound_on: false,
            console_skin: 0,
            unit_skin: 0,
            show_bonus_skins: false,

            rollback_target: RECOMMENDED_ROLLBACK_TARGET,
            turn_rate_24_delay_on: false,
        }
    }
}

impl OptionsView {
    /// Records a change in the view-model, so a screen shows what the player just did without
    /// waiting for the host to tell it what the game now holds.
    pub fn apply(&mut self, change: SettingChange) {
        match change {
            SettingChange::MouseSensitivityOn(value) => self.mouse_sensitivity_on = value,
            SettingChange::MouseSensitivity(value) => self.mouse_sensitivity = value,
            SettingChange::MouseScalingOn(value) => self.mouse_scaling_on = value,
            SettingChange::HardwareCursorOn(value) => self.hardware_cursor_on = value,
            SettingChange::MouseConfineOn(value) => self.mouse_confine_on = value,
            SettingChange::KeyboardScrollSpeed(value) => self.keyboard_scroll_speed = value,
            SettingChange::MouseScrollSpeed(value) => self.mouse_scroll_speed = value,
            SettingChange::GrabPanOn(value) => self.grab_pan_on = value,
            SettingChange::GrabPanSensitivity(value) => self.grab_pan_sensitivity = value,
            SettingChange::GrabPanInverted(value) => self.grab_pan_inverted = value,
            SettingChange::LegacyCursorSizing(value) => self.legacy_cursor_sizing = value,
            SettingChange::CustomCursorSizeOn(value) => self.custom_cursor_size_on = value,
            SettingChange::CursorSizeEighths(value) => self.cursor_size_eighths = value,

            SettingChange::MusicOn(value) => self.music_on = value,
            SettingChange::MusicVolume(value) => self.music_volume = value,
            SettingChange::SoundOn(value) => self.sound_on = value,
            SettingChange::SoundVolume(value) => self.sound_volume = value,
            SettingChange::UnitSpeechOn(value) => self.unit_speech_on = value,
            SettingChange::UnitAcknowledgementsOn(value) => self.unit_acknowledgements_on = value,
            SettingChange::BackgroundSoundsOn(value) => self.background_sounds_on = value,
            SettingChange::BuildingSoundsOn(value) => self.building_sounds_on = value,
            SettingChange::GameSubtitlesOn(value) => self.game_subtitles_on = value,
            SettingChange::CinematicSubtitlesOn(value) => self.cinematic_subtitles_on = value,
            SettingChange::OriginalVoiceOversOn(value) => self.original_voice_overs_on = value,
            SettingChange::Announcer(id) => self.announcer = index_of(ANNOUNCERS, id),

            SettingChange::DisplayMode(value) => self.display_mode = value,
            SettingChange::Monitor(index) => self.monitor = index,
            SettingChange::Brightness(value) => self.brightness = value,
            SettingChange::FramePacing(value) => self.frame_pacing = value,
            SettingChange::FpsLimitOn(value) => self.fps_limit_on = value,
            SettingChange::FpsLimit(value) => self.fps_limit = value,
            SettingChange::VsyncOn(value) => self.vsync_on = value,
            SettingChange::HdGraphicsOn(value) => self.hd_graphics_on = value,
            SettingChange::SdGraphicsFilter(value) => self.sd_graphics_filter = value,
            SettingChange::EnvironmentEffectsOn(value) => self.environment_effects_on = value,
            SettingChange::RealTimeLightingOn(value) => self.real_time_lighting_on = value,
            SettingChange::SmoothUnitTurningOn(value) => self.smooth_unit_turning_on = value,
            SettingChange::ShadowStackingOn(value) => self.shadow_stacking_on = value,
            SettingChange::PillarboxOn(value) => self.pillarbox_on = value,
            SettingChange::ShowFps(value) => self.show_fps = value,

            SettingChange::GameTimerOn(value) => self.game_timer_on = value,
            SettingChange::ColorCyclingOn(value) => self.color_cycling_on = value,
            SettingChange::UnitPortraits(value) => self.unit_portraits = value,
            SettingChange::ShowLatency(value) => self.show_latency = value,
            SettingChange::MinimapPosition(value) => self.minimap_position = value,
            SettingChange::MinimapTerrain(value) => self.minimap_terrain = value,
            SettingChange::StartingFog(value) => self.starting_fog = value,
            SettingChange::MinimapColorMode(value) => self.minimap_color_mode = value,
            SettingChange::ApmDisplayOn(value) => self.apm_display_on = value,
            SettingChange::ApmAlertOn(value) => self.apm_alert_on = value,
            SettingChange::ApmAlertValue(value) => self.apm_alert_value = value,
            SettingChange::ApmAlertColorOn(value) => self.apm_alert_color_on = value,
            SettingChange::ApmAlertSoundOn(value) => self.apm_alert_sound_on = value,
            SettingChange::ConsoleSkin(id) => self.console_skin = index_of(CONSOLE_SKINS, id),
            SettingChange::UnitSkin(id) => self.unit_skin = index_of(UNIT_SKINS, id),
            SettingChange::ShowBonusSkins(value) => self.show_bonus_skins = value,

            SettingChange::RollbackTarget(value) => self.rollback_target = value,
            SettingChange::TurnRate24DelayOn(value) => self.turn_rate_24_delay_on = value,
        }
    }

    /// The change another setting has to make along with `change`, made on a view showing `self`.
    ///
    /// Turning the hardware cursor on turns mouse scaling off: the screen greys scaling out under
    /// the hardware cursor, but SC:R scales the mouse whenever scaling is on, hardware cursor or
    /// not, confining the system cursor to a scaled-down box and drawing its own in its place.
    pub fn implied_change(&self, change: SettingChange) -> Option<SettingChange> {
        match change {
            SettingChange::HardwareCursorOn(true) if self.mouse_scaling_on => {
                Some(SettingChange::MouseScalingOn(false))
            }
            _ => None,
        }
    }
}

/// One setting moved to a new value.
///
/// A variant per setting rather than a key and a number: the host applies each of these to the game
/// directly, and a string key would push the question of what a value means out to whoever was
/// reading it. The list choices carry the id the game's own settings file holds, which is the value
/// a host writes.
///
/// Each variant names the key the app keeps the setting under, and which of the app's two settings
/// objects holds it: `scr` for the ones SC:R owns, `local` for ShieldBattery's own. A value is the
/// app's own encoding wherever that is a plain flag or number; the others say how they differ.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SettingChange {
    /// `scr.mouseSensitivityOn`.
    MouseSensitivityOn(bool),
    /// `scr.mouseSensitivity`.
    MouseSensitivity(u32),
    /// `scr.mouseScalingOn`.
    MouseScalingOn(bool),
    /// `scr.hardwareCursorOn`.
    HardwareCursorOn(bool),
    /// `scr.mouseConfineOn`.
    MouseConfineOn(bool),
    /// `scr.keyboardScrollSpeed`.
    KeyboardScrollSpeed(u32),
    /// `scr.mouseScrollSpeed`.
    MouseScrollSpeed(u32),
    /// `local.grabPanSensitivityOn`.
    GrabPanOn(bool),
    /// `local.grabPanSensitivity`.
    GrabPanSensitivity(u32),
    /// `local.grabPanInverted`.
    GrabPanInverted(bool),
    /// `local.legacyCursorSizing`.
    LegacyCursorSizing(bool),
    /// `local.useCustomCursorSize`.
    CustomCursorSizeOn(bool),
    /// `local.customCursorSize`, which the app keeps as a fraction of the cursor's full size: this
    /// many eighths of it. See [`CURSOR_SIZE_EIGHTHS`].
    CursorSizeEighths(u32),

    /// `scr.musicOn`.
    MusicOn(bool),
    /// `scr.musicVolume`.
    MusicVolume(u32),
    /// `scr.soundOn`.
    SoundOn(bool),
    /// `scr.soundVolume`.
    SoundVolume(u32),
    /// `scr.unitSpeechOn`.
    UnitSpeechOn(bool),
    /// `scr.unitAcknowledgementsOn`.
    UnitAcknowledgementsOn(bool),
    /// `scr.backgroundSoundsOn`.
    BackgroundSoundsOn(bool),
    /// `scr.buildingSoundsOn`.
    BuildingSoundsOn(bool),
    /// `scr.gameSubtitlesOn`.
    GameSubtitlesOn(bool),
    /// `scr.cinematicSubtitlesOn`.
    CinematicSubtitlesOn(bool),
    /// `scr.originalVoiceOversOn`.
    OriginalVoiceOversOn(bool),
    /// `scr.selectedAnnouncer`, as the id the app keeps.
    Announcer(&'static str),

    /// `scr.displayMode`: 0 windowed, 1 windowed fullscreen, 2 fullscreen.
    DisplayMode(DisplayMode),
    /// `local.monitorId`. `None` is the app's "Default (primary monitor)", which it keeps as the key
    /// being absent. `Some` is an index into the host's [`OptionsLists::monitors`]; the app knows a
    /// display by an id of its own, which is found from the entry's
    /// [`bounds`](MonitorView::bounds).
    Monitor(Option<usize>),
    /// `scr.gamma`, on the 0-100 scale the app's own slider shows rather than as the gamma
    /// percentage SC:R keeps. See [`BRIGHTNESS`].
    Brightness(u32),
    /// `local.framePacing`: `'display'`, `'variableRefresh'` or `'off'`.
    FramePacing(FramePacing),
    /// `scr.fpsLimitOn`.
    FpsLimitOn(bool),
    /// `scr.fpsLimit`.
    FpsLimit(u32),
    /// `scr.vsyncOn`, which the app keeps as 1 or 0 rather than as a bool.
    VsyncOn(bool),
    /// `scr.hdGraphicsOn`.
    HdGraphicsOn(bool),
    /// `scr.sdGraphicsFilter`.
    SdGraphicsFilter(u32),
    /// `scr.environmentEffectsOn`.
    EnvironmentEffectsOn(bool),
    /// `scr.realTimeLightingOn`.
    RealTimeLightingOn(bool),
    /// `scr.smoothUnitTurningOn`.
    SmoothUnitTurningOn(bool),
    /// `scr.shadowStackingOn`.
    ShadowStackingOn(bool),
    /// `scr.pillarboxOn`.
    PillarboxOn(bool),
    /// `scr.showFps`.
    ShowFps(bool),

    /// `scr.gameTimerOn`.
    GameTimerOn(bool),
    /// `scr.colorCyclingOn`.
    ColorCyclingOn(bool),
    /// `scr.unitPortraits`: 2 animated, 1 still, 0 disabled.
    UnitPortraits(UnitPortraits),
    /// `scr.showTurnRate`.
    ShowLatency(bool),
    /// `scr.minimapPosition`: true for the bottom-left corner, false for standard.
    MinimapPosition(MinimapPosition),
    /// `local.minimapTerrainHidden`: true when hidden.
    MinimapTerrain(MinimapTerrain),
    /// `local.startingFog`: `'transparent'`, `'showResources'` or `'legacy'`.
    StartingFog(StartingFog),
    /// `local.minimapColorMode`: 0 standard, 1 preset on the minimap only, 2 preset everywhere.
    MinimapColorMode(MinimapColorMode),
    /// `scr.apmDisplayOn`.
    ApmDisplayOn(bool),
    /// `scr.apmAlertOn`.
    ApmAlertOn(bool),
    /// `scr.apmAlertValue`.
    ApmAlertValue(u32),
    /// `scr.apmAlertColorOn`.
    ApmAlertColorOn(bool),
    /// `scr.apmAlertSoundOn`.
    ApmAlertSoundOn(bool),
    /// `scr.consoleSkin`, as the id the app keeps.
    ConsoleSkin(&'static str),
    /// `scr.selectedSkin`, as the id the app keeps.
    UnitSkin(&'static str),
    /// `scr.showBonusSkins`.
    ShowBonusSkins(bool),

    /// `local.rollbackTarget`. See [`ROLLBACK_TARGET`].
    RollbackTarget(u32),
    /// `local.emulateTurnRate24Delay`.
    TurnRate24DelayOn(bool),
}

impl SettingChange {
    /// One change per setting, each to a value other than [`OptionsView::default`]'s, for a test on
    /// either side of the host boundary to check every setting with.
    pub fn one_per_setting() -> Vec<SettingChange> {
        vec![
            SettingChange::MouseSensitivityOn(true),
            SettingChange::MouseSensitivity(35),
            SettingChange::MouseScalingOn(true),
            SettingChange::HardwareCursorOn(true),
            SettingChange::MouseConfineOn(true),
            SettingChange::KeyboardScrollSpeed(4),
            SettingChange::MouseScrollSpeed(3),
            SettingChange::GrabPanOn(false),
            SettingChange::GrabPanSensitivity(75),
            SettingChange::GrabPanInverted(true),
            SettingChange::LegacyCursorSizing(true),
            SettingChange::CustomCursorSizeOn(true),
            SettingChange::CursorSizeEighths(5),
            SettingChange::MusicOn(false),
            SettingChange::MusicVolume(20),
            SettingChange::SoundOn(false),
            SettingChange::SoundVolume(80),
            SettingChange::UnitSpeechOn(false),
            SettingChange::UnitAcknowledgementsOn(false),
            SettingChange::BackgroundSoundsOn(false),
            SettingChange::BuildingSoundsOn(false),
            SettingChange::GameSubtitlesOn(true),
            SettingChange::CinematicSubtitlesOn(true),
            SettingChange::OriginalVoiceOversOn(true),
            SettingChange::Announcer(ANNOUNCERS[3].id),
            SettingChange::DisplayMode(DisplayMode::Fullscreen),
            SettingChange::Monitor(Some(1)),
            SettingChange::Brightness(75),
            SettingChange::FramePacing(FramePacing::VariableRefresh),
            SettingChange::FpsLimitOn(true),
            SettingChange::FpsLimit(240),
            SettingChange::VsyncOn(true),
            SettingChange::HdGraphicsOn(false),
            SettingChange::SdGraphicsFilter(2),
            SettingChange::EnvironmentEffectsOn(false),
            SettingChange::RealTimeLightingOn(true),
            SettingChange::SmoothUnitTurningOn(false),
            SettingChange::ShadowStackingOn(true),
            SettingChange::PillarboxOn(true),
            SettingChange::ShowFps(true),
            SettingChange::GameTimerOn(true),
            SettingChange::ColorCyclingOn(false),
            SettingChange::UnitPortraits(UnitPortraits::Animated),
            SettingChange::ShowLatency(true),
            SettingChange::MinimapPosition(MinimapPosition::BottomLeft),
            SettingChange::MinimapTerrain(MinimapTerrain::Hidden),
            SettingChange::StartingFog(StartingFog::Legacy),
            SettingChange::MinimapColorMode(MinimapColorMode::PresetOnMinimapOnly),
            SettingChange::ApmDisplayOn(true),
            SettingChange::ApmAlertOn(true),
            SettingChange::ApmAlertValue(120),
            SettingChange::ApmAlertColorOn(true),
            SettingChange::ApmAlertSoundOn(true),
            SettingChange::ConsoleSkin(CONSOLE_SKINS[2].id),
            SettingChange::UnitSkin(UNIT_SKINS[2].id),
            SettingChange::ShowBonusSkins(true),
            SettingChange::RollbackTarget(4),
            SettingChange::TurnRate24DelayOn(true),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A change that [`OptionsView::apply`] wires to the wrong field, or to none, is caught by the
    /// field that then fails to move or by two changes moving the same one.
    #[test]
    fn every_change_moves_exactly_one_setting() {
        let defaults = OptionsView::default();
        let mut seen = Vec::new();
        for change in SettingChange::one_per_setting() {
            let mut view = defaults;
            view.apply(change);
            assert_ne!(view, defaults, "{change:?} changed nothing");
            // Applying it again cannot move anything further: a change carries the value the
            // setting is to take, not a nudge.
            let once = view;
            view.apply(change);
            assert_eq!(view, once, "{change:?} is not idempotent");
            assert!(
                !seen.contains(&view),
                "{change:?} moves the same setting as an earlier change"
            );
            seen.push(view);
        }
    }

    /// Everything moved at once, then the same list applied again, which must leave the view where
    /// it already was: a screen that re-sent what it was already showing would otherwise drift.
    #[test]
    fn applying_every_change_settles() {
        let mut view = OptionsView::default();
        for change in SettingChange::one_per_setting() {
            view.apply(change);
        }
        let settled = view;
        for change in SettingChange::one_per_setting() {
            view.apply(change);
        }
        assert_eq!(view, settled);
    }

    /// The hardware cursor takes scaling off with it, and nothing else brings another change.
    #[test]
    fn the_hardware_cursor_turns_mouse_scaling_off() {
        let scaled = OptionsView {
            mouse_scaling_on: true,
            ..OptionsView::default()
        };
        assert_eq!(
            scaled.implied_change(SettingChange::HardwareCursorOn(true)),
            Some(SettingChange::MouseScalingOn(false))
        );
        assert_eq!(
            scaled.implied_change(SettingChange::HardwareCursorOn(false)),
            None
        );
        let unscaled = OptionsView::default();
        assert_eq!(
            unscaled.implied_change(SettingChange::HardwareCursorOn(true)),
            None
        );
        for change in SettingChange::one_per_setting() {
            if !matches!(change, SettingChange::HardwareCursorOn(_)) {
                assert_eq!(scaled.implied_change(change), None, "{change:?}");
            }
        }
    }

    /// Every field of the view is a setting some change moves, bar the one that describes the game
    /// rather than a choice of the player's. A field added without a change to move it, or a change
    /// left out of [`SettingChange::one_per_setting`], leaves its field where the default put it.
    #[test]
    fn every_setting_is_moved_by_a_change() {
        let fields = |view: OptionsView| match serde_json::to_value(view) {
            Ok(serde_json::Value::Object(fields)) => fields,
            other => panic!("not an object: {other:?}"),
        };
        let defaults = fields(OptionsView::default());
        let mut moved = OptionsView::default();
        for change in SettingChange::one_per_setting() {
            moved.apply(change);
        }
        let moved = fields(moved);
        let unmoved: Vec<&str> = defaults
            .iter()
            .filter(|&(field, value)| moved.get(field) == Some(value))
            .map(|(field, _)| field.as_str())
            .collect();
        assert_eq!(unmoved, ["hd_graphics_available"]);
    }

    /// Every slider's default is a value that slider can actually be left on.
    #[test]
    fn slider_defaults_sit_on_a_notch() {
        let view = OptionsView::default();
        for (range, value) in [
            (MOUSE_SENSITIVITY, view.mouse_sensitivity),
            (SCROLL_SPEED, view.keyboard_scroll_speed),
            (SCROLL_SPEED, view.mouse_scroll_speed),
            (GRAB_PAN_SENSITIVITY, view.grab_pan_sensitivity),
            (CURSOR_SIZE_EIGHTHS, view.cursor_size_eighths),
            (VOLUME, view.music_volume),
            (VOLUME, view.sound_volume),
            (BRIGHTNESS, view.brightness),
            (FPS_LIMIT, view.fps_limit),
            (SD_GRAPHICS_FILTER, view.sd_graphics_filter),
            (APM_ALERT_VALUE, view.apm_alert_value),
            (ROLLBACK_TARGET, view.rollback_target),
        ] {
            assert!(range.holds(value), "{value} is not a value {range:?} takes");
        }
    }

    /// A value from anywhere — a game that was playing on something else, a settings file written
    /// by hand — lands on a notch inside the bounds rather than being passed through.
    #[test]
    fn clamping_lands_on_a_notch_inside_the_bounds() {
        assert_eq!(MOUSE_SENSITIVITY.clamp(0), 0);
        assert_eq!(MOUSE_SENSITIVITY.clamp(37), 35);
        assert_eq!(MOUSE_SENSITIVITY.clamp(38), 40);
        assert_eq!(MOUSE_SENSITIVITY.clamp(4_000), 100);
        assert_eq!(FPS_LIMIT.clamp(0), 100);
        assert_eq!(FPS_LIMIT.clamp(144), 144);
        assert_eq!(CURSOR_SIZE_EIGHTHS.clamp(1), 2);
        // Every whole number the app lets a player type into the APM alert is one the row holds.
        assert_eq!(APM_ALERT_VALUE.clamp(123), 123);
        assert_eq!(APM_ALERT_VALUE.clamp(5_000), 999);
    }

    /// A list choice a host hands over is found by the id the game's own settings file holds, and
    /// one the overlay has no name for falls back to the entry every install has.
    #[test]
    fn list_choices_are_found_by_the_games_own_id() {
        assert_eq!(index_of(CONSOLE_SKINS, "KRC_Gold"), 5);
        assert_eq!(index_of(ANNOUNCERS, "Jini"), 5);
        assert_eq!(index_of(UNIT_SKINS, ""), 0);
        assert_eq!(index_of(UNIT_SKINS, "a-skin-from-a-later-patch"), 0);
    }
}
