//! The economy panel: what each player's base is earning them, and what it is earning it with.
//!
//! The left of the two upper stats wings, at the kit's ambient tier. One row per player, led by the
//! bar of their own color and their name, then three columns:
//!
//! - **Income**, minerals and gas gathered per minute, which is the number a caster reads a build
//!   against: a player two hundred minerals a minute behind is losing the game quietly.
//! - **Workers**, with how many of them are standing still. Idle workers are the single most common
//!   unforced error in the game, and a count nobody can see is one nobody calls.
//! - **Efficiency**: income per worker per minute. It falls when workers idle, when they are walking
//!   to a new base, and when a mineral line is oversaturated, so it says whether a worker count is
//!   actually being converted into a bank.
//!
//! Every column is a fixed width. These numbers move every second, and a table that resized itself
//! around them would be unreadable over a game.

use egui::{Align, Color32, Context, Id, Rect, Sense, Ui, vec2};

use crate::kit::text;
use crate::kit::theme;
use crate::kit::widgets::{self, ResourceGlyph};
use crate::observer::{
    EdgeCursor, STAT_COLOR_BAR, STAT_GLYPH, STAT_GLYPH_GAP, STAT_HEADING_HEIGHT, STAT_ROW_GAP,
    STAT_ROW_HEIGHT, STAT_VALUE_SIZE, Wing, paint_column_heading, paint_resource_value,
    paint_stat_identity, paint_text, vision_alpha, wing_panel,
};
use crate::{tr, tr_plural};

/// How wide the panel is, in overlay points.
pub const PANEL_WIDTH: f32 = 474.0;

/// How far its top edge sits below the screen's, which is clear of the matchup bar above it.
const PANEL_TOP: f32 = 78.0;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = 450.0;

/// Gap between the bar of the player's color and their name.
const BAR_GAP: f32 = 8.0;

/// Width the player's name is laid out in. Fixed, because a name is player-chosen: one longer than
/// its column would otherwise push every number beside it out of the design's grid.
const NAME_WIDTH: f32 = 112.0;

/// Gap between two columns.
const COLUMN_GAP: f32 = 10.0;

/// Width of one of the two halves of the income column.
const RATE_WIDTH: f32 = 69.0;

/// Gap between the mineral rate and the gas rate, which is wider than the gap inside either of them
/// so the pair reads as two numbers rather than four.
const RATE_GAP: f32 = 14.0;

/// What the income column takes of the row.
const INCOME_WIDTH: f32 = RATE_WIDTH * 2.0 + RATE_GAP;

/// Width of the worker column, which carries a count and how many of it are standing still.
const WORKERS_WIDTH: f32 = 104.0;

/// Width of the efficiency column. The narrowest of the three, because it is the only one carrying
/// a single number with no second half and no word beside it.
const EFFICIENCY_WIDTH: f32 = 40.0;

/// The columns are the row and the row is the panel. Checked where the widths are written, because
/// a column more than fits would be drawn outside the panel's chrome.
const _: () = assert!(
    STAT_COLOR_BAR
        + BAR_GAP
        + NAME_WIDTH
        + COLUMN_GAP
        + INCOME_WIDTH
        + COLUMN_GAP
        + WORKERS_WIDTH
        + COLUMN_GAP
        + EFFICIENCY_WIDTH
        == CONTENT_WIDTH
);

/// Text size of the idle-worker count, which is a footnote to the worker count beside it.
const IDLE_SIZE: f32 = 12.0;

/// Gap between the worker count and the idle count.
const IDLE_GAP: f32 = 6.0;

/// Width the idle count is laid out in. Generous for the two English words it holds, because it is
/// where a translation of them runs out of room first.
const IDLE_WIDTH: f32 = 46.0;

/// One player's row.
pub struct EconomyPlayerView {
    pub name: String,
    /// The color this player is on the map, which is what ties the row to what the watcher sees.
    pub color: Color32,
    /// Whether the watcher currently sees the game through this player's eyes.
    pub vision: bool,
    /// Minerals and gas gathered per minute, over the last minute of game time.
    pub minerals_per_minute: u32,
    pub gas_per_minute: u32,
    pub workers: u32,
    /// How many of those workers are standing still.
    pub idle_workers: u32,
}

impl EconomyPlayerView {
    /// Resources gathered per minute for each worker the player owns.
    ///
    /// Zero without workers rather than undefined: a player with no workers has no income either, so
    /// the whole row reads as the same zero rather than as a gap.
    fn efficiency(&self) -> u32 {
        match self.workers {
            0 => 0,
            workers => (self.minerals_per_minute + self.gas_per_minute) / workers,
        }
    }
}

/// Everything the economy panel draws from.
pub struct EconomyView {
    /// The players it has rows for, in the order the game lists them.
    pub players: Vec<EconomyPlayerView>,
}

impl EconomyView {
    /// Whether there is anything at all to draw.
    pub fn is_empty(&self) -> bool {
        self.players.is_empty()
    }
}

