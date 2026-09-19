//! The team cards: what the matchup bar becomes once a game has more players than a bar can hold.
//!
//! Four players still fit across the top of the screen as two stacked pairs. More than two in a
//! half do not, so the bar gives up its halves, keeps the clock alone in the middle, and each half
//! moves into a card of its own in a top corner — at the kit's hero tier, because these carry the
//! match's identity exactly as the bar does.
//!
//! A card is read top to bottom: whose side it is and what the side is sitting on, then a row per
//! player with the four numbers a watcher checks constantly, then the side's totals along the
//! bottom. The totals are the point of the card. In a team game the question is which side is
//! ahead, and four columns of per-player numbers answer that only after the watcher has added them
//! up themselves.
//!
//! A card for a half the game never named — one end of a free-for-all, or of a game split into
//! more sides than there are corners — keeps its rows and gives up both its title and its totals.
//! A sum across players who are not on a side together is a number about nothing, and a title would
//! claim the side that sum implies.
//!
//! Two cards at most, because the design gives them the screen's two top corners and nothing else.

use egui::{Align, Align2, Area, Color32, Context, Id, Order, Rect, Sense, Ui, pos2, vec2};

use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets::{self, ResourceGlyph};
use crate::kit::{motion, theme, tiers};
use crate::observer::{
    DOCK_RESERVE, EdgeCursor, RaceView, STAT_GLYPH, STAT_GLYPH_GAP, STAT_HEADING_HEIGHT,
    STAT_ROW_GAP, STAT_ROW_HEIGHT, WING_MARGIN, Wing, centred, paint_column_heading,
    paint_player_bar, paint_race_chip, paint_text, team_name, vision_alpha,
};
use crate::tr;

/// How wide a card is, in overlay points.
pub const CARD_WIDTH: f32 = 512.0;

/// How far a card's top edge sits below the screen's, level with the clock the bar has become.
pub(crate) const CARD_TOP: f32 = 16.0;

/// The room inside a card's chrome.
const CONTENT_WIDTH: f32 = CARD_WIDTH - 24.0;

/// Corner radius of a card, which floats rather than hanging off an edge.
const CARD_RADIUS: u8 = 6;

/// Height of the card's own title row.
const HEADER_HEIGHT: f32 = 22.0;

/// The bar of the side's own color at the head of the card, which stands taller than the bars in
/// the rows under it: it names the side rather than one of its players.
const HEADER_BAR: f32 = 5.0;
const HEADER_BAR_HEIGHT: f32 = 17.0;

/// How much of a supply count's size its cap is set at.
const SUPPLY_CAP_RATIO: f32 = 0.75;

/// Width of the bar of the player's own color that leads their row.
const COLOR_BAR: f32 = 4.0;

/// Gap between that bar and the race chip.
const BAR_GAP: f32 = 8.0;

/// Diameter of the race chip.
const CHIP: f32 = 18.0;

/// Gap between the chip and the name.
const CHIP_GAP: f32 = 6.0;

/// Width the player's name is laid out in. Fixed, because a name is player-chosen, and it is what
/// the value columns leave: a name has more to say than a number, and a bank past five digits is
/// not a bank anybody keeps.
const NAME_WIDTH: f32 = 142.0;

/// Gap between two columns.
const COLUMN_GAP: f32 = 6.0;

/// Width of each of the four value columns: room for five digits of minerals, four of gas, a supply
/// count against its cap, and three digits of APM.
const MINERAL_WIDTH: f32 = 84.0;
const GAS_WIDTH: f32 = 70.0;
const SUPPLY_WIDTH: f32 = 76.0;
const APM_WIDTH: f32 = 56.0;

/// The columns are the row and the row is the card. Checked where the widths are written, because
/// a column more than fits would be drawn outside the card's chrome.
const _: () = assert!(
    COLOR_BAR
        + BAR_GAP
        + CHIP
        + CHIP_GAP
        + NAME_WIDTH
        + COLUMN_GAP
        + MINERAL_WIDTH
        + COLUMN_GAP
        + GAS_WIDTH
        + COLUMN_GAP
        + SUPPLY_WIDTH
        + COLUMN_GAP
        + APM_WIDTH
        == CONTENT_WIDTH
);

