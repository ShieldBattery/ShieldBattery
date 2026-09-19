//! The in-game options screen's presentation layer: a plain-data view-model and the egui render fn
//! that draws it. Like [`crate::chat_history`] and [`crate::game_menu`], everything here is a pure
//! fn of [`OptionsView`] plus an [`egui::Context`], so the same code renders in the injected game
//! DLL and in the host preview.
//!
//! It stands in for the game's own options popup, so it is drawn at the kit's modal tier. It is
//! organised the way the app's game settings are — input, sound, video, gameplay, in that order,
//! with the same groups and the same words inside each — because the two screens are one setting
//! list seen from two places, and a player who learned where a setting lives in the app must not
//! have to learn it again here.
//!
//! What it does not carry: the network latency the app no longer lets anyone change, the player
//! colors the app resolves before a game starts, and the settings that exist only in a dev client.
//!
//! Nothing here writes a setting. A row reports a [`SettingChange`] carrying the value the player
//! moved it to, and the host applies it: the view-model is what the game currently holds, not a
//! place to stage edits in.

use egui::{Align, Context, Id, Layout, Sense, Shape, Stroke, Ui, Vec2, pos2, vec2};
use serde::{Deserialize, Serialize};

use crate::colors::{BLUE70, GREY_BLUE70, GREY_BLUE95};
use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets::{self, ButtonPlate};
use crate::kit::{theme, tiers};
use crate::tr;

/// How wide the dialog is, chrome included.
pub const DIALOG_WIDTH: f32 = 940.0;

/// Width of the section nav down the left of the body.
const NAV_WIDTH: f32 = 220.0;

/// Height of one nav row.
const NAV_ROW_HEIGHT: f32 = 42.0;

/// How far a nav row's label stands in from the row's left edge, lit or not.
const NAV_LABEL_INSET: f32 = theme::SPACE_LG;

/// Padding between the content column's edge and its rows.
const CONTENT_PAD_X: f32 = 24.0;
const CONTENT_PAD_Y: f32 = 32.0;

/// Gap between two rows of a section.
const ROW_SPACING: f32 = 22.0;

/// Height of one row, which is the height of the controls that stand in it.
const ROW_HEIGHT: f32 = theme::HIT_PANEL;

/// Width of the column a row's label stands in. Fixed, so every control in a section starts at the
/// same x however long a translated label runs.
const LABEL_WIDTH: f32 = 260.0;

/// The least room the body leaves the content column, and the most it will grow to on a tall
/// screen. A section is taller than either, so what this really decides is how much of one is read
/// without scrolling.
const BODY_MIN_HEIGHT: f32 = 470.0;
const BODY_MAX_HEIGHT: f32 = 700.0;

/// What the dialog's own chrome takes above and below the body, which is what the body is sized
/// against so the whole dialog fits the screen it is centred on.
const CHROME_HEIGHT: f32 = 160.0;

/// How much of the screen the dialog leaves above and below itself. Below 1080 lines the overlay
/// stops scaling down and a point is a pixel, so a screen shorter than the design's is a screen
/// with fewer points on it: the body gives room back rather than the chrome running off the edge.
const SCREEN_MARGIN: f32 = 40.0;

/// Width the vertical scrollbar and its margins take out of the content column. Reserved whether or
/// not the section is long enough to scroll, so the rows of a short section line up with a long
/// one's.
const SCROLLBAR_WIDTH: f32 = theme::SCROLLBAR_WIDTH + theme::SCROLLBAR_INSET + theme::SPACE_XS;

/// How much room the content column leaves its rows. The scrollbar's own margins are the padding
/// on the right, the way the chat log's list is padded.
const CONTENT_WIDTH: f32 = tiers::dialog_content_width(DIALOG_WIDTH)
    - NAV_WIDTH
    - theme::HAIRLINE
    - CONTENT_PAD_X * 2.0
    - SCROLLBAR_WIDTH;

/// How much room a row leaves its control.
const CONTROL_WIDTH: f32 = CONTENT_WIDTH - LABEL_WIDTH;

/// The widths are the dialog, so widening the nav or the label column narrows the controls.
/// Checked where the widths are written, since past this point a control would be laid out
/// backwards rather than merely cramped.
const _: () = assert!(CONTROL_WIDTH > 200.0);

/// Text size of a row's label.
const LABEL_SIZE: f32 = 15.5;

