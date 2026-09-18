//! The in-game chat history's presentation layer: a plain-data view-model and the egui render fn
//! that draws it. Like [`crate::disconnect`] and [`crate::netstat`], everything here is a pure fn of
//! [`ChatHistoryView`] plus an [`egui::Context`], so the same code renders in the injected game DLL
//! and in the host preview.
//!
//! It stands in for SC:R's own chat log, so it is drawn at the kit's modal tier: the game is already
//! in a modal state by the time the dialog it replaces spawns, and a player reading back over a
//! game's chat is not doing anything else.
//!
//! A line is a row of fixed columns — when it was said, who said it, who they said it to, and the
//! words — so a log scans down its left edge rather than being re-read line by line. The words sit
//! in their own column, which is what gives a wrapped message its hanging indent. System notices
//! have no sender and no scope, so they take that whole width and render dim.

use egui::{Align, Color32, Id, Layout, Ui, vec2};

use crate::kit::text::{self, BodyWeight, TextSpec};
use crate::kit::widgets::{self, ButtonVariant, TagStyle};
use crate::kit::{theme, tiers};
use crate::tr;

/// How wide the dialog is, in overlay points.
///
/// Wider than the shell's other modals: this one holds running text rather than a handful of rows,
/// and every point taken off it is a point of message that wraps instead of reading straight across.
pub const DIALOG_WIDTH: f32 = 600.0;

/// How tall the list may grow before it scrolls. Short of the shortest screen the game runs on, so
/// the dialog's chrome and its button are never pushed off the top or bottom.
const LIST_MAX_HEIGHT: f32 = 432.0;

/// Width of the column holding a line's game-time stamp.
const TIME_WIDTH: f32 = 38.0;

/// Width of the sender column.
const NAME_WIDTH: f32 = 112.0;

/// Width of the scope-tag column. The tag elides inside it, so a long recipient name moves nothing.
const TAG_WIDTH: f32 = 72.0;

/// Gap between two columns.
const COLUMN_GAP: f32 = theme::SPACE_SM;

/// Width the vertical scrollbar and its margin take out of the dialog. Reserved whether or not the
/// list is long enough to scroll, so a message arriving does not re-wrap every line above it.
const SCROLLBAR_WIDTH: f32 = 14.0;

/// Width the message column is laid out against.
const MESSAGE_WIDTH: f32 =
    DIALOG_WIDTH - TIME_WIDTH - NAME_WIDTH - TAG_WIDTH - COLUMN_GAP * 3.0 - SCROLLBAR_WIDTH;

/// Width a system notice takes, being the sender, scope and message columns together.
const SYSTEM_WIDTH: f32 = NAME_WIDTH + TAG_WIDTH + MESSAGE_WIDTH + COLUMN_GAP * 2.0;

/// The columns are the dialog, so widening one of them narrows the message column. Checked where
/// the widths are written: past the point where nothing is left for the words, every line would lay
/// out one character per row.
const _: () = assert!(MESSAGE_WIDTH > 0.0);

/// Text size of a message and of the name over it.
const LINE_SIZE: f32 = 13.5;

/// Text size of a line's game-time stamp, a step down because it is a coordinate rather than
/// content.
const TIME_SIZE: f32 = 12.0;

/// Vertical gap between two lines.
const LINE_GAP: f32 = theme::SPACE_XS;

/// Who a message was addressed to, as the tag over it reads.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ChatScopeView {
    /// Everyone in the game.
    All,
    /// The sender's allies.
    Allies,
    /// The observers.
    Observers,
    /// A named set of players. `recipient` is the one player it went to, where the set named
    /// exactly one and their name could be resolved; a team-addressed message in a shared-control
    /// game reaches several players at once and carries none.
    Players { recipient: Option<String> },
}

/// What a line of the history is.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ChatLineKindView {
    /// Something a player said.
    Player {
        /// The sender's display name.
        name: String,
        /// The sender's in-game color, which is what makes a log scannable by who is talking.
        color: Color32,
        /// Whether the local player sent it. Their own lines wear the accent tag, so their half of
        /// a conversation is findable at a glance.
        own: bool,
        /// Who the message was addressed to.
        scope: ChatScopeView,
    },
    /// A notice the game itself printed — a player leaving, an alliance changing.
    System,
}

