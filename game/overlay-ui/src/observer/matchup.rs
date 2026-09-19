//! The matchup bar: who is playing, what they are sitting on, and how far into the game it is.
//!
//! This is the one surface a watcher never turns off, so it is drawn at the kit's hero tier and
//! hangs off the top edge of the screen, where nothing the game draws competes with it: SC:R's own
//! resource counters sit in the top-right corner, and the bar is centred.
//!
//! Its two halves are mirror images about a middle block holding the clock. Each carries one
//! player, and a click on one is how a watcher takes that player's vision: the bar is the only
//! place every player in the game is named, which makes it the natural place to ask to see through
//! one of their eyes. A player whose vision is off is dimmed rather than dropped — they are still in
//! the game, and their numbers are still the ones the other side's are read against.
//!
//! Two players a half still fit across the top: the bar grows, and each half carries them stacked
//! one over the other, leaving an empty slot where a half is short one. A game whose players are
//! not two sides — a free-for-all, or three sides or more — is cut down the middle of the list
//! instead, since a half is then a place to put players rather than a claim about who is fighting
//! whom. Anything wider than two a half belongs in the corner team cards, and the bar keeps its
//! middle block alone, so a watcher is never shown two of six players as though they were the
//! whole game.

use egui::{
    Align, Align2, Area, Color32, Context, Id, Order, Rect, Sense, Ui, UiBuilder, pos2, vec2,
};

use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets::{self, ResourceGlyph, TagStyle};
use crate::kit::{motion, theme, tiers};
use crate::observer::{
    EdgeCursor, RaceView, centred, game_clock, paint_player_bar, paint_race_chip, paint_text,
    vision_alpha,
};
use crate::tr;

/// How wide the bar is with one player on each side, in overlay points.
pub const BAR_WIDTH: f32 = 1200.0;

/// How wide it is with two players stacked on each side.
pub const STACKED_WIDTH: f32 = 1400.0;

/// How wide it is with only its middle block, which is what a game it has no halves for leaves.
pub const CLOCK_WIDTH: f32 = 160.0;

/// How tall the bar is with one player a side.
pub const BAR_HEIGHT: f32 = 64.0;

/// How tall it is with two of them stacked, which is not twice as tall: a stacked row carries the
/// same cells at a size read from a screen away rather than from across a room.
pub const STACKED_HEIGHT: f32 = 86.0;

/// The radius of the two corners that are not against the screen's edge.
const BAR_RADIUS: u8 = 6;

/// Width of the middle block, which holds the clock and the tag saying what is being watched.
const CENTRE_WIDTH: f32 = 150.0;

/// Width of one player's half.
const SIDE_WIDTH: f32 = (BAR_WIDTH - CENTRE_WIDTH) / 2.0;

/// Width of one side of the stacked bar.
const STACKED_SIDE_WIDTH: f32 = (STACKED_WIDTH - CENTRE_WIDTH) / 2.0;

/// Width of the bar of the player's own color along the half's outer edge.
const COLOR_BAR: f32 = 6.0;

/// Gap between the color bar and the player's chip.
const PAD_OUTER: f32 = 12.0;

/// Diameter of the race chip.
const CHIP: f32 = 26.0;

/// Gap between the chip and the name.
const CHIP_GAP: f32 = 8.0;

/// Width the player's name is laid out against. Fixed, because a name is player-chosen: one longer
/// than its slot would otherwise push every number beside it out of the design's grid.
const NAME_WIDTH: f32 = 117.0;

/// Gap between the name and the first number.
const NAME_GAP: f32 = 12.0;

/// Gap between two numbers.
const STAT_GAP: f32 = 10.0;

/// Size of the glyph that says which resource a number counts.
const GLYPH: f32 = 14.0;

/// Gap between a glyph and the number it names.
const GLYPH_GAP: f32 = 6.0;

// How much room each number is laid out in. Every one of them is fixed for the same reason the name
// is: the bar must not breathe as a bank passes a thousand or a supply count gains a digit.
const MINERAL_VALUE: f32 = 46.0;
const GAS_VALUE: f32 = 46.0;
const SUPPLY_VALUE: f32 = 76.0;
const APM_VALUE: f32 = 42.0;