/// Width of each footer cell, and the gap between two of them.
const FOOTER_INCOME: f32 = 140.0;
const FOOTER_ARMY: f32 = 140.0;
const FOOTER_WORKERS: f32 = 80.0;
const FOOTER_TRADE: f32 = 104.0;
const FOOTER_GAP: f32 = 8.0;

// The footer's cells are the card's width too, for the same reason.
const _: () = assert!(
    FOOTER_INCOME + FOOTER_ARMY + FOOTER_WORKERS + FOOTER_TRADE + FOOTER_GAP * 3.0 == CONTENT_WIDTH
);

/// Width of one of the two halves of a footer cell that carries both resources.
const FOOTER_HALF: f32 = (FOOTER_INCOME - FOOTER_GAP) / 2.0;

/// Width of the slash between a kill count and a loss count, and of the kill count ahead of it:
/// room for four digits, so the loss count sits a fixed distance from the kills rather than
/// wherever the cell's middle falls.
const SLASH_WIDTH: f32 = 10.0;
const TRADE_KILLS_WIDTH: f32 = 40.0;

/// Text size of a player's name.
const NAME_SIZE: f32 = 15.0;

/// Text size of the numbers on a player's row.
const VALUE_SIZE: f32 = 18.0;

/// Text size of the side's own totals, which are read before the rows above them.
const TOTAL_SIZE: f32 = 17.0;

/// One player's row on a card.
pub struct TeamCardPlayerView {
    pub name: String,
    /// The color this player is on the map.
    pub color: Color32,
    pub race: RaceView,
    /// Whether the watcher currently sees the game through this player's eyes.
    pub vision: bool,
    pub minerals: u32,
    pub gas: u32,
    /// Supply in the units the game shows, not the halved ones it counts in.
    pub supply_used: u32,
    pub supply_max: u32,
    pub apm: u32,
}

/// What a side has between them, which is the question a team game is actually about.
#[derive(Copy, Clone, Default)]
pub struct TeamCardTotalsView {
    pub minerals_per_minute: u32,
    pub gas_per_minute: u32,
    pub army_minerals: u32,
    pub army_gas: u32,
    pub workers: u32,
    pub units_killed: u32,
    pub units_lost: u32,
}

/// One end of the game: a side of it, or a half of one that has no sides to be read off.
pub struct TeamCardView {
    /// The game's own team number, which is what the card is titled by, or `None` for a half that
    /// stands for no side the game ever named.
    pub team: Option<u8>,
    pub players: Vec<TeamCardPlayerView>,
    /// What the side has between them, or `None` for a card whose players are not on a side
    /// together and so have nothing between them to add up.
    pub totals: Option<TeamCardTotalsView>,
}

impl TeamCardView {
    /// The side's supply, summed over the players on it.
    fn supply(&self) -> (u32, u32) {
        self.players.iter().fold((0, 0), |(used, max), player| {
            (
                used.saturating_add(player.supply_used),
                max.saturating_add(player.supply_max),
            )
        })
    }
}

/// Everything the team cards draw from.
pub struct TeamCardsView {
    /// The two ends of the game, outermost first: the first takes the screen's top-left corner and
    /// the second its top-right. Any other count draws nothing at all.
    pub teams: Vec<TeamCardView>,
}

impl TeamCardsView {
    /// Whether there are two sides to put in the two corners.
    pub fn is_empty(&self) -> bool {
        self.teams.len() != 2
    }
}

/// Where the cards left the wings under them, in points below the screen's top edge.
pub struct TeamCardsOutcome {
    /// Where each card is on screen, for the host's hit testing.
    pub rects: Vec<Rect>,
    /// The bottom edge of the card on each side, or `None` for a side with no card drawn.
    pub left_bottom: Option<f32>,
    pub right_bottom: Option<f32>,
}

