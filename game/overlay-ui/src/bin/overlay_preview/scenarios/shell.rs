//! The shell's own scenario: a frame with no screen of its own, for walking through the modal
//! stack, the input capture and the native dialog replacements.
//!
//! The ambient surface it puts on screen is the network-stats panel: with it up and the mode set to
//! observing, a frame here is an ambient panel under whatever modal the native dialogs raise.

use egui::Color32;
use overlay_ui::end_card::{EndCardStats, EndCardView, GameResult, Rank, StatRanks};
use overlay_ui::observer::RaceView;
use overlay_ui::options::{
    DisplayMode, FramePacing, MonitorView, OptionsLists, OptionsSection, OptionsView,
};
use overlay_ui::stats_card::{
    Division, MatchmakingMode, ModeStanding, Rank as StatsRank, RosterGroup, RosterPlayer,
    RosterRecord, RosterSide, RosterStats, RosterView, StatsCardContent, StatsCardView,
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
    /// Which answer to a `/stats` command the scenario comes up with, if any.
    pub stats_card: Option<StatsCardSample>,
    /// Which game's other players the roster is held up over, if it is.
    pub roster: Option<RosterSample>,
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
            stats_card: None,
            roster: None,
        }
    }
}

/// The other players of a game, standing in for what the app has looked up about them.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RosterSample {
    /// A 1v1 matchmaking game: one opponent.
    OneVOne,
    /// A 2v2 matchmaking game: an ally and two opponents.
    TwoVTwo,
    /// A 3v3 matchmaking game, with one player still loading and one not yet rated in the mode.
    ThreeVThree,
    /// A free-for-all lobby game, which has no mode, so every row shows its player's best.
    Lobby,
}

impl RosterSample {
    pub const ALL: [RosterSample; 4] = [
        RosterSample::OneVOne,
        RosterSample::TwoVTwo,
        RosterSample::ThreeVThree,
        RosterSample::Lobby,
    ];

