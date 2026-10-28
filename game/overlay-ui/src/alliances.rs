//! The alliances and chat screen: everyone else in the game and their race, who the player is allied
//! with and shares vision with, whose chat they hear, and who their own chat goes to. It stands in
//! for SC:R's alliance and message filter dialogs, which split those across two screens.
//!
//! A table of the other players reads across each of them: who they are, then the two things the
//! player sets with them through the game (alliance, vision), then the two that are the player's
//! alone (mute, and a menu of what goes beyond this game: blocking and reporting). A computer has
//! only the first of those, and is listed so the table still answers "who am I playing against".
//! The footer holds what is set once for the whole game rather than per player: where the player's
//! chat goes, and whether allies share a victory. Like every screen here, it is a pure fn of
//! [`AlliancesView`] plus an [`egui::Context`].
//!
//! What the game shares with the other players (alliances, vision, allied victory) waits in an
//! [`AlliancesDraft`] until the player applies it, as the game's own alliance dialog waits for OK.
//! What is the player's alone (mute, block, report, where their chat goes) takes effect at once.

use std::borrow::Cow;
use std::collections::BTreeMap;

use egui::{Align, Color32, Id, Layout, Rect, Sense, Ui, UiBuilder, Vec2, pos2, vec2};

use crate::colors::{BLUE70, GREY_BLUE60, GREY_BLUE70, GREY_BLUE80};
use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets::{
    self, ButtonVariant, Glyph, IconButtonState, MenuRow, MenuSide, MenuTone, TagStyle,
};
use crate::kit::{theme, tiers};
use crate::observer::{self, RaceView};
use crate::tr;

/// How wide the dialog's contents are, in overlay points.
const CONTENT_WIDTH: f32 = 720.0;

/// The table's fixed columns, and the gap between two columns. The player's column takes the rest.
/// The two switch columns are only as wide as their labels need, which every language keeps to a
/// short word.
const ALLY_WIDTH: f32 = 72.0;
const VISION_WIDTH: f32 = 72.0;
const MUTE_WIDTH: f32 = 72.0;
const MORE_WIDTH: f32 = 48.0;
const COLUMN_GAP: f32 = 8.0;
const PLAYER_WIDTH: f32 =
    CONTENT_WIDTH - ALLY_WIDTH - VISION_WIDTH - MUTE_WIDTH - MORE_WIDTH - COLUMN_GAP * 4.0;
const _: () = assert!(PLAYER_WIDTH > 400.0);

/// A row of the table: its controls, and the room above and below them. Seven of them (everyone
/// else in an eight player game) have to fit a 720-line screen along with the rest of the dialog.
const ROW_HEIGHT: f32 = 60.0;

/// The pieces of a player's cell, left to right.
const SWATCH_SIZE: f32 = 20.0;
const NAME_SIZE: f32 = 22.0;
const CELL_GAP: f32 = 12.0;
const CELL_END_GAP: f32 = 16.0;

/// The status shown in place of the switches for someone out of the game.
const STATUS_SIZE: f32 = 14.0;

/// The race initial beside the player's color swatch.
const RACE_INITIAL_WIDTH: f32 = 28.0;
const RACE_INITIAL_SIZE: f32 = 22.0;

/// The header's mute-everyone button.
const MUTE_ALL_HEIGHT: f32 = 32.0;
const MUTE_ALL_LABEL_SIZE: f32 = 12.0;

/// How wide each menu is.
const PLAYER_MENU_WIDTH: f32 = 250.0;
const CHAT_MENU_WIDTH: f32 = 230.0;

/// The narrowest the chat target's dropdown gets, so choosing a short name does not shift the
/// footer under the pointer.
const CHAT_TARGET_MIN_WIDTH: f32 = 140.0;

/// The key that closes the screen, dropping any staged changes, as its keycap names it.
pub const DONE_KEY: &str = "Esc";
/// The key that applies the staged changes and closes the screen.
pub const APPLY_KEY: &str = "Enter";

/// What the screen shows of one other player in the game.
#[derive(Clone, PartialEq, Debug)]
pub struct AlliancePlayerView {
    /// The game's fixed team number. Zero means the game has no assigned teams.
    pub team: u8,
    /// Their ShieldBattery account, which mute, block and report are kept against. `None` for a
    /// computer, which none of those apply to.
    pub user_id: Option<u32>,
    pub name: String,
    /// Their color on the map.
    pub color: Color32,
    /// The race they chose, which is Random for a player who left it to the game.
    pub race: RaceView,
    pub standing: PlayerStanding,
    pub muted: bool,
    pub blocked: bool,
    pub report: ReportState,
}

/// The player's own alliance with someone, as the game holds it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct AllianceState {
    /// The game's own id for them, which alliance and vision are set against.
    pub player_id: u8,
    pub allied: bool,
    pub vision: bool,
}

/// Where someone stands in the game, which is what their row's ally and vision columns hold: the
/// switches for someone the player can ally with, or why there is nothing to set.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PlayerStanding {
    /// In the game, with what the player has set with them through it.
    Allyable(AllianceState),
    /// In the game, with nothing for the player to set: a teammate sharing the player's own units,
    /// or a computer, whose alliances are its own.
    Fixed,
    /// Beaten, and still in the game.
    Defeated,
    /// Gone from the game.
    Left,
}

impl PlayerStanding {
    pub fn alliance(self) -> Option<AllianceState> {
        match self {
            PlayerStanding::Allyable(alliance) => Some(alliance),
            _ => None,
        }
    }

    fn alliance_mut(&mut self) -> Option<&mut AllianceState> {
        match self {
            PlayerStanding::Allyable(alliance) => Some(alliance),
            _ => None,
        }
    }
}

/// Where a report the player made about someone this game stands.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum ReportState {
    #[default]
    None,
    /// Filed, and not yet answered.
    Sending,
    /// Received by ShieldBattery.
    Sent,
    /// Not received; the player can try again.
    Failed,
}