/// Draws the two team cards in the screen's top corners, fading and sliding them in and out.
/// Returns nothing at all once they are gone, or for a game that has no two sides to draw.
pub fn render_team_cards_view(
    view: &TeamCardsView,
    ctx: &Context,
    shown: bool,
) -> TeamCardsOutcome {
    let mut outcome = TeamCardsOutcome {
        rects: Vec::new(),
        left_bottom: None,
        right_bottom: None,
    };
    let shown = shown && !view.is_empty();
    for (index, wing) in [Wing::Left, Wing::Right].into_iter().enumerate() {
        let id = Id::new(("sb_team_card", index));
        let (align, offset_x) = match wing {
            Wing::Left => (Align2::LEFT_TOP, WING_MARGIN),
            Wing::Right => (Align2::RIGHT_TOP, -(WING_MARGIN + DOCK_RESERVE)),
        };
        let area = Area::new(id)
            .anchor(align, vec2(offset_x, CARD_TOP))
            .order(Order::Foreground);
        // A side with no card is still asked for, so a game dropping from three sides to two
        // brings the second card back through the same fade the first one entered by.
        let team = view.teams.get(index);
        let Some(inner) = motion::presence_area(
            ctx,
            id.with("presence"),
            shown && team.is_some(),
            area,
            |ui| {
                if let Some(team) = team {
                    draw_card(ui, team);
                }
            },
        ) else {
            continue;
        };
        let rect = inner.response.rect;
        outcome.rects.push(rect);
        let bottom = rect.bottom() - ctx.viewport_rect().top();
        match wing {
            Wing::Left => outcome.left_bottom = Some(bottom),
            Wing::Right => outcome.right_bottom = Some(bottom),
        }
    }
    outcome
}

fn draw_card(ui: &mut Ui, team: &TeamCardView) {
    tiers::tier1_panel(ui, theme::radius(CARD_RADIUS), |ui| {
        // The rows are stacked by the gaps written here and by nothing else: this is a fixed
        // layout, and egui's own item spacing would add to every one of them.
        ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
        ui.set_width(CONTENT_WIDTH);
        // A card standing for a half of the game rather than for a side of it is given neither a
        // title nor totals: both speak for a side, and players who share a card only because the
        // game had to be cut somewhere are not one. The rows take the room the title would have
        // had rather than standing under a band of nothing.
        if let Some(number) = team.team {
            draw_header(ui, team, number);
        }
        draw_headings(ui);
        for player in &team.players {
            ui.add_space(STAT_ROW_GAP);
            draw_player(ui, player);
        }
        if let Some(totals) = &team.totals {
            ui.add_space(theme::SPACE_SM);
            widgets::divider(ui);
            ui.add_space(theme::SPACE_SM);
            draw_totals(ui, totals);
        }
    });
}

/// Draws the card's title row: whose side it is, and what the side is sitting on between them.
fn draw_header(ui: &mut Ui, team: &TeamCardView, number: u8) {
    let (rect, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, HEADER_HEIGHT), Sense::hover());
    let mut cursor = EdgeCursor::from_left(rect);
    // A side's own bar, which is what ties the card in the corner to the units on the map before
    // its title has been read. The colour is the first player's: a side is named after where it
    // sits, and where it sits is where its first slot is.
    if let Some(player) = team.players.first() {
        paint_player_bar(
            ui,
            centred(cursor.take(HEADER_BAR), HEADER_BAR_HEIGHT),
            player.color,
            1.0,
        );
    } else {
        cursor.skip(HEADER_BAR);
    }
    cursor.skip(BAR_GAP);
    paint_text(
        ui,
        cursor.take(CONTENT_WIDTH),
        &text::hero_title(),
        &team_name(number),
        Align::LEFT,
    );
    let (used, max) = team.supply();
    let mut cursor = EdgeCursor::from_right(rect);
    let value = cursor.take(SUPPLY_WIDTH - STAT_GLYPH - STAT_GLYPH_GAP);
    // The cap is what the count is read against rather than a number of its own, so it is set
    // smaller and quieter, the way the matchup bar sets it.
    let mut job = text::numeral(VALUE_SIZE).job(&used.to_string());
    job.append(
        &format!("/{max}"),
        0.0,
        text::numeral(VALUE_SIZE * SUPPLY_CAP_RATIO)
            .with_color(theme::TEXT_DIM)
            .format(),
    );
    let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
    ui.painter().galley(
        pos2(
            value.right() - galley.size().x,
            value.center().y - galley.size().y * 0.5,
        ),
        galley,
        theme::TEXT_PRIMARY,
    );
    cursor.skip(STAT_GLYPH_GAP);
    widgets::paint_resource_glyph(
        ui.painter(),
        centred(cursor.take(STAT_GLYPH), STAT_GLYPH),
        ResourceGlyph::Supply,
        1.0,
    );
}