    pub fn slug(self) -> &'static str {
        match self {
            RosterSample::OneVOne => "1v1",
            RosterSample::TwoVTwo => "2v2",
            RosterSample::ThreeVThree => "3v3",
            RosterSample::Lobby => "lobby",
        }
    }

    pub fn view(self) -> RosterView {
        // BW's own player colors, in slot order, which is what a row's bar is matched against.
        const COLORS: [Color32; 6] = [
            Color32::from_rgb(0xF4, 0x04, 0x04),
            Color32::from_rgb(0x0C, 0x48, 0xCC),
            Color32::from_rgb(0x2C, 0xB4, 0x94),
            Color32::from_rgb(0x88, 0x40, 0x9C),
            Color32::from_rgb(0xF8, 0x8C, 0x14),
            Color32::from_rgb(0x70, 0x30, 0x14),
        ];
        let player = |name: &str, slot: usize, race, stats| RosterPlayer {
            name: name.to_string(),
            color: COLORS[slot],
            race,
            stats,
        };
        let loaded = |main_race, wins, losses, mode, rank: Option<(Division, u32)>| {
            RosterStats::Loaded(RosterRecord {
                main_race,
                wins,
                losses,
                standing: Some(ModeStanding {
                    mode,
                    rank: rank.map(|(division, rating)| StatsRank { division, rating }),
                }),
            })
        };
        let group = |side, players| RosterGroup { side, players };
        use MatchmakingMode::*;
        use RaceView::*;
        match self {
            RosterSample::OneVOne => RosterView {
                mode: Some(OneVOne),
                groups: vec![group(
                    RosterSide::Opponents,
                    vec![player(
                        "Bisu[Shield]",
                        1,
                        Protoss,
                        loaded(
                            Some(Protoss),
                            362,
                            248,
                            OneVOne,
                            Some((Division::Platinum1, 1865)),
                        ),
                    )],
                )],
            },
            RosterSample::TwoVTwo => RosterView {
                mode: Some(TwoVTwo),
                groups: vec![
                    group(
                        RosterSide::Allies,
                        vec![player(
                            "Flash",
                            2,
                            Terran,
                            loaded(
                                Some(Terran),
                                1204,
                                699,
                                TwoVTwo,
                                Some((Division::Diamond3, 2214)),
                            ),
                        )],
                    ),
                    group(
                        RosterSide::Opponents,
                        vec![
                            player(
                                "Jaedong",
                                1,
                                Zerg,
                                loaded(
                                    Some(Zerg),
                                    880,
                                    602,
                                    TwoVTwo,
                                    Some((Division::Diamond1, 2051)),
                                ),
                            ),
                            player(
                                "Stork",
                                3,
                                Protoss,
                                loaded(
                                    Some(Protoss),
                                    431,
                                    390,
                                    TwoVTwo,
                                    Some((Division::Gold3, 1742)),
                                ),
                            ),
                        ],
                    ),
                ],
            },
            RosterSample::ThreeVThree => RosterView {
                mode: Some(ThreeVThreeBgh),
                groups: vec![
                    group(
                        RosterSide::Allies,
                        vec![
                            player(
                                "AVeryLongNamePlayer",
                                2,
                                Zerg,
                                loaded(
                                    Some(Terran),
                                    12_480,
                                    11_903,
                                    ThreeVThreeBgh,
                                    Some((Division::Silver2, 1488)),
                                ),
                            ),
                            player(
                                "newcomer",
                                4,
                                Terran,
                                loaded(None, 2, 1, ThreeVThreeBgh, None),
                            ),
                        ],
                    ),
                    group(
                        RosterSide::Opponents,
                        vec![
                            player(
                                "Light",
                                1,
                                Terran,
                                loaded(
                                    Some(Terran),
                                    640,
                                    511,
                                    ThreeVThreeBgh,
                                    Some((Division::Gold1, 1603)),
                                ),
                            ),
                            player("Rain", 3, Protoss, RosterStats::Loading),
                            player(
                                "Soulkey",
                                5,
                                Zerg,
                                loaded(
                                    Some(Zerg),
                                    977,
                                    845,
                                    ThreeVThreeBgh,
                                    Some((Division::Platinum2, 1910)),
                                ),
                            ),
                        ],
                    ),
                ],
            },
            RosterSample::Lobby => RosterView {
                mode: None,
                groups: vec![group(
                    RosterSide::Opponents,
                    vec![
                        player(
                            "Jaedong",
                            1,
                            Zerg,
                            loaded(
                                Some(Zerg),
                                880,
                                602,
                                OneVOne,
                                Some((Division::Champion, 2512)),
                            ),
                        ),
                        player(
                            "Flash",
                            2,
                            Terran,
                            loaded(
                                Some(Terran),
                                1204,
                                699,
                                TwoVTwo,
                                Some((Division::Diamond3, 2214)),
                            ),
                        ),
                        player("guest4471", 3, Random, RosterStats::Unavailable),
                    ],
                )],
            },
        }
    }
}

