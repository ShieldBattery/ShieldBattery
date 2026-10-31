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

use egui::{Align, Align2, Area, Color32, Context, Id, Order, Rect, Sense, Ui, Vec2, pos2, vec2};

use crate::kit::clamp_layout;
use crate::kit::text::{self, BodyWeight, TextSpec};
use crate::kit::widgets::{self, ResourceGlyph};
use crate::kit::{motion, theme, tiers};
use crate::observer::{
    EdgeCursor, RaceView, STAT_GLYPH, STAT_GLYPH_GAP, STAT_HEADING_HEIGHT, STAT_ROW_GAP,
    STAT_ROW_HEIGHT, WING_GAP, WING_MARGIN, Wing, centred, paint_column_heading, paint_count,
    paint_picked_race_chip, paint_player_swatch, paint_player_swatch_in, paint_text, team_name,
    vision_alpha,
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

/// The square of the side's own color at the head of the card, which is larger than the squares in
/// the rows under it: it names the side rather than one of its players.
const HEADER_BAR: f32 = 14.0;

/// How much of a supply count's size its cap is set at.
const SUPPLY_CAP_RATIO: f32 = 0.75;

/// Width of the column the square of the player's own color that leads their row stands in.
const COLOR_BAR: f32 = super::PLAYER_SWATCH;

/// Gap between that square and the race chip.
const BAR_GAP: f32 = 8.0;

/// Diameter of the race chip.
const CHIP: f32 = 18.0;

/// Gap between the chip and the name.
const CHIP_GAP: f32 = 6.0;

/// Width the player's name is laid out in where the card has its design's width. Fixed rather than
/// grown to the longest name, because a name is player-chosen, and it is what the value columns
/// leave: a name has more to say than a number, and a bank past five digits is not a bank anybody
/// keeps.
const NAME_WIDTH: f32 = 134.0;

/// The room a name keeps however narrow the card: about nine letters, which is still the player it
/// names. Below it a row gives up a column rather than eliding the name further.
const MIN_NAME_WIDTH: f32 = 80.0;

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

/// Width of the slash between a kill count and a loss count, and of the kill count ahead of it:
/// room for four digits, so the loss count sits a fixed distance from the kills rather than
/// wherever the cell's middle falls.
const SLASH_WIDTH: f32 = 10.0;
const TRADE_KILLS_WIDTH: f32 = 40.0;

/// Room a column or a totals cell keeps beyond its widest text, so two of them at their tightest
/// still read as two rather than one run of numbers.
const CELL_CLEARANCE: f32 = 6.0;

/// The fewest digits a count is given room for, so a column does not move each time a number in it
/// gains a digit early in the game.
const MIN_RESOURCE_DIGITS: usize = 4;
const MIN_COUNT_DIGITS: usize = 3;

/// A value column on a player's row, in the order the row reads them.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Column {
    Minerals,
    Gas,
    Supply,
    Rate,
}

impl Column {
    const ALL: [Column; 4] = [Column::Minerals, Column::Gas, Column::Supply, Column::Rate];

    fn design_width(self) -> f32 {
        match self {
            Column::Minerals => MINERAL_WIDTH,
            Column::Gas => GAS_WIDTH,
            Column::Supply => SUPPLY_WIDTH,
            Column::Rate => APM_WIDTH,
        }
    }

    fn heading(self) -> String {
        match self {
            Column::Minerals => tr!("observer.columnMinerals", "Min"),
            Column::Gas => tr!("observer.columnGas", "Gas"),
            Column::Supply => tr!("observer.columnSupply", "Supply"),
            Column::Rate => tr!("observer.apm", "APM"),
        }
    }
}

/// A cell of the side's totals, in the order the footer reads them.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum TotalsCell {
    Income,
    Army,
    Workers,
    Trade,
}

impl TotalsCell {
    const ALL: [TotalsCell; 4] = [
        TotalsCell::Income,
        TotalsCell::Army,
        TotalsCell::Workers,
        TotalsCell::Trade,
    ];

    fn design_width(self) -> f32 {
        match self {
            TotalsCell::Income => FOOTER_INCOME,
            TotalsCell::Army => FOOTER_ARMY,
            TotalsCell::Workers => FOOTER_WORKERS,
            TotalsCell::Trade => FOOTER_TRADE,
        }
    }

