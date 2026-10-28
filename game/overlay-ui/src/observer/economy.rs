//! The economy panel: what each player's base is earning them, and what it is earning it with.
//!
//! The left of the two upper stats wings, at the kit's ambient tier. One row per player, led by the
//! bar of their own color and their name, then three columns:
//!
//! - **Workers**, with how many of them are standing still. Idle workers are the single most common
//!   unforced error in the game, and a count nobody can see is one nobody calls.
//! - **Income / min**, minerals and gas gathered per minute, which is the number a caster reads a
//!   build against: a player two hundred minerals a minute behind is losing the game quietly.
//! - **Trend**: how much the income column has moved over the last minute. It climbs as new workers
//!   and new bases start mining and falls when a mineral line is harassed or workers are pulled, so
//!   it says which way an economy is heading, where income alone only says where it is.
//!
//! Every column is a fixed width. These numbers move every second, and a table that resized itself
//! around them would be unreadable over a game.

use egui::{Align, Color32, Context, Id, Rect, Sense, Ui, pos2, vec2};

use crate::kit::text;
use crate::kit::theme;
use crate::kit::widgets::{self, ResourceGlyph};
use crate::observer::{
    EdgeCursor, RaceView, STAT_COLOR_BAR, STAT_HEADING_HEIGHT, STAT_ROW_GAP, STAT_ROW_HEIGHT,
    STAT_VALUE_SIZE, Wing, paint_column_heading, paint_resource_value, paint_stat_identity,
    paint_team_divider, paint_text, stat_table_height, teams_worth_dividing, vision_alpha,
    wing_panel,
};
use crate::shell::Panel;
use crate::{tr, tr_plural};

/// How wide the panel is, in overlay points.
pub const PANEL_WIDTH: f32 = 474.0;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = 450.0;

/// Gap between the bar of the player's color and their name.
const BAR_GAP: f32 = 8.0;

/// Width the player's name is laid out in. Fixed, because a name is player-chosen: one longer than
/// its column would otherwise push every number beside it out of the design's grid.
const NAME_WIDTH: f32 = 106.0;

/// Gap between two columns.
const COLUMN_GAP: f32 = 6.0;

/// Width of one of the two halves of the income column.
const RATE_WIDTH: f32 = 71.0;

/// Gap between the mineral rate and the gas rate, which is wider than the gap inside either of them
/// so the pair reads as two numbers rather than four.
const RATE_GAP: f32 = 14.0;

/// What the income column takes of the row.
const INCOME_WIDTH: f32 = RATE_WIDTH * 2.0 + RATE_GAP;

/// Width of the worker column, which carries a count and how many of it are standing still.
const WORKERS_WIDTH: f32 = 92.0;

/// Width of the trend column. The narrowest of the three, because it is the only one carrying a
/// single number with no second half and no word beside it.
const TREND_WIDTH: f32 = 58.0;

/// The columns are the row and the row is the panel. Checked where the widths are written, because
/// a column more than fits would be drawn outside the panel's chrome.
const _: () = assert!(
    STAT_COLOR_BAR
        + BAR_GAP
        + NAME_WIDTH
        + COLUMN_GAP
        + WORKERS_WIDTH
        + COLUMN_GAP
        + INCOME_WIDTH
        + COLUMN_GAP
        + TREND_WIDTH
        == CONTENT_WIDTH
);

/// Text size of the idle-worker count, which is a footnote to the worker count beside it.
const IDLE_SIZE: f32 = 12.0;

/// Text size of the trend column, which carries a direction rather than a quantity and so is set in
/// the body face the rest of the overlay's judgments are.
const TREND_SIZE: f32 = 12.5;

/// Gap between the worker count and the idle count.
const IDLE_GAP: f32 = 6.0;

/// The widest worker count the column keeps room for. Nobody fields a thousand workers, and the
/// count's digits are tabular, so the idle count can stand right after three of them and still never
/// move as the count changes.
const WIDEST_WORKER_COUNT: &str = "000";

/// Width the idle count is laid out in. Generous for the two English words it holds, because it is
/// where a translation of them runs out of room first.
const IDLE_WIDTH: f32 = 46.0;

/// One player's row.
pub struct EconomyPlayerView {
    pub name: String,
    /// Which side of the game they are on, which is where the table's dividers fall.
    pub team: u8,
    /// The color this player is on the map, which is what ties the row to what the watcher sees.
    pub color: Color32,
    /// Whether the watcher currently sees the game through this player's eyes.
    pub vision: bool,
    /// Which race's art their gas is drawn in.
    pub race: RaceView,
    /// Minerals and gas gathered per minute, over the last minute of game time.
    pub minerals_per_minute: u32,
    pub gas_per_minute: u32,
    pub workers: u32,
    /// How many of those workers are standing still.
    pub idle_workers: u32,
    /// How much more the player gathered per minute, minerals and gas together, over the last
    /// minute than over the minute before it: negative where it fell. `None` until the game has
    /// run two minutes and there is a minute before the last to compare with.
    pub income_trend: Option<i32>,
}

