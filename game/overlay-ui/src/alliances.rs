//! The alliances and chat screen: who the player is allied with and shares vision with, whose chat
//! they hear, and who their own chat goes to. It stands in for SC:R's alliance and message filter
//! dialogs, which split those across two screens.
//!
//! A table of the other people in the game reads across each person: who they are, then the two
//! things the player sets with them through the game (alliance, vision), then the two that are the
//! player's alone (mute, and a menu of what goes further than this game: blocking, reporting, their
//! profile). The footer holds what is set once for the whole game rather than per person: where the
//! player's chat goes, and whether allies share a victory. Like every screen here, it is a pure fn
//! of [`AlliancesView`] plus an [`egui::Context`].

use egui::{Align, Color32, Id, Layout, Rect, Sense, Ui, UiBuilder, Vec2, pos2, vec2};

use crate::colors::{GREY_BLUE60, GREY_BLUE70, GREY_BLUE80};
use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets::{
    self, ButtonVariant, Glyph, IconButtonState, MenuRow, MenuSide, MenuTone, TagStyle,
};
use crate::kit::{theme, tiers};
use crate::observer::{self, RaceView};
use crate::tr;

/// How wide the dialog's contents are, in overlay points.
const CONTENT_WIDTH: f32 = 704.0;

/// The table's fixed columns, and the gap between two columns. The player's column takes the rest.
const ALLY_WIDTH: f32 = 96.0;
const VISION_WIDTH: f32 = 96.0;
const MUTE_WIDTH: f32 = 72.0;
const MORE_WIDTH: f32 = 56.0;
const COLUMN_GAP: f32 = 8.0;
const PLAYER_WIDTH: f32 =
    CONTENT_WIDTH - ALLY_WIDTH - VISION_WIDTH - MUTE_WIDTH - MORE_WIDTH - COLUMN_GAP * 4.0;
const _: () = assert!(PLAYER_WIDTH > 200.0);

/// A row of the table: its controls, and the room above and below them.
const ROW_HEIGHT: f32 = 58.0;

/// The pieces of a player's cell, left to right.
const BAR_SIZE: Vec2 = vec2(4.0, 17.0);
const RACE_CHIP_SIZE: f32 = 24.0;
const NAME_SIZE: f32 = 17.0;
const CELL_GAP: f32 = 10.0;
const NOTE_SIZE: f32 = 12.5;
const CELL_END_GAP: f32 = 16.0;

/// The header's mute-everyone button.
const MUTE_ALL_HEIGHT: f32 = 32.0;
const MUTE_ALL_LABEL_SIZE: f32 = 12.0;

/// How wide each menu is.
const PLAYER_MENU_WIDTH: f32 = 250.0;
const CHAT_MENU_WIDTH: f32 = 230.0;

/// The narrowest the chat target's dropdown gets, so choosing a short name does not shift the
/// footer under the pointer.
const CHAT_TARGET_MIN_WIDTH: f32 = 140.0;

/// The size of the notes under the footer.
const FOOTNOTE_SIZE: f32 = 12.0;

/// The key that closes the screen, as its keycap names it.
pub const DONE_KEY: &str = "Esc";

/// What the screen shows of one other person in the game.
#[derive(Clone, PartialEq, Debug)]
pub struct AlliancePlayerView {
    /// Their ShieldBattery account, which is what mute, block and report are kept against.
    pub user_id: u32,
    pub name: String,
    /// Their color on the map.
    pub color: Color32,
    pub race: RaceView,
    /// What the player has set with them through the game, where there is anything to set: a
    /// teammate sharing the player's own units, or someone out of the game, has none.
    pub alliance: Option<AllianceState>,
    /// What else the row says about them.
    pub note: Option<PlayerNote>,
    pub muted: bool,
    pub blocked: bool,
    /// Whether the player has asked to report them once the game is over.
    pub report_requested: bool,
}