    fn heading(self) -> String {
        match self {
            TotalsCell::Income => tr!("observer.columnIncome", "Income"),
            TotalsCell::Army => tr!("observer.columnArmy", "Army"),
            TotalsCell::Workers => tr!("observer.columnWorkers", "Workers"),
            TotalsCell::Trade => tr!("observer.columnUnitsKillsLosses", "Units k/l"),
        }
    }
}

/// What a player's row gives up, least missed first, once its columns are as tight as their
/// contents and the name still has less than [`MIN_NAME_WIDTH`]. The rate is the number least
/// often looked for; the supply cap is mostly said already by the count turning red at it; the race
/// chip is said by the units on the map; and gas goes before minerals, which every build spends
/// first.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum RowShed {
    Rate,
    SupplyCap,
    RaceChip,
    Gas,
}

const ROW_SHEDDING: [RowShed; 4] = [
    RowShed::Rate,
    RowShed::SupplyCap,
    RowShed::RaceChip,
    RowShed::Gas,
];

/// The least room each part of a card needs to be drawn whole: a heading or the widest value under
/// it, whichever is wider. Measured across both cards, which share one layout.
#[derive(Copy, Clone, PartialEq, Debug)]
struct CardNeeds {
    /// The widest name on either card, up to [`MIN_NAME_WIDTH`]: a short name needs no more.
    name: f32,
    /// The widest name on either card, up to [`NAME_WIDTH`]: the room that shows every name whole.
    whole_name: f32,
    /// Each value column, in [`Column::ALL`]'s order.
    columns: [f32; 4],
    /// The supply column with its counts alone, for a row that has given up the cap.
    supply_count: f32,
    /// Each cell of the totals, in [`TotalsCell::ALL`]'s order.
    totals: [f32; 4],
}

impl CardNeeds {
    fn measure(ctx: &Context, view: &TeamCardsView) -> CardNeeds {
        let width = |spec: &TextSpec, text: &str| spec.layout(ctx, spec.job(text)).size().x;
        let heading = text::column_label();
        let players = || view.teams.iter().flat_map(|team| &team.players);
        let most = |value: fn(&TeamCardPlayerView) -> u32| players().map(value).max().unwrap_or(0);

        let value = text::numeral(VALUE_SIZE);
        let supply_used = digits(most(|player| player.supply_used), MIN_COUNT_DIGITS);
        let supply_max = digits(most(|player| player.supply_max), MIN_COUNT_DIGITS);
        let columns = Column::ALL.map(|column| {
            let widest = match column {
                Column::Minerals => digits(most(|player| player.minerals), MIN_RESOURCE_DIGITS),
                Column::Gas => digits(most(|player| player.gas), MIN_RESOURCE_DIGITS),
                Column::Supply => format!("{supply_used}/{supply_max}"),
                Column::Rate => digits(most(|player| player.apm), MIN_COUNT_DIGITS),
            };
            width(&heading, &column.heading()).max(width(&value, &widest)) + CELL_CLEARANCE
        });

        let total = text::numeral(TOTAL_SIZE);
        let sides = || view.teams.iter().filter_map(|team| team.totals.as_ref());
        let most = |value: fn(&TeamCardTotalsView) -> u32| sides().map(value).max().unwrap_or(0);
        // Both halves of a pair cell are as wide as the wider of its two numbers.
        let pair = |widest: u32| {
            (STAT_GLYPH + STAT_GLYPH_GAP + width(&total, &digits(widest, MIN_RESOURCE_DIGITS)))
                * 2.0
                + FOOTER_GAP
        };
        let totals = TotalsCell::ALL.map(|cell| {
            let content = match cell {
                TotalsCell::Income => pair(most(|side| {
                    side.minerals_per_minute.max(side.gas_per_minute)
                })),
                TotalsCell::Army => pair(most(|side| side.army_minerals.max(side.army_gas))),
                TotalsCell::Workers => {
                    width(&total, &digits(most(|side| side.workers), MIN_COUNT_DIGITS))
                }
                TotalsCell::Trade => {
                    TRADE_KILLS_WIDTH
                        + SLASH_WIDTH
                        + width(
                            &total,
                            &digits(most(|side| side.units_lost), MIN_COUNT_DIGITS),
                        )
                }
            };
            width(&heading, &cell.heading()).max(content) + CELL_CLEARANCE
        });

        let widest_name = players()
            .map(|player| width(&text::player_name(NAME_SIZE), &player.name))
            .fold(0.0, f32::max);
        CardNeeds {
            name: widest_name.min(MIN_NAME_WIDTH),
            whole_name: widest_name.min(NAME_WIDTH),
            columns,
            supply_count: width(&heading, &Column::Supply.heading())
                .max(width(&value, &supply_used))
                + CELL_CLEARANCE,
            totals,
        }
    }
}