/// Why the player is reporting someone.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash)]
pub enum ReportReason {
    Cheating,
    Abandoning,
    Griefing,
    AbusiveChat,
}

impl ReportReason {
    pub const ALL: [ReportReason; 4] = [
        ReportReason::Cheating,
        ReportReason::Abandoning,
        ReportReason::Griefing,
        ReportReason::AbusiveChat,
    ];

    fn label(self) -> String {
        match self {
            ReportReason::Cheating => tr!("alliances.reasonCheating", "Cheating or exploiting"),
            ReportReason::Abandoning => tr!("alliances.reasonAbandoning", "Left the game"),
            ReportReason::Griefing => tr!("alliances.reasonGriefing", "Griefing"),
            ReportReason::AbusiveChat => tr!("alliances.reasonAbusiveChat", "Abusive chat"),
        }
    }
}

/// Where the player's chat goes.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash)]
pub enum ChatTargetChoice {
    All,
    Allies,
    /// One recipient as the game numbers them: a player, or in a game whose teams share control, a
    /// team.
    Recipient(u8),
}

/// Who a [`ChatTargetChoice::Recipient`] is.
#[derive(Clone, PartialEq, Debug)]
pub enum RecipientName {
    Player(String),
    /// A team, by the number the lobby gave it.
    Team(u8),
}

/// One choice of where the player's chat goes.
#[derive(Clone, PartialEq, Debug)]
pub struct ChatTargetOption {
    pub choice: ChatTargetChoice,
    /// Who the choice is, for a choice of one recipient.
    pub recipient: Option<RecipientName>,
    /// The color of the player the choice stands for, if it stands for one.
    pub color: Option<Color32>,
    /// Whether the player has muted the person the choice stands for: they can still be written to,
    /// so the choice stays, set back from the rest.
    pub muted: bool,
}

impl ChatTargetOption {
    /// What the choice is called on screen.
    pub fn label(&self) -> String {
        match (&self.recipient, self.choice) {
            (Some(RecipientName::Player(name)), _) => name.clone(),
            (Some(RecipientName::Team(number)), _) => {
                tr!("alliances.chatTeam", "Team {{number}}", number = number)
            }
            (None, ChatTargetChoice::Allies) => tr!("alliances.chatAllies", "Allies"),
            (None, _) => tr!("alliances.chatAll", "All players"),
        }
    }
}

/// Everything the screen needs to draw itself.
#[derive(Clone, PartialEq, Debug)]
pub struct AlliancesView {
    /// Every other player in the game, computers included, in team then player-slot order.
    pub players: Vec<AlliancePlayerView>,
    /// Whether this game lets the player change their alliances and shared vision at all.
    pub alliances_open: bool,
    /// Whether the player's allies share a victory with them. One setting for every ally, which is
    /// how the game keeps it.
    pub allied_victory: bool,
    pub chat_target: ChatTargetChoice,
    /// The choices of where chat goes, in the order the menu lists them.
    pub chat_targets: Vec<ChatTargetOption>,
}

/// Something the player did on the screen, which the host carries out.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AlliancesAction {
    SetAllied {
        player_id: u8,
        allied: bool,
    },
    SetSharedVision {
        player_id: u8,
        shared: bool,
    },
    SetAlliedVictory(bool),
    SetMuted {
        user_id: u32,
        muted: bool,
    },
    /// Mutes, or unmutes, every person the screen lists.
    SetAllMuted(bool),
    SetBlocked {
        user_id: u32,
        blocked: bool,
    },
    Report {
        user_id: u32,
        reason: ReportReason,
    },
    SetChatTarget(ChatTargetChoice),
}

/// Changes to the player's alliances, shared vision and allied victory made on the screen and not
/// yet sent to the game.
#[derive(Clone, Default, PartialEq, Eq, Debug)]
pub struct AlliancesDraft {
    allied: BTreeMap<u8, bool>,
    vision: BTreeMap<u8, bool>,
    allied_victory: Option<bool>,
}

impl AlliancesDraft {
    /// Holds `action` back if it is one the draft stages, and hands it back otherwise.
    pub fn stage(&mut self, action: AlliancesAction) -> Option<AlliancesAction> {
        match action {
            AlliancesAction::SetAllied { player_id, allied } => {
                self.allied.insert(player_id, allied);
            }
            AlliancesAction::SetSharedVision { player_id, shared } => {
                self.vision.insert(player_id, shared);
            }
            AlliancesAction::SetAlliedVictory(shared) => self.allied_victory = Some(shared),
            action => return Some(action),
        }
        None
    }

    /// Drops every change `view`, the game's own state, already holds, and every change to
    /// something the player can no longer set.
    pub fn settle(&mut self, view: &AlliancesView) {
        if !view.alliances_open {
            *self = AlliancesDraft::default();
            return;
        }
        let held = |player_id: u8| {
            view.players
                .iter()
                .filter_map(|player| player.standing.alliance())
                .find(|alliance| alliance.player_id == player_id)
        };
        self.allied
            .retain(|&id, allied| held(id).is_some_and(|held| held.allied != *allied));
        self.vision
            .retain(|&id, shared| held(id).is_some_and(|held| held.vision != *shared));
        self.allied_victory = self
            .allied_victory
            .filter(|&shared| shared != view.allied_victory);
    }

    pub fn is_empty(&self) -> bool {
        self.allied.is_empty() && self.vision.is_empty() && self.allied_victory.is_none()
    }

