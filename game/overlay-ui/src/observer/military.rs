//! The military panel: what each player has spent their bank on, and what it has cost them.
//!
//! The right of the two upper stats wings, mirroring the economy panel across the screen. One row
//! per player, then three columns:
//!
//! - **Army**, the minerals and gas standing on the map as fighting units. Read against the economy
//!   panel's income it says who is converting a lead into something that can take a fight.
//! - **Units killed and lost**, from the game's own score tables.
//! - **Workers killed and lost**, kept apart from the units above because a worker trade is a
//!   different kind of damage: it is paid for over the following minutes rather than at once.
//!
//! Kills are set in the panel's own text color and losses in the dim one, so a row reads as
//! "what I did" followed by "what it cost" without either number shouting.

use egui::{Align, Color32, Context, Id, Rect, Sense, Ui, vec2};

use crate::kit::text;
use crate::kit::theme;
use crate::kit::widgets::{self, ResourceGlyph};
use crate::observer::{
    EdgeCursor, STAT_COLOR_BAR, STAT_HEADING_HEIGHT, STAT_ROW_GAP, STAT_ROW_HEIGHT,
    STAT_VALUE_SIZE, Wing, paint_column_heading, paint_resource_value, paint_stat_identity,
    paint_team_divider, paint_text, teams_worth_dividing, vision_alpha, wing_panel,
};
use crate::tr;

/// How wide the panel is, in overlay points.
pub const PANEL_WIDTH: f32 = 486.0;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = 462.0;

/// Gap between the bar of the player's color and their name.
const BAR_GAP: f32 = 8.0;

/// Width the player's name is laid out in. Wider than the economy panel's identity column, because
/// this panel's three value columns together take less of the row than the economy panel's do.
const NAME_WIDTH: f32 = 146.0;

/// Gap between two columns.
const COLUMN_GAP: f32 = 6.0;

/// Width of one of the two halves of the army column.
const VALUE_WIDTH: f32 = 57.0;

/// Gap between the mineral value and the gas value.
const VALUE_GAP: f32 = 14.0;

/// What the army column takes of the row.
const ARMY_WIDTH: f32 = VALUE_WIDTH * 2.0 + VALUE_GAP;

/// Width of the unit kill-and-loss column.
const UNITS_WIDTH: f32 = 88.0;

/// Width of the worker kill-and-loss column.
const WORKERS_WIDTH: f32 = 70.0;

/// The columns are the row and the row is the panel. Checked where the widths are written, because
/// a column more than fits would be drawn outside the panel's chrome.
const _: () = assert!(
    STAT_COLOR_BAR
        + BAR_GAP
        + NAME_WIDTH
        + COLUMN_GAP
        + ARMY_WIDTH
        + COLUMN_GAP
        + UNITS_WIDTH
        + COLUMN_GAP
        + WORKERS_WIDTH
        == CONTENT_WIDTH
);

/// Width of the hairline slash between a kill count and a loss count.
const SLASH_WIDTH: f32 = 8.0;

/// Width the kill count is laid out in, ahead of the slash. Wide enough for four digits, because a
/// loss count sitting a fixed distance from the kill count beside it must not be shoved rightward
/// as the kill count itself gains a digit.
const KILLS_WIDTH: f32 = 36.0;

/// One player's row.
pub struct MilitaryPlayerView {
    pub name: String,
    /// Which side of the game they are on, which is where the table's dividers fall.
    pub team: u8,
    /// The color this player is on the map, which is what ties the row to what the watcher sees.
    pub color: Color32,
    /// Whether the watcher currently sees the game through this player's eyes.
    pub vision: bool,
    /// What the player's standing army cost to build, in each resource.
    pub army_minerals: u32,
    pub army_gas: u32,
    pub units_killed: u32,
    pub units_lost: u32,
    pub worker_kills: u32,
    pub worker_losses: u32,
}

/// Everything the military panel draws from.
pub struct MilitaryView {
    /// The players it has rows for, in the order the game lists them.
    pub players: Vec<MilitaryPlayerView>,
}