/// As many zeros as `value` has digits, and at least `floor` of them: the room the value takes in
/// tabular numerals, which are all one width.
fn digits(value: u32, floor: usize) -> String {
    let count = value.checked_ilog10().map_or(1, |log| log as usize + 1);
    "0".repeat(count.max(floor))
}

/// How a card is laid out across the width a screen leaves it.
///
/// The design's columns where the card has its design's width. Narrower, the name column gives up
/// the room no name on the cards uses and the value columns tighten toward what they hold, since
/// both are giving up empty space, then the names narrow to [`MIN_NAME_WIDTH`], and past that a
/// row gives up what it misses least (see [`RowShed`]) and hands the room to the name. The totals tighten the same way and then give up the trade, then the
/// workers, rather than eliding a heading partway through a word.
#[derive(Copy, Clone, PartialEq, Debug)]
struct CardLayout {
    content_width: f32,
    race_chip: bool,
    name_width: f32,
    /// Each value column's width in [`Column::ALL`]'s order, or `None` for one the row gave up.
    columns: [Option<f32>; 4],
    /// Whether the supply column shows the cap after the count.
    supply_cap: bool,
    /// Each totals cell's width in [`TotalsCell::ALL`]'s order, or `None` for one given up.
    totals: [Option<f32>; 4],
}

impl CardLayout {
    /// The card a corner `width` points wide holds, at most the design's own.
    fn fitted(width: f32, needs: &CardNeeds) -> CardLayout {
        let content_width = tiers::panel_content_width(width.min(CARD_WIDTH));
        let mut layout = CardLayout {
            content_width,
            race_chip: true,
            name_width: 0.0,
            columns: [None; 4],
            supply_cap: true,
            totals: fit_totals(content_width, &needs.totals),
        };
        let mut shown = [true; 4];
        let steps = std::iter::once(None).chain(ROW_SHEDDING.map(Some));
        for (step, shed) in steps.enumerate() {
            if let Some(shed) = shed {
                match shed {
                    RowShed::Rate => shown[Column::Rate as usize] = false,
                    RowShed::SupplyCap => layout.supply_cap = false,
                    RowShed::RaceChip => layout.race_chip = false,
                    RowShed::Gas => shown[Column::Gas as usize] = false,
                }
            }
            let cells = Column::ALL.map(|column| {
                shown[column as usize].then(|| {
                    let need = if column == Column::Supply && !layout.supply_cap {
                        needs.supply_count
                    } else {
                        needs.columns[column as usize]
                    };
                    (need, column.design_width())
                })
            });
            let lead = COLOR_BAR + BAR_GAP + layout.chip_width();
            let gaps = COLUMN_GAP * cells.iter().flatten().count() as f32;
            let room = content_width - lead - gaps;
            let columns_need: f32 = cells.iter().flatten().map(|&(need, _)| need).sum();
            if room - columns_need < needs.name && step < ROW_SHEDDING.len() {
                continue;
            }
            // Every name is shown whole before the columns grow past what they hold, and the name
            // takes whatever the columns' designs leave over besides.
            let name = clamp_layout(room - columns_need, 0.0, needs.whole_name);
            let (columns, leftover) = spread(cells, room - name);
            layout.columns = columns;
            layout.name_width = name + leftover;
            break;
        }
        layout
    }

    fn column(&self, column: Column) -> Option<f32> {
        self.columns[column as usize]
    }