    /// `view` as it will be once the draft is applied.
    pub fn applied_to<'a>(&self, view: &'a AlliancesView) -> Cow<'a, AlliancesView> {
        if self.is_empty() {
            return Cow::Borrowed(view);
        }
        let mut view = view.clone();
        for alliance in view
            .players
            .iter_mut()
            .filter_map(|player| player.standing.alliance_mut())
        {
            if let Some(&allied) = self.allied.get(&alliance.player_id) {
                alliance.allied = allied;
            }
            if let Some(&shared) = self.vision.get(&alliance.player_id) {
                alliance.vision = shared;
            }
        }
        if let Some(shared) = self.allied_victory {
            view.allied_victory = shared;
        }
        Cow::Owned(view)
    }

    /// Takes the staged changes as the actions that carry them out, leaving the draft empty.
    ///
    /// Alliances come ahead of allied victory: a new ally takes the level the player gives every
    /// ally, so the victory setting has to land after them to reach them.
    pub fn take_actions(&mut self) -> Vec<AlliancesAction> {
        let draft = std::mem::take(self);
        let allied = draft
            .allied
            .into_iter()
            .map(|(player_id, allied)| AlliancesAction::SetAllied { player_id, allied });
        let victory = draft.allied_victory.map(AlliancesAction::SetAlliedVictory);
        let vision = draft
            .vision
            .into_iter()
            .map(|(player_id, shared)| AlliancesAction::SetSharedVision { player_id, shared });
        allied.chain(victory).chain(vision).collect()
    }
}

/// A menu open on the screen.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AlliancesMenu {
    /// What can be done about one person beyond this game.
    Player { user_id: u32 },
    /// Why the player is reporting one person, which the player menu leads to.
    Report { user_id: u32 },
    /// Where the player's chat goes.
    ChatTarget,
}

/// What the player did with the screen this frame.
#[derive(Default)]
pub struct AlliancesOutcome {
    pub actions: Vec<AlliancesAction>,
    /// The menu the screen should have open from the next frame, where that changed this frame.
    pub menu: Option<Option<AlliancesMenu>>,
    /// Whether the player asked for the screen to close, dropping any staged changes.
    pub done: bool,
    /// Whether the player asked for the staged changes to be applied and the screen closed.
    pub apply: bool,
    /// Where the open menu was drawn. A menu hangs off its control and can reach past the dialog's
    /// edge, so the host has to know it takes the pointer there too.
    pub menu_rect: Option<Rect>,
}

/// Renders the screen, with `menu` open over it. `staged` is whether `view` shows changes that are
/// waiting to be applied, which decides how the screen can be closed.
pub fn render_alliances_view(
    view: &AlliancesView,
    ctx: &egui::Context,
    menu: Option<AlliancesMenu>,
    staged: bool,
) -> tiers::DialogResponse<AlliancesOutcome> {
    tiers::tier2_dialog(
        ctx,
        Id::new("sb_alliances"),
        tiers::dialog_outer_width(CONTENT_WIDTH),
        |ui| {
            let mut outcome = AlliancesOutcome::default();
            tiers::dialog_header(ui, |ui| draw_header(ui, view, &mut outcome));
            let anchors = tiers::dialog_body(ui, |ui| draw_table(ui, view, menu, &mut outcome));
            let chat_anchor = tiers::dialog_footer_ruled(ui, |ui| {
                draw_footer(ui, view, menu, staged, &mut outcome)
            });
            match menu {
                Some(AlliancesMenu::Player { user_id } | AlliancesMenu::Report { user_id }) => {
                    let player = view
                        .players
                        .iter()
                        .find(|player| player.user_id == Some(user_id));
                    let anchor = anchors.iter().find(|(id, _)| *id == user_id);
                    match (player, anchor, menu) {
                        (Some(player), Some(&(_, anchor)), Some(AlliancesMenu::Player { .. })) => {
                            draw_player_menu(ui.ctx(), player, user_id, anchor, &mut outcome)
                        }
                        (Some(_), Some(&(_, anchor)), _) => {
                            draw_report_menu(ui.ctx(), user_id, anchor, &mut outcome)
                        }
                        // The person it was open for is no longer listed.
                        _ => outcome.menu = Some(None),
                    }
                }
                Some(AlliancesMenu::ChatTarget) => {
                    draw_chat_menu(ui.ctx(), view, chat_anchor, &mut outcome)
                }
                None => {}
            }
            outcome
        },
    )
}

/// The header: the title, and the button that mutes everyone at once.
fn draw_header(ui: &mut Ui, view: &AlliancesView, outcome: &mut AlliancesOutcome) {
    let width = ui.available_width();
    ui.horizontal(|ui| {
        ui.set_width(width);
        tiers::dialog_title(ui, &tr!("alliances.title", "Alliances & chat"));
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            let mut people = view
                .players
                .iter()
                .filter(|player| player.user_id.is_some())
                .peekable();
            if people.peek().is_none() {
                return;
            }
            let all_muted = people.all(|player| player.muted);
            let label = match all_muted {
                true => tr!("alliances.unmuteAll", "Unmute all"),
                false => tr!("alliances.muteAll", "Mute all"),
            };
            let glyph = match all_muted {
                true => Glyph::Speaker,
                false => Glyph::SpeakerMuted,
            };
            if mute_all_button(ui, &label, glyph).clicked() {
                outcome
                    .actions
                    .push(AlliancesAction::SetAllMuted(!all_muted));
            }
        });
    });
}