/// Paints a player's console under the overlay, which the preview otherwise has none of: the
/// minimap in the bottom-left corner, the band along the bottom, and a few lines of chat where BW
/// writes them, above the minimap. The chat-area surfaces are judged against what they cover.
pub fn paint_player_console_stand_in(ctx: &egui::Context) {
    let screen = ctx.viewport_rect();
    let minimap = super::observer::minimap_square(screen);
    super::observer::paint_minimap_stand_in(ctx, minimap);
    let painter = ctx.layer_painter(egui::LayerId::new(
        egui::Order::Background,
        egui::Id::new("player_console_stand_in"),
    ));
    let unit = screen.height() / 1080.0;
    let band = egui::Rect::from_min_max(
        egui::pos2(minimap.right(), screen.bottom() - 200.0 * unit),
        screen.max,
    );
    painter.rect_filled(band, 0.0, Color32::from_rgb(0x14, 0x16, 0x1a));
    painter.hline(
        band.x_range(),
        band.top(),
        egui::Stroke::new(2.0, Color32::from_rgb(0x3a, 0x3e, 0x46)),
    );
    let lines = [
        ("Jaedong", Color32::from_rgb(0xF4, 0x04, 0x04), "gl hf"),
        ("Flash", Color32::from_rgb(0x0C, 0x48, 0xCC), "glhf"),
        ("Stork", Color32::from_rgb(0x2C, 0xB4, 0x94), "gl"),
    ];
    let font = egui::FontId::proportional(16.0);
    let mut y = minimap.top() - 14.0;
    for (name, color, text) in lines.iter().rev() {
        let name_galley = painter.layout_no_wrap(format!("{name}: "), font.clone(), *color);
        let pos = egui::pos2(minimap.left(), y - name_galley.size().y);
        let width = name_galley.size().x;
        painter.galley(
            pos + egui::vec2(1.0, 1.0),
            name_galley.clone(),
            Color32::BLACK,
        );
        painter.galley(pos, name_galley, *color);
        let text_galley = painter.layout_no_wrap(text.to_string(), font.clone(), Color32::WHITE);
        painter.galley(pos + egui::vec2(width, 0.0), text_galley, Color32::WHITE);
        y -= 20.0;
    }
}

/// An answer to a `/stats` command, standing in for what the app sends back.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StatsCardSample {
    /// A seasoned player looked up during a 1v1, whose best mode is another one.
    Matchmaking,
    /// A player whose best mode is the one being played.
    SameMode,
    /// A player looked up in a lobby game, which has no mode of its own.
    Lobby,
    /// A new player in their first matchmaking game, rated in nothing yet.
    NewPlayer,
    /// A name long enough to need truncating, with a record wide enough to crowd it.
    LongName,
    /// A name nobody has.
    NotFound,
    /// The player's own stats, which couldn't be loaded.
    Failed,
}

impl StatsCardSample {
    pub const ALL: [StatsCardSample; 7] = [
        StatsCardSample::Matchmaking,
        StatsCardSample::SameMode,
        StatsCardSample::Lobby,
        StatsCardSample::NewPlayer,
        StatsCardSample::LongName,
        StatsCardSample::NotFound,
        StatsCardSample::Failed,
    ];