/// Draws the row of column headings, each aligned the way its column's values are.
fn draw_headings(ui: &mut Ui) {
    let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, STAT_HEADING_HEIGHT), Sense::hover());
    let mut cursor = EdgeCursor::from_left(row);
    cursor.skip(COLOR_BAR + BAR_GAP + CHIP + CHIP_GAP + NAME_WIDTH + COLUMN_GAP);
    for (index, (width, label)) in [
        (MINERAL_WIDTH, tr!("observer.columnMinerals", "Min")),
        (GAS_WIDTH, tr!("observer.columnGas", "Gas")),
        (SUPPLY_WIDTH, tr!("observer.columnSupply", "Supply")),
        (APM_WIDTH, tr!("observer.apm", "APM")),
    ]
    .into_iter()
    .enumerate()
    {
        if index > 0 {
            cursor.skip(COLUMN_GAP);
        }
        paint_column_heading(ui, cursor.take(width), &label, Align::RIGHT);
    }
}

/// Draws one player's row.
fn draw_player(ui: &mut Ui, player: &TeamCardPlayerView) {
    let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, STAT_ROW_HEIGHT), Sense::hover());
    let alpha = vision_alpha(player.vision);
    let mut cursor = EdgeCursor::from_left(row);
    let bar = cursor.take(COLOR_BAR);
    paint_player_bar(
        ui,
        centred(bar, row.height() - theme::SPACE_XS),
        player.color,
        // The color bar keeps more of itself than the rest of a vision-less row: it is what says
        // whose row this is, and two rows dimmed alike are hard to tell apart at a glance.
        if player.vision { 1.0 } else { 0.5 },
    );
    cursor.skip(BAR_GAP);
    paint_race_chip(ui, centred(cursor.take(CHIP), CHIP), player.race, alpha);
    cursor.skip(CHIP_GAP);
    paint_text(
        ui,
        cursor.take(NAME_WIDTH),
        &text::player_name(NAME_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
        &player.name,
        Align::LEFT,
    );

    cursor.skip(COLUMN_GAP);
    let value = |value: &str, color: Color32, rect: Rect| {
        paint_text(
            ui,
            rect,
            &text::numeral(VALUE_SIZE).with_color(color),
            value,
            Align::RIGHT,
        );
    };
    let primary = theme::TEXT_PRIMARY.gamma_multiply(alpha);
    value(
        &player.minerals.to_string(),
        primary,
        cursor.take(MINERAL_WIDTH),
    );
    cursor.skip(COLUMN_GAP);
    value(&player.gas.to_string(), primary, cursor.take(GAS_WIDTH));
    cursor.skip(COLUMN_GAP);
    // Supply past the cap is production time a player is losing, so it is the one number on the
    // card that changes color.
    let supply_color = if player.supply_used > player.supply_max {
        theme::TEXT_NEGATIVE.gamma_multiply(alpha)
    } else {
        primary
    };
    value(
        &format!("{}/{}", player.supply_used, player.supply_max),
        supply_color,
        cursor.take(SUPPLY_WIDTH),
    );
    cursor.skip(COLUMN_GAP);
    value(&player.apm.to_string(), primary, cursor.take(APM_WIDTH));
}

/// Draws the side's totals: two labelled rows, so each number keeps the word that says what it is.
fn draw_totals(ui: &mut Ui, totals: &TeamCardTotalsView) {
    let (headings, _) =
        ui.allocate_exact_size(vec2(CONTENT_WIDTH, STAT_HEADING_HEIGHT), Sense::hover());
    let mut cursor = EdgeCursor::from_left(headings);
    for (index, (width, label)) in [
        (FOOTER_INCOME, tr!("observer.columnIncome", "Income")),
        (FOOTER_ARMY, tr!("observer.columnArmy", "Army")),
        (FOOTER_WORKERS, tr!("observer.columnWorkers", "Workers")),
        (
            FOOTER_TRADE,
            tr!("observer.columnUnitsKillsLosses", "Units k/l"),
        ),
    ]
    .into_iter()
    .enumerate()
    {
        if index > 0 {
            cursor.skip(FOOTER_GAP);
        }
        paint_column_heading(ui, cursor.take(width), &label, Align::LEFT);
    }

    let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, STAT_ROW_HEIGHT), Sense::hover());
    let mut cursor = EdgeCursor::from_left(row);
    draw_pair(
        ui,
        cursor.take(FOOTER_INCOME),
        totals.minerals_per_minute,
        totals.gas_per_minute,
    );
    cursor.skip(FOOTER_GAP);
    draw_pair(
        ui,
        cursor.take(FOOTER_ARMY),
        totals.army_minerals,
        totals.army_gas,
    );
    cursor.skip(FOOTER_GAP);
    paint_text(
        ui,
        cursor.take(FOOTER_WORKERS),
        &text::numeral(TOTAL_SIZE),
        &totals.workers.to_string(),
        Align::LEFT,
    );
    cursor.skip(FOOTER_GAP);
    draw_trade(
        ui,
        cursor.take(FOOTER_TRADE),
        totals.units_killed,
        totals.units_lost,
    );
}

