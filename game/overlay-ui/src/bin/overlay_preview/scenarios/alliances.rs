//! The alliances and chat scenario.
//!
//! The screen is a modal that the alliance filter dialog's replacement raises, so selecting this
//! scenario also spawns that dialog in the emulated host — otherwise the screen would have nothing
//! to draw on.
//!
//! The roster is synthesized deterministically from the knobs, so the same knob settings always
//! produce the same screen and an offline render is reproducible. What the player does on the screen
//! is kept in [`State`], the way the game would keep it: a toggle changes the next frame's view, and
//! the knobs only decide what the game started out as.

use std::collections::HashMap;

use egui::vec2;
use overlay_ui::alliances::{
    AlliancePlayerView, AllianceState, AlliancesAction, AlliancesMenu, AlliancesView,
    ChatTargetChoice, ChatTargetOption, PlayerStanding, RecipientName, ReportState,
};
use overlay_ui::kit::theme;
use overlay_ui::observer::RaceView;
use overlay_ui::shell::Mode;
use serde::{Deserialize, Serialize};

use crate::knobs::Knobs as AllKnobs;

/// The people the roster is dealt from, in the game's order. The local player is not among them: the
/// screen only lists everyone else.
const NAMES: [&str; 7] = [
    "Zerglot",
    "pachi",
    "Artanis_Fan",
    "tec27",
    "mineral_walker",
    "Cleric",
    "ShieldBat",
];

/// The name the long-name knob gives the second row, long enough to run out of room for the tags
/// and the note after it.
const LONG_NAME: &str = "an-extremely-long-player-name-that-keeps-going";

/// What the computer rows are called, after the people.
const COMPUTER_NAMES: [&str; 3] = ["Computer", "Computer", "Computer"];

/// The ShieldBattery account the first row has; the rest follow it.
const FIRST_USER_ID: u32 = 100;

/// The game's own id for the first row. Slot zero is the local player.
const FIRST_PLAYER_ID: u8 = 1;

/// The alliances scenario's emulation knobs.
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    /// How many other people are in the game.
    pub players: u32,
    /// How many computers are in the game, listed after the people.
    pub computers: u32,
    /// Whether every other row is a teammate sharing the player's units, which has nothing to set
    /// with them.
    pub team_game: bool,
    /// Whether the first three rows show a report sending, sent and failed.
    pub report_states: bool,
    /// Whether the game lets the player change alliances and vision at all.
    pub alliances_open: bool,
    /// Whether the last row is someone who has left the game.
    pub departed_player: bool,
    /// Whether the second row is someone who has been beaten but is still in the game.
    pub defeated_player: bool,
    /// Whether the second row's name is long enough to be cut short.
    pub long_name: bool,
    /// How many rows, from the top, start out allied with the player.
    pub allied_rows: u32,
    /// How many rows, from the top, start out muted.
    pub muted_rows: u32,
    /// How many rows, from the bottom, start out blocked.
    pub blocked_rows: u32,
    /// Whether "Allies" is one of the places chat can go.
    pub allies_chat_target: bool,
    /// Which of the screen's menus is open as the scenario comes up.
    pub open_menu: OpenMenu,
    /// Whether the scenario comes up with an alliance change waiting to be applied.
    pub staged_change: bool,
}

/// A menu of the screen's, as a knob opens it.
#[derive(Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum OpenMenu {
    #[default]
    None,
    /// The first row's menu of what can be done about them.
    Player,
    /// The first row's menu of why they are being reported.
    Report,
    /// Where chat goes.
    ChatTarget,
}

/// The menu `k` asks to have open.
pub fn open_menu(k: &Knobs) -> Option<AlliancesMenu> {
    match k.open_menu {
        OpenMenu::None => None,
        OpenMenu::Player => rows(k).first().map(|row| AlliancesMenu::Player {
            user_id: row.user_id,
        }),
        OpenMenu::Report => rows(k).first().map(|row| AlliancesMenu::Report {
            user_id: row.user_id,
        }),
        OpenMenu::ChatTarget => Some(AlliancesMenu::ChatTarget),
    }
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            players: 3,
            computers: 0,
            team_game: false,
            report_states: false,
            alliances_open: true,
            departed_player: false,
            defeated_player: false,
            long_name: false,
            allied_rows: 1,
            muted_rows: 0,
            blocked_rows: 0,
            allies_chat_target: true,
            open_menu: OpenMenu::None,
            staged_change: false,
        }
    }
}