/// Text size of the line under a row that says what the row means.
const HINT_SIZE: f32 = 13.0;

/// Text size of the dialog's subtitle.
const SUBTITLE_SIZE: f32 = 13.0;

/// Which page of the options is on screen.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum OptionsSection {
    Input,
    Sound,
    Video,
    /// Where the screen opens: the settings a player changes mid-match are here.
    #[default]
    Gameplay,
}

impl OptionsSection {
    /// Every section, in the order the app's own settings list them.
    pub const ALL: [OptionsSection; 4] = [
        OptionsSection::Input,
        OptionsSection::Sound,
        OptionsSection::Video,
        OptionsSection::Gameplay,
    ];

    /// What the nav calls this section.
    pub fn label(self) -> String {
        match self {
            OptionsSection::Input => tr!("options.sectionInput", "Input"),
            OptionsSection::Sound => tr!("options.sectionSound", "Sound"),
            OptionsSection::Video => tr!("options.sectionVideo", "Video"),
            OptionsSection::Gameplay => tr!("options.sectionGameplay", "Gameplay"),
        }
    }

    /// A short name for this section in a knob panel or a log line.
    pub fn slug(self) -> &'static str {
        match self {
            OptionsSection::Input => "input",
            OptionsSection::Sound => "sound",
            OptionsSection::Video => "video",
            OptionsSection::Gameplay => "gameplay",
        }
    }
}

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