/// Draws the economy panel against the left edge of the screen, fading and sliding it in and out.
/// Returns nothing at all once it is gone, or while there is nobody to report on.
pub fn render_economy_view(view: &EconomyView, ctx: &Context, shown: bool) -> Option<Rect> {
    let id = Id::new("sb_economy_panel");
    let inner = wing_panel(
        ctx,
        id,
        Wing::Left,
        PANEL_TOP,
        PANEL_WIDTH,
        shown && !view.is_empty(),
        |ui| draw_panel(ui, view),
    )?;
    Some(inner.response.rect)
}

fn draw_panel(ui: &mut Ui, view: &EconomyView) {
    widgets::panel_header(ui, &tr!("observer.panelEconomy", "Economy"), Some("E"));
    draw_headings(ui);
    for player in &view.players {
        ui.add_space(STAT_ROW_GAP);
        draw_row(ui, player);
    }
}

/// Draws the row of column headings, each aligned the way its column's values are.
fn draw_headings(ui: &mut Ui) {
    let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, STAT_HEADING_HEIGHT), Sense::hover());
    let mut cursor = EdgeCursor::from_left(row);
    cursor.skip(STAT_COLOR_BAR + BAR_GAP + NAME_WIDTH + COLUMN_GAP);
    paint_column_heading(
        ui,
        cursor.take(INCOME_WIDTH),
        &tr!("observer.columnIncome", "Income"),
        Align::LEFT,
    );
    cursor.skip(COLUMN_GAP);
    paint_column_heading(
        ui,
        cursor.take(WORKERS_WIDTH),
        &tr!("observer.columnWorkers", "Workers"),
        Align::LEFT,
    );
    cursor.skip(COLUMN_GAP);
    paint_column_heading(
        ui,
        cursor.take(EFFICIENCY_WIDTH),
        &tr!("observer.columnEfficiency", "Eff"),
        Align::RIGHT,
    );
}

/// Draws one player's row.
fn draw_row(ui: &mut Ui, player: &EconomyPlayerView) {
    let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, STAT_ROW_HEIGHT), Sense::hover());
    let alpha = vision_alpha(player.vision);
    let mut cursor = EdgeCursor::from_left(row);
    paint_stat_identity(
        ui,
        &mut cursor,
        BAR_GAP,
        NAME_WIDTH,
        &player.name,
        player.color,
        alpha,
    );

    cursor.skip(COLUMN_GAP);
    paint_resource_value(
        ui,
        cursor.take(RATE_WIDTH),
        ResourceGlyph::Minerals,
        &player.minerals_per_minute.to_string(),
        alpha,
    );
    cursor.skip(RATE_GAP);
    paint_resource_value(
        ui,
        cursor.take(RATE_WIDTH),
        ResourceGlyph::Gas,
        &player.gas_per_minute.to_string(),
        alpha,
    );

    cursor.skip(COLUMN_GAP);
    draw_workers(ui, cursor.take(WORKERS_WIDTH), player, alpha);

    cursor.skip(COLUMN_GAP);
    paint_text(
        ui,
        cursor.take(EFFICIENCY_WIDTH),
        &text::numeral(STAT_VALUE_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
        &player.efficiency().to_string(),
        Align::RIGHT,
    );
}

/// Draws the worker column: how many there are, and how many of them are doing nothing.
///
/// The idle count is only drawn when there is one. A zero there every second of every game would
/// train the watcher to stop reading the column, which is the one thing it exists to be read for.
fn draw_workers(ui: &Ui, rect: Rect, player: &EconomyPlayerView, alpha: f32) {
    let mut cursor = EdgeCursor::from_left(rect);
    // The count sits where a resource number would, so the three numeric columns line up down the
    // panel even though this one names no resource.
    cursor.skip(STAT_GLYPH + STAT_GLYPH_GAP);
    paint_text(
        ui,
        cursor.take(rect.width() - STAT_GLYPH - STAT_GLYPH_GAP - IDLE_GAP - IDLE_WIDTH),
        &text::numeral(STAT_VALUE_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
        &player.workers.to_string(),
        Align::RIGHT,
    );
    if player.idle_workers == 0 {
        return;
    }
    cursor.skip(IDLE_GAP);
    paint_text(
        ui,
        cursor.take(IDLE_WIDTH),
        &text::body(IDLE_SIZE, text::BodyWeight::Medium)
            .with_color(theme::TEXT_NEGATIVE.gamma_multiply(alpha)),
        &tr_plural!(
            "observer.idleWorkers",
            player.idle_workers,
            one = "{{count}} idle",
            other = "{{count}} idle"
        ),
        Align::LEFT,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_columns_fill_the_panels_own_width() {
        assert_eq!(
            crate::kit::tiers::panel_content_width(PANEL_WIDTH),
            CONTENT_WIDTH
        );
    }

    #[test]
    fn efficiency_is_what_each_worker_earns() {
        let player = |workers, minerals, gas| EconomyPlayerView {
            name: String::new(),
            color: Color32::WHITE,
            vision: true,
            minerals_per_minute: minerals,
            gas_per_minute: gas,
            workers,
            idle_workers: 0,
        };
        assert_eq!(player(20, 900, 100).efficiency(), 50);
        // A player with nothing left to mine with has no income to divide up either.
        assert_eq!(player(0, 0, 0).efficiency(), 0);
    }
}