/// Width of the caps label standing in for a glyph on the rate, which counts no resource.
const APM_LABEL: f32 = 26.0;

/// One resource cell of a half: which glyph names it, and the room its number is laid out in.
#[derive(Copy, Clone)]
struct StatCell {
    glyph: ResourceGlyph,
    value_width: f32,
}

impl StatCell {
    /// What the cell takes of the row: its glyph, the gap, and its number.
    const fn width(self) -> f32 {
        GLYPH + GLYPH_GAP + self.value_width
    }

    /// The same cell with more room for its number, for the wider of the bar's two forms.
    const fn widened(self, extra: f32) -> StatCell {
        StatCell {
            value_width: self.value_width + extra,
            ..self
        }
    }
}

const MINERAL_STAT: StatCell = StatCell {
    glyph: ResourceGlyph::Minerals,
    value_width: MINERAL_VALUE,
};
const GAS_STAT: StatCell = StatCell {
    glyph: ResourceGlyph::Gas,
    value_width: GAS_VALUE,
};
const SUPPLY_STAT: StatCell = StatCell {
    glyph: ResourceGlyph::Supply,
    value_width: SUPPLY_VALUE,
};

/// Gap between the last number and the middle block.
const PAD_INNER: f32 = 12.0;

/// Text size of a player's name.
const NAME_SIZE: f32 = 19.0;

/// Text size of every number on the bar.
const VALUE_SIZE: f32 = 24.0;

/// How much of a supply count's size its cap is set at.
const SUPPLY_CAP_RATIO: f32 = 0.71;

/// Type sizes on a stacked row, which has to fit two of itself in not much more than one row's
/// height.
const STACKED_NAME_SIZE: f32 = 16.0;
const STACKED_VALUE_SIZE: f32 = 19.0;

/// Diameter of the race chip on a stacked row, which has half the height to fit it in.
const STACKED_CHIP: f32 = 22.0;

/// How much wider each of the stacked row's cells is than the duel row's.
///
/// The wider bar's extra room is spread across the row rather than dropped into one cell: a row
/// that gave it all to the name would leave its numbers huddled against the clock with a hand's
/// width of nothing before them.
const STACKED_NAME_EXTRA: f32 = 34.0;
const STACKED_VALUE_EXTRA: f32 = 14.0;
const STACKED_PAD_EXTRA: f32 = 14.0;

/// How far a stacked side's rows sit inside the bar, and how far apart they are.
const STACKED_INSET: f32 = 5.0;
const STACKED_ROW_GAP: f32 = 2.0;

/// The sizes one player's row is laid out at. All that differs between the bar's two
/// player-carrying forms, since both are built from the same cells in the same order.
#[derive(Copy, Clone)]
struct RowMetrics {
    chip: f32,
    name_width: f32,
    name_size: f32,
    value_size: f32,
    minerals: StatCell,
    gas: StatCell,
    supply: StatCell,
    apm_value: f32,
    pad_inner: f32,
}

impl RowMetrics {
    /// Everything the row takes but the name, which is what a side's width has to hold besides it.
    ///
    /// A row is the design's grid and nothing else: every cell is placed against the side's own
    /// outer edge, so no number and no translation can move one.
    const fn width(&self) -> f32 {
        COLOR_BAR
            + PAD_OUTER
            + self.chip
            + CHIP_GAP
            + self.name_width
            + NAME_GAP
            + self.minerals.width()
            + STAT_GAP
            + self.gas.width()
            + STAT_GAP
            + self.supply.width()
            + STAT_GAP
            + APM_LABEL
            + GLYPH_GAP
            + self.apm_value
            + self.pad_inner
    }
}

/// The row of a bar carrying one player a side.
const DUEL_ROW: RowMetrics = RowMetrics {
    chip: CHIP,
    name_width: NAME_WIDTH,
    name_size: NAME_SIZE,
    value_size: VALUE_SIZE,
    minerals: MINERAL_STAT,
    gas: GAS_STAT,
    supply: SUPPLY_STAT,
    apm_value: APM_VALUE,
    pad_inner: PAD_INNER,
};