/// The alliance change `k` asks to have waiting: allying with the first row that isn't allied yet.
pub fn staged_change(k: &Knobs) -> Option<AlliancesAction> {
    if !k.staged_change {
        return None;
    }
    rows(k)
        .into_iter()
        .find(|row| row.index >= k.allied_rows as usize && !row.teammate && !row.departed)
        .map(|row| AlliancesAction::SetAllied {
            player_id: row.player_id,
            allied: true,
        })
}

/// A one-click preview state: a free-for-all, a game with teams, a game whose alliances are fixed,
/// a crowded game with every kind of row in it, and each of the screen's menus open.
#[derive(Clone, Copy)]
pub enum Preset {
    Ffa,
    TeamGame,
    Locked,
    Crowded,
    PlayerMenu,
    ReportMenu,
    ChatMenu,
    Staged,
}

impl Preset {
    pub const ALL: [Preset; 8] = [
        Preset::Ffa,
        Preset::TeamGame,
        Preset::Locked,
        Preset::Crowded,
        Preset::PlayerMenu,
        Preset::ReportMenu,
        Preset::ChatMenu,
        Preset::Staged,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Preset::Ffa => "ffa",
            Preset::TeamGame => "team-game",
            Preset::Locked => "locked",
            Preset::Crowded => "crowded",
            Preset::PlayerMenu => "player-menu",
            Preset::ReportMenu => "report-menu",
            Preset::ChatMenu => "chat-menu",
            Preset::Staged => "staged",
        }
    }

    /// Presets this scenario's knobs, and puts the host where the screen exists: a player's game,
    /// with the native dialog the screen replaces spawned.
    pub fn apply(self, knobs: &mut AllKnobs) {
        knobs.host.alliance_filter_spawned = true;
        knobs.host.mode = Mode::Playing;
        self.apply_knobs(&mut knobs.alliances);
    }

    /// Presets only what this scenario owns, for the preset row inside its own knob section, where
    /// the dialog has already been spawned by the selector.
    pub fn apply_knobs(self, k: &mut Knobs) {
        *k = match self {
            Preset::Ffa => Knobs::default(),
            Preset::TeamGame => Knobs {
                players: 5,
                team_game: true,
                allied_rows: 0,
                ..Knobs::default()
            },
            Preset::Locked => Knobs {
                players: 4,
                alliances_open: false,
                allied_rows: 2,
                ..Knobs::default()
            },
            Preset::Crowded => Knobs {
                players: 5,
                computers: 2,
                team_game: true,
                report_states: true,
                departed_player: true,
                defeated_player: true,
                long_name: true,
                allied_rows: 3,
                muted_rows: 2,
                blocked_rows: 1,
                ..Knobs::default()
            },
            Preset::PlayerMenu => Knobs {
                players: 4,
                muted_rows: 1,
                open_menu: OpenMenu::Player,
                ..Knobs::default()
            },
            Preset::ReportMenu => Knobs {
                players: 4,
                open_menu: OpenMenu::Report,
                ..Knobs::default()
            },
            Preset::ChatMenu => Knobs {
                players: 4,
                muted_rows: 1,
                open_menu: OpenMenu::ChatTarget,
                ..Knobs::default()
            },
            Preset::Staged => Knobs {
                players: 4,
                staged_change: true,
                ..Knobs::default()
            },
        };
    }
}

/// What the fake game remembers of what the screen asked of it. Each map holds only what the player
/// has changed; a row the player has not touched keeps what the knobs gave it.
#[derive(Default)]
pub struct State {
    allied: HashMap<u8, bool>,
    vision: HashMap<u8, bool>,
    muted: HashMap<u32, bool>,
    blocked: HashMap<u32, bool>,
    reports: HashMap<u32, ReportState>,
    allied_victory: bool,
    chat_target: Option<ChatTargetChoice>,
    /// The menu knob as the shell was last told it, so the knob opens the menu once rather than
    /// holding it open against the player's clicks.
    pub menu_applied: Option<OpenMenu>,
    /// The staged-change knob as the shell was last told it, for the same reason.
    pub staged_applied: Option<bool>,
}

impl State {
    pub fn new() -> State {
        State::default()
    }

    /// Puts everything back to what the knobs say.
    pub fn reset(&mut self) {
        *self = State::new();
    }

