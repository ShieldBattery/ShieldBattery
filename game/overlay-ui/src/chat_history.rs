//! The in-game chat history's presentation layer: a plain-data view-model and the egui render fn
//! that draws it. Like [`crate::disconnect`] and [`crate::netstat`], everything here is a pure fn of
//! [`ChatHistoryView`] plus an [`egui::Context`], so the same code renders in the injected game DLL
//! and in the host preview.
//!
//! It stands in for SC:R's own chat log, so it is drawn at the kit's modal tier: the game is already
//! in a modal state by the time the dialog it replaces spawns, and a player reading back over a
//! game's chat is not doing anything else.
//!
//! A line reads left to right the way it is asked about: who it went to, when, then who said it and
//! what. The scope tag and the time stamp stand in fixed slots at the left edge, each set flush
//! right against the words, so a log scans down two straight seams before the eye ever lands on a
//! sentence; the words follow the sender's name directly, as chat does, so a line is read straight
//! across without a jump over a column of empty space. System notices have no sender and no scope,
//! so they take the whole width of the words and render dim.

use std::sync::Arc;

use egui::text::LayoutJob;
use egui::{
    Align, Color32, Frame, Galley, Id, Layout, Margin, Shape, Stroke, StrokeKind, Ui, vec2,
};

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

/// Padding between the list's edge and its lines. The list is drawn as a sunken box inside the
/// dialog so that a line cut off by scrolling is cut at the box's edge, which the eye reads as a
/// window onto more text rather than as a layout that ran out of room.
const LIST_PAD: i8 = 8;

/// Width of the slot holding a line's scope tag. The tag elides inside it, so a long recipient name
/// moves nothing.
const TAG_WIDTH: f32 = 72.0;

/// Width of the slot holding a line's game-time stamp.
const TIME_WIDTH: f32 = 38.0;

/// Gap between two of a line's slots.
const COLUMN_GAP: f32 = theme::SPACE_SM;

/// Width the vertical scrollbar and its margin take out of the list. Reserved whether or not the
/// list is long enough to scroll, so a message arriving does not re-wrap every line above it.
const SCROLLBAR_WIDTH: f32 = 14.0;

/// Width the words of a line are laid out against.
const MESSAGE_WIDTH: f32 = DIALOG_WIDTH
    - LIST_PAD as f32 * 2.0
    - TAG_WIDTH
    - TIME_WIDTH
    - COLUMN_GAP * 2.0
    - SCROLLBAR_WIDTH;

/// The slots are the dialog, so widening one of them narrows the words. Checked where the widths
/// are written: past the point where nothing is left for the words, every line would lay out one
/// character per row.
const _: () = assert!(MESSAGE_WIDTH > 0.0);

/// Text size of a message and of the name in front of it.
const LINE_SIZE: f32 = 13.5;

/// Text size of a line's game-time stamp, a step down because it is a coordinate rather than
/// content.
const TIME_SIZE: f32 = 12.0;

/// Gap between a sender's name and their words.
const NAME_GAP: f32 = theme::SPACE_SM;

/// Vertical gap between two lines. Wider than the rows inside a wrapped message, which is what
/// keeps a wrapped message reading as one line and its neighbours as others.
const LINE_GAP: f32 = theme::SPACE_SM;

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
        /// Whether the local player sent it. Their own lines wear a filled scope tag where every
        /// other line's is an outline, so their half of a conversation is findable at a glance.
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
    /// ([`text::append_bw_colored`]) rather than stripped, because a player who colored their
    /// message meant it to be read that way.
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
        tiers::dialog_outer_width(DIALOG_WIDTH),
        |ui| {
            tiers::dialog_header(ui, |ui| {
                tiers::dialog_title(ui, &tr!("chatHistory.title", "Chat history"));
            });
            tiers::dialog_body(ui, |ui| draw_list(ui, view));
            tiers::dialog_footer(ui, |ui| {
                ui.vertical_centered(|ui| {
                    widgets::button(ui, &tr!("common.close", "Close"), ButtonVariant::Tier2)
                        .clicked()
                })
                .inner
            })
        },
    )
}

/// Draws the sunken box the lines sit in, and the lines, or what stands in for them while the game
/// has said nothing.
fn draw_list(ui: &mut Ui, view: &ChatHistoryView) {
    let background = ui.painter().add(Shape::Noop);
    let inner = Frame::NONE
        .inner_margin(Margin::same(LIST_PAD))
        .show(ui, |ui| {
            ui.set_width(DIALOG_WIDTH - f32::from(LIST_PAD) * 2.0);
            if view.lines.is_empty() {
                draw_empty(ui);
            } else {
                draw_lines(ui, view);
            }
        });
    let rect = inner.response.rect;
    let radius = theme::radius(theme::RADIUS_TIGHT);
    ui.painter().set(
        background,
        Shape::Vec(vec![
            Shape::rect_filled(rect, radius, theme::TIER2_ROW_FILL),
            Shape::rect_stroke(
                rect,
                radius,
                Stroke::new(theme::HAIRLINE, theme::TIER2_DIVIDER),
                StrokeKind::Inside,
            ),
        ]),
    );
}