/// The row of a bar carrying two of them stacked.
const STACKED_ROW: RowMetrics = RowMetrics {
    chip: STACKED_CHIP,
    name_width: NAME_WIDTH + STACKED_NAME_EXTRA,
    name_size: STACKED_NAME_SIZE,
    value_size: STACKED_VALUE_SIZE,
    minerals: MINERAL_STAT.widened(STACKED_VALUE_EXTRA),
    gas: GAS_STAT.widened(STACKED_VALUE_EXTRA),
    supply: SUPPLY_STAT.widened(STACKED_VALUE_EXTRA),
    apm_value: APM_VALUE + STACKED_VALUE_EXTRA,
    pad_inner: PAD_INNER + STACKED_PAD_EXTRA,
};

// Checked where the widths are written, because a row that overran would draw its last number
// under the clock.
const _: () = assert!(DUEL_ROW.width() == SIDE_WIDTH);
const _: () = assert!(STACKED_ROW.width() == STACKED_SIDE_WIDTH);

/// Text size of the clock.
const CLOCK_SIZE: f32 = 30.0;

/// Size of the tag under the clock.
const TAG_WIDTH: f32 = 76.0;
const TAG_HEIGHT: f32 = 16.0;

/// How far the tag sits above the bar's bottom edge.
const TAG_BOTTOM_MARGIN: f32 = 6.0;

/// One player as the bar reads them.
pub struct MatchupPlayerView {
    /// The game's own player id, which is what a vision toggle names.
    pub player_id: u8,
    /// Which side of the game they are on, as the game numbers its teams. A game with no teams
    /// gives every player the same number, which is exactly what makes it a game with no sides.
    pub team: u8,
    pub name: String,
    /// The color this player is on the map, which is what ties a half of the bar to what the watcher
    /// is looking at.
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

/// Which of its forms the bar is in.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MatchupForm {
    /// One player on each side of the clock.
    Duel,
    /// Two players stacked on each side of it.
    Stacked,
    /// The clock alone, for a game whose players are read from the corner cards instead.
    ClockOnly,
}

impl MatchupForm {
    /// How tall the bar is in this form, which is what the surfaces hanging under it clear.
    pub fn height(self) -> f32 {
        self.size().1
    }

    /// How wide and how tall the bar is in this form.
    fn size(self) -> (f32, f32) {
        match self {
            MatchupForm::Duel => (BAR_WIDTH, BAR_HEIGHT),
            MatchupForm::Stacked => (STACKED_WIDTH, STACKED_HEIGHT),
            MatchupForm::ClockOnly => (CLOCK_WIDTH, BAR_HEIGHT),
        }
    }
}

/// The game cut into the two ends the bar and the corner cards are built from.
pub struct Halves<'a> {
    pub left: Vec<&'a MatchupPlayerView>,
    pub right: Vec<&'a MatchupPlayerView>,
    /// The game's own numbers for the two halves, for a game that has exactly two sides. A game cut
    /// down the middle instead has halves standing for nothing the game ever named, and naming them
    /// anyway would tell a watcher two players are on a side together when they are not.
    pub teams: Option<(u8, u8)>,
}