/// A quiet outlined button with a glyph in front of its label, for the header's one action.
fn mute_all_button(ui: &mut Ui, label: &str, glyph: Glyph) -> egui::Response {
    let spec = text::button_label(MUTE_ALL_LABEL_SIZE)
        .with_letter_spacing(1.0)
        .with_color(GREY_BLUE80);
    let galley = spec.galley(ui, label);
    let glyph_size = 14.0;
    let pad = 14.0;
    let width = pad * 2.0 + glyph_size + theme::SPACE_SM + galley.size().x;
    let (rect, response) = ui.allocate_exact_size(vec2(width, MUTE_ALL_HEIGHT), Sense::click());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    let color = if response.hovered() {
        theme::TEXT_PRIMARY
    } else {
        GREY_BLUE80
    };
    ui.painter().add(egui::Shape::rect_stroke(
        rect,
        corner_radius,
        egui::Stroke::new(
            theme::HAIRLINE,
            theme::alpha(BLUE70, if response.hovered() { 0.8 } else { 0.45 }),
        ),
        egui::StrokeKind::Inside,
    ));
    widgets::paint_glyph(
        ui.painter(),
        Rect::from_min_size(
            pos2(rect.left() + pad, rect.center().y - glyph_size * 0.5),
            Vec2::splat(glyph_size),
        ),
        glyph,
        color,
    );
    ui.painter().galley(
        pos2(
            rect.left() + pad + glyph_size + theme::SPACE_SM,
            rect.center().y - galley.size().y * 0.5,
        ),
        galley,
        color,
    );
    response
}

/// The table of everyone else in the game. Returns where each person's menu button is, which is
/// what their menus hang off.
fn draw_table(
    ui: &mut Ui,
    view: &AlliancesView,
    menu: Option<AlliancesMenu>,
    outcome: &mut AlliancesOutcome,
) -> Vec<(u32, Rect)> {
    let mut anchors = Vec::new();
    draw_column_labels(ui);
    if view.players.is_empty() {
        ui.add_space(theme::SPACE_LG);
        ui.vertical_centered(|ui| {
            ui.label(
                text::body(13.5, BodyWeight::Regular)
                    .with_color(theme::TEXT_LABEL)
                    .job(&tr!("alliances.empty", "Nobody else is in this game")),
            );
        });
        ui.add_space(theme::SPACE_LG);
        return anchors;
    }
    let divided = observer::teams_worth_dividing(view.players.iter().map(|player| player.team));
    let mut team = view.players[0].team;
    for (index, player) in view.players.iter().enumerate() {
        if divided && team != player.team {
            ui.add_space(theme::SPACE_SM);
            team_rule(ui);
            ui.add_space(theme::SPACE_SM);
        }
        team = player.team;
        let menu_open = player.user_id.is_some_and(|user_id| {
            matches!(
                menu,
                Some(AlliancesMenu::Player { user_id: open } | AlliancesMenu::Report { user_id: open })
                    if open == user_id
            )
        });
        let more = ui
            .push_id(("sb_alliances_row", index), |ui| {
                draw_row(ui, view, player, menu_open, outcome)
            })
            .inner;
        if let (Some(user_id), Some(more)) = (player.user_id, more) {
            anchors.push((user_id, more));
        }
    }
    anchors
}

/// Where each of a row's columns is.
struct Columns {
    player: Rect,
    ally: Rect,
    vision: Rect,
    mute: Rect,
    more: Rect,
}

impl Columns {
    fn of(row: Rect) -> Columns {
        let mut left = row.left();
        let mut next = |width: f32| {
            let column = Rect::from_min_size(pos2(left, row.top()), vec2(width, row.height()));
            left += width + COLUMN_GAP;
            column
        };
        Columns {
            player: next(PLAYER_WIDTH),
            ally: next(ALLY_WIDTH),
            vision: next(VISION_WIDTH),
            mute: next(MUTE_WIDTH),
            more: next(MORE_WIDTH),
        }
    }
}

fn draw_column_labels(ui: &mut Ui) {
    let spec = text::column_label().with_color(GREY_BLUE60);
    let height = spec.row_height(ui);
    let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, height), Sense::hover());
    let columns = Columns::of(row);
    for (rect, label, align) in [
        (
            columns.player,
            tr!("alliances.columnPlayer", "Player"),
            Align::Min,
        ),
        (
            columns.ally,
            tr!("alliances.columnAlly", "Ally"),
            Align::Center,
        ),
        (
            columns.vision,
            tr!("alliances.columnVision", "Vision"),
            Align::Center,
        ),
        (
            columns.mute,
            tr!("alliances.columnMute", "Mute"),
            Align::Center,
        ),
    ] {
        let galley = spec.layout(ui.ctx(), spec.job_truncated(&label, rect.width()));
        let x = match align {
            Align::Min => rect.left(),
            _ => rect.center().x - galley.size().x * 0.5,
        };
        ui.painter().galley(pos2(x, rect.top()), galley, spec.color);
    }
    ui.add_space(theme::SPACE_XS + 2.0);
}