    /// The room the race chip takes ahead of the name, with the gap after it.
    fn chip_width(&self) -> f32 {
        if self.race_chip { CHIP + CHIP_GAP } else { 0.0 }
    }
}

/// The totals' cells across `content_width`: all four where they fit whole, and otherwise without
/// the trade, then without the workers too. Income and army are what the card's totals are for, so
/// they stay however little room is left.
fn fit_totals(content_width: f32, needs: &[f32; 4]) -> [Option<f32>; 4] {
    let room = |count: usize| content_width - FOOTER_GAP * (count - 1) as f32;
    let fits = |count: usize| needs[..count].iter().sum::<f32>() <= room(count);
    let count = [4, 3].into_iter().find(|&count| fits(count)).unwrap_or(2);
    let cells = TotalsCell::ALL
        .map(|cell| ((cell as usize) < count).then(|| (needs[cell as usize], cell.design_width())));
    let (widths, leftover) = spread(cells, room(count));
    let share = leftover / count as f32;
    widths.map(|width| width.map(|width| width + share))
}

/// Widens `cells`, each given as the room it needs and its design width, within `room`: each grows
/// from its need toward its design by the same share of what it lacks, and one that needs more than
/// its design keeps its need. Returns the widths and what of `room` is left once every cell has its
/// design. Too little room for every need squeezes them all alike.
fn spread(cells: [Option<(f32, f32)>; 4], room: f32) -> ([Option<f32>; 4], f32) {
    let need: f32 = cells.iter().flatten().map(|&(need, _)| need).sum();
    let short: f32 = cells
        .iter()
        .flatten()
        .map(|&(need, design)| (design - need).max(0.0))
        .sum();
    let spare = room - need;
    if spare < 0.0 {
        let squeeze = room.max(0.0) / need;
        return (cells.map(|cell| cell.map(|(need, _)| need * squeeze)), 0.0);
    }
    let share = if short > 0.0 {
        (spare / short).min(1.0)
    } else {
        0.0
    };
    (
        cells.map(|cell| cell.map(|(need, design)| need + (design - need).max(0.0) * share)),
        (spare - short).max(0.0),
    )
}

/// Text size of a player's name.
const NAME_SIZE: f32 = 15.0;

/// Text size of the numbers on a player's row.
const VALUE_SIZE: f32 = 18.0;

/// Text size of the side's own totals, which are read before the rows above them.
const TOTAL_SIZE: f32 = 17.0;

/// One player's row on a card.
pub struct TeamCardPlayerView {
    /// The game's own slot for this player, which is what a click on their row toggles the vision
    /// of.
    pub player_id: u8,
    pub name: String,
    /// The color this player is on the map.
    pub color: Color32,
    pub race: RaceView,
    /// Whether the player left their race to chance in the lobby, which their chip marks beside
    /// the race the pick resolved to.
    pub random: bool,
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
    /// The player whose row was clicked, whose vision the click toggles as it does on the bar.
    pub toggled_vision: Option<u8>,
}

