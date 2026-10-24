//! The shell's own scenario: a frame with no screen of its own, for walking through the modal
//! stack, the input capture and the native dialog replacements.
//!
//! The ambient surface it puts on screen is the network-stats panel: with it up and the mode set to
//! observing, a frame here is an ambient panel under whatever modal the native dialogs raise.

use overlay_ui::end_card::{EndCardStats, EndCardView, GameResult, Rank, StatRanks};
use overlay_ui::observer::RaceView;
use overlay_ui::options::{
    DisplayMode, FramePacing, MonitorView, OptionsLists, OptionsSection, OptionsView,
};
use serde::{Deserialize, Serialize};

use crate::knobs::Knobs as AllKnobs;
use crate::scenarios::netstat;

/// The shell scenario's own knobs.
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    /// Whether an ambient panel is on screen under the modal layer.
    pub ambient_panel: bool,
    /// Whether the options screen is on the modal stack. Raised by the shell rather than by a
    /// native dialog, the way the in-game menu's own Options button raises it.
    pub options_open: bool,
    /// Which page of the options screen the shell is put on.
    pub options_section: OptionsSection,
    /// The settings the emulated host reports, standing in for what the game holds.
    pub options: OptionsView,
    /// The race the emulated player played, whose emblem the end-of-game screen shows.
    pub race: RaceView,
    /// A moment of the end-of-game screen's entrance to hold it at, in seconds after it appeared,
    /// or `None` to let it play. Holding it is how a stage of the entrance is looked at as a still.
    pub end_card_moment: Option<f32>,
    /// Whether the scenario comes up with the notice of a setting the game changed on its own keys.
    pub setting_toast: bool,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            ambient_panel: true,
            options_open: false,
            options_section: OptionsSection::default(),
            options: OptionsView::default(),
            race: RaceView::Protoss,
            end_card_moment: None,
            setting_toast: false,
        }
    }
}

/// A one-click state of the shell.
#[derive(Clone, Copy)]
pub enum Preset {
    /// Observing, with an ambient panel up and nothing modal over it.
    Observer,
    /// The in-game menu's replacement, raised the way its native dialog spawning raises it.
    GameMenu,
    /// The same menu as a player sees it, with what only a player can do from it.
    PlayerGameMenu,
    /// The chat log's replacement, raised the same way.
    ChatHistory,
    /// The options screen, which takes the place of the menu that opens it, on one of its pages.
    Options(OptionsSection),
    /// The end-of-game card of a player who has won, raised by the victory popup spawning.
    Victory,
    /// The end-of-game card of a player who has lost, raised by the defeat popup spawning.
    Defeat,
    /// A player's game with the notice of a setting changed on the game's own keys.
    SettingToast,
}

impl Preset {
    pub const ALL: [Preset; 12] = [
        Preset::Observer,
        Preset::GameMenu,
        Preset::PlayerGameMenu,
        Preset::ChatHistory,
        Preset::Options(OptionsSection::Gameplay),
        Preset::Options(OptionsSection::Input),
        Preset::Options(OptionsSection::Sound),
        Preset::Options(OptionsSection::Video),
        Preset::Options(OptionsSection::Network),
        Preset::Victory,
        Preset::Defeat,
        Preset::SettingToast,
    ];

    pub fn label(self) -> String {
        match self {
            Preset::Observer => "observer".to_string(),
            Preset::GameMenu => "game-menu".to_string(),
            Preset::PlayerGameMenu => "player-game-menu".to_string(),
            Preset::ChatHistory => "chat-history".to_string(),
            Preset::Options(section) => format!("options-{}", section.slug()),
            Preset::Victory => "victory".to_string(),
            Preset::Defeat => "defeat".to_string(),
            Preset::SettingToast => "setting-toast".to_string(),
        }
    }