/// What the trend column reads for `trend`: signed, so a rise and a fall of the same size never
/// read alike, and empty while there is nothing to compare yet.
fn trend_text(trend: Option<i32>) -> String {
    match trend {
        None => String::new(),
        Some(trend) if trend > 0 => format!("+{trend}"),
        // A true minus sign, which sits at the plus sign's height and width.
        Some(trend) if trend < 0 => format!("\u{2212}{}", trend.unsigned_abs()),
        Some(_) => "0".to_string(),
    }
}

/// What color the trend column is drawn in for `trend`: the overlay's own green for an economy
/// growing and red for one shrinking, and quiet for one holding where it is.
fn trend_color(trend: Option<i32>) -> Color32 {
    match trend {
        Some(trend) if trend > 0 => theme::TEXT_POSITIVE,
        Some(trend) if trend < 0 => theme::TEXT_NEGATIVE,
        _ => theme::TEXT_DIM,
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

/// How tall the panel is for `view`, chrome included, which is what the wing it hangs in has to
/// have room for before it is drawn.
pub(crate) fn panel_height(view: &EconomyView) -> f32 {
    stat_table_height(view.players.iter().map(|player| player.team))
}

/// Draws the economy panel against the left edge of the screen at `top`, fading and sliding it in
/// and out. Returns nothing at all once it is gone, or while there is nobody to report on.
pub fn render_economy_view(
    view: &EconomyView,
    ctx: &Context,
    shown: bool,
    top: f32,
) -> Option<Rect> {
    let id = Id::new("sb_economy_panel");
    let inner = wing_panel(
        ctx,
        id,
        Wing::Left,
        top,
        PANEL_WIDTH,
        shown && !view.is_empty(),
        |ui| draw_panel(ui, view),
    )?;
    Some(inner.response.rect)
}

fn draw_panel(ui: &mut Ui, view: &EconomyView) {
    widgets::panel_header(
        ui,
        &tr!("observer.panelEconomy", "Economy"),
        Panel::Economy.key_label().as_deref(),
    );
    draw_headings(ui);
    let divided = teams_worth_dividing(view.players.iter().map(|player| player.team));
    let mut side = view.players.first().map(|player| player.team);
    for player in &view.players {
        if divided && side != Some(player.team) {
            side = Some(player.team);
            ui.add_space(STAT_ROW_GAP);
            let (row, _) =
                ui.allocate_exact_size(vec2(CONTENT_WIDTH, STAT_HEADING_HEIGHT), Sense::hover());
            paint_team_divider(ui, row, player.team);
        }
        ui.add_space(STAT_ROW_GAP);
        draw_row(ui, player);
    }
}

/// Draws the row of column headings, each aligned the way its column's values are, and saying on
/// hover what its column counts: the headings are a word each, and two of the columns are rates.
fn draw_headings(ui: &mut Ui) {
    let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, STAT_HEADING_HEIGHT), Sense::hover());
    let mut cursor = EdgeCursor::from_left(row);
    cursor.skip(STAT_COLOR_BAR + BAR_GAP + NAME_WIDTH + COLUMN_GAP);
    draw_heading(
        ui,
        cursor.take(WORKERS_WIDTH),
        "workers",
        &tr!("observer.columnWorkers", "Workers"),
        &tr!(
            "observer.columnWorkersHint",
            "Workers alive, and how many are standing idle"
        ),
    );
    cursor.skip(COLUMN_GAP);
    draw_heading(
        ui,
        cursor.take(INCOME_WIDTH),
        "income",
        &tr!("observer.columnIncomePerMinute", "Income / min"),
        &tr!(
            "observer.columnIncomeHint",
            "Minerals and gas gathered per minute, over the last minute"
        ),
    );
    cursor.skip(COLUMN_GAP);
    draw_heading(
        ui,
        cursor.take(TREND_WIDTH),
        "trend",
        &tr!("observer.columnTrend", "Trend"),
        &tr!(
            "observer.columnTrendHint",
            "How income per minute has changed since a minute ago"
        ),
    );
}