    /// Carries out what the screen asked for, the way the game would.
    pub fn apply(&mut self, k: &Knobs, action: AlliancesAction) {
        match action {
            AlliancesAction::SetAllied { player_id, allied } => {
                self.allied.insert(player_id, allied);
            }
            AlliancesAction::SetSharedVision { player_id, shared } => {
                self.vision.insert(player_id, shared);
            }
            AlliancesAction::SetAlliedVictory(on) => self.allied_victory = on,
            AlliancesAction::SetMuted { user_id, muted } => {
                self.muted.insert(user_id, muted);
            }
            AlliancesAction::SetAllMuted(muted) => {
                for row in rows(k) {
                    self.muted.insert(row.user_id, muted);
                }
            }
            AlliancesAction::SetBlocked { user_id, blocked } => {
                self.blocked.insert(user_id, blocked);
            }
            // The emulated game has no server to file with, so a report is taken at once.
            AlliancesAction::Report { user_id, .. } => {
                self.reports.insert(user_id, ReportState::Sent);
            }
            AlliancesAction::SetChatTarget(choice) => self.chat_target = Some(choice),
        }
    }
}

/// What the knobs say about one row before the player has touched anything.
struct Row {
    index: usize,
    user_id: u32,
    player_id: u8,
    teammate: bool,
    departed: bool,
}

/// The roster the knobs describe, in the game's order.
fn rows(k: &Knobs) -> Vec<Row> {
    let count = (k.players as usize).min(NAMES.len());
    (0..count)
        .map(|index| Row {
            index,
            user_id: FIRST_USER_ID + index as u32,
            player_id: FIRST_PLAYER_ID + index as u8,
            teammate: k.team_game && index % 2 == 0,
            departed: k.departed_player && index + 1 == count,
        })
        .collect()
}

/// Builds the view the game would hand the overlay.
pub fn build_view(k: &Knobs, state: &State) -> AlliancesView {
    let count = (k.players as usize).min(NAMES.len());
    let rows = rows(k);
    let mut players = rows
        .iter()
        .map(|row| {
            let name = if k.long_name && row.index == 1 {
                LONG_NAME
            } else {
                NAMES[row.index]
            };
            let allied = state
                .allied
                .get(&row.player_id)
                .copied()
                .unwrap_or(row.index < k.allied_rows as usize);
            let vision = state
                .vision
                .get(&row.player_id)
                .copied()
                .unwrap_or(row.index < k.allied_rows as usize && row.index % 2 == 0);
            let knob_report = match row.index {
                0 if k.report_states => ReportState::Sending,
                1 if k.report_states => ReportState::Sent,
                2 if k.report_states => ReportState::Failed,
                _ => ReportState::None,
            };
            AlliancePlayerView {
                team: if k.team_game {
                    if row.teammate { 1 } else { 2 }
                } else {
                    0
                },
                user_id: Some(row.user_id),
                name: name.to_string(),
                color: theme::player_color(row.index + 1),
                race: RaceView::ALL[row.index % RaceView::ALL.len()],
                standing: if row.departed {
                    PlayerStanding::Left
                } else if k.defeated_player && row.index == 1 {
                    PlayerStanding::Defeated
                } else if row.teammate {
                    PlayerStanding::Fixed
                } else {
                    PlayerStanding::Allyable(AllianceState {
                        player_id: row.player_id,
                        allied,
                        vision,
                    })
                },
                muted: state
                    .muted
                    .get(&row.user_id)
                    .copied()
                    .unwrap_or(row.index < k.muted_rows as usize),
                blocked: state
                    .blocked
                    .get(&row.user_id)
                    .copied()
                    .unwrap_or(row.index >= count.saturating_sub(k.blocked_rows as usize)),
                report: state
                    .reports
                    .get(&row.user_id)
                    .copied()
                    .unwrap_or(knob_report),
            }
        })
        .chain(
            (0..(k.computers as usize).min(COMPUTER_NAMES.len())).map(|index| {
                let slot = count + index;
                AlliancePlayerView {
                    team: if k.team_game { 2 } else { 0 },
                    user_id: None,
                    name: COMPUTER_NAMES[index].to_string(),
                    color: theme::player_color(slot + 1),
                    race: RaceView::ALL[slot % RaceView::ALL.len()],
                    standing: PlayerStanding::Fixed,
                    muted: false,
                    blocked: false,
                    report: ReportState::None,
                }
            }),
        )
        .collect::<Vec<_>>();
    players.sort_by_key(|player| player.team);

    let mut chat_targets = vec![ChatTargetOption {
        choice: ChatTargetChoice::All,
        recipient: None,
        color: None,
        muted: false,
    }];
    if k.allies_chat_target {
        chat_targets.push(ChatTargetOption {
            choice: ChatTargetChoice::Allies,
            recipient: None,
            color: None,
            muted: false,
        });
    }
    for player in &players {
        if let Some(alliance) = player.standing.alliance() {
            chat_targets.push(ChatTargetOption {
                choice: ChatTargetChoice::Recipient(alliance.player_id),
                recipient: Some(RecipientName::Player(player.name.clone())),
                color: Some(player.color),
                muted: player.muted,
            });
        }
    }
    // A choice the knobs have since removed falls back to everyone, the way the game would stop
    // sending to someone who is no longer in it.
    let chat_target = state
        .chat_target
        .filter(|choice| chat_targets.iter().any(|option| option.choice == *choice))
        .unwrap_or(ChatTargetChoice::All);

    AlliancesView {
        players,
        alliances_open: k.alliances_open,
        allied_victory: state.allied_victory,
        chat_target,
        chat_targets,
    }
}