fn draw_empty(ui: &mut Ui) {
    ui.add_space(theme::SPACE_LG);
    ui.vertical_centered(|ui| {
        ui.label(
            text::body(LINE_SIZE, BodyWeight::Regular)
                .with_color(theme::TEXT_LABEL)
                .job(&tr!("chatHistory.empty", "No messages yet")),
        );
    });
    ui.add_space(theme::SPACE_LG);
}

/// Draws the scrolling list.
///
/// The list stays pinned to its newest line only for as long as the reader leaves it there: once
/// they have scrolled up, a message arriving must not pull the text out from under them, which is
/// exactly what SC:R's own log does and the complaint this screen exists to answer.
fn draw_lines(ui: &mut Ui, view: &ChatHistoryView) {
    egui::ScrollArea::vertical()
        .id_salt("sb_chat_history_lines")
        .max_height(LIST_MAX_HEIGHT)
        .auto_shrink([false, true])
        .stick_to_bottom(true)
        .show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = LINE_GAP;
            let tag_height = widgets::tag_height(ui);
            for line in &view.lines {
                draw_line(ui, line, tag_height);
            }
        });
}

/// Draws one line: to whom, when, then who and what.
///
/// The tag and the stamp are centred on the first row of the words, whichever of the three is
/// tallest, so the three read as one line even though each is set in its own face and size.
fn draw_line(ui: &mut Ui, line: &ChatLineView, tag_height: f32) {
    let words = words_galley(ui, line);
    let first_row = words.rows.first().map_or(0.0, |row| row.height());
    let row_height = first_row.max(tag_height);
    ui.horizontal_top(|ui| {
        ui.spacing_mut().item_spacing.x = COLUMN_GAP;
        slot(ui, TAG_WIDTH, row_height, |ui| {
            if let ChatLineKindView::Player { own, scope, .. } = &line.kind {
                widgets::tag_sized(ui, &scope_label(scope), scope_style(scope, *own), TAG_WIDTH);
            }
        });
        slot(ui, TIME_WIDTH, row_height, |ui| {
            ui.label(
                text::numeral(TIME_SIZE)
                    .with_color(theme::TEXT_LABEL)
                    .job(&mmss(line.game_seconds)),
            );
        });
        ui.allocate_ui_with_layout(
            vec2(MESSAGE_WIDTH, 0.0),
            Layout::top_down(Align::LEFT),
            |ui| {
                ui.set_width(MESSAGE_WIDTH);
                ui.add_space((row_height - first_row) * 0.5);
                ui.label(words);
            },
        );
    });
}

/// One fixed slot of a line, its contents flush right and centred on the line's first row.
///
/// The width is the dialog's rather than one read back from the layout: a list this long sits in an
/// auto-sized area, so sizing a slot from the space available would let one wide line widen the
/// area and the next pass hand that extra width straight back.
fn slot(ui: &mut Ui, width: f32, height: f32, add: impl FnOnce(&mut Ui)) {
    ui.allocate_ui_with_layout(
        vec2(width, height),
        Layout::right_to_left(Align::Center),
        |ui| {
            ui.set_width(width);
            ui.set_min_height(height);
            add(ui);
        },
    );
}

/// Lays out the words of a line: the sender's name in their color, then what they said, wrapped
/// as one paragraph so a wrapped message continues under its name.
fn words_galley(ui: &Ui, line: &ChatLineView) -> Arc<Galley> {
    let mut job = LayoutJob::default();
    job.wrap.max_width = MESSAGE_WIDTH;
    match &line.kind {
        ChatLineKindView::Player { name, color, .. } => {
            let name_spec = text::player_name(LINE_SIZE).with_color(*color);
            job.append(name, 0.0, name_spec.format());
            text::append_bw_colored(&mut job, &message_spec(), &line.text, NAME_GAP);
        }
        ChatLineKindView::System => {
            text::append_bw_colored(&mut job, &system_spec(), &line.text, 0.0);
        }
    }
    ui.ctx().fonts_mut(|fonts| fonts.layout_job(job))
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

/// How the scope tag is drawn: the scope's own hue, filled in on the local player's lines.
fn scope_style(scope: &ChatScopeView, own: bool) -> TagStyle {
    let color = match scope {
        ChatScopeView::All => theme::CHAT_SCOPE_ALL,
        ChatScopeView::Allies => theme::CHAT_SCOPE_ALLIES,
        ChatScopeView::Observers => theme::CHAT_SCOPE_OBSERVERS,
        ChatScopeView::Players { .. } => theme::CHAT_SCOPE_PLAYERS,
    };
    TagStyle::Hue { color, filled: own }
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