    /// Selects this preset's host state as well as its own knobs: a modal here is raised by a native
    /// dialog spawning, which is host state rather than anything the scenario owns.
    pub fn apply(self, knobs: &mut AllKnobs) {
        // The options screen takes the place of the menu it is opened from, so it comes up alone.
        knobs.host.game_menu_spawned = matches!(self, Preset::GameMenu | Preset::PlayerGameMenu);
        knobs.host.chat_history_spawned = matches!(self, Preset::ChatHistory);
        knobs.host.victory_spawned = matches!(self, Preset::Victory);
        knobs.host.defeat_spawned = matches!(self, Preset::Defeat);
        // The result popups are a player's; the rest of the shell's states are shown to a watcher.
        knobs.host.mode = match self {
            Preset::PlayerGameMenu | Preset::Victory | Preset::Defeat | Preset::SettingToast => {
                overlay_ui::shell::Mode::Playing
            }
            _ => overlay_ui::shell::Mode::Observing,
        };
        knobs.shell.ambient_panel = matches!(self, Preset::Observer);
        knobs.shell.setting_toast = matches!(self, Preset::SettingToast);
        knobs.shell.options_open = matches!(self, Preset::Options(_));
        if let Preset::Options(section) = self {
            knobs.shell.options_section = section;
        }
        // A different emblem behind each result, so the renders of both show two of them.
        match self {
            Preset::Victory => knobs.shell.race = RaceView::Protoss,
            Preset::Defeat => knobs.shell.race = RaceView::Zerg,
            _ => {}
        }
    }

    /// Moments into this preset's entrance worth rendering as stills of their own, in seconds after
    /// it appeared: the end-of-game screen arrives in stages over a couple of seconds, and its
    /// resting frame shows none of them.
    pub fn timeline(self) -> &'static [f64] {
        match self {
            Preset::Victory | Preset::Defeat => &[0.15, 0.3, 0.6, 1.0, 1.4, 1.5, 1.6, 1.8, 2.2],
            _ => &[],
        }
    }

    /// How long after it appears this preset has come to rest, for a preset that takes longer than
    /// an offline render's usual settling.
    pub fn settle_secs(self) -> Option<f64> {
        match self {
            Preset::Victory | Preset::Defeat => Some(3.0),
            _ => None,
        }
    }
}

/// Brings the shell's modal stack in line with the options knob, the way the in-game menu's own
/// Options button brings it in line with a click.
pub fn sync_options_modal(knobs: &Knobs, shell: &mut overlay_ui::shell::Shell) {
    use overlay_ui::shell::ModalId;

    let open = shell.open_modals().any(|modal| modal == ModalId::Options);
    if knobs.options_open && !open {
        shell.open_modal(ModalId::Options);
        // Only as the screen comes up: after that the nav inside it owns which page is on, and a
        // knob re-applied every frame would take every click straight back.
        shell.set_options_section(knobs.options_section);
    } else if !knobs.options_open && open {
        shell.close_modal(ModalId::Options);
    }
}

/// What the emulated host reports beside the settings: two displays, so the monitor row has more
/// than its default to step through, and a game that rolls back, so the network section shows
/// every row it can. Whether the game is being watched follows the host's mode.
pub fn option_lists(watching: bool) -> OptionsLists {
    OptionsLists {
        monitors: vec![
            MonitorView {
                name: "AORUS FO27Q2".to_string(),
                bounds: (0, 0, 2560, 1440),
            },
            MonitorView {
                name: "DELL U2415".to_string(),
                bounds: (2560, 0, 1920, 1200),
            },
        ],
        rollback_game: true,
        watching,
    }
}

/// What the emulated game reports on the end-of-game card: a mid-length game with a busy army on
/// both sides, so every cell of the summary carries a number of realistic width, played as `race`.
/// The winner led most of the game's numbers and the loser only its APM, so both cards show their
/// `#1` marks.
pub fn end_card_view(result: GameResult, game_seconds: u64, race: RaceView) -> EndCardView {
    EndCardView {
        result,
        game_seconds,
        race: (result != GameResult::GameOver).then_some(race),
        stats: Some(match result {
            GameResult::Victory => EndCardStats {
                units_produced: 87,
                units_killed: 64,
                units_lost: 38,
                minerals_gathered: 18_450,
                gas_gathered: 6_125,
                average_apm: Some(214),
            },
            GameResult::Defeat => EndCardStats {
                units_produced: 71,
                units_killed: 38,
                units_lost: 64,
                minerals_gathered: 14_225,
                gas_gathered: 4_350,
                average_apm: Some(187),
            },
            // A watcher played no game of their own to sum up.
            GameResult::GameOver => {
                return EndCardView {
                    result,
                    game_seconds,
                    race: None,
                    stats: None,
                    ranks: StatRanks::default(),
                };
            }
        }),
        // Every place a mark comes in, in a game big enough for all three.
        ranks: match result {
            GameResult::Victory => StatRanks {
                units_produced: Some(Rank::First),
                units_killed: Some(Rank::Second),
                minerals_gathered: Some(Rank::First),
                gas_gathered: Some(Rank::Third),
                average_apm: Some(Rank::First),
            },
            GameResult::Defeat => StatRanks {
                average_apm: Some(Rank::Second),
                ..StatRanks::default()
            },
            GameResult::GameOver => StatRanks::default(),
        },
    }
}