/// The rate the APM alert fires below.
pub const APM_ALERT_VALUE: SliderRange = SliderRange {
    min: 0,
    max: 300,
    step: 10,
};

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

    fn label(self) -> String {
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

    fn label(self) -> String {
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

    fn label(self) -> String {
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

    fn label(self) -> String {
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

    fn label(self) -> String {
        match self {
            StartingFog::ShowTerrainAndResources => tr!(
                "options.startingFogShowTerrainAndResources",
                "Terrain and resources"
            ),
            StartingFog::ShowResources => {
                tr!("options.startingFogShowResources", "Resources")
            }
            StartingFog::Legacy => tr!("options.startingFogLegacy", "Legacy"),
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

/// One step through `list` from `index`, wrapping at both ends: these lists are short and cyclic,
/// and a stepper that stopped dead would leave the player walking back the way they came.
fn stepped(list: &[NamedChoice], index: usize, delta: i32) -> usize {
    let len = list.len() as i32;
    if len == 0 {
        return 0;
    }
    (index as i32 + delta).rem_euclid(len) as usize
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
    pub brightness: u32,
    pub fps_limit_on: bool,
    pub fps_limit: u32,
    pub vsync_on: bool,
    pub hd_graphics_on: bool,
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
    pub minimap_position: MinimapPosition,
    pub minimap_terrain: MinimapTerrain,
    pub starting_fog: StartingFog,
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
            brightness: 50,
            fps_limit_on: false,
            fps_limit: FPS_LIMIT.min,
            vsync_on: false,
            hd_graphics_on: true,
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
            minimap_position: MinimapPosition::Standard,
            minimap_terrain: MinimapTerrain::Shown,
            starting_fog: StartingFog::ShowTerrainAndResources,
            apm_display_on: false,
            apm_alert_on: false,
            apm_alert_value: 0,
            apm_alert_color_on: false,
            apm_alert_sound_on: false,
            console_skin: 0,
            unit_skin: 0,
            show_bonus_skins: false,
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
            SettingChange::Brightness(value) => self.brightness = value,
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
            SettingChange::MinimapPosition(value) => self.minimap_position = value,
            SettingChange::MinimapTerrain(value) => self.minimap_terrain = value,
            SettingChange::StartingFog(value) => self.starting_fog = value,
            SettingChange::ApmDisplayOn(value) => self.apm_display_on = value,
            SettingChange::ApmAlertOn(value) => self.apm_alert_on = value,
            SettingChange::ApmAlertValue(value) => self.apm_alert_value = value,
            SettingChange::ApmAlertColorOn(value) => self.apm_alert_color_on = value,
            SettingChange::ApmAlertSoundOn(value) => self.apm_alert_sound_on = value,
            SettingChange::ConsoleSkin(id) => self.console_skin = index_of(CONSOLE_SKINS, id),
            SettingChange::UnitSkin(id) => self.unit_skin = index_of(UNIT_SKINS, id),
            SettingChange::ShowBonusSkins(value) => self.show_bonus_skins = value,
        }
    }
}

/// One setting moved to a new value.
///
/// A variant per setting rather than a key and a number: the host applies each of these to the game
/// directly, and a string key would push the question of what a value means out to whoever was
/// reading it. The list choices carry the id the game's own settings file holds, which is the value
/// a host writes.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SettingChange {
    MouseSensitivityOn(bool),
    MouseSensitivity(u32),
    MouseScalingOn(bool),
    HardwareCursorOn(bool),
    MouseConfineOn(bool),
    KeyboardScrollSpeed(u32),
    MouseScrollSpeed(u32),
    GrabPanOn(bool),
    GrabPanSensitivity(u32),
    GrabPanInverted(bool),
    LegacyCursorSizing(bool),
    CustomCursorSizeOn(bool),
    /// The cursor scale in eighths; see [`CURSOR_SIZE_EIGHTHS`].
    CursorSizeEighths(u32),

    MusicOn(bool),
    MusicVolume(u32),
    SoundOn(bool),
    SoundVolume(u32),
    UnitSpeechOn(bool),
    UnitAcknowledgementsOn(bool),
    BackgroundSoundsOn(bool),
    BuildingSoundsOn(bool),
    GameSubtitlesOn(bool),
    CinematicSubtitlesOn(bool),
    OriginalVoiceOversOn(bool),
    Announcer(&'static str),

    DisplayMode(DisplayMode),
    Brightness(u32),
    FpsLimitOn(bool),
    FpsLimit(u32),
    VsyncOn(bool),
    HdGraphicsOn(bool),
    SdGraphicsFilter(u32),
    EnvironmentEffectsOn(bool),
    RealTimeLightingOn(bool),
    SmoothUnitTurningOn(bool),
    ShadowStackingOn(bool),
    PillarboxOn(bool),
    ShowFps(bool),

    GameTimerOn(bool),
    ColorCyclingOn(bool),
    UnitPortraits(UnitPortraits),
    MinimapPosition(MinimapPosition),
    MinimapTerrain(MinimapTerrain),
    StartingFog(StartingFog),
    ApmDisplayOn(bool),
    ApmAlertOn(bool),
    ApmAlertValue(u32),
    ApmAlertColorOn(bool),
    ApmAlertSoundOn(bool),
    ConsoleSkin(&'static str),
    UnitSkin(&'static str),
    ShowBonusSkins(bool),
}

/// What the player did with the options screen this frame.
#[derive(Default)]
pub struct OptionsOutcome {
    /// The section they moved the nav to.
    pub section: Option<OptionsSection>,
    /// Every setting they moved, in the order they moved it.
    pub changes: Vec<SettingChange>,
    /// Whether they asked for the screen to close.
    pub done: bool,
}

/// Renders the options screen.
pub fn render_options_view(
    view: &OptionsView,
    ctx: &Context,
    section: OptionsSection,
) -> tiers::DialogResponse<OptionsOutcome> {
    let body_height = (ctx.viewport_rect().height() - CHROME_HEIGHT - SCREEN_MARGIN * 2.0)
        .clamp(BODY_MIN_HEIGHT, BODY_MAX_HEIGHT);
    tiers::tier2_dialog(ctx, Id::new("sb_options"), DIALOG_WIDTH, |ui| {
        let mut outcome = OptionsOutcome::default();
        tiers::dialog_header(ui, draw_header);
        tiers::dialog_body(ui, |ui| {
            ui.horizontal_top(|ui| {
                ui.spacing_mut().item_spacing = Vec2::ZERO;
                outcome.section = draw_nav(ui, section, body_height);
                draw_nav_rule(ui, body_height);
                draw_content(ui, view, section, body_height, &mut outcome);
            });
        });
        tiers::dialog_footer(ui, |ui| draw_footer(ui, &mut outcome));
        outcome
    })
}

/// The header: what the screen is, and what changing something on it does.
fn draw_header(ui: &mut Ui) {
    let width = ui.available_width();
    ui.horizontal(|ui| {
        ui.set_width(width);
        tiers::dialog_title(ui, &tr!("options.title", "Options"));
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            // Whatever the title left: a subtitle long enough to reach it would otherwise be drawn
            // over the one word the header exists to say.
            let room = (ui.available_width() - theme::SPACE_XL).max(0.0);
            ui.label(
                text::body(SUBTITLE_SIZE, BodyWeight::Regular)
                    .with_color(GREY_BLUE70)
                    .job_truncated(
                        &tr!(
                            "options.subtitle",
                            "Changes apply immediately and are saved with your ShieldBattery settings"
                        ),
                        room,
                    ),
            );
        });
    });
}

/// The section nav. Returns the section the player moved to, on the frame they moved it.
fn draw_nav(ui: &mut Ui, section: OptionsSection, height: f32) -> Option<OptionsSection> {
    let mut picked = None;
    ui.allocate_ui_with_layout(
        vec2(NAV_WIDTH, height),
        Layout::top_down(Align::LEFT),
        |ui| {
            ui.set_width(NAV_WIDTH);
            ui.set_min_height(height);
            ui.spacing_mut().item_spacing = Vec2::ZERO;
            for entry in OptionsSection::ALL {
                if draw_nav_row(ui, entry, entry == section) {
                    picked = Some(entry);
                }
            }
        },
    );
    picked
}

/// One nav row: a plain label, or the lit plate that says the player is reading this section.
fn draw_nav_row(ui: &mut Ui, section: OptionsSection, active: bool) -> bool {
    let size = vec2(NAV_WIDTH - theme::SPACE_MD, NAV_ROW_HEIGHT);
    let label = section.label();
    // The lit row keeps its label where the plain rows keep theirs: a label that slid to the
    // middle of the plate as it lit would read as the nav rearranging itself with every click.
    let clicked = if active {
        widgets::plate_button_aligned(
            ui,
            &text::button_label(14.0).with_letter_spacing(1.0),
            &label,
            size,
            ButtonPlate::selected(),
            Align::LEFT,
            NAV_LABEL_INSET,
        )
        .clicked()
    } else {
        let (rect, response) = ui.allocate_exact_size(size, Sense::click());
        if ui.is_rect_visible(rect) {
            let corner_radius = theme::radius(theme::RADIUS_TIGHT);
            widgets::state_overlay(ui, &response, rect, corner_radius);
            let spec = text::body(15.0, BodyWeight::Regular).with_color(theme::TEXT_SECONDARY);
            let job = spec.job_truncated(&label, size.x - NAV_LABEL_INSET * 2.0);
            let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
            ui.painter().galley(
                pos2(
                    rect.left() + NAV_LABEL_INSET,
                    rect.center().y - galley.size().y * 0.5,
                ),
                galley,
                spec.color,
            );
        }
        response.clicked()
    };
    ui.add_space(theme::SPACE_XS);
    clicked
}

/// The rule that separates the nav from what it selects.
fn draw_nav_rule(ui: &mut Ui, height: f32) {
    let (rect, _) = ui.allocate_exact_size(vec2(theme::HAIRLINE, height), Sense::hover());
    ui.painter().add(Shape::line_segment(
        [
            pos2(rect.center().x, rect.top()),
            pos2(rect.center().x, rect.bottom()),
        ],
        Stroke::new(theme::HAIRLINE, theme::TIER2_DIVIDER),
    ));
}

/// The selected section's rows, scrolling when there are more of them than the body has room for.
fn draw_content(
    ui: &mut Ui,
    view: &OptionsView,
    section: OptionsSection,
    height: f32,
    outcome: &mut OptionsOutcome,
) {
    let width = ui.available_width();
    ui.allocate_ui_with_layout(vec2(width, height), Layout::top_down(Align::LEFT), |ui| {
        ui.set_width(width);
        ui.set_min_height(height);
        egui::ScrollArea::vertical()
            // Per section, so each one remembers where its reader left it rather than every
            // section sharing one scroll position.
            .id_salt(("sb_options_section", section.slug()))
            .max_height(height)
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.add_space(CONTENT_PAD_Y);
                ui.horizontal_top(|ui| {
                    ui.add_space(CONTENT_PAD_X);
                    ui.allocate_ui_with_layout(
                        vec2(CONTENT_WIDTH, 0.0),
                        Layout::top_down(Align::LEFT),
                        |ui| {
                            ui.set_width(CONTENT_WIDTH);
                            ui.spacing_mut().item_spacing = Vec2::ZERO;
                            match section {
                                OptionsSection::Input => draw_input(ui, view, outcome),
                                OptionsSection::Sound => draw_sound(ui, view, outcome),
                                OptionsSection::Video => draw_video(ui, view, outcome),
                                OptionsSection::Gameplay => draw_gameplay(ui, view, outcome),
                            }
                        },
                    );
                });
                ui.add_space(CONTENT_PAD_Y);
            });
    });
}

/// The footer: the one control that undoes everything, and the one that closes the screen.
fn draw_footer(ui: &mut Ui, outcome: &mut OptionsOutcome) {
    let width = ui.available_width();
    ui.allocate_ui_with_layout(
        vec2(width, theme::HIT_DIALOG),
        Layout::right_to_left(Align::Center),
        |ui| {
            ui.set_width(width);
            if widgets::button(
                ui,
                &tr!("common.done", "Done"),
                widgets::ButtonVariant::Tier2,
            )
            .clicked()
            {
                outcome.done = true;
            }
        },
    );
}

// The sections. Each is a list of rows in the order the app's own settings page lists them, so the
// two screens read the same way down.

fn draw_input(ui: &mut Ui, view: &OptionsView, outcome: &mut OptionsOutcome) {
    group_header(
        ui,
        &tr!("options.groupMouseSensitivity", "Mouse sensitivity"),
        false,
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
    switch_row(
        ui,
        &tr!("options.mouseScaling", "Use mouse scaling"),
        view.mouse_scaling_on,
        false,
        outcome,
        SettingChange::MouseScalingOn,
    );
    switch_row(
        ui,
        &tr!("options.hardwareCursor", "Hardware cursor"),
        view.hardware_cursor_on,
        false,
        outcome,
        SettingChange::HardwareCursorOn,
    );
    switch_row(
        ui,
        &tr!("options.lockCursor", "Lock cursor to window"),
        view.mouse_confine_on,
        false,
        outcome,
        SettingChange::MouseConfineOn,
    );

    group_header(ui, &tr!("options.groupScrolling", "Scrolling"), true);
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

    group_header(ui, &tr!("options.groupGrabPan", "Grab pan"), true);
    switch_row(
        ui,
        &tr!("options.grabPan", "Custom grab pan sensitivity"),
        view.grab_pan_on,
        false,
        outcome,
        SettingChange::GrabPanOn,
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

    group_header(ui, &tr!("options.groupCursor", "Cursor"), true);
    switch_row(
        ui,
        &tr!("options.legacyCursorSizing", "Use legacy cursor sizing"),
        view.legacy_cursor_sizing,
        false,
        outcome,
        SettingChange::LegacyCursorSizing,
    );
    // The sizing is a patch the DLL applies while it installs its hooks, before the game has drawn
    // a cursor, so a change here is only seen by the next game the app launches.
    hint(
        ui,
        &tr!("options.legacyCursorSizingHint", "Takes effect next game"),
    );
    switch_row(
        ui,
        &tr!("options.customCursorSize", "Use custom cursor size"),
        view.custom_cursor_size_on,
        false,
        outcome,
        SettingChange::CustomCursorSizeOn,
    );
    slider_row(
        ui,
        &tr!("options.cursorSize", "Cursor size"),
        view.cursor_size_eighths,
        CURSOR_SIZE_EIGHTHS,
        !view.custom_cursor_size_on,
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
}

fn draw_sound(ui: &mut Ui, view: &OptionsView, outcome: &mut OptionsOutcome) {
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

    group_header(ui, &tr!("options.groupAnnouncer", "Announcer"), true);
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
}

fn draw_video(ui: &mut Ui, view: &OptionsView, outcome: &mut OptionsOutcome) {
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
    slider_row(
        ui,
        &tr!("options.brightness", "Brightness"),
        view.brightness,
        BRIGHTNESS,
        false,
        outcome,
        SettingChange::Brightness,
    );
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
    switch_row(
        ui,
        &tr!("options.vsync", "Enable vertical sync"),
        view.vsync_on,
        false,
        outcome,
        SettingChange::VsyncOn,
    );

    group_header(ui, &tr!("options.groupGraphics", "Graphics"), true);
    switch_row(
        ui,
        &tr!("options.hdGraphics", "HD graphics"),
        view.hd_graphics_on,
        false,
        outcome,
        SettingChange::HdGraphicsOn,
    );
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
    switch_row(
        ui,
        &tr!("options.pillarbox", "Pillarbox (4:3 aspect ratio)"),
        view.pillarbox_on,
        false,
        outcome,
        SettingChange::PillarboxOn,
    );
    switch_row(
        ui,
        &tr!("options.showFps", "Show FPS"),
        view.show_fps,
        false,
        outcome,
        SettingChange::ShowFps,
    );
}

fn draw_gameplay(ui: &mut Ui, view: &OptionsView, outcome: &mut OptionsOutcome) {
    group_header(ui, &tr!("options.groupInterface", "Interface"), false);
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
        &tr!("options.colorCycling", "Enable color cycling"),
        view.color_cycling_on,
        false,
        outcome,
        SettingChange::ColorCyclingOn,
    );
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

    group_header(ui, &tr!("options.groupApm", "APM"), true);
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

    group_header(ui, &tr!("options.groupSkins", "Skins"), true);
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
    hint(ui, &tr!("options.skinsHint", "Skins take effect next game"));
    switch_row(
        ui,
        &tr!("options.showBonusSkins", "Show bonus skins"),
        view.show_bonus_skins,
        false,
        outcome,
        SettingChange::ShowBonusSkins,
    );
}

// The row shapes every section is built from. Each takes the value the game holds and reports the
// value the player moved it to, so no part of this screen owns a setting.

/// The overline over a group of rows, ruled off from the group before it.
fn group_header(ui: &mut Ui, label: &str, after_group: bool) {
    if after_group {
        ui.add_space(ROW_SPACING);
        let (rect, _) =
            ui.allocate_exact_size(vec2(ui.available_width(), theme::HAIRLINE), Sense::hover());
        ui.painter().add(Shape::line_segment(
            [
                pos2(rect.left(), rect.center().y),
                pos2(rect.right(), rect.center().y),
            ],
            Stroke::new(theme::HAIRLINE, theme::alpha(BLUE70, 0.35)),
        ));
        ui.add_space(ROW_SPACING);
    }
    ui.label(text::column_label().job(label));
    ui.add_space(theme::SPACE_MD);
}

/// The frame every row stands in: the label in its column, then the control in the rest of it.
fn row(ui: &mut Ui, label: &str, disabled: bool, add: impl FnOnce(&mut Ui)) {
    ui.allocate_ui_with_layout(
        vec2(ui.available_width(), ROW_HEIGHT),
        Layout::left_to_right(Align::Center),
        |ui| {
            ui.spacing_mut().item_spacing = Vec2::ZERO;
            widgets::set_disabled(ui, disabled);
            widgets::text_cell(
                ui,
                &text::body(LABEL_SIZE, BodyWeight::Regular).with_color(GREY_BLUE95),
                label,
                vec2(LABEL_WIDTH, ROW_HEIGHT),
                Align::LEFT,
            );
            add(ui);
        },
    );
    ui.add_space(ROW_SPACING);
}

/// A line under the row above, saying what that row means or when it takes effect.
///
/// It sits in the control's column rather than the label's, because it is about the value rather
/// than about the setting's name.
fn hint(ui: &mut Ui, text: &str) {
    // The hint belongs to the row above, so it takes back the gap that row left behind it.
    ui.add_space(-ROW_SPACING + theme::SPACE_XS);
    ui.horizontal(|ui| {
        ui.add_space(LABEL_WIDTH);
        ui.label(
            text::body(HINT_SIZE, BodyWeight::Regular)
                .with_color(GREY_BLUE70)
                .job_truncated(text, CONTROL_WIDTH),
        );
    });
    ui.add_space(ROW_SPACING);
}

/// A row carrying an on/off setting.
fn switch_row(
    ui: &mut Ui,
    label: &str,
    value: bool,
    disabled: bool,
    outcome: &mut OptionsOutcome,
    change: fn(bool) -> SettingChange,
) {
    row(ui, label, disabled, |ui| {
        let mut moved = value;
        if widgets::switch(ui, &mut moved).changed() {
            outcome.changes.push(change(moved));
        }
    });
}

/// A row carrying a setting the game keeps in notches.
fn slider_row(
    ui: &mut Ui,
    label: &str,
    value: u32,
    range: SliderRange,
    disabled: bool,
    outcome: &mut OptionsOutcome,
    change: fn(u32) -> SettingChange,
) {
    row(ui, label, disabled, |ui| {
        let mut moved = range.clamp(value) as f32;
        let response = widgets::slider_sized(
            ui,
            &mut moved,
            range.min as f32..=range.max as f32,
            range.step as f32,
            vec2(CONTROL_WIDTH, ROW_HEIGHT),
        );
        if response.changed() {
            outcome
                .changes
                .push(change(range.clamp(moved.round() as u32)));
        }
    });
}

/// A row carrying a choice short enough to lay out as chips. Returns the choice the player took.
fn segmented_row<T: Copy + PartialEq>(
    ui: &mut Ui,
    label: &str,
    choices: &[T],
    value: T,
    describe: fn(T) -> String,
    disabled: bool,
) -> Option<T> {
    let mut picked = None;
    row(ui, label, disabled, |ui| {
        let labels: Vec<String> = choices.iter().map(|choice| describe(*choice)).collect();
        let labels: Vec<&str> = labels.iter().map(String::as_str).collect();
        let mut selected = choices
            .iter()
            .position(|choice| *choice == value)
            .unwrap_or(0);
        if widgets::segmented_sized(ui, &mut selected, &labels, vec2(CONTROL_WIDTH, ROW_HEIGHT))
            .changed()
        {
            picked = choices.get(selected).copied();
        }
    });
    picked
}

/// A row carrying a choice from a list too long for chips. Returns the entry the player stepped to.
fn stepper_row(
    ui: &mut Ui,
    label: &str,
    list: &[NamedChoice],
    index: usize,
    disabled: bool,
) -> Option<usize> {
    let mut picked = None;
    row(ui, label, disabled, |ui| {
        let index = index.min(list.len().saturating_sub(1));
        let current = list.get(index).map(NamedChoice::label).unwrap_or_default();
        let delta = widgets::stepper(ui, &current, vec2(CONTROL_WIDTH, ROW_HEIGHT));
        if delta != 0 {
            picked = Some(stepped(list, index, delta));
        }
    });
    picked
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One change per variant, each carrying something other than the default's value, so a
    /// variant that [`OptionsView::apply`] wires to the wrong field — or to none — is caught. The
    /// match in `apply` is exhaustive, so the compiler catches a variant that has no handling at
    /// all; this list is what catches one that has the wrong handling.
    fn every_change() -> Vec<SettingChange> {
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
            SettingChange::Brightness(75),
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
            SettingChange::MinimapPosition(MinimapPosition::BottomLeft),
            SettingChange::MinimapTerrain(MinimapTerrain::Hidden),
            SettingChange::StartingFog(StartingFog::Legacy),
            SettingChange::ApmDisplayOn(true),
            SettingChange::ApmAlertOn(true),
            SettingChange::ApmAlertValue(120),
            SettingChange::ApmAlertColorOn(true),
            SettingChange::ApmAlertSoundOn(true),
            SettingChange::ConsoleSkin(CONSOLE_SKINS[2].id),
            SettingChange::UnitSkin(UNIT_SKINS[2].id),
            SettingChange::ShowBonusSkins(true),
        ]
    }

    #[test]
    fn every_change_moves_exactly_one_setting() {
        let defaults = OptionsView::default();
        let mut seen = Vec::new();
        for change in every_change() {
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
        for change in every_change() {
            view.apply(change);
        }
        let settled = view;
        for change in every_change() {
            view.apply(change);
        }
        assert_eq!(view, settled);
    }

    /// The nav reads in the order the app's own settings do, and opens where a player mid-match
    /// wants to be.
    #[test]
    fn the_sections_are_in_the_apps_order() {
        assert_eq!(
            OptionsSection::ALL,
            [
                OptionsSection::Input,
                OptionsSection::Sound,
                OptionsSection::Video,
                OptionsSection::Gameplay,
            ]
        );
        assert_eq!(OptionsSection::default(), OptionsSection::Gameplay);
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
    }

    /// A stepper walks its list both ways and wraps at both ends.
    #[test]
    fn stepping_wraps_at_both_ends() {
        assert_eq!(stepped(UNIT_SKINS, 0, 1), 1);
        assert_eq!(stepped(UNIT_SKINS, 0, -1), UNIT_SKINS.len() - 1);
        assert_eq!(stepped(UNIT_SKINS, UNIT_SKINS.len() - 1, 1), 0);
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