/// Draws one player's row, and returns where its menu button is, for a person who has one.
fn draw_row(
    ui: &mut Ui,
    view: &AlliancesView,
    player: &AlliancePlayerView,
    menu_open: bool,
    outcome: &mut AlliancesOutcome,
) -> Option<Rect> {
    let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, ROW_HEIGHT), Sense::hover());
    // The row the pointer is over, or whose menu is open, is lit, so it is plain whose settings a
    // control at the far end of it changes. Painted first, to sit under everything in the row.
    let lit_rect = row.expand2(vec2(tiers::DIALOG_SIDE_PAD, 0.0));
    if menu_open || ui.rect_contains_pointer(lit_rect) {
        ui.painter()
            .rect_filled(lit_rect, 0.0, theme::HOVER_OVERLAY);
    }
    let columns = Columns::of(row);
    draw_player_cell(ui, columns.player, player);
    let status = match player.standing {
        PlayerStanding::Allyable(_) | PlayerStanding::Fixed => None,
        PlayerStanding::Defeated => Some(tr!("alliances.defeated", "defeated")),
        PlayerStanding::Left => Some(tr!("alliances.left", "left the game")),
    };
    if let Some(status) = status {
        // Someone out of the game has no alliance left to set, so their status takes the place of
        // the switches.
        observer::paint_text(
            ui,
            columns.ally.union(columns.vision),
            &text::body(STATUS_SIZE, BodyWeight::Regular).with_color(GREY_BLUE60),
            &status,
            Align::Center,
        );
    }
    if let PlayerStanding::Allyable(alliance) = player.standing {
        let mut allied = alliance.allied;
        if centered(
            ui,
            columns.ally,
            widgets::SWITCH_SIZE,
            !view.alliances_open,
            |ui| {
                ui.push_id("ally", |ui| widgets::switch(ui, &mut allied))
                    .inner
            },
        )
        .changed()
        {
            outcome.actions.push(AlliancesAction::SetAllied {
                player_id: alliance.player_id,
                allied,
            });
        }
        let mut vision = alliance.vision;
        if centered(
            ui,
            columns.vision,
            widgets::SWITCH_SIZE,
            !view.alliances_open,
            |ui| {
                ui.push_id("vision", |ui| widgets::switch(ui, &mut vision))
                    .inner
            },
        )
        .changed()
        {
            outcome.actions.push(AlliancesAction::SetSharedVision {
                player_id: alliance.player_id,
                shared: vision,
            });
        }
    }
    player.user_id.map(|user_id| {
        let button_size = Vec2::splat(widgets::ICON_BUTTON_SIZE);
        let (glyph, state) = match player.muted {
            true => (Glyph::SpeakerMuted, IconButtonState::Raised),
            false => (Glyph::Speaker, IconButtonState::Rest),
        };
        if centered(ui, columns.mute, button_size, false, |ui| {
            widgets::icon_button(ui, glyph, state)
        })
        .clicked()
        {
            outcome.actions.push(AlliancesAction::SetMuted {
                user_id,
                muted: !player.muted,
            });
        }
        let more_state = match menu_open {
            true => IconButtonState::Open,
            false => IconButtonState::Rest,
        };
        let more = centered(ui, columns.more, button_size, false, |ui| {
            widgets::icon_button(ui, Glyph::More, more_state)
        });
        if more.clicked() {
            outcome.menu = Some(match menu_open {
                true => None,
                false => Some(AlliancesMenu::Player { user_id }),
            });
        }
        more.rect
    })
}

/// The rule between one team's rows and the next. Players within a team sit unruled, so the teams
/// read as the table's groups.
fn team_rule(ui: &mut Ui) {
    let (rect, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, theme::HAIRLINE), Sense::hover());
    ui.painter().line_segment(
        [
            pos2(rect.left(), rect.center().y),
            pos2(rect.right(), rect.center().y),
        ],
        egui::Stroke::new(theme::HAIRLINE, theme::alpha(BLUE70, 0.30)),
    );
}

/// Lays a control `size` big out in the middle of `rect`, disabled where `disabled` says. The
/// control is placed rather than laid out, so it sits exactly under its column's label whatever the
/// layout around it would have done with the spare room.
fn centered<R>(
    ui: &mut Ui,
    rect: Rect,
    size: Vec2,
    disabled: bool,
    add: impl FnOnce(&mut Ui) -> R,
) -> R {
    ui.scope_builder(
        UiBuilder::new().max_rect(Rect::from_center_size(rect.center(), size)),
        |ui| {
            widgets::set_disabled(ui, disabled);
            add(ui)
        },
    )
    .inner
}

/// The player's color swatch and race initial, their name, and the tags for what the player has
/// done about them beyond this game.
fn draw_player_cell(ui: &mut Ui, rect: Rect, player: &AlliancePlayerView) {
    let painter = ui.painter();
    let mut left = rect.left();
    observer::paint_player_swatch(
        ui,
        Rect::from_min_size(
            pos2(left, rect.center().y - SWATCH_SIZE * 0.5),
            Vec2::splat(SWATCH_SIZE),
        ),
        player.color,
        1.0,
    );
    left += SWATCH_SIZE + CELL_GAP;
    observer::paint_text(
        ui,
        Rect::from_min_size(
            pos2(left, rect.top()),
            vec2(RACE_INITIAL_WIDTH, rect.height()),
        ),
        &text::body(RACE_INITIAL_SIZE, BodyWeight::Medium).with_color(theme::TEXT_SECONDARY),
        &race_initial(player.race),
        Align::Center,
    );
    left += RACE_INITIAL_WIDTH + CELL_GAP;

    // What follows the name is laid out first, from the right, so a long name gives way to it. The
    // cell keeps clear of the switches beside it, which a tag set against them would read as part of.
    let mut right = rect.right() - CELL_END_GAP;
    let danger = TagStyle::Hue {
        color: theme::TEXT_DANGER,
        filled: false,
    };
    let mut trailing = Vec::new();
    match player.report {
        ReportState::None => {}
        ReportState::Sending => trailing.push((
            tr!("alliances.reportingTag", "Reporting"),
            TagStyle::Neutral,
        )),
        ReportState::Sent => trailing.push((tr!("alliances.reportedTag", "Reported"), danger)),
        ReportState::Failed => trailing.push((
            tr!("alliances.reportFailedTag", "Report failed"),
            TagStyle::Hue {
                color: theme::TEXT_DANGER,
                filled: true,
            },
        )),
    }
    // Muting has no tag: the mute button in the same row already shows it.
    if player.blocked {
        trailing.push((tr!("alliances.blockedTag", "Blocked"), danger));
    }
    let tag_rects = trailing
        .iter()
        .map(|(label, style)| {
            let job = text::column_label().job(label);
            let width =
                ui.ctx().fonts_mut(|fonts| fonts.layout_job(job)).size().x + theme::SPACE_MD;
            let tag = Rect::from_min_size(
                pos2(
                    right - width,
                    rect.center().y - widgets::tag_height(ui) * 0.5,
                ),
                vec2(width, widgets::tag_height(ui)),
            );
            right = tag.left() - theme::SPACE_SM;
            (tag, label, *style)
        })
        .collect::<Vec<_>>();
    let dimmed = player.muted || player.blocked || player.standing == PlayerStanding::Left;
    let name_color = if dimmed {
        GREY_BLUE70
    } else {
        theme::TEXT_PRIMARY
    };
    let name_job = text::player_name(NAME_SIZE)
        .with_color(name_color)
        .job_truncated(&player.name, (right - left).max(0.0));
    let name = ui.ctx().fonts_mut(|fonts| fonts.layout_job(name_job));
    painter.galley(
        pos2(left, rect.center().y - name.size().y * 0.5),
        name,
        name_color,
    );
    for (tag, label, style) in tag_rects {
        ui.scope_builder(UiBuilder::new().max_rect(tag), |ui| {
            widgets::tag_sized(ui, label, style, tag.width());
        });
    }
}