impl MilitaryView {
    /// Whether there is anything at all to draw.
    pub fn is_empty(&self) -> bool {
        self.players.is_empty()
    }
}

/// Draws the military panel against the right edge of the screen at `top`, fading and sliding it in
/// and out. Returns nothing at all once it is gone, or while there is nobody to report on.
pub fn render_military_view(
    view: &MilitaryView,
    ctx: &Context,
    shown: bool,
    top: f32,
    right_inset: f32,
) -> Option<Rect> {
    let id = Id::new("sb_military_panel");
    let inner = wing_panel(
        ctx,
        id,
        Wing::Right { inset: right_inset },
        top,
        PANEL_WIDTH,
        shown && !view.is_empty(),
        |ui| draw_panel(ui, view),
    )?;
    Some(inner.response.rect)
}

fn draw_panel(ui: &mut Ui, view: &MilitaryView) {
    widgets::panel_header(ui, &tr!("observer.panelMilitary", "Military"), Some("M"));
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

/// Draws the row of column headings, each aligned the way its column's values are.
fn draw_headings(ui: &mut Ui) {
    let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, STAT_HEADING_HEIGHT), Sense::hover());
    let mut cursor = EdgeCursor::from_left(row);
    cursor.skip(STAT_COLOR_BAR + BAR_GAP + NAME_WIDTH + COLUMN_GAP);
    paint_column_heading(
        ui,
        cursor.take(ARMY_WIDTH),
        &tr!("observer.columnArmyValue", "Army value"),
        Align::LEFT,
    );
    cursor.skip(COLUMN_GAP);
    paint_column_heading(
        ui,
        cursor.take(UNITS_WIDTH),
        &tr!("observer.columnUnitsKillsLosses", "Units k/l"),
        Align::LEFT,
    );
    cursor.skip(COLUMN_GAP);
    paint_column_heading(
        ui,
        cursor.take(WORKERS_WIDTH),
        &tr!("observer.columnWorkersKillsLosses", "Wkr k/l"),
        Align::LEFT,
    );
}

/// Draws one player's row.
fn draw_row(ui: &mut Ui, player: &MilitaryPlayerView) {
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
        cursor.take(VALUE_WIDTH),
        ResourceGlyph::Minerals,
        &player.army_minerals.to_string(),
        Align::LEFT,
        alpha,
    );
    cursor.skip(VALUE_GAP);
    paint_resource_value(
        ui,
        cursor.take(VALUE_WIDTH),
        ResourceGlyph::Gas,
        &player.army_gas.to_string(),
        Align::LEFT,
        alpha,
    );

    cursor.skip(COLUMN_GAP);
    draw_trade(
        ui,
        cursor.take(UNITS_WIDTH),
        player.units_killed,
        player.units_lost,
        alpha,
    );
    cursor.skip(COLUMN_GAP);
    draw_trade(
        ui,
        cursor.take(WORKERS_WIDTH),
        player.worker_kills,
        player.worker_losses,
        alpha,
    );
}

/// Draws one kill-and-loss pair as a run starting at the column's left edge: what the player took,
/// then what it cost them, with the loss count a fixed distance from the kill count rather than
/// centred in whatever room the column happens to have.
fn draw_trade(ui: &Ui, rect: Rect, kills: u32, losses: u32, alpha: f32) {
    let mut cursor = EdgeCursor::from_left(rect);
    paint_text(
        ui,
        cursor.take(KILLS_WIDTH),
        &text::numeral(STAT_VALUE_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
        &kills.to_string(),
        Align::LEFT,
    );
    paint_text(
        ui,
        cursor.take(SLASH_WIDTH),
        &text::numeral(STAT_VALUE_SIZE).with_color(theme::TEXT_LABEL.gamma_multiply(alpha)),
        "/",
        Align::Center,
    );
    paint_text(
        ui,
        cursor.take(rect.width() - KILLS_WIDTH - SLASH_WIDTH),
        &text::numeral(STAT_VALUE_SIZE).with_color(theme::TEXT_DIM.gamma_multiply(alpha)),
        &losses.to_string(),
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
}