impl<'a> Halves<'a> {
    /// The two halves in the order they are drawn, outermost first, each with the side it stands
    /// for where it stands for one.
    pub fn each(self) -> [(Option<u8>, Vec<&'a MatchupPlayerView>); 2] {
        let (left, right) = match self.teams {
            Some((left, right)) => (Some(left), Some(right)),
            None => (None, None),
        };
        [(left, self.left), (right, self.right)]
    }
}

/// Everything the matchup bar draws from.
pub struct MatchupView {
    /// The players on the bar, in team order, which is the order every surface reads them in. The
    /// list is cut into the bar's two halves at the side it changes on where it has two sides, and
    /// down its middle where it has any other number of them.
    pub players: Vec<MatchupPlayerView>,
    /// How far into the game it is, in seconds.
    pub elapsed_secs: u64,
    /// Whether this is a recording rather than a game happening now, which is what the tag says.
    pub is_replay: bool,
}

impl MatchupView {
    /// The game's players grouped into the sides they are on, in the order the sides are listed.
    ///
    /// Grouped here rather than handed over grouped, because every other surface reads the players
    /// as one list in team order and a second shape of the same data could only disagree with it.
    pub fn sides(&self) -> Vec<(u8, Vec<&MatchupPlayerView>)> {
        let mut sides: Vec<(u8, Vec<&MatchupPlayerView>)> = Vec::new();
        for player in &self.players {
            match sides.last_mut() {
                Some((team, members)) if *team == player.team => members.push(player),
                _ => sides.push((player.team, vec![player])),
            }
        }
        sides
    }

    /// The game cut into the left end and the right end of every surface that has two of them.
    ///
    /// A game of two sides is cut where the sides are, and the halves carry their numbers. Every
    /// other shape — one side, or three or more of them — is cut down the middle of the player
    /// list, which is a way of fitting the players on screen and not a reading of the game: those
    /// halves go unnamed, and nothing is ever summed across one.
    pub fn halves(&self) -> Halves<'_> {
        let mut sides = self.sides();
        if sides.len() == 2 {
            let (right_team, right) = sides.remove(1);
            let (left_team, left) = sides.remove(0);
            return Halves {
                left,
                right,
                teams: Some((left_team, right_team)),
            };
        }
        let (left, right) = self.players.split_at(self.players.len().div_ceil(2));
        Halves {
            left: left.iter().collect(),
            right: right.iter().collect(),
            teams: None,
        }
    }

    /// Whether this game has sides worth telling apart from the players on them.
    pub fn has_teams(&self) -> bool {
        let sides = self.sides();
        sides.len() > 1 && sides.iter().any(|(_, members)| members.len() > 1)
    }

    /// Which form the bar takes for this game.
    ///
    /// Two players are a duel whether or not the game calls them two sides, and a game with nobody
    /// left in it keeps its middle block alone. Everything else is stacked for as long as both
    /// halves fit in two rows, and read from the corner cards once one of them does not.
    pub fn form(&self) -> MatchupForm {
        if self.players.is_empty() {
            return MatchupForm::ClockOnly;
        }
        // One player is drawn the way one against one is, with the other half left empty: the wider
        // bar's second row would be a blank under a blank.
        if self.players.len() <= 2 {
            return MatchupForm::Duel;
        }
        let halves = self.halves();
        if halves.left.len() <= 2 && halves.right.len() <= 2 {
            return MatchupForm::Stacked;
        }
        MatchupForm::ClockOnly
    }
}

/// What the watcher asked of the bar this frame.
pub struct MatchupOutcome {
    /// Where the bar is on screen, for the host's hit testing.
    pub rect: Rect,
    /// The player whose vision was asked to change, if one was clicked.
    pub toggled_vision: Option<u8>,
}

/// Draws the matchup bar against the top edge of the screen, fading and sliding it in and out.
/// Returns nothing at all once it is gone.
pub fn render_matchup_view(
    view: &MatchupView,
    ctx: &Context,
    shown: bool,
) -> Option<MatchupOutcome> {
    let id = Id::new("sb_matchup_bar");
    let area = Area::new(id)
        .anchor(Align2::CENTER_TOP, vec2(0.0, 0.0))
        .order(Order::Foreground);
    let inner = motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        draw_bar(ui, view)
    })?;
    Some(MatchupOutcome {
        rect: inner.response.rect,
        toggled_vision: inner.inner,
    })
}