/// A race's one-character tag, matching the ones StarCraft's own alliance dialog shows.
fn race_initial(race: RaceView) -> String {
    match race {
        RaceView::Zerg => tr!("alliances.raceInitialZerg", "Z"),
        RaceView::Terran => tr!("alliances.raceInitialTerran", "T"),
        RaceView::Protoss => tr!("alliances.raceInitialProtoss", "P"),
        RaceView::Random => tr!("alliances.raceInitialRandom", "?"),
    }
}

/// The footer: where the player's chat goes and whether allies share a victory on one line, and the
/// way out under them: one button with nothing `staged`, and a choice between dropping and applying
/// the staged changes otherwise. Returns where the chat target's dropdown is.
fn draw_footer(
    ui: &mut Ui,
    view: &AlliancesView,
    menu: Option<AlliancesMenu>,
    staged: bool,
    outcome: &mut AlliancesOutcome,
) -> Rect {
    let width = ui.available_width();
    let label_spec = text::column_label().with_color(GREY_BLUE60);
    let dropdown = ui
        .allocate_ui_with_layout(
            vec2(width, theme::HIT_DIALOG),
            Layout::left_to_right(Align::Center),
            |ui| {
                ui.set_width(width);
                ui.spacing_mut().item_spacing.x = theme::SPACE_MD;
                ui.label(label_spec.job(&tr!("alliances.sendChatTo", "Send chat to")));
                let open = menu == Some(AlliancesMenu::ChatTarget);
                let current = view
                    .chat_targets
                    .iter()
                    .find(|option| option.choice == view.chat_target)
                    .map_or_else(
                        || tr!("alliances.chatAll", "All players"),
                        ChatTargetOption::label,
                    );
                let dropdown = widgets::dropdown_button(ui, &current, CHAT_TARGET_MIN_WIDTH, open);
                if dropdown.clicked() {
                    outcome.menu = Some(match open {
                        true => None,
                        false => Some(AlliancesMenu::ChatTarget),
                    });
                }
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    ui.spacing_mut().item_spacing.x = theme::SPACE_MD;
                    let mut allied_victory = view.allied_victory;
                    let switched = ui
                        .scope(|ui| {
                            widgets::set_disabled(ui, !view.alliances_open);
                            widgets::switch(ui, &mut allied_victory)
                        })
                        .inner;
                    if switched.changed() {
                        outcome
                            .actions
                            .push(AlliancesAction::SetAlliedVictory(allied_victory));
                    }
                    ui.label(label_spec.job(&tr!("alliances.alliedVictory", "Allied victory")));
                });
                dropdown.rect
            },
        )
        .inner;
    ui.add_space(theme::SPACE_LG);
    if staged {
        // The two buttons sit either side of the middle, where the one button stands otherwise.
        let row = ui
            .allocate_space(vec2(ui.available_width(), theme::HIT_DIALOG))
            .1;
        let half_gap = theme::SPACE_SM / 2.0;
        let middle = row.center().x;
        let left = Rect::from_min_max(row.min, pos2(middle - half_gap, row.max.y));
        let right = Rect::from_min_max(pos2(middle + half_gap, row.min.y), row.max);
        ui.scope_builder(
            UiBuilder::new()
                .max_rect(left)
                .layout(Layout::right_to_left(Align::Center)),
            |ui| {
                let discard = tr!("alliances.discardChanges", "Discard");
                outcome.done =
                    widgets::button_with_kbd(ui, &discard, ButtonVariant::Tier2, DONE_KEY)
                        .clicked();
            },
        );
        ui.scope_builder(
            UiBuilder::new()
                .max_rect(right)
                .layout(Layout::left_to_right(Align::Center)),
            |ui| {
                let apply = tr!("alliances.applyChanges", "Apply");
                let apply =
                    widgets::button_with_kbd(ui, &apply, ButtonVariant::Tier2Primary, APPLY_KEY);
                widgets::default_focus(&apply);
                outcome.apply = apply.clicked();
            },
        );
    } else {
        ui.vertical_centered(|ui| {
            let done = widgets::button_with_kbd(
                ui,
                &tr!("common.done", "Done"),
                ButtonVariant::Tier2,
                DONE_KEY,
            );
            widgets::default_focus(&done);
            outcome.done = done.clicked();
        });
    }
    dropdown
}