/// The player's own alliance with someone, as the game holds it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct AllianceState {
    /// The game's own id for them, which alliance and vision are set against.
    pub player_id: u8,
    pub allied: bool,
    pub vision: bool,
}

/// What a row says about someone besides their name.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PlayerNote {
    /// On the player's own team.
    Teammate,
    /// Beaten, and still in the game.
    Defeated,
    /// Gone from the game.
    Left,
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
    /// Everyone else in the game the player could hear, in the game's order.
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
    /// Mutes, or unmutes, everyone the screen lists.
    SetAllMuted(bool),
    SetBlocked {
        user_id: u32,
        blocked: bool,
    },
    /// Asks to report someone once the game is over, which is when a game's reports open.
    Report {
        user_id: u32,
    },
    /// Brings ShieldBattery up on someone's profile.
    ViewProfile {
        user_id: u32,
    },
    SetChatTarget(ChatTargetChoice),
}

/// A menu open on the screen.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AlliancesMenu {
    /// What can be done about one person, beyond this game.
    Player { user_id: u32 },
    /// Where the player's chat goes.
    ChatTarget,
}

/// What the player did with the screen this frame.
#[derive(Default)]
pub struct AlliancesOutcome {
    pub actions: Vec<AlliancesAction>,
    /// The menu the screen should have open from the next frame, where that changed this frame.
    pub menu: Option<Option<AlliancesMenu>>,
    /// Whether the player asked for the screen to close.
    pub done: bool,
}