/// The scenario's knob section. Returns whether anything changed.
pub fn knobs_ui(k: &mut Knobs, state: &mut State, ui: &mut egui::Ui) -> bool {
    let mut changed = false;

    ui.horizontal_wrapped(|ui| {
        ui.label("Preset:");
        for preset in Preset::ALL {
            if ui.button(preset.label()).clicked() {
                preset.apply_knobs(k);
                state.reset();
                changed = true;
            }
        }
    });

    ui.add_space(4.0);
    egui::Grid::new("alliances_knobs")
        .num_columns(2)
        .spacing(vec2(8.0, 6.0))
        .show(ui, |ui| {
            ui.label("Players");
            changed |= ui
                .add(egui::DragValue::new(&mut k.players).range(0..=NAMES.len() as u32))
                .changed();
            ui.end_row();

            ui.label("Computers");
            changed |= ui
                .add(egui::DragValue::new(&mut k.computers).range(0..=COMPUTER_NAMES.len() as u32))
                .changed();
            ui.end_row();

            ui.label("Allied rows");
            changed |= ui
                .add(egui::DragValue::new(&mut k.allied_rows).range(0..=NAMES.len() as u32))
                .on_hover_text("How many rows, from the top, start out allied with the player.")
                .changed();
            ui.end_row();

            ui.label("Muted rows");
            changed |= ui
                .add(egui::DragValue::new(&mut k.muted_rows).range(0..=NAMES.len() as u32))
                .on_hover_text("How many rows, from the top, start out muted.")
                .changed();
            ui.end_row();

            ui.label("Blocked rows");
            changed |= ui
                .add(egui::DragValue::new(&mut k.blocked_rows).range(0..=NAMES.len() as u32))
                .on_hover_text("How many rows, from the bottom, start out blocked.")
                .changed();
            ui.end_row();
        });

    changed |= ui
        .checkbox(&mut k.team_game, "team game")
        .on_hover_text("Every other row is a teammate, which has no alliance to set.")
        .changed();
    changed |= ui
        .checkbox(&mut k.report_states, "report states")
        .on_hover_text("The first three rows show a report sending, sent and failed.")
        .changed();
    changed |= ui
        .checkbox(&mut k.alliances_open, "alliances open")
        .on_hover_text("Off fixes alliances and shared vision, as a game with set teams does.")
        .changed();
    changed |= ui
        .checkbox(&mut k.departed_player, "departed player")
        .on_hover_text("The last row has left the game.")
        .changed();
    changed |= ui
        .checkbox(&mut k.defeated_player, "defeated player")
        .on_hover_text("The second row has been beaten but is still in the game.")
        .changed();
    changed |= ui
        .checkbox(&mut k.long_name, "long name")
        .on_hover_text("The second row's name is too long to fit beside its tags.")
        .changed();
    changed |= ui
        .checkbox(&mut k.allies_chat_target, "allies chat target")
        .on_hover_text("Whether \"Allies\" is one of the places chat can go.")
        .changed();

    ui.add_space(4.0);
    if ui
        .button("reset changes")
        .on_hover_text("Forgets what has been toggled on the screen, going back to the knobs.")
        .clicked()
    {
        state.reset();
        changed = true;
    }

    changed
}