/// The menu of what can be done about one person beyond this game.
fn draw_player_menu(
    ctx: &egui::Context,
    player: &AlliancePlayerView,
    user_id: u32,
    anchor: Rect,
    outcome: &mut AlliancesOutcome,
) {
    let menu = widgets::popup_menu(
        ctx,
        Id::new(("sb_alliances_player_menu", user_id)),
        anchor,
        MenuSide::Below,
        Align::Max,
        PLAYER_MENU_WIDTH,
        |ui| {
            let block_label = match player.blocked {
                true => tr!("alliances.unblock", "Unblock {{name}}", name = &player.name),
                false => tr!("alliances.block", "Block {{name}}", name = &player.name),
            };
            if MenuRow::new(&block_label)
                .glyph(Glyph::Block)
                .show(ui)
                .clicked()
            {
                return Some(PlayerMenuChoice::Act(AlliancesAction::SetBlocked {
                    user_id,
                    blocked: !player.blocked,
                }));
            }
            // A report already on its way, or received, is not filed twice.
            let (report_label, report_tone, can_report) = match player.report {
                ReportState::Sending => (
                    tr!("alliances.reportSending", "Sending report…"),
                    MenuTone::Dim,
                    false,
                ),
                ReportState::Sent => (
                    tr!("alliances.reportSent", "Reported"),
                    MenuTone::Dim,
                    false,
                ),
                ReportState::None | ReportState::Failed => (
                    tr!("alliances.report", "Report player"),
                    MenuTone::Danger,
                    true,
                ),
            };
            let clicked = MenuRow::new(&report_label)
                .tone(report_tone)
                .glyph(Glyph::Flag)
                .show(ui)
                .clicked();
            (clicked && can_report).then_some(PlayerMenuChoice::Report)
        },
    );
    outcome.menu_rect = Some(menu.rect);
    match menu.inner {
        Some(PlayerMenuChoice::Act(action)) => {
            outcome.actions.push(action);
            outcome.menu = Some(None);
        }
        Some(PlayerMenuChoice::Report) => {
            outcome.menu = Some(Some(AlliancesMenu::Report { user_id }));
        }
        None if menu.clicked_outside && outcome.menu.is_none() => outcome.menu = Some(None),
        None => {}
    }
}

/// What the player chose from a person's menu.
enum PlayerMenuChoice {
    Act(AlliancesAction),
    /// The report entry, which leads on to why.
    Report,
}

/// The menu of why the player is reporting someone, which takes the place of their player menu.
fn draw_report_menu(
    ctx: &egui::Context,
    user_id: u32,
    anchor: Rect,
    outcome: &mut AlliancesOutcome,
) {
    let menu = widgets::popup_menu(
        ctx,
        Id::new(("sb_alliances_report_menu", user_id)),
        anchor,
        MenuSide::Below,
        Align::Max,
        PLAYER_MENU_WIDTH,
        |ui| {
            ui.add_space(theme::SPACE_SM);
            ui.horizontal(|ui| {
                ui.add_space(12.0);
                ui.label(
                    text::column_label()
                        .with_color(GREY_BLUE60)
                        .job(&tr!("alliances.reportFor", "Report for")),
                );
            });
            ui.add_space(theme::SPACE_XS);
            let mut picked = None;
            for reason in ReportReason::ALL {
                let label = reason.label();
                if ui
                    .push_id(("sb_report_reason", reason), |ui| {
                        MenuRow::new(&label).show(ui)
                    })
                    .inner
                    .clicked()
                {
                    picked = Some(reason);
                }
            }
            picked
        },
    );
    outcome.menu_rect = Some(menu.rect);
    if let Some(reason) = menu.inner {
        outcome
            .actions
            .push(AlliancesAction::Report { user_id, reason });
        outcome.menu = Some(None);
    } else if menu.clicked_outside && outcome.menu.is_none() {
        outcome.menu = Some(None);
    }
}