/// One line of the history.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ChatLineView {
    /// How far into the game the line was said, in whole seconds.
    pub game_seconds: u64,
    pub kind: ChatLineKindView,
    /// The line's text, BW's inline color codes and all: they are read at layout
    /// ([`text::bw_colored_job`]) rather than stripped, because a player who colored their message
    /// meant it to be read that way.
    pub text: String,
}

/// Everything the chat history needs to draw itself, built from the DLL's per-game store. Oldest
/// line first, which is the order it reads in.
#[derive(Clone, Default, PartialEq, Eq, Debug)]
pub struct ChatHistoryView {
    pub lines: Vec<ChatLineView>,
}

/// Renders the chat history and returns whether the player asked for it to close.
pub fn render_chat_history_view(
    view: &ChatHistoryView,
    ctx: &egui::Context,
) -> tiers::DialogResponse<bool> {
    tiers::tier2_dialog(
        ctx,
        Id::new("sb_chat_history"),
        &tr!("chatHistory.title", "Chat history"),
        DIALOG_WIDTH,
        |ui| {
            draw_lines(ui, view);
            ui.add_space(theme::SPACE_MD);
            ui.vertical_centered(|ui| {
                widgets::button(ui, &tr!("common.close", "Close"), ButtonVariant::Tier2).clicked()
            })
            .inner
        },
    )
}

/// Draws the scrolling list, or what stands in for it while the game has said nothing.
///
/// The list stays pinned to its newest line only for as long as the reader leaves it there: once
/// they have scrolled up, a message arriving must not pull the text out from under them, which is
/// exactly what SC:R's own log does and the complaint this screen exists to answer.
fn draw_lines(ui: &mut Ui, view: &ChatHistoryView) {
    if view.lines.is_empty() {
        ui.add_space(theme::SPACE_LG);
        ui.vertical_centered(|ui| {
            ui.label(
                text::body(LINE_SIZE, BodyWeight::Regular)
                    .with_color(theme::TEXT_LABEL)
                    .job(&tr!("chatHistory.empty", "No messages yet")),
            );
        });
        ui.add_space(theme::SPACE_LG);
        return;
    }
    egui::ScrollArea::vertical()
        .id_salt("sb_chat_history_lines")
        .max_height(LIST_MAX_HEIGHT)
        .auto_shrink([false, true])
        .stick_to_bottom(true)
        .show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = LINE_GAP;
            for line in &view.lines {
                draw_line(ui, line);
            }
        });
}

/// Draws one line: when, who, to whom, and what.
fn draw_line(ui: &mut Ui, line: &ChatLineView) {
    ui.horizontal_top(|ui| {
        ui.spacing_mut().item_spacing.x = COLUMN_GAP;
        column(ui, TIME_WIDTH, Align::RIGHT, |ui| {
            ui.label(
                text::numeral(TIME_SIZE)
                    .with_color(theme::TEXT_LABEL)
                    .job(&mmss(line.game_seconds)),
            );
        });
        match &line.kind {
            ChatLineKindView::Player {
                name,
                color,
                own,
                scope,
            } => {
                column(ui, NAME_WIDTH, Align::LEFT, |ui| {
                    ui.label(
                        text::player_name(LINE_SIZE)
                            .with_color(*color)
                            .job_truncated(name, NAME_WIDTH),
                    );
                });
                column(ui, TAG_WIDTH, Align::LEFT, |ui| {
                    let style = if *own {
                        TagStyle::Amber
                    } else {
                        TagStyle::Neutral
                    };
                    widgets::tag_sized(ui, &scope_label(scope), style, TAG_WIDTH);
                });
                column(ui, MESSAGE_WIDTH, Align::LEFT, |ui| {
                    ui.label(text::bw_colored_job(
                        &message_spec(),
                        &line.text,
                        MESSAGE_WIDTH,
                    ));
                });
            }
            ChatLineKindView::System => {
                column(ui, SYSTEM_WIDTH, Align::LEFT, |ui| {
                    ui.label(text::bw_colored_job(
                        &system_spec(),
                        &line.text,
                        SYSTEM_WIDTH,
                    ));
                });
            }
        }
    });
}