/// Renders the screen, with `menu` open over it.
pub fn render_alliances_view(
    view: &AlliancesView,
    ctx: &egui::Context,
    menu: Option<AlliancesMenu>,
) -> tiers::DialogResponse<AlliancesOutcome> {
    tiers::tier2_dialog(
        ctx,
        Id::new("sb_alliances"),
        tiers::dialog_outer_width(CONTENT_WIDTH),
        |ui| {
            let mut outcome = AlliancesOutcome::default();
            tiers::dialog_header(ui, |ui| draw_header(ui, view, &mut outcome));
            let anchors = tiers::dialog_body(ui, |ui| draw_table(ui, view, menu, &mut outcome));
            let chat_anchor =
                tiers::dialog_footer_ruled(ui, |ui| draw_footer(ui, view, menu, &mut outcome));
            draw_footnotes(ui, view);
            match menu {
                Some(AlliancesMenu::Player { user_id }) => {
                    let player = view.players.iter().find(|player| player.user_id == user_id);
                    let anchor = anchors.iter().find(|(id, _)| *id == user_id);
                    match (player, anchor) {
                        (Some(player), Some(&(_, anchor))) => {
                            draw_player_menu(ui.ctx(), player, anchor, &mut outcome)
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
            if view.players.is_empty() {
                return;
            }
            let all_muted = view.players.iter().all(|player| player.muted);
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
            theme::alpha(
                crate::colors::BLUE70,
                if response.hovered() { 0.8 } else { 0.45 },
            ),
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

/// The table of everyone else in the game. Returns where each row's menu button is, which is what
/// its menu hangs off.
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
    let last = view.players.len() - 1;
    for (index, player) in view.players.iter().enumerate() {
        let open = menu
            == Some(AlliancesMenu::Player {
                user_id: player.user_id,
            });
        let more = ui
            .push_id(("sb_alliances_row", player.user_id), |ui| {
                draw_row(ui, view, player, open, index != last, outcome)
            })
            .inner;
        anchors.push((player.user_id, more));
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
        let galley = ui
            .ctx()
            .fonts_mut(|fonts| fonts.layout_job(spec.job_truncated(&label, rect.width())));
        let x = match align {
            Align::Min => rect.left(),
            _ => rect.center().x - galley.size().x * 0.5,
        };
        ui.painter().galley(pos2(x, rect.top()), galley, spec.color);
    }
    ui.add_space(theme::SPACE_XS + 2.0);
}

/// Draws one person's row, and returns where its menu button is.
fn draw_row(
    ui: &mut Ui,
    view: &AlliancesView,
    player: &AlliancePlayerView,
    menu_open: bool,
    ruled: bool,
    outcome: &mut AlliancesOutcome,
) -> Rect {
    let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, ROW_HEIGHT), Sense::hover());
    let columns = Columns::of(row);
    draw_player_cell(ui, columns.player, player);
    if let Some(alliance) = player.alliance {
        let mut allied = alliance.allied;
        if centered(ui, columns.ally, !view.alliances_open, |ui| {
            ui.push_id("ally", |ui| widgets::switch(ui, &mut allied))
                .inner
        })
        .changed()
        {
            outcome.actions.push(AlliancesAction::SetAllied {
                player_id: alliance.player_id,
                allied,
            });
        }
        let mut vision = alliance.vision;
        if centered(ui, columns.vision, !view.alliances_open, |ui| {
            ui.push_id("vision", |ui| widgets::switch(ui, &mut vision))
                .inner
        })
        .changed()
        {
            outcome.actions.push(AlliancesAction::SetSharedVision {
                player_id: alliance.player_id,
                shared: vision,
            });
        }
    }
    let (glyph, state) = match player.muted {
        true => (Glyph::SpeakerMuted, IconButtonState::Raised),
        false => (Glyph::Speaker, IconButtonState::Rest),
    };
    if centered(ui, columns.mute, false, |ui| {
        widgets::icon_button(ui, glyph, state)
    })
    .clicked()
    {
        outcome.actions.push(AlliancesAction::SetMuted {
            user_id: player.user_id,
            muted: !player.muted,
        });
    }
    let more_state = match menu_open {
        true => IconButtonState::Open,
        false => IconButtonState::Rest,
    };
    let more = centered(ui, columns.more, false, |ui| {
        widgets::icon_button(ui, Glyph::More, more_state)
    });
    if more.clicked() {
        outcome.menu = Some(match menu_open {
            true => None,
            false => Some(AlliancesMenu::Player {
                user_id: player.user_id,
            }),
        });
    }
    if ruled {
        let y = row.bottom() - theme::HAIRLINE * 0.5;
        ui.painter().line_segment(
            [pos2(row.left(), y), pos2(row.right(), y)],
            egui::Stroke::new(theme::HAIRLINE, theme::alpha(crate::colors::BLUE70, 0.30)),
        );
    }
    more.rect
}

/// Lays `add` out centered in `rect`, disabled where `disabled` says.
fn centered<R>(ui: &mut Ui, rect: Rect, disabled: bool, add: impl FnOnce(&mut Ui) -> R) -> R {
    ui.scope_builder(
        UiBuilder::new()
            .max_rect(rect)
            .layout(Layout::centered_and_justified(egui::Direction::LeftToRight)),
        |ui| {
            widgets::set_disabled(ui, disabled);
            ui.with_layout(
                Layout::left_to_right(Align::Center).with_main_align(Align::Center),
                add,
            )
            .inner
        },
    )
    .inner
}

/// The person themselves: the bar of their color, their race, their name, and what else is worth
/// saying about them.
fn draw_player_cell(ui: &mut Ui, rect: Rect, player: &AlliancePlayerView) {
    let painter = ui.painter();
    let mut left = rect.left();
    observer::paint_player_bar(
        ui,
        Rect::from_min_size(pos2(left, rect.center().y - BAR_SIZE.y * 0.5), BAR_SIZE),
        player.color,
        1.0,
    );
    left += BAR_SIZE.x + CELL_GAP;
    observer::paint_race_chip(
        ui,
        Rect::from_min_size(
            pos2(left, rect.center().y - RACE_CHIP_SIZE * 0.5),
            Vec2::splat(RACE_CHIP_SIZE),
        ),
        player.race,
        1.0,
    );
    left += RACE_CHIP_SIZE + CELL_GAP;

    // What follows the name is laid out first, from the right, so a long name gives way to it. The
    // cell keeps clear of the switches beside it, which a tag set against them would read as part of.
    let mut right = rect.right() - CELL_END_GAP;
    let mut trailing = Vec::new();
    if player.blocked {
        trailing.push((
            tr!("alliances.blockedTag", "Blocked"),
            TagStyle::Hue {
                color: theme::TEXT_DANGER,
                filled: false,
            },
        ));
    } else if player.muted {
        trailing.push((tr!("alliances.mutedTag", "Muted"), TagStyle::Amber));
    }
    let note = player.note.map(|note| match note {
        PlayerNote::Teammate => tr!("alliances.teammate", "teammate"),
        PlayerNote::Defeated => tr!("alliances.defeated", "defeated"),
        PlayerNote::Left => tr!("alliances.left", "left the game"),
    });
    let note_galley = note.map(|note| {
        text::body(NOTE_SIZE, BodyWeight::Regular)
            .with_color(GREY_BLUE60)
            .galley(ui, &note)
    });
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
    let dimmed = player.muted || player.blocked || player.note == Some(PlayerNote::Left);
    let name_color = if dimmed {
        GREY_BLUE70
    } else {
        theme::TEXT_PRIMARY
    };
    let note_width = note_galley
        .as_ref()
        .map_or(0.0, |galley| galley.size().x + CELL_GAP);
    let name_job = text::player_name(NAME_SIZE)
        .with_color(name_color)
        .job_truncated(&player.name, (right - left - note_width).max(0.0));
    let name = ui.ctx().fonts_mut(|fonts| fonts.layout_job(name_job));
    let name_pos = pos2(left, rect.center().y - name.size().y * 0.5);
    let name_right = name_pos.x + name.size().x;
    painter.galley(name_pos, name, name_color);
    if let Some(galley) = note_galley {
        painter.galley(
            pos2(
                name_right + CELL_GAP,
                rect.center().y - galley.size().y * 0.5,
            ),
            galley,
            GREY_BLUE60,
        );
    }
    for (tag, label, style) in tag_rects {
        ui.scope_builder(UiBuilder::new().max_rect(tag), |ui| {
            widgets::tag_sized(ui, label, style, tag.width());
        });
    }
}

/// The footer: where the player's chat goes and whether allies share a victory, which are set once
/// for the whole game, and the way out. Returns where the chat target's dropdown is.
fn draw_footer(
    ui: &mut Ui,
    view: &AlliancesView,
    menu: Option<AlliancesMenu>,
    outcome: &mut AlliancesOutcome,
) -> Rect {
    let width = ui.available_width();
    let label_spec = text::column_label().with_color(GREY_BLUE60);
    ui.allocate_ui_with_layout(
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
            ui.add_space(theme::SPACE_MD);
            ui.label(label_spec.job(&tr!("alliances.alliedVictory", "Allied victory")));
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
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if widgets::button_with_kbd(
                    ui,
                    &tr!("common.done", "Done"),
                    ButtonVariant::Tier2,
                    DONE_KEY,
                )
                .clicked()
                {
                    outcome.done = true;
                }
            });
            dropdown.rect
        },
    )
    .inner
}

/// What the screen's settings last for, under everything else.
fn draw_footnotes(ui: &mut Ui, view: &AlliancesView) {
    let spec = text::body(FOOTNOTE_SIZE, BodyWeight::Regular).with_color(GREY_BLUE60);
    let width = ui.available_width();
    egui::Frame::NONE
        .inner_margin(egui::Margin {
            left: 28,
            right: 28,
            top: 0,
            bottom: 16,
        })
        .show(ui, |ui| {
            ui.set_width(width - 56.0);
            ui.spacing_mut().item_spacing.y = 3.0;
            ui.label(spec.job_wrapped(
                &tr!(
                    "alliances.persistenceNote",
                    "Mute lasts for this game. Blocks are saved to your account, and reports open \
                     in ShieldBattery after the game."
                ),
                width - 56.0,
            ));
            let alliance_note = match view.alliances_open {
                true => tr!(
                    "alliances.changesNote",
                    "Alliance changes take effect immediately. Backstabs are on you."
                ),
                false => tr!(
                    "alliances.lockedNote",
                    "Alliances and shared vision are fixed in this game."
                ),
            };
            ui.label(spec.job_wrapped(&alliance_note, width - 56.0));
        });
}

/// The menu of what can be done about one person beyond this game.
fn draw_player_menu(
    ctx: &egui::Context,
    player: &AlliancePlayerView,
    anchor: Rect,
    outcome: &mut AlliancesOutcome,
) {
    let menu = widgets::popup_menu(
        ctx,
        Id::new(("sb_alliances_player_menu", player.user_id)),
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
                return Some(AlliancesAction::SetBlocked {
                    user_id: player.user_id,
                    blocked: !player.blocked,
                });
            }
            let (report_label, report_tone) = match player.report_requested {
                true => (
                    tr!("alliances.reportRequested", "Reporting after the game"),
                    MenuTone::Dim,
                ),
                false => (tr!("alliances.report", "Report player"), MenuTone::Danger),
            };
            if MenuRow::new(&report_label)
                .tone(report_tone)
                .glyph(Glyph::Flag)
                .show(ui)
                .clicked()
            {
                return Some(AlliancesAction::Report {
                    user_id: player.user_id,
                });
            }
            widgets::menu_separator(ui);
            if MenuRow::new(&tr!("alliances.viewProfile", "View ShieldBattery profile"))
                .glyph(Glyph::Person)
                .show(ui)
                .clicked()
            {
                return Some(AlliancesAction::ViewProfile {
                    user_id: player.user_id,
                });
            }
            None
        },
    );
    if let Some(action) = menu.inner {
        outcome.actions.push(action);
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
            user_id,
            name: name.to_string(),
            color: theme::player_color(user_id as usize),
            race: RaceView::Zerg,
            alliance: Some(AllianceState {
                player_id: user_id as u8,
                allied: false,
                vision: false,
            }),
            note: None,
            muted: false,
            blocked: false,
            report_requested: false,
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

    /// Renders one pass and returns the dialog's width.
    fn render_width(ctx: &egui::Context, view: &AlliancesView, menu: Option<AlliancesMenu>) -> f32 {
        let raw = egui::RawInput {
            screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(1920.0, 1080.0))),
            ..Default::default()
        };
        ctx.begin_pass(raw);
        let width = render_alliances_view(view, ctx, menu).response.rect.width();
        let mut out = ctx.end_pass();
        let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
        out.textures_delta.clear();
        width
    }

    fn settled_width(
        ctx: &egui::Context,
        view: &AlliancesView,
        menu: Option<AlliancesMenu>,
    ) -> f32 {
        let mut width = 0.0;
        for _ in 0..4 {
            width = render_width(ctx, view, menu);
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
        long.note = Some(PlayerNote::Left);
        let busy = view(vec![player(1, "a"), long]);
        assert_eq!(settled_width(&ctx, &busy, None), baseline);
        assert_eq!(
            settled_width(&ctx, &busy, Some(AlliancesMenu::Player { user_id: 2 })),
            baseline
        );
        assert_eq!(
            settled_width(&ctx, &busy, Some(AlliancesMenu::ChatTarget)),
            baseline
        );
    }

    /// A menu left open for someone the screen no longer lists closes rather than hanging off
    /// nothing.
    #[test]
    fn a_menu_for_someone_no_longer_listed_closes() {
        let ctx = fresh_ctx();
        let raw = egui::RawInput {
            screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(1920.0, 1080.0))),
            ..Default::default()
        };
        ctx.begin_pass(raw);
        let outcome = render_alliances_view(
            &view(vec![player(1, "a")]),
            &ctx,
            Some(AlliancesMenu::Player { user_id: 9 }),
        )
        .inner;
        let mut out = ctx.end_pass();
        let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
        out.textures_delta.clear();
        assert_eq!(outcome.menu, Some(None));
    }
}