/// Draws the bar and reports which player was clicked.
fn draw_bar(ui: &mut Ui, view: &MatchupView) -> Option<u8> {
    let form = view.form();
    let (width, height) = form.size();
    let (rect, _) = ui.allocate_exact_size(vec2(width, height), Sense::hover());
    ui.painter()
        .add(tiers::tier1_chrome(rect, theme::radius_bottom(BAR_RADIUS)));
    let centre =
        Rect::from_center_size(rect.center(), vec2(CENTRE_WIDTH.min(width), rect.height()));

    let mut clicked = None;
    // Every stacked half is split into both of its slots whether or not it has a player for each,
    // so a half short one leaves its second slot empty rather than growing its one player to the
    // height of two. The slot is left blank rather than filled with anything of its own: the bar
    // is a reading of the game, and a row standing in for a player who does not exist would be a
    // claim the game never made.
    let (metrics, rows) = match form {
        MatchupForm::Stacked => (STACKED_ROW, 2),
        _ => (DUEL_ROW, 1),
    };
    if form != MatchupForm::ClockOnly {
        for (index, (_, members)) in view.halves().each().into_iter().enumerate() {
            let mirrored = index == 1;
            let half = if mirrored {
                Rect::from_min_max(centre.right_top(), rect.right_bottom())
            } else {
                Rect::from_min_max(rect.left_top(), centre.left_bottom())
            };
            for (row, player) in rows_of(half, rows).into_iter().zip(members) {
                let response = ui.interact(
                    row,
                    ui.id().with(("matchup_player", player.player_id)),
                    Sense::click(),
                );
                draw_half(ui, row, player, mirrored, metrics);
                widgets::state_overlay(ui, &response, row, theme::radius(theme::RADIUS_TIGHT));
                if response.clicked() {
                    clicked = Some(player.player_id);
                }
            }
        }
    }
    draw_centre(ui, centre, view);
    clicked
}

/// Splits a half into `count` slots, stacked and evenly spaced.
///
/// A half of one slot is the whole half, so a duel's is exactly the rect it always was rather than
/// a special case of a stack.
fn rows_of(half: Rect, count: usize) -> Vec<Rect> {
    if count <= 1 {
        return vec![half];
    }
    let inner = Rect::from_min_max(
        pos2(half.left(), half.top() + STACKED_INSET),
        pos2(half.right(), half.bottom() - STACKED_INSET),
    );
    let height = (inner.height() - STACKED_ROW_GAP * (count - 1) as f32).max(0.0) / count as f32;
    (0..count)
        .map(|index| {
            let top = inner.top() + index as f32 * (height + STACKED_ROW_GAP);
            Rect::from_min_max(pos2(inner.left(), top), pos2(inner.right(), top + height))
        })
        .collect()
}

/// Draws the middle block: the clock, and the tag saying whether this game is happening now.
///
/// The block is walled off from the halves on either side of it and sits a shade darker than they
/// do, so the one number that belongs to the game rather than to a player reads as its own thing.
fn draw_centre(ui: &mut Ui, rect: Rect, view: &MatchupView) {
    ui.painter()
        .rect_filled(rect, 0, theme::alpha(crate::colors::BLUE10, 0.50));
    for x in [rect.left(), rect.right()] {
        ui.painter().add(egui::Shape::line_segment(
            [
                pos2(x, rect.top()),
                pos2(x, rect.bottom() - f32::from(BAR_RADIUS)),
            ],
            egui::Stroke::new(theme::HAIRLINE, theme::alpha(crate::colors::BLUE60, 0.30)),
        ));
    }
    let tag = if view.is_replay {
        tr!("observer.replayTag", "Replay")
    } else {
        tr!("observer.liveTag", "Live")
    };
    let clock_rect = Rect::from_min_max(
        rect.left_top(),
        pos2(rect.right(), rect.bottom() - TAG_HEIGHT - theme::SPACE_XS),
    );
    paint_text(
        ui,
        clock_rect,
        &text::numeral(CLOCK_SIZE),
        &game_clock(view.elapsed_secs),
        Align::Center,
    );
    let tag_rect = Rect::from_center_size(
        pos2(
            rect.center().x,
            rect.bottom() - TAG_HEIGHT * 0.5 - TAG_BOTTOM_MARGIN,
        ),
        vec2(TAG_WIDTH, TAG_HEIGHT),
    );
    // The tag is placed rather than laid out, so it is drawn in a scope of its own: the kit's tags
    // take their space from whatever layout they are handed, and this one's place is the design's.
    ui.scope_builder(UiBuilder::new().max_rect(tag_rect), |ui| {
        widgets::tag_exact(
            ui,
            &text::column_label(),
            &tag,
            TagStyle::Amber,
            tag_rect.size(),
        );
    });
}