/// One column of a line, at a width the dialog decides rather than one read back from the layout.
///
/// A list this long sits in an auto-sized area, so sizing a column from the space available would
/// let one wide line widen the area and the next pass hand that extra width straight back.
fn column(ui: &mut Ui, width: f32, align: Align, add: impl FnOnce(&mut Ui)) {
    ui.allocate_ui_with_layout(vec2(width, 0.0), Layout::top_down(align), |ui| {
        ui.set_width(width);
        add(ui);
    });
}

/// What the scope tag over a message reads.
fn scope_label(scope: &ChatScopeView) -> String {
    match scope {
        ChatScopeView::All => tr!("chatHistory.scopeAll", "All"),
        ChatScopeView::Allies => tr!("chatHistory.scopeAllies", "Allies"),
        ChatScopeView::Observers => tr!("chatHistory.scopeObservers", "Obs"),
        ChatScopeView::Players {
            recipient: Some(name),
        } => tr!("chatHistory.scopeTo", "To {{name}}", name = name),
        ChatScopeView::Players { recipient: None } => tr!("chatHistory.scopeToPlayers", "To"),
    }
}

fn message_spec() -> TextSpec {
    text::body(LINE_SIZE, BodyWeight::Regular)
}

/// System notices are the log's furniture rather than its content, so they speak quietly.
fn system_spec() -> TextSpec {
    text::body(LINE_SIZE, BodyWeight::Regular).with_color(theme::TEXT_DIM)
}

/// Whole seconds as a clock reads them.
fn mmss(seconds: u64) -> String {
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player_line(seconds: u64, own: bool, scope: ChatScopeView, text: &str) -> ChatLineView {
        ChatLineView {
            game_seconds: seconds,
            kind: ChatLineKindView::Player {
                name: "player-a".to_string(),
                color: theme::player_color(0),
                own,
                scope,
            },
            text: text.to_string(),
        }
    }

    fn fresh_ctx() -> egui::Context {
        let ctx = egui::Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        ctx
    }

    /// Renders `view` for one pass against `ctx` and returns the dialog's on-screen width in points.
    fn render_width(ctx: &egui::Context, view: &ChatHistoryView) -> f32 {
        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::pos2(0.0, 0.0),
                vec2(1280.0, 720.0),
            )),
            ..Default::default()
        };
        ctx.begin_pass(raw);
        let width = render_chat_history_view(view, ctx).response.rect.width();
        let mut out = ctx.end_pass();
        let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
        // Layout checks have no GPU texture store to update.
        out.textures_delta.clear();
        width
    }

    /// Renders `view` a few times and returns the width the last pass settled on: an auto-sized
    /// area takes egui a couple of passes to resolve.
    fn settled_width(ctx: &egui::Context, view: &ChatHistoryView) -> f32 {
        let mut width = 0.0;
        for _ in 0..4 {
            width = render_width(ctx, view);
        }
        width
    }

    /// Nothing a message carries may change how wide the dialog is: a log whose chrome moved as
    /// lines arrived would be unreadable while a game is still being played.
    #[test]
    fn the_dialog_is_the_same_width_whatever_it_holds() {
        let ctx = fresh_ctx();
        let empty = ChatHistoryView::default();
        let baseline = settled_width(&ctx, &empty);
        let busy = ChatHistoryView {
            lines: vec![
                player_line(5, false, ChatScopeView::All, "gl hf"),
                player_line(
                    75,
                    true,
                    ChatScopeView::Players {
                        recipient: Some("a-very-long-player-name".to_string()),
                    },
                    &"a message that runs on and on ".repeat(8),
                ),
                player_line(
                    200,
                    false,
                    ChatScopeView::Allies,
                    "\x06watch the drop\x07 now",
                ),
                ChatLineView {
                    game_seconds: 900,
                    kind: ChatLineKindView::System,
                    text: "player-b has left the game.".to_string(),
                },
            ],
        };
        assert_eq!(settled_width(&ctx, &busy), baseline);
    }
}