/// Draws the two team cards in the screen's top corners, fading and sliding them in and out.
/// Returns nothing at all once they are gone, or for a game that has no two sides to draw.
///
/// Both cards are as wide as a corner leaves: two cards of different widths would read as two kinds
/// of card. A corner ends where the clock the bar has become begins.
pub fn render_team_cards_view(
    view: &TeamCardsView,
    ctx: &Context,
    shown: bool,
) -> TeamCardsOutcome {
    let screen = ctx.viewport_rect();
    let corner = (screen.width() - super::matchup::CLOCK_WIDTH) * 0.5 - WING_GAP - WING_MARGIN;
    let layout = CardLayout::fitted(corner, &CardNeeds::measure(ctx, view));
    let mut outcome = TeamCardsOutcome {
        rects: Vec::new(),
        left_bottom: None,
        right_bottom: None,
        toggled_vision: None,
    };
    let shown = shown && !view.is_empty();
    for (index, wing) in [Wing::Left, Wing::Right].into_iter().enumerate() {
        let id = Id::new(("sb_team_card", index));
        let (align, offset_x) = match wing {
            Wing::Left => (Align2::LEFT_TOP, WING_MARGIN),
            Wing::Right => (Align2::RIGHT_TOP, -WING_MARGIN),
        };
        let area = Area::new(id)
            .anchor(align, vec2(offset_x, CARD_TOP))
            .order(Order::Foreground);
        // A side with no card is still asked for, so a game dropping from three sides to two
        // brings the second card back through the same fade the first one entered by.
        let team = view.teams.get(index);
        let Some(inner) = motion::presence_area_from_top(
            ctx,
            id.with("presence"),
            shown && team.is_some(),
            area,
            |ui| team.and_then(|team| draw_card(ui, team, layout)),
        ) else {
            continue;
        };
        outcome.toggled_vision = outcome.toggled_vision.or(inner.inner);
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

/// Draws one card and returns the player whose row was clicked.
fn draw_card(ui: &mut Ui, team: &TeamCardView, layout: CardLayout) -> Option<u8> {
    tiers::tier1_panel(ui, theme::radius(CARD_RADIUS), |ui| {
        // The rows are stacked by the gaps written here and by nothing else: this is a fixed
        // layout, and egui's own item spacing would add to every one of them.
        ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
        ui.set_width(layout.content_width);
        // A half of the game rather than a side of it gets neither a title nor totals, since both
        // speak for a side. The rows take the room the title would have had.
        if let Some(number) = team.team {
            draw_header(ui, team, number, layout);
        }
        draw_headings(ui, layout);
        let mut clicked = None;
        for player in &team.players {
            ui.add_space(STAT_ROW_GAP);
            if draw_player(ui, player, layout) {
                clicked = Some(player.player_id);
            }
        }
        if let Some(totals) = &team.totals {
            ui.add_space(theme::SPACE_SM);
            widgets::divider(ui);
            ui.add_space(theme::SPACE_SM);
            draw_totals(ui, totals, layout);
        }
        clicked
    })
    .inner
}

/// Draws the card's title row: whose side it is, and what the side is sitting on between them.
fn draw_header(ui: &mut Ui, team: &TeamCardView, number: u8, layout: CardLayout) {
    let (rect, _) =
        ui.allocate_exact_size(vec2(layout.content_width, HEADER_HEIGHT), Sense::hover());
    let mut cursor = EdgeCursor::from_left(rect);
    // A side's own bar, which is what ties the card in the corner to the units on the map before
    // its title has been read. The color is the first player's: a side is named after where it
    // sits, and where it sits is where its first slot is.
    if let Some(player) = team.players.first() {
        let column = cursor.take(HEADER_BAR);
        let square = Rect::from_center_size(column.center(), Vec2::splat(HEADER_BAR));
        paint_player_swatch(ui, square, player.color, 1.0);
    } else {
        cursor.skip(HEADER_BAR);
    }
    cursor.skip(BAR_GAP);
    paint_text(
        ui,
        cursor.take(layout.content_width),
        &text::hero_title(),
        &team_name(number),
        Align::LEFT,
    );
    let (used, max) = team.supply();
    let mut cursor = EdgeCursor::from_right(rect);
    let value = cursor.take(SUPPLY_WIDTH - STAT_GLYPH - STAT_GLYPH_GAP);
    // The cap is what the count is read against rather than a number of its own, so it is set
    // smaller and quieter, the way the matchup bar sets it.
    let spec = text::numeral(VALUE_SIZE);
    let mut job = spec.job(&used.to_string());
    job.append(
        &format!("/{max}"),
        0.0,
        text::numeral(VALUE_SIZE * SUPPLY_CAP_RATIO)
            .with_color(theme::TEXT_DIM)
            .format(),
    );
    let galley = spec.layout(ui.ctx(), job);
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
fn draw_headings(ui: &mut Ui, layout: CardLayout) {
    let (row, _) = ui.allocate_exact_size(
        vec2(layout.content_width, STAT_HEADING_HEIGHT),
        Sense::hover(),
    );
    let mut cursor = EdgeCursor::from_left(row);
    cursor.skip(COLOR_BAR + BAR_GAP + layout.chip_width() + layout.name_width);
    for column in Column::ALL {
        if let Some(width) = layout.column(column) {
            cursor.skip(COLUMN_GAP);
            paint_column_heading(ui, cursor.take(width), &column.heading(), Align::RIGHT);
        }
    }
}

/// Draws one player's row.
/// Draws one player's row and returns whether it was clicked.
fn draw_player(ui: &mut Ui, player: &TeamCardPlayerView, layout: CardLayout) -> bool {
    let (row, response) =
        ui.allocate_exact_size(vec2(layout.content_width, STAT_ROW_HEIGHT), Sense::click());
    widgets::state_overlay(ui, &response, row, theme::radius(theme::RADIUS_TIGHT));
    let alpha = vision_alpha(player.vision);
    let mut cursor = EdgeCursor::from_left(row);
    paint_player_swatch_in(
        ui,
        cursor.take(COLOR_BAR),
        player.color,
        // The swatch keeps more of itself than the rest of a vision-less row: it is what says
        // whose row this is, and two rows dimmed alike are hard to tell apart at a glance.
        if player.vision { 1.0 } else { 0.5 },
    );
    cursor.skip(BAR_GAP);
    if layout.race_chip {
        paint_picked_race_chip(
            ui,
            centred(cursor.take(CHIP), CHIP),
            player.race,
            player.random,
            alpha,
        );
        cursor.skip(CHIP_GAP);
    }
    paint_text(
        ui,
        cursor.take(layout.name_width),
        &text::player_name(NAME_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
        &player.name,
        Align::LEFT,
    );

    let primary = theme::TEXT_PRIMARY.gamma_multiply(alpha);
    // Supply at or past the cap is production time a player is losing, so it is the one number on the
    // card that changes color.
    let supply_color = if super::matchup::supply_blocked(player.supply_used, player.supply_max) {
        theme::TEXT_NEGATIVE.gamma_multiply(alpha)
    } else {
        primary
    };
    for column in Column::ALL {
        let Some(width) = layout.column(column) else {
            continue;
        };
        cursor.skip(COLUMN_GAP);
        let rect = cursor.take(width);
        let spec = text::numeral(VALUE_SIZE);
        match column {
            Column::Minerals => paint_count(
                ui,
                rect,
                &spec.with_color(primary),
                player.minerals,
                Align::RIGHT,
            ),
            Column::Gas => paint_count(
                ui,
                rect,
                &spec.with_color(primary),
                player.gas,
                Align::RIGHT,
            ),
            Column::Supply if layout.supply_cap => paint_text(
                ui,
                rect,
                &spec.with_color(supply_color),
                &format!("{}/{}", player.supply_used, player.supply_max),
                Align::RIGHT,
            ),
            Column::Supply => paint_text(
                ui,
                rect,
                &spec.with_color(supply_color),
                &player.supply_used.to_string(),
                Align::RIGHT,
            ),
            Column::Rate => paint_text(
                ui,
                rect,
                &spec.with_color(primary),
                &player.apm.to_string(),
                Align::RIGHT,
            ),
        }
    }
    response.clicked()
}

/// Draws the side's totals: two labeled rows, so each number keeps the word that says what it is.
fn draw_totals(ui: &mut Ui, totals: &TeamCardTotalsView, layout: CardLayout) {
    let cells = || {
        TotalsCell::ALL
            .into_iter()
            .filter_map(|cell| layout.totals[cell as usize].map(|width| (cell, width)))
    };
    let (headings, _) = ui.allocate_exact_size(
        vec2(layout.content_width, STAT_HEADING_HEIGHT),
        Sense::hover(),
    );
    let mut cursor = EdgeCursor::from_left(headings);
    for (index, (cell, width)) in cells().enumerate() {
        if index > 0 {
            cursor.skip(FOOTER_GAP);
        }
        paint_column_heading(ui, cursor.take(width), &cell.heading(), Align::LEFT);
    }

    let (row, _) =
        ui.allocate_exact_size(vec2(layout.content_width, STAT_ROW_HEIGHT), Sense::hover());
    let mut cursor = EdgeCursor::from_left(row);
    for (index, (cell, width)) in cells().enumerate() {
        if index > 0 {
            cursor.skip(FOOTER_GAP);
        }
        let rect = cursor.take(width);
        match cell {
            TotalsCell::Income => {
                draw_pair(ui, rect, totals.minerals_per_minute, totals.gas_per_minute)
            }
            TotalsCell::Army => draw_pair(ui, rect, totals.army_minerals, totals.army_gas),
            TotalsCell::Workers => paint_text(
                ui,
                rect,
                &text::numeral(TOTAL_SIZE),
                &totals.workers.to_string(),
                Align::LEFT,
            ),
            TotalsCell::Trade => draw_trade(ui, rect, totals.units_killed, totals.units_lost),
        }
    }
}

/// Draws one footer cell carrying both resources.
fn draw_pair(ui: &Ui, rect: Rect, minerals: u32, gas: u32) {
    let half = (rect.width() - FOOTER_GAP) * 0.5;
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
        let cell = cursor.take(half);
        let mut inner = EdgeCursor::from_left(cell);
        widgets::paint_resource_glyph(
            ui.painter(),
            centred(inner.take(STAT_GLYPH), STAT_GLYPH),
            glyph,
            1.0,
        );
        inner.skip(STAT_GLYPH_GAP);
        paint_count(
            ui,
            inner.take(half - STAT_GLYPH - STAT_GLYPH_GAP),
            &text::numeral(TOTAL_SIZE),
            value,
            Align::LEFT,
        );
    }
}

/// Draws the side's kill-and-loss pair: what they took, then what it cost them.
fn draw_trade(ui: &Ui, rect: Rect, kills: u32, losses: u32) {
    let mut cursor = EdgeCursor::from_left(rect);
    paint_count(
        ui,
        cursor.take(TRADE_KILLS_WIDTH),
        &text::numeral(TOTAL_SIZE),
        kills,
        Align::LEFT,
    );
    paint_text(
        ui,
        cursor.take(SLASH_WIDTH),
        &text::body(TOTAL_SIZE - 4.0, BodyWeight::Regular).with_color(theme::TEXT_LABEL),
        "/",
        Align::Center,
    );
    paint_count(
        ui,
        cursor.take(rect.width() - TRADE_KILLS_WIDTH - SLASH_WIDTH),
        &text::numeral(TOTAL_SIZE).with_color(theme::TEXT_DIM),
        losses,
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

    /// What an English card of a late game measures, near enough.
    fn needs() -> CardNeeds {
        CardNeeds {
            name: MIN_NAME_WIDTH,
            whole_name: NAME_WIDTH,
            columns: [44.0, 44.0, 66.0, 33.0],
            supply_count: 40.0,
            totals: [118.0, 118.0, 64.0, 82.0],
        }
    }

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() < 0.01
    }

    /// Everything a row lays out across the card, which is the card's content width wherever a
    /// name has any room at all.
    fn row_width(layout: &CardLayout) -> f32 {
        COLOR_BAR
            + BAR_GAP
            + layout.chip_width()
            + layout.name_width
            + layout
                .columns
                .iter()
                .flatten()
                .map(|width| COLUMN_GAP + width)
                .sum::<f32>()
    }

    fn totals_width(layout: &CardLayout) -> f32 {
        let cells = layout.totals.iter().flatten();
        cells.clone().sum::<f32>() + FOOTER_GAP * (cells.count() - 1) as f32
    }

    /// Which of [`ROW_SHEDDING`] a layout has given up, as a count from the front of it.
    fn shed(layout: &CardLayout) -> usize {
        let given_up = [
            layout.column(Column::Rate).is_none(),
            !layout.supply_cap,
            !layout.race_chip,
            layout.column(Column::Gas).is_none(),
        ];
        let count = given_up.iter().take_while(|&&given_up| given_up).count();
        assert!(
            given_up[count..].iter().all(|&given_up| !given_up),
            "a row gave up {given_up:?}, out of order"
        );
        count
    }

    #[test]
    fn a_card_with_its_design_width_keeps_the_design_columns() {
        let layout = CardLayout::fitted(CARD_WIDTH + 40.0, &needs());
        assert_eq!(layout.content_width, CONTENT_WIDTH);
        assert!(close(layout.name_width, NAME_WIDTH));
        assert!(layout.race_chip && layout.supply_cap);
        for column in Column::ALL {
            assert!(close(layout.column(column).unwrap(), column.design_width()));
        }
        for cell in TotalsCell::ALL {
            assert!(close(
                layout.totals[cell as usize].unwrap(),
                cell.design_width()
            ));
        }
    }

    #[test]
    fn a_heading_longer_than_its_design_column_is_given_its_room_from_the_others() {
        let mut needs = needs();
        needs.columns[Column::Supply as usize] = SUPPLY_WIDTH + 12.0;
        needs.totals[TotalsCell::Workers as usize] = FOOTER_WORKERS + 16.0;
        let layout = CardLayout::fitted(CARD_WIDTH, &needs);
        assert!(close(layout.name_width, NAME_WIDTH));
        assert!(close(
            layout.column(Column::Supply).unwrap(),
            SUPPLY_WIDTH + 12.0
        ));
        assert!(layout.column(Column::Rate).is_some());
        assert!(close(
            layout.totals[TotalsCell::Workers as usize].unwrap(),
            FOOTER_WORKERS + 16.0
        ));
        assert!(close(row_width(&layout), CONTENT_WIDTH));
        assert!(close(totals_width(&layout), CONTENT_WIDTH));
    }

    #[test]
    fn a_narrow_card_tightens_its_columns_before_it_narrows_names() {
        let layout = CardLayout::fitted(CARD_WIDTH - 48.0, &needs());
        assert!(close(layout.name_width, NAME_WIDTH));
        assert_eq!(shed(&layout), 0);
        for column in Column::ALL {
            let width = layout.column(column).unwrap();
            assert!(width >= needs().columns[column as usize] && width < column.design_width());
        }
    }

    #[test]
    fn a_narrowing_card_gives_up_what_its_rows_miss_least_first_and_keeps_names_readable() {
        let needs = needs();
        let mut last_shed = 0;
        let mut width = CARD_WIDTH;
        while width >= 200.0 {
            let layout = CardLayout::fitted(width, &needs);
            let shed = shed(&layout);
            assert!(
                shed >= last_shed,
                "a narrower card took back what it gave up"
            );
            last_shed = shed;
            if shed < ROW_SHEDDING.len() {
                assert!(
                    layout.name_width >= needs.name - 0.01,
                    "at {width}: {layout:?}"
                );
            }
            assert!(close(row_width(&layout), layout.content_width));
            width -= 1.0;
        }
        assert_eq!(last_shed, ROW_SHEDDING.len());
    }

    #[test]
    fn short_names_leave_their_room_to_the_columns() {
        let short_names = CardNeeds {
            name: 40.0,
            whole_name: 40.0,
            ..needs()
        };
        // The room no name uses is given up before any column tightens.
        let layout = CardLayout::fitted(CARD_WIDTH - 48.0, &short_names);
        assert!(close(layout.name_width, NAME_WIDTH - 48.0));
        for column in Column::ALL {
            assert!(close(layout.column(column).unwrap(), column.design_width()));
        }
        // And a row whose names are short keeps more of itself.
        assert!(
            shed(&CardLayout::fitted(300.0, &short_names))
                < shed(&CardLayout::fitted(300.0, &needs()))
        );
    }

    #[test]
    fn narrow_totals_give_up_the_trade_then_the_workers_and_never_the_resources() {
        let needs = needs();
        let shown = |width: f32| {
            let layout = CardLayout::fitted(width, &needs);
            assert!(close(totals_width(&layout), layout.content_width));
            layout.totals.map(|cell| cell.is_some())
        };
        assert_eq!(shown(CARD_WIDTH - 48.0), [true; 4]);
        assert_eq!(shown(380.0), [true, true, true, false]);
        assert_eq!(shown(300.0), [true, true, false, false]);
        assert_eq!(shown(200.0), [true, true, false, false]);
    }

    #[test]
    fn a_count_is_given_room_for_its_digits_and_never_fewer_than_the_floor() {
        assert_eq!(digits(0, 3), "000");
        assert_eq!(digits(7, 1), "0");
        assert_eq!(digits(1143, 3), "0000");
        assert_eq!(digits(12345, 4), "00000");
    }

    #[test]
    fn a_sides_supply_is_what_its_players_have_between_them() {
        let player = |used, max| TeamCardPlayerView {
            player_id: 0,
            name: String::new(),
            color: Color32::WHITE,
            race: RaceView::Random,
            random: false,
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