/// Draws one player's row, mirrored about the bar's middle for the side on the right.
fn draw_half(ui: &Ui, rect: Rect, player: &MatchupPlayerView, mirrored: bool, metrics: RowMetrics) {
    let alpha = vision_alpha(player.vision);
    let mut cursor = if mirrored {
        EdgeCursor::from_right(rect)
    } else {
        EdgeCursor::from_left(rect)
    };

    let bar = cursor.take(COLOR_BAR);
    paint_player_bar(
        ui,
        centred(bar, (rect.height() - theme::SPACE_SM).max(theme::SPACE_SM)),
        player.color,
        // The color bar is what says whose row this is, so it keeps more of itself than the rest
        // of a vision-less one: dimming it to the contents' opacity would make two players' rows
        // hard to tell apart at a glance.
        if player.vision { 1.0 } else { 0.5 },
    );
    cursor.skip(PAD_OUTER);
    let chip = cursor.take(metrics.chip);
    paint_race_chip(ui, centred(chip, metrics.chip), player.race, alpha);
    cursor.skip(CHIP_GAP);

    let name = cursor.take(metrics.name_width);
    paint_text(
        ui,
        name,
        &text::player_name(metrics.name_size).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
        &player.name,
        cursor.outer_align(),
    );
    cursor.skip(NAME_GAP);

    draw_stat(
        ui,
        &mut cursor,
        metrics.minerals,
        &player.minerals.to_string(),
        theme::TEXT_PRIMARY.gamma_multiply(alpha),
        alpha,
        metrics.value_size,
    );
    cursor.skip(STAT_GAP);
    draw_stat(
        ui,
        &mut cursor,
        metrics.gas,
        &player.gas.to_string(),
        theme::TEXT_PRIMARY.gamma_multiply(alpha),
        alpha,
        metrics.value_size,
    );
    cursor.skip(STAT_GAP);
    // Supply past the cap is production time a player is losing, so it is the one number on the bar
    // that changes color: a watcher scanning the bar sees the block before they have read either
    // half of the fraction.
    let supply_color = if player.supply_used > player.supply_max {
        theme::TEXT_NEGATIVE
    } else {
        theme::TEXT_PRIMARY
    };
    draw_supply(
        ui,
        &mut cursor,
        metrics,
        player,
        supply_color.gamma_multiply(alpha),
        alpha,
    );
    cursor.skip(STAT_GAP);
    draw_apm(ui, &mut cursor, player.apm, alpha, metrics);
}

/// Draws the supply cell, whose two halves are not read alike: what a player is on is a number they
/// are watching, and what they are capped at is the thing it is being read against, so the cap is
/// set smaller and quieter than the count.
fn draw_supply(
    ui: &Ui,
    cursor: &mut EdgeCursor,
    metrics: RowMetrics,
    player: &MatchupPlayerView,
    color: Color32,
    alpha: f32,
) {
    let cell = metrics.supply;
    let mut inner = EdgeCursor::from_left(cursor.take(cell.width()));
    widgets::paint_resource_glyph(
        ui.painter(),
        centred(inner.take(GLYPH), GLYPH),
        cell.glyph,
        alpha,
    );
    inner.skip(GLYPH_GAP);
    let value_rect = inner.take(cell.value_width);
    let cap_size = metrics.value_size * SUPPLY_CAP_RATIO;
    let job = {
        let mut job = text::numeral(metrics.value_size)
            .with_color(color)
            .job(&player.supply_used.to_string());
        job.append(
            &format!("/{}", player.supply_max),
            0.0,
            text::numeral(cap_size)
                .with_color(theme::TEXT_DIM.gamma_multiply(alpha))
                .format(),
        );
        job
    };
    let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
    ui.painter().galley(
        pos2(
            value_rect.left(),
            value_rect.center().y - galley.size().y * 0.5,
        ),
        galley,
        color,
    );
}