/// Draws one column heading, with `hint` under the pointer while it rests on the heading's words.
fn draw_heading(ui: &Ui, rect: Rect, key: &str, label: &str, hint: &str) {
    paint_column_heading(ui, rect, label, Align::LEFT);
    // The words rather than the column: the column's empty width is where the pointer passes on
    // its way to something else, and a card that sprang up there would be in the way.
    let words = text::column_label().galley(ui, label).size();
    let target = Rect::from_min_size(
        pos2(rect.left(), rect.center().y - words.y * 0.5),
        vec2(words.x.min(rect.width()), words.y),
    );
    let id = Id::new(("sb_economy_heading", key));
    let response = ui.interact(target, id, Sense::hover());
    if let Some(pointer) = response.hover_pos() {
        widgets::tooltip(ui.ctx(), id.with("hint"), pointer, |ui| {
            ui.label(
                text::body(12.0, text::BodyWeight::Regular)
                    .with_color(theme::TEXT_SECONDARY)
                    .job(hint),
            );
        });
    }
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
    draw_workers(ui, cursor.take(WORKERS_WIDTH), player, alpha);

    cursor.skip(COLUMN_GAP);
    paint_resource_value(
        ui,
        cursor.take(RATE_WIDTH),
        ResourceGlyph::Minerals,
        player.race,
        player.minerals_per_minute,
        Align::LEFT,
        alpha,
    );
    cursor.skip(RATE_GAP);
    paint_resource_value(
        ui,
        cursor.take(RATE_WIDTH),
        ResourceGlyph::Gas,
        player.race,
        player.gas_per_minute,
        Align::LEFT,
        alpha,
    );

    cursor.skip(COLUMN_GAP);
    // The trend is the one column that is a direction rather than a count, so it is the one drawn
    // in a color: a watcher scanning the panel reads which way an economy is heading before they
    // read by how much.
    paint_text(
        ui,
        cursor.take(TREND_WIDTH),
        &text::body(TREND_SIZE, text::BodyWeight::Medium)
            .with_color(trend_color(player.income_trend).gamma_multiply(alpha))
            .tabular(),
        &trend_text(player.income_trend),
        Align::LEFT,
    );
}

/// Draws the worker column: how many there are, and how many of them are doing nothing.
///
/// The idle count is only drawn when there is one. A zero there every second of every game would
/// train the watcher to stop reading the column, which is the one thing it exists to be read for.
fn draw_workers(ui: &Ui, rect: Rect, player: &EconomyPlayerView, alpha: f32) {
    let mut cursor = EdgeCursor::from_left(rect);
    let spec = text::numeral(STAT_VALUE_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha));
    let count_width = spec.galley(ui, WIDEST_WORKER_COUNT).size().x;
    paint_text(
        ui,
        cursor.take(count_width.min(rect.width() - IDLE_GAP - IDLE_WIDTH)),
        &spec,
        &player.workers.to_string(),
        Align::LEFT,
    );
    if player.idle_workers == 0 {
        return;
    }
    cursor.skip(IDLE_GAP);
    paint_text(
        ui,
        cursor.take(IDLE_WIDTH),
        // Amber rather than red: idle workers are a thing to fix, not a thing that has gone
        // wrong, and the panel has a red of its own for numbers that have.
        &text::body(IDLE_SIZE, text::BodyWeight::Medium)
            .with_color(theme::TEXT_WARNING.gamma_multiply(alpha)),
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
    fn the_worked_out_height_is_the_height_the_panel_draws_at() {
        let player = |team| EconomyPlayerView {
            name: "Rhynso".to_string(),
            team,
            color: Color32::WHITE,
            vision: true,
            race: RaceView::Terran,
            minerals_per_minute: 900,
            gas_per_minute: 300,
            workers: 60,
            idle_workers: 2,
            income_trend: Some(120),
        };
        for teams in [vec![1, 2], vec![1, 1, 2, 2], vec![1, 1, 1, 2, 2, 2]] {
            let view = EconomyView {
                players: teams.iter().map(|team| player(*team)).collect(),
            };
            let rect = crate::observer::test_support::settled_rect(|ctx| {
                render_economy_view(&view, ctx, true, 100.0)
            })
            .expect("the panel is drawn");
            assert_eq!(rect.height(), panel_height(&view), "{teams:?}");
        }
    }

    #[test]
    fn the_columns_fill_the_panels_own_width() {
        assert_eq!(
            crate::kit::tiers::panel_content_width(PANEL_WIDTH),
            CONTENT_WIDTH
        );
    }

    #[test]
    fn the_trend_reads_with_its_sign() {
        assert_eq!(trend_text(Some(180)), "+180");
        assert_eq!(trend_text(Some(-60)), "\u{2212}60");
        assert_eq!(trend_text(Some(0)), "0");
        assert_eq!(trend_text(None), "");
    }
}