/// The ambient panel this scenario puts under the modal layer, if any.
pub fn ambient_view(
    knobs: &Knobs,
    netstat_knobs: &netstat::Knobs,
) -> Option<overlay_ui::netstat::NetStatsView> {
    knobs
        .ambient_panel
        .then(|| netstat::build_view(netstat_knobs))
}

/// The scenario's knob section. Returns whether anything changed.
pub fn knobs_ui(knobs: &mut Knobs, ui: &mut egui::Ui) -> bool {
    let mut changed = false;
    ui.label(
        "Nothing here is a screen of its own: the modals come from the native dialogs in the \
         emulated host section above, and the ambient panel stands in for the observer panel set.",
    );
    ui.add_space(4.0);
    changed |= ui
        .checkbox(&mut knobs.ambient_panel, "ambient panel")
        .on_hover_text("Puts the network-stats panel on screen under the modal layer.")
        .changed();
    changed |= ui
        .checkbox(&mut knobs.setting_toast, "setting notice")
        .on_hover_text(
            "Shows the notice of a setting the game changed on its own keys, as Shift+Tab turning \
             the color overrides off would. Tick it again to show it again.",
        )
        .changed();
    ui.add_space(8.0);
    changed |= ui
        .checkbox(&mut knobs.options_open, "options")
        .on_hover_text(
            "Raises the options screen the way the in-game menu's own Options button raises it.",
        )
        .changed();
    ui.horizontal_wrapped(|ui| {
        ui.label("section:");
        for section in OptionsSection::ALL {
            changed |= ui
                .selectable_value(&mut knobs.options_section, section, section.slug())
                .changed();
        }
    });
    ui.horizontal_wrapped(|ui| {
        ui.label("end card race:");
        for race in RaceView::ALL {
            changed |= ui
                .selectable_value(&mut knobs.race, race, race.label())
                .changed();
        }
    });
    ui.horizontal(|ui| {
        let mut held = knobs.end_card_moment.is_some();
        if ui
            .checkbox(&mut held, "hold end card at")
            .on_hover_text(
                "Freezes the end-of-game screen's entrance this many seconds after it appeared, \
                 so a stage of it can be looked at as a still.",
            )
            .changed()
        {
            knobs.end_card_moment = held.then_some(0.4);
            changed = true;
        }
        if let Some(moment) = &mut knobs.end_card_moment {
            changed |= ui
                .add(egui::Slider::new(moment, 0.0..=2.5).suffix(" s"))
                .changed();
        }
    });
    ui.label("What the emulated host reports the game's settings as:");
    for (label, value) in [
        ("music", &mut knobs.options.music_on),
        ("hd graphics", &mut knobs.options.hd_graphics_on),
        ("apm alert", &mut knobs.options.apm_alert_on),
        (
            "custom mouse sensitivity",
            &mut knobs.options.mouse_sensitivity_on,
        ),
        ("hardware cursor", &mut knobs.options.hardware_cursor_on),
        ("vertical sync", &mut knobs.options.vsync_on),
    ] {
        changed |= ui.checkbox(value, label).changed();
    }
    // The video section's rows come and go with these two, so each of their states is a layout.
    ui.horizontal_wrapped(|ui| {
        ui.label("display mode:");
        for (mode, label) in [
            (DisplayMode::Windowed, "windowed"),
            (DisplayMode::WindowedFullscreen, "windowed fullscreen"),
            (DisplayMode::Fullscreen, "fullscreen"),
        ] {
            changed |= ui
                .selectable_value(&mut knobs.options.display_mode, mode, label)
                .changed();
        }
    });
    ui.horizontal_wrapped(|ui| {
        ui.label("frame pacing:");
        for (pacing, label) in [
            (FramePacing::Display, "match refresh"),
            (FramePacing::VariableRefresh, "variable refresh"),
            (FramePacing::Off, "off"),
        ] {
            changed |= ui
                .selectable_value(&mut knobs.options.frame_pacing, pacing, label)
                .changed();
        }
    });
    changed
}