/// Draws one footer cell carrying both resources.
fn draw_pair(ui: &Ui, rect: Rect, minerals: u32, gas: u32) {
    let mut cursor = EdgeCursor::from_left(rect);
    for (index, (glyph, value)) in [
        (ResourceGlyph::Minerals, minerals),
        (ResourceGlyph::Gas, gas),
    ]
    .into_iter()
    .enumerate()
    {
        if index > 0 {
            cursor.skip(FOOTER_GAP);
        }
        let cell = cursor.take(FOOTER_HALF);
        let mut inner = EdgeCursor::from_left(cell);
        widgets::paint_resource_glyph(
            ui.painter(),
            centred(inner.take(STAT_GLYPH), STAT_GLYPH),
            glyph,
            1.0,
        );
        inner.skip(STAT_GLYPH_GAP);
        paint_text(
            ui,
            inner.take(FOOTER_HALF - STAT_GLYPH - STAT_GLYPH_GAP),
            &text::numeral(TOTAL_SIZE),
            &value.to_string(),
            Align::LEFT,
        );
    }
}

/// Draws the side's kill-and-loss pair: what they took, then what it cost them.
fn draw_trade(ui: &Ui, rect: Rect, kills: u32, losses: u32) {
    let mut cursor = EdgeCursor::from_left(rect);
    paint_text(
        ui,
        cursor.take(TRADE_KILLS_WIDTH),
        &text::numeral(TOTAL_SIZE),
        &kills.to_string(),
        Align::LEFT,
    );
    paint_text(
        ui,
        cursor.take(SLASH_WIDTH),
        &text::body(TOTAL_SIZE - 4.0, BodyWeight::Regular).with_color(theme::TEXT_LABEL),
        "/",
        Align::Center,
    );
    paint_text(
        ui,
        cursor.take(rect.width() - TRADE_KILLS_WIDTH - SLASH_WIDTH),
        &text::numeral(TOTAL_SIZE).with_color(theme::TEXT_DIM),
        &losses.to_string(),
        Align::LEFT,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_columns_fill_the_cards_own_width() {
        assert_eq!(
            crate::kit::tiers::panel_content_width(CARD_WIDTH),
            CONTENT_WIDTH
        );
    }

    #[test]
    fn a_sides_supply_is_what_its_players_have_between_them() {
        let player = |used, max| TeamCardPlayerView {
            name: String::new(),
            color: Color32::WHITE,
            race: RaceView::Random,
            vision: true,
            minerals: 0,
            gas: 0,
            supply_used: used,
            supply_max: max,
            apm: 0,
        };
        let team = TeamCardView {
            team: Some(1),
            players: vec![player(42, 60), player(18, 24)],
            totals: Some(TeamCardTotalsView::default()),
        };
        assert_eq!(team.supply(), (60, 84));
    }

    #[test]
    fn a_game_with_any_other_number_of_cards_draws_none_of_them() {
        let card = |team| TeamCardView {
            team,
            players: Vec::new(),
            totals: None,
        };
        assert!(TeamCardsView { teams: Vec::new() }.is_empty());
        assert!(
            TeamCardsView {
                teams: vec![card(Some(1))]
            }
            .is_empty()
        );
        assert!(
            !TeamCardsView {
                teams: vec![card(Some(1)), card(Some(2))]
            }
            .is_empty()
        );
        // The two halves of a game with no sides are two cards like any other pair.
        assert!(
            !TeamCardsView {
                teams: vec![card(None), card(None)]
            }
            .is_empty()
        );
        assert!(
            TeamCardsView {
                teams: vec![card(Some(1)), card(Some(2)), card(Some(3))]
            }
            .is_empty()
        );
    }
}