/// Draws one resource cell: the glyph against the half's outer edge, the number beside it.
fn draw_stat(
    ui: &Ui,
    cursor: &mut EdgeCursor,
    cell: StatCell,
    value: &str,
    color: Color32,
    alpha: f32,
    value_size: f32,
) {
    // A cell reads the same way in both halves: the glyph names the resource and the number
    // follows it. Only the order of the cells across a half is mirrored, because a half is read
    // from the screen's edge inwards, while what is inside a cell is read the way every language
    // the overlay speaks reads a label and its value.
    let mut inner = EdgeCursor::from_left(cursor.take(cell.width()));
    let glyph_rect = centred(inner.take(GLYPH), GLYPH);
    widgets::paint_resource_glyph(ui.painter(), glyph_rect, cell.glyph, alpha);
    inner.skip(GLYPH_GAP);
    let value_rect = inner.take(cell.value_width);
    paint_text(
        ui,
        value_rect,
        &text::numeral(value_size).with_color(color),
        value,
        Align::LEFT,
    );
}

/// Draws the rate cell, which is labelled rather than given a glyph: it counts no resource, and the
/// three letters are what every caster already calls it.
fn draw_apm(ui: &Ui, cursor: &mut EdgeCursor, apm: u32, alpha: f32, metrics: RowMetrics) {
    let mut inner = EdgeCursor::from_left(cursor.take(APM_LABEL + GLYPH_GAP + metrics.apm_value));
    let label = inner.take(APM_LABEL);
    paint_text(
        ui,
        label,
        &text::body(11.0, BodyWeight::Medium).with_color(theme::TEXT_LABEL.gamma_multiply(alpha)),
        &tr!("observer.apm", "APM"),
        Align::LEFT,
    );
    inner.skip(GLYPH_GAP);
    let value = inner.take(metrics.apm_value);
    paint_text(
        ui,
        value,
        &text::numeral(metrics.value_size).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
        &apm.to_string(),
        Align::LEFT,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::observer::RaceView;

    fn player(player_id: u8, team: u8) -> MatchupPlayerView {
        MatchupPlayerView {
            player_id,
            team,
            name: String::new(),
            color: Color32::WHITE,
            race: RaceView::Random,
            vision: true,
            minerals: 0,
            gas: 0,
            supply_used: 0,
            supply_max: 0,
            apm: 0,
        }
    }

    fn view(teams: &[u8]) -> MatchupView {
        MatchupView {
            players: teams
                .iter()
                .enumerate()
                .map(|(index, team)| player(index as u8, *team))
                .collect(),
            elapsed_secs: 0,
            is_replay: false,
        }
    }

    /// The player ids in each half, and the sides the halves stand for.
    fn halves(view: &MatchupView) -> (Vec<u8>, Vec<u8>, Option<(u8, u8)>) {
        let halves = view.halves();
        let ids = |members: &[&MatchupPlayerView]| {
            members
                .iter()
                .map(|player| player.player_id)
                .collect::<Vec<_>>()
        };
        (ids(&halves.left), ids(&halves.right), halves.teams)
    }

    #[test]
    fn a_game_of_two_sides_is_cut_where_its_sides_are() {
        assert_eq!(halves(&view(&[1, 2])), (vec![0], vec![1], Some((1, 2))));
        assert_eq!(
            halves(&view(&[1, 1, 2, 2])),
            (vec![0, 1], vec![2, 3], Some((1, 2)))
        );
        // An uneven pair of sides is still cut where they are, however lopsided that leaves it.
        assert_eq!(
            halves(&view(&[1, 1, 1, 2])),
            (vec![0, 1, 2], vec![3], Some((1, 2)))
        );
    }

    #[test]
    fn a_game_of_any_other_number_of_sides_is_cut_down_the_middle_and_left_unnamed() {
        // A free-for-all, where the game gives every player a side of their own.
        assert_eq!(halves(&view(&[1, 2, 3])), (vec![0, 1], vec![2], None));
        assert_eq!(
            halves(&view(&[1, 2, 3, 4, 5, 6])),
            (vec![0, 1, 2], vec![3, 4, 5], None)
        );
        // Four sides of two, which are still listed in side order, so the cut falls between them.
        assert_eq!(
            halves(&view(&[1, 1, 2, 2, 3, 3, 4, 4])),
            (vec![0, 1, 2, 3], vec![4, 5, 6, 7], None)
        );
        // A game the players of which are all on one side, which names no halves either.
        assert_eq!(halves(&view(&[1, 1])), (vec![0], vec![1], None));
        // One player takes a half of their own, leaving the other empty.
        assert_eq!(halves(&view(&[1])), (vec![0], Vec::new(), None));
    }

    #[test]
    fn the_bar_takes_the_form_its_game_has_room_for() {
        assert_eq!(view(&[1]).form(), MatchupForm::Duel);
        assert_eq!(view(&[1, 2]).form(), MatchupForm::Duel);
        // Two players are a duel whether the game calls them two sides or one.
        assert_eq!(view(&[1, 1]).form(), MatchupForm::Duel);
        assert_eq!(view(&[1, 2, 3]).form(), MatchupForm::Stacked);
        assert_eq!(view(&[1, 1, 2]).form(), MatchupForm::Stacked);
        assert_eq!(view(&[1, 2, 3, 4]).form(), MatchupForm::Stacked);
        assert_eq!(view(&[1, 1, 2, 2]).form(), MatchupForm::Stacked);
        // Three in a half is more than the bar can stack, whether they are a side or half a
        // free-for-all.
        assert_eq!(view(&[1, 1, 1, 2]).form(), MatchupForm::ClockOnly);
        assert_eq!(view(&[1, 1, 1, 2, 2, 2]).form(), MatchupForm::ClockOnly);
        assert_eq!(view(&[1, 2, 3, 4, 5, 6]).form(), MatchupForm::ClockOnly);
        assert_eq!(
            view(&[1, 1, 2, 2, 3, 3, 4, 4]).form(),
            MatchupForm::ClockOnly
        );
        assert_eq!(view(&[]).form(), MatchupForm::ClockOnly);
    }

    #[test]
    fn a_game_with_one_player_a_side_has_no_sides_to_tell_apart() {
        assert!(!view(&[1, 2]).has_teams());
        assert!(!view(&[1, 2, 3, 4]).has_teams());
        assert!(view(&[1, 1, 2, 2]).has_teams());
        assert!(view(&[1, 1, 1, 2, 2, 2]).has_teams());
        // Four sides of two are four sides, whatever the halves the bar cuts them into.
        assert!(view(&[1, 1, 2, 2, 3, 3, 4, 4]).has_teams());
    }

    #[test]
    fn the_sides_keep_the_order_the_players_are_listed_in() {
        let view = view(&[1, 1, 2, 2]);
        let sides = view.sides();
        assert_eq!(sides.len(), 2);
        assert_eq!(sides[0].0, 1);
        assert_eq!(
            sides[0].1.iter().map(|p| p.player_id).collect::<Vec<_>>(),
            vec![0, 1]
        );
        assert_eq!(
            sides[1].1.iter().map(|p| p.player_id).collect::<Vec<_>>(),
            vec![2, 3]
        );
    }

    #[test]
    fn a_half_of_one_slot_is_the_whole_half_rather_than_a_stack_of_one() {
        let half = Rect::from_min_max(pos2(0.0, 0.0), pos2(100.0, 64.0));
        assert_eq!(rows_of(half, 1), vec![half]);
        let rows = rows_of(half, 2);
        assert_eq!(rows.len(), 2);
        assert!(rows[0].bottom() < rows[1].top());
        assert!(rows[0].top() >= half.top());
        assert!(rows[1].bottom() <= half.bottom());
    }
}