    pub fn slug(self) -> &'static str {
        match self {
            StatsCardSample::Matchmaking => "matchmaking",
            StatsCardSample::SameMode => "same-mode",
            StatsCardSample::Lobby => "lobby",
            StatsCardSample::NewPlayer => "new-player",
            StatsCardSample::LongName => "long-name",
            StatsCardSample::NotFound => "not-found",
            StatsCardSample::Failed => "failed",
        }
    }

    pub fn content(self) -> StatsCardContent {
        let rated = |mode, division, rating| ModeStanding {
            mode,
            rank: Some(StatsRank { division, rating }),
        };
        let seasoned = |name: &str, best, current| {
            StatsCardContent::Stats(StatsCardView {
                name: name.to_string(),
                main_race: Some(RaceView::Zerg),
                wins: 362,
                losses: 248,
                best: Some(best),
                current,
            })
        };
        match self {
            StatsCardSample::Matchmaking => seasoned(
                "Bisu[Shield]",
                rated(MatchmakingMode::TwoVTwo, Division::Diamond2, 2140),
                Some(rated(MatchmakingMode::OneVOne, Division::Platinum1, 1865)),
            ),
            StatsCardSample::SameMode => {
                let one_v_one = rated(MatchmakingMode::OneVOne, Division::Gold2, 1720);
                seasoned("Flash", one_v_one, Some(one_v_one))
            }
            StatsCardSample::Lobby => seasoned(
                "Jaedong",
                rated(MatchmakingMode::OneVOne, Division::Champion, 2512),
                None,
            ),
            StatsCardSample::NewPlayer => StatsCardContent::Stats(StatsCardView {
                name: "newcomer".to_string(),
                main_race: None,
                wins: 0,
                losses: 0,
                best: None,
                current: Some(ModeStanding {
                    mode: MatchmakingMode::OneVOne,
                    rank: None,
                }),
            }),
            StatsCardSample::LongName => StatsCardContent::Stats(StatsCardView {
                name: "AVeryLongName16c".to_string(),
                main_race: Some(RaceView::Protoss),
                wins: 12_480,
                losses: 11_903,
                best: Some(rated(
                    MatchmakingMode::ThreeVThreeHunters,
                    Division::Silver3,
                    1488,
                )),
                current: Some(rated(
                    MatchmakingMode::TwoVTwoFastest,
                    Division::Bronze1,
                    1210,
                )),
            }),
            StatsCardSample::NotFound => StatsCardContent::NotFound {
                name: "nobodyxyz".to_string(),
            },
            StatsCardSample::Failed => StatsCardContent::Failed { name: None },
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
    /// A player's game with the answer to a `/stats` command they typed.
    StatsCard(StatsCardSample),
    /// A player's game with the roster of the other players held up.
    Roster(RosterSample),
}

impl Preset {
    pub const ALL: [Preset; 23] = [
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
        Preset::StatsCard(StatsCardSample::Matchmaking),
        Preset::StatsCard(StatsCardSample::SameMode),
        Preset::StatsCard(StatsCardSample::Lobby),
        Preset::StatsCard(StatsCardSample::NewPlayer),
        Preset::StatsCard(StatsCardSample::LongName),
        Preset::StatsCard(StatsCardSample::NotFound),
        Preset::StatsCard(StatsCardSample::Failed),
        Preset::Roster(RosterSample::OneVOne),
        Preset::Roster(RosterSample::TwoVTwo),
        Preset::Roster(RosterSample::ThreeVThree),
        Preset::Roster(RosterSample::Lobby),
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
            Preset::StatsCard(sample) => format!("stats-card-{}", sample.slug()),
            Preset::Roster(sample) => format!("roster-{}", sample.slug()),
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
            Preset::PlayerGameMenu
            | Preset::Victory
            | Preset::Defeat
            | Preset::SettingToast
            | Preset::StatsCard(_)
            | Preset::Roster(_) => overlay_ui::shell::Mode::Playing,
            _ => overlay_ui::shell::Mode::Observing,
        };
        knobs.shell.ambient_panel = matches!(self, Preset::Observer);
        knobs.shell.setting_toast = matches!(self, Preset::SettingToast);
        knobs.shell.stats_card = match self {
            Preset::StatsCard(sample) => Some(sample),
            _ => None,
        };
        knobs.shell.roster = match self {
            Preset::Roster(sample) => Some(sample),
            _ => None,
        };
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
/// every row it can.
pub fn option_lists() -> OptionsLists {
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
        brightness_fullscreen_only: false,
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
    ui.horizontal_wrapped(|ui| {
        ui.label("stats card:");
        changed |= ui
            .selectable_value(&mut knobs.stats_card, None, "none")
            .changed();
        for sample in StatsCardSample::ALL {
            changed |= ui
                .selectable_value(&mut knobs.stats_card, Some(sample), sample.slug())
                .on_hover_text("Shows this answer to a /stats command.")
                .changed();
        }
    });
    ui.horizontal_wrapped(|ui| {
        ui.label("roster held:");
        changed |= ui
            .selectable_value(&mut knobs.roster, None, "none")
            .changed();
        for sample in RosterSample::ALL {
            changed |= ui
                .selectable_value(&mut knobs.roster, Some(sample), sample.slug())
                .on_hover_text("Holds up the roster of this game's other players.")
                .changed();
        }
    });
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