/// The menu of where the player's chat goes, opening upwards from the footer.
fn draw_chat_menu(
    ctx: &egui::Context,
    view: &AlliancesView,
    anchor: Rect,
    outcome: &mut AlliancesOutcome,
) {
    let menu = widgets::popup_menu(
        ctx,
        Id::new("sb_alliances_chat_menu"),
        anchor,
        MenuSide::Above,
        Align::Min,
        CHAT_MENU_WIDTH,
        |ui| {
            let mut picked = None;
            let mut ruled = false;
            for option in &view.chat_targets {
                // Everyone and the allies come first, ruled off from the people one by one.
                let personal = matches!(option.choice, ChatTargetChoice::Recipient(_));
                if personal && !ruled {
                    widgets::menu_separator(ui);
                    ruled = true;
                }
                let muted_note = tr!("alliances.mutedNote", "muted");
                let label = option.label();
                let mut row = MenuRow::new(&label)
                    .compact()
                    .selected(option.choice == view.chat_target);
                if let Some(color) = option.color {
                    row = row.bar(color);
                }
                if option.muted {
                    row = row.tone(MenuTone::Dim).note(&muted_note);
                }
                if ui
                    .push_id(("sb_chat_target", option.choice), |ui| row.show(ui))
                    .inner
                    .clicked()
                {
                    picked = Some(option.choice);
                }
            }
            picked
        },
    );
    outcome.menu_rect = Some(menu.rect);
    if let Some(choice) = menu.inner {
        outcome.actions.push(AlliancesAction::SetChatTarget(choice));
        outcome.menu = Some(None);
    } else if menu.clicked_outside && outcome.menu.is_none() {
        outcome.menu = Some(None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_ctx() -> egui::Context {
        let ctx = egui::Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        ctx
    }

    fn player(user_id: u32, name: &str) -> AlliancePlayerView {
        AlliancePlayerView {
            team: 0,
            user_id: Some(user_id),
            name: name.to_string(),
            color: theme::player_color(user_id as usize),
            race: RaceView::Zerg,
            standing: PlayerStanding::Allyable(AllianceState {
                player_id: user_id as u8,
                allied: false,
                vision: false,
            }),
            muted: false,
            blocked: false,
            report: ReportState::None,
        }
    }

    fn computer(name: &str) -> AlliancePlayerView {
        AlliancePlayerView {
            user_id: None,
            standing: PlayerStanding::Fixed,
            ..player(0, name)
        }
    }

    fn view(players: Vec<AlliancePlayerView>) -> AlliancesView {
        AlliancesView {
            players,
            alliances_open: true,
            allied_victory: false,
            chat_target: ChatTargetChoice::All,
            chat_targets: vec![ChatTargetOption {
                choice: ChatTargetChoice::All,
                recipient: None,
                color: None,
                muted: false,
            }],
        }
    }

    /// Runs one pass of the screen and returns its outcome and on-screen width.
    fn render(
        ctx: &egui::Context,
        view: &AlliancesView,
        menu: Option<AlliancesMenu>,
    ) -> (AlliancesOutcome, f32) {
        let raw = egui::RawInput {
            screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(1920.0, 1080.0))),
            ..Default::default()
        };
        ctx.begin_pass(raw);
        let dialog = render_alliances_view(view, ctx, menu, false);
        let width = dialog.response.rect.width();
        let mut out = ctx.end_pass();
        let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
        // Layout checks have no GPU texture store to update.
        out.textures_delta.clear();
        (dialog.inner, width)
    }

    fn settled_width(
        ctx: &egui::Context,
        view: &AlliancesView,
        menu: Option<AlliancesMenu>,
    ) -> f32 {
        let mut width = 0.0;
        for _ in 0..4 {
            width = render(ctx, view, menu).1;
        }
        width
    }

    /// The table is a grid: nothing a row holds, however long a name or however many tags, may
    /// widen the dialog and pull every column out of line.
    #[test]
    fn the_dialog_is_the_same_width_whatever_its_rows_hold() {
        let ctx = fresh_ctx();
        let baseline = settled_width(&ctx, &view(vec![player(1, "a")]), None);
        let mut long = player(2, &"an-extremely-long-player-name".repeat(4));
        long.muted = true;
        long.blocked = true;
        long.report = ReportState::Failed;
        long.standing = PlayerStanding::Left;
        let busy = view(vec![player(1, "a"), long, computer("Computer")]);
        assert_eq!(settled_width(&ctx, &busy, None), baseline);
        for menu in [
            AlliancesMenu::Player { user_id: 2 },
            AlliancesMenu::Report { user_id: 2 },
            AlliancesMenu::ChatTarget,
        ] {
            assert_eq!(settled_width(&ctx, &busy, Some(menu)), baseline);
        }
    }

    /// The overlay is never drawn smaller than one point per pixel, so a 720-line screen is 720
    /// points tall, and everyone else in an eight player game has to fit on it with the dialog
    /// clear of the screen's edges.
    #[test]
    fn an_eight_player_game_fits_a_720_line_screen() {
        let ctx = fresh_ctx();
        let others = view((1..=7).map(|id| player(id, "player")).collect());
        for _ in 0..4 {
            render(&ctx, &others, None);
        }
        let height = ctx
            .memory(|memory| memory.area_rect(Id::new("sb_alliances")))
            .expect("the dialog was drawn")
            .height();
        assert!(
            height <= 720.0 - tiers::CENTERED_MIN_MARGIN * 2.0,
            "the dialog is {height} points tall"
        );
    }

    /// A menu left open for someone the screen no longer lists closes rather than hanging off
    /// nothing.
    #[test]
    fn a_menu_for_someone_no_longer_listed_closes() {
        let ctx = fresh_ctx();
        for menu in [
            AlliancesMenu::Player { user_id: 9 },
            AlliancesMenu::Report { user_id: 9 },
        ] {
            let (outcome, _) = render(&ctx, &view(vec![player(1, "a")]), Some(menu));
            assert_eq!(outcome.menu, Some(None));
        }
    }

    fn diplomacy_view() -> AlliancesView {
        let player = |player_id: u8, allied: bool| AlliancePlayerView {
            team: 0,
            user_id: Some(u32::from(player_id)),
            name: format!("player {player_id}"),
            color: Color32::WHITE,
            race: RaceView::Random,
            standing: PlayerStanding::Allyable(AllianceState {
                player_id,
                allied,
                vision: false,
            }),
            muted: false,
            blocked: false,
            report: ReportState::None,
        };
        AlliancesView {
            players: vec![player(1, false), player(2, true)],
            alliances_open: true,
            allied_victory: false,
            chat_target: ChatTargetChoice::All,
            chat_targets: Vec::new(),
        }
    }

    /// What the game shares with other players waits for the player to apply it; what is theirs
    /// alone goes through at once.
    #[test]
    fn the_draft_holds_only_what_the_game_shares() {
        let mut draft = AlliancesDraft::default();
        let ally = AlliancesAction::SetAllied {
            player_id: 1,
            allied: true,
        };
        assert_eq!(draft.stage(ally), None);
        assert_eq!(draft.stage(AlliancesAction::SetAlliedVictory(true)), None);
        let mute = AlliancesAction::SetMuted {
            user_id: 1,
            muted: true,
        };
        assert_eq!(draft.stage(mute), Some(mute));
        let view = diplomacy_view();
        let shown = draft.applied_to(&view);
        assert!(shown.players[0].standing.alliance().unwrap().allied);
        assert!(shown.allied_victory);
        // Alliances go ahead of the victory setting, so a new ally shares it.
        assert_eq!(
            draft.take_actions(),
            [ally, AlliancesAction::SetAlliedVictory(true)]
        );
        assert!(draft.is_empty());
    }

    /// A switch moved and moved back again is no change, and neither is one the game already holds.
    #[test]
    fn the_draft_drops_what_the_game_already_holds() {
        let view = diplomacy_view();
        let mut draft = AlliancesDraft::default();
        draft.stage(AlliancesAction::SetAllied {
            player_id: 2,
            allied: false,
        });
        draft.stage(AlliancesAction::SetAllied {
            player_id: 2,
            allied: true,
        });
        draft.stage(AlliancesAction::SetSharedVision {
            player_id: 7,
            shared: true,
        });
        draft.settle(&view);
        assert!(draft.is_empty());
        assert!(matches!(draft.applied_to(&view), Cow::Borrowed(_)));
    }

    /// A game that closes its alliances leaves nothing to apply.
    #[test]
    fn closed_alliances_empty_the_draft() {
        let mut view = diplomacy_view();
        let mut draft = AlliancesDraft::default();
        draft.stage(AlliancesAction::SetAlliedVictory(true));
        view.alliances_open = false;
        draft.settle(&view);
        assert!(draft.is_empty());
    }
}
