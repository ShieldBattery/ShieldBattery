//! The matchup bar: who is playing, what they are sitting on, and how far into the game it is.
//!
//! This is the one surface a watcher never turns off, so it is drawn at the kit's hero tier and
//! hangs off the top edge of the screen, where nothing the game draws competes with it: SC:R's own
//! resource counters sit in the top-right corner, and the bar is centered.
//!
//! Its two halves sit either side of a middle block holding the clock. Each player's color, race and
//! name stand at the screen's edge, framing the bar from the outside, and their numbers stand against
//! the clock in the same order in both halves, so a watcher reading across one half has already
//! learned the other. A click on a player takes their vision: the bar is the only place every
//! player in the game is named. A player whose vision is off is dimmed rather than dropped, since
//! their numbers are still the ones the other side's are read against.
//!
//! Two players a half still fit across the top: the bar grows, and each half carries them stacked
//! one over the other, leaving an empty slot where a half is short one. A game whose players are
//! not two sides — a free-for-all, or three sides or more — is cut down the middle of the list
//! instead, since a half is then a place to put players rather than a claim about who is fighting
//! whom. Anything wider than two a half belongs in the corner team cards, and the bar keeps its
//! middle block alone, so a watcher is never shown two of six players as though they were the
//! whole game.
//!
//! A game that is one of a series carries the series with it. Each side's score stands in a cell of
//! its own against the clock, on the side of it that side's players are on, and a tab hung under
//! the middle of the bar names the series and how far into it this game is. The series is part of
//! the matchup rather than a surface of its own: it comes and goes with the bar, and in the compact
//! scoreboard it leads the rows and follows the title instead.

use std::sync::Arc;

use egui::{
    Align, Align2, Area, Color32, Context, Galley, Id, Order, Rect, Sense, Ui, UiBuilder, pos2,
    vec2,
};

use crate::kit::text::{self, BodyWeight, TextSpec};
use crate::kit::widgets::{self, ResourceGlyph, TagStyle};
use crate::kit::{motion, theme, tiers};
use crate::observer::{
    EdgeCursor, RaceView, centred, game_clock, paint_count, paint_picked_race_chip,
    paint_player_bar, paint_text, vision_alpha,
};
use crate::observer::{layout, map_control, team_cards};
use crate::{tr, tr_plural};

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

/// Width of the cell a side's series score stands in, against the middle block.
const SCORE_CELL: f32 = 50.0;

/// What the two score cells add to the bar's width. The halves keep theirs, so the bar grows by
/// exactly this, and a screen too narrow for it squeezes the halves and never the cells.
const SCORES_WIDTH: f32 = SCORE_CELL * 2.0;

/// Text size of a series score on the bar: the clock's, being read at the same glance.
const SCORE_SIZE: f32 = 30.0;

/// Height of the tab hung under the bar's middle that names the series.
pub(crate) const TAB_HEIGHT: f32 = 22.0;

/// The narrowest the series tab is: the middle block and its two score cells, which it hangs from.
const TAB_MIN_WIDTH: f32 = CENTRE_WIDTH + SCORES_WIDTH;

/// Padding either side of the series line inside its tab.
const TAB_PAD: f32 = 12.0;

/// Gap either side of the dot that separates the parts of a series line.
const SEPARATOR_GAP: f32 = 6.0;

/// The narrowest a series title is elided to before it is left out of the line altogether: room for
/// a letter and the ellipsis, below which an elided title says nothing.
const MIN_TITLE_WIDTH: f32 = 24.0;

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
const NAME_WIDTH: f32 = 113.0;

/// Gap between the name and the first number.
const NAME_GAP: f32 = 12.0;

/// Gap between two numbers.
const STAT_GAP: f32 = 10.0;

/// Size of the glyph that says which resource a number counts.
const GLYPH: f32 = 14.0;

/// Gap between a glyph and the number it names.
const GLYPH_GAP: f32 = 6.0;

// How much room each number is laid out in. Every one of them is fixed for the same reason the name
// is: the bar must not breathe as a bank passes a thousand or a supply count gains a digit. The
// rate gets the banks' room for four digits, which fast hands pass in a busy fight.
const MINERAL_VALUE: f32 = 46.0;
const GAS_VALUE: f32 = 46.0;
const SUPPLY_VALUE: f32 = 76.0;
const APM_VALUE: f32 = 46.0;

/// Width of the caps label standing in for a glyph on the rate, which counts no resource.
const APM_LABEL: f32 = 26.0;

/// One resource cell of a half: which glyph names it, and the room its number is laid out in.
#[derive(Copy, Clone, PartialEq)]
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
/// player-carrying forms, since both are built from the same cells in the same order, and what a
/// screen too narrow for either takes away from them.
#[derive(Copy, Clone, PartialEq)]
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
    /// Whether the row carries the rate at its inner end. The last thing a narrow screen gives up
    /// (see [`RowMetrics::fitted`]): a player's bank and supply are the reading, their rate is
    /// color.
    apm: bool,
}

impl RowMetrics {
    /// What the row takes of its side.
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
            + self.stats_width()
            + self.pad_inner
    }

    /// What the row's numbers take together, from the first resource to the rate.
    const fn stats_width(&self) -> f32 {
        self.minerals.width()
            + STAT_GAP
            + self.gas.width()
            + STAT_GAP
            + self.supply.width()
            + self.apm_width()
    }

    /// What the rate cell takes, with the gap ahead of it.
    const fn apm_width(&self) -> f32 {
        if self.apm {
            STAT_GAP + APM_LABEL + GLYPH_GAP + self.apm_value
        } else {
            0.0
        }
    }

    /// How much wider than the duel's own the row's numbers and its inner padding are, which is the
    /// room a narrow screen takes back first: it is room the wider bar was given to breathe in,
    /// not room any number needs.
    fn spare(&self) -> f32 {
        (self.minerals.value_width - MINERAL_VALUE)
            + (self.gas.value_width - GAS_VALUE)
            + (self.supply.value_width - SUPPLY_VALUE)
            + (self.apm_value - APM_VALUE)
            + (self.pad_inner - PAD_INNER)
    }

    /// This row with `share` of its [`spare`](Self::spare) room taken back, from 0 (none) to 1.
    fn shed(self, share: f32) -> RowMetrics {
        let shed = |value: f32, base: f32| value - (value - base) * share;
        RowMetrics {
            minerals: StatCell {
                value_width: shed(self.minerals.value_width, MINERAL_VALUE),
                ..self.minerals
            },
            gas: StatCell {
                value_width: shed(self.gas.value_width, GAS_VALUE),
                ..self.gas
            },
            supply: StatCell {
                value_width: shed(self.supply.value_width, SUPPLY_VALUE),
                ..self.supply
            },
            apm_value: shed(self.apm_value, APM_VALUE),
            pad_inner: shed(self.pad_inner, PAD_INNER),
            ..self
        }
    }

    /// This row squeezed into a side `side` wide.
    ///
    /// Taken back in the order a watcher misses least: the breathing room the wider bar was given,
    /// then the name down to the narrowest that still reads as one, then the rate. A side narrower
    /// than a row with all of that gone keeps the row anyway, which no screen the game runs at
    /// comes near.
    fn fitted(self, side: f32) -> RowMetrics {
        let mut row = self;
        let excess = row.width() - side;
        if excess <= 0.0 {
            return row;
        }
        let spare = row.spare();
        if spare > 0.0 {
            row = row.shed((excess / spare).min(1.0));
        }
        let excess = row.width() - side;
        if excess <= 0.0 {
            return row;
        }
        let squeeze = excess.min((row.name_width - MIN_NAME_WIDTH).max(0.0));
        row.name_width -= squeeze;
        if row.width() > side {
            row.apm = false;
        }
        row
    }
}

/// The narrowest a name slot is squeezed to before the row gives up its rate instead: about the
/// width of six letters, which is a name a watcher still recognizes with its end elided.
const MIN_NAME_WIDTH: f32 = 64.0;

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
    apm: true,
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
    apm: true,
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
    /// Finished workers of every race the player owns.
    pub workers: u32,
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
        match self {
            MatchupForm::Stacked => STACKED_HEIGHT,
            MatchupForm::Duel | MatchupForm::ClockOnly => BAR_HEIGHT,
        }
    }

    /// How wide the bar is in this form given all the room it wants, with the series scores' cells
    /// where `scored`.
    fn natural_width(self, scored: bool) -> f32 {
        let width = match self {
            MatchupForm::Duel => BAR_WIDTH,
            MatchupForm::Stacked => STACKED_WIDTH,
            MatchupForm::ClockOnly => CLOCK_WIDTH,
        };
        width + middle_extra(scored)
    }

    /// How the bar is laid out across `available` points of the screen's width: its width, and
    /// the row each half's players are drawn in.
    ///
    /// The design's widths where they fit, and the halves squeezed to fit where they do not: a 4:3
    /// screen is 1280 points wide, which the stacked bar's 1400 would run off both ends of. The
    /// middle block and the score cells beside it are never squeezed, being the parts of the bar
    /// that are about the game itself.
    fn layout(self, available: f32, scored: bool) -> (f32, RowMetrics) {
        let natural = self.natural_width(scored);
        let row = match self {
            MatchupForm::Stacked => STACKED_ROW,
            _ => DUEL_ROW,
        };
        if self == MatchupForm::ClockOnly || natural <= available {
            return (natural, row);
        }
        let middle = middle_width(scored);
        let side = ((available - middle) * 0.5).max(0.0);
        (side * 2.0 + middle, row.fitted(side))
    }
}

/// What the series scores' cells add to the middle of the bar, where `scored`.
fn middle_extra(scored: bool) -> f32 {
    if scored { SCORES_WIDTH } else { 0.0 }
}

/// How wide the middle of the bar is: the middle block, and the score cells either side of it where
/// `scored`.
fn middle_width(scored: bool) -> f32 {
    CENTRE_WIDTH + middle_extra(scored)
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
    /// Where the series this game is one of stood when it started, for a game that is one. Drawn
    /// only while the players are two sides, which is what its two scores stand beside.
    pub series: Option<SeriesView>,
}

/// How a series is played, as far as the overlay says anything about it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SeriesFormat {
    /// The side that wins the most of `length` games takes the series.
    BestOf { length: u32 },
}

/// Where a series stood when one of its games started: everything the overlay says about it, none
/// of which it works out for itself.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SeriesView {
    /// What a person named the series, if anyone did.
    pub title: Option<String>,
    pub format: SeriesFormat,
    /// Which game of the series this is, counting from one.
    pub game_number: u32,
    /// Each side's number, in the order the matchup lists its sides: the side whose players come
    /// first, which takes the left of the bar and the top of the scoreboard, then the other. For a
    /// best-of it is the games the side has won so far.
    pub scores: [u32; 2],
}

impl SeriesView {
    /// What the series line says about how far into the series this game is, which stays whole
    /// wherever it is drawn: the title is what gives way to a narrow line.
    pub(crate) fn progress(&self) -> String {
        match self.format {
            SeriesFormat::BestOf { length } => tr_plural!(
                "observer.bestOfGame",
                length,
                one = "Best of {{count}} · Game {{game}}",
                other = "Best of {{count}} · Game {{game}}",
                game = self.game_number
            ),
        }
    }

    /// The color each side's score is set in: the side ahead in the primary text color and the one
    /// behind in the secondary one, and both in the primary while they are level.
    pub(crate) fn score_colors(&self) -> [Color32; 2] {
        let [first, second] = self.scores;
        [
            if first >= second {
                theme::TEXT_PRIMARY
            } else {
                theme::TEXT_SECONDARY
            },
            if second >= first {
                theme::TEXT_PRIMARY
            } else {
                theme::TEXT_SECONDARY
            },
        ]
    }
}

/// A series line laid out for the room it is drawn in: the title where there is room for it, the
/// dots between the parts, and how far into the series the game is.
pub(crate) struct SeriesLine {
    /// Whether a dot leads the line, for a line that follows something of its own.
    lead: bool,
    /// The title, elided to the room the rest of the line leaves it.
    title: Option<Arc<Galley>>,
    /// The dot between the title and the rest, laid out once and painted wherever a dot goes.
    separator: Arc<Galley>,
    progress: Arc<Galley>,
}

impl SeriesLine {
    /// The style every part of a series line is set in.
    fn spec() -> TextSpec {
        text::column_label()
    }

    /// Lays `series` out in `room` points, with a dot ahead of it where `lead` asks for one.
    ///
    /// How far into the series the game is never gives way: the title is elided first, and left out
    /// once there is too little room for any of it to read.
    pub(crate) fn lay_out(ctx: &Context, series: &SeriesView, room: f32, lead: bool) -> SeriesLine {
        let spec = SeriesLine::spec();
        let separator = spec.layout(ctx, spec.job(&tr!("observer.seriesLineSeparator", "·")));
        let progress = spec.layout(ctx, spec.job(&series.progress()));
        let dot = separator.size().x + SEPARATOR_GAP * 2.0;
        let lead_width = if lead { dot } else { 0.0 };
        let title_room = room - lead_width - dot - progress.size().x;
        let title = series
            .title
            .as_deref()
            .filter(|title| !title.is_empty() && title_room >= MIN_TITLE_WIDTH)
            .map(|title| spec.layout(ctx, spec.job_truncated(title, title_room)));
        SeriesLine {
            lead,
            title,
            separator,
            progress,
        }
    }

    /// How wide the line is with the whole of `series`' title in it.
    pub(crate) fn natural_width(ctx: &Context, series: &SeriesView, lead: bool) -> f32 {
        SeriesLine::lay_out(ctx, series, f32::INFINITY, lead).width()
    }

    /// How wide the line is as laid out.
    pub(crate) fn width(&self) -> f32 {
        let dot = self.separator.size().x + SEPARATOR_GAP * 2.0;
        let lead = if self.lead { dot } else { 0.0 };
        let title = self
            .title
            .as_ref()
            .map_or(0.0, |title| title.size().x + dot);
        lead + title + self.progress.size().x
    }

    /// Whether how far into the series the game is came out whole, for the checks that it always
    /// does.
    #[cfg(test)]
    pub(crate) fn progress_whole(&self) -> bool {
        !self.progress.elided
    }

    /// Paints the line from `left`, its parts centered on `middle` down the screen.
    pub(crate) fn paint(&self, ui: &Ui, left: f32, middle: f32) {
        let spec = SeriesLine::spec();
        let middle = egui::emath::GuiRounding::round_to_pixels(middle, ui.ctx().pixels_per_point());
        let mut x = if self.lead {
            left + SEPARATOR_GAP
        } else {
            left
        };
        let mut put = |galley: &Arc<Galley>, gap: f32| {
            ui.painter().galley(
                pos2(x, middle - galley.size().y * 0.5),
                galley.clone(),
                spec.color,
            );
            x += galley.size().x + gap;
        };
        if self.lead {
            put(&self.separator, SEPARATOR_GAP);
        }
        if let Some(title) = &self.title {
            put(title, SEPARATOR_GAP);
            put(&self.separator, SEPARATOR_GAP);
        }
        put(&self.progress, 0.0);
    }
}

impl MatchupView {
    /// The series this game is one of, where there is one to draw: a game whose players are not two
    /// sides has nowhere to stand two scores, and is drawn as though it were no series at all.
    pub fn shown_series(&self) -> Option<&SeriesView> {
        let mut sides = 0;
        let mut current = None;
        for player in &self.players {
            if current != Some(player.team) {
                current = Some(player.team);
                sides += 1;
            }
        }
        self.series.as_ref().filter(|_| sides == 2)
    }

    /// How wide the bar is when it is its middle block alone, which is what the corner cards keep
    /// clear of: wider in a series game, by the scores beside the clock.
    pub fn clock_block_width(&self) -> f32 {
        MatchupForm::ClockOnly.natural_width(self.shown_series().is_some())
    }

    /// How far down the screen the bar reaches, the series tab hung under its middle included:
    /// what a surface hung under the middle of the bar clears.
    pub fn bar_depth(&self) -> f32 {
        let tab = if self.shown_series().is_some() {
            TAB_HEIGHT
        } else {
            0.0
        };
        self.form().height() + tab
    }
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
    /// Where the series tab hung under the bar is, in a series game.
    pub tab: Option<Rect>,
    /// The player whose vision was asked to change, if one was clicked.
    pub toggled_vision: Option<u8>,
}

/// Draws the matchup bar against the top edge of the screen, fading and sliding it in and out.
/// Returns nothing at all once it is gone.
///
/// The bar takes no more of the screen's width than leaves the margin every edge surface keeps at
/// both ends.
pub fn render_matchup_view(
    view: &MatchupView,
    ctx: &Context,
    shown: bool,
) -> Option<MatchupOutcome> {
    let id = Id::new("sb_matchup_bar");
    let area = Area::new(id)
        .anchor(Align2::CENTER_TOP, vec2(0.0, 0.0))
        .order(Order::Foreground);
    let screen = ctx.viewport_rect();
    let available = screen.width() - layout::screen_margin(screen) * 2.0;
    let inner = motion::presence_area_from_top(ctx, id.with("presence"), shown, area, |ui| {
        draw_bar(ui, view, available, screen)
    })?;
    let (toggled_vision, tab) = inner.inner;
    Some(MatchupOutcome {
        rect: inner.response.rect,
        tab,
        toggled_vision,
    })
}

/// How wide the series tab may be on `screen`: the room between the surfaces hung beside the bar's
/// middle, measured as the map-control strip measures it, against the wider of the stats wings
/// whether or not either is up. A game read from the corner cards measures against them too, as
/// wide as they are beside a clock block `block` wide.
fn tab_room(screen: Rect, form: MatchupForm, block: f32) -> f32 {
    let wings = map_control::room_between_wings(screen);
    if form == MatchupForm::ClockOnly {
        wings.min(team_cards::room_between_cards(screen, block))
    } else {
        wings
    }
}

/// How wide the series tab is for `series`, given `room` between the surfaces beside it: as wide as
/// its line and the padding either side, never narrower than what it hangs from nor wider than the
/// room. Where the room is narrower than what it hangs from, which no screen the game runs at comes
/// near, it keeps the width it hangs from.
fn tab_width(ctx: &Context, series: &SeriesView, room: f32) -> f32 {
    let natural = SeriesLine::natural_width(ctx, series, false) + TAB_PAD * 2.0;
    // An even number of whole points, so a tab centered on the bar lands on whole pixels.
    let width = (natural * 0.5).ceil() * 2.0;
    width.clamp(TAB_MIN_WIDTH, room.max(TAB_MIN_WIDTH))
}

/// Draws the bar across no more than `available` points of `screen` and reports which player was
/// clicked, and where the series tab went in a series game.
fn draw_bar(
    ui: &mut Ui,
    view: &MatchupView,
    available: f32,
    screen: Rect,
) -> (Option<u8>, Option<Rect>) {
    let form = view.form();
    let series = view.shown_series();
    let (width, metrics) = form.layout(available, series.is_some());
    let height = form.height();
    let (rect, _) = ui.allocate_exact_size(vec2(width, height), Sense::hover());
    ui.painter()
        .add(tiers::tier1_chrome(rect, theme::radius_bottom(BAR_RADIUS)));
    let middle = Rect::from_center_size(
        rect.center(),
        vec2(middle_width(series.is_some()).min(width), rect.height()),
    );
    let centre =
        Rect::from_center_size(rect.center(), vec2(CENTRE_WIDTH.min(width), rect.height()));

    let mut clicked = None;
    // Every stacked half is split into both of its slots whether or not it has a player for each,
    // so a half short one leaves its second slot empty rather than growing its one player to the
    // height of two. The slot is left blank rather than filled with anything of its own: the bar
    // is a reading of the game, and a row standing in for a player who does not exist would be a
    // claim the game never made.
    let rows = match form {
        MatchupForm::Stacked => 2,
        _ => 1,
    };
    if form != MatchupForm::ClockOnly {
        for (index, (_, members)) in view.halves().each().into_iter().enumerate() {
            let mirrored = index == 1;
            let half = if mirrored {
                Rect::from_min_max(middle.right_top(), rect.right_bottom())
            } else {
                Rect::from_min_max(rect.left_top(), middle.left_bottom())
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
    let tab = series.map(|series| {
        let colors = series.score_colors();
        let left = Rect::from_min_max(pos2(middle.left(), rect.top()), centre.left_bottom());
        let right = Rect::from_min_max(centre.right_top(), pos2(middle.right(), rect.bottom()));
        draw_score_cell(ui, left, left.left(), series.scores[0], colors[0]);
        draw_score_cell(ui, right, right.right(), series.scores[1], colors[1]);
        let room = tab_room(screen, form, view.clock_block_width());
        draw_tab(ui, rect, series, tab_width(ui.ctx(), series, room))
    });
    (clicked, tab)
}

/// Draws one side's series score in its cell against the middle block, shaded as the block is and
/// walled off at `wall`, its edge against the half beside it, by the hairline the block is.
fn draw_score_cell(ui: &Ui, rect: Rect, wall: f32, score: u32, color: Color32) {
    ui.painter()
        .rect_filled(rect, 0, theme::alpha(crate::colors::BLUE10, 0.50));
    paint_block_wall(ui, rect, wall);
    paint_text(
        ui,
        rect,
        &text::numeral_strong(SCORE_SIZE).with_color(color),
        &score.to_string(),
        Align::Center,
    );
}

/// Paints the hairline that walls the bar's middle off from what is beside it, at `x` down `rect`.
fn paint_block_wall(ui: &Ui, rect: Rect, x: f32) {
    ui.painter().add(egui::Shape::line_segment(
        // Inside the bar's own edge at both ends: a translucent line drawn on into the edge
        // doubles up with it into a brighter pixel where the two cross.
        [
            pos2(x, rect.top() + theme::HAIRLINE),
            pos2(x, rect.bottom() - theme::HAIRLINE),
        ],
        egui::Stroke::new(theme::HAIRLINE, theme::alpha(crate::colors::BLUE60, 0.30)),
    ));
}

/// Draws the series tab `width` wide under the middle of `bar`, joined to it, and returns where it
/// went.
///
/// An ambient surface rather than a part of the hero bar above it: the line it carries is read once
/// a game rather than at every glance, so it hangs quieter than the scores it explains.
fn draw_tab(ui: &Ui, bar: Rect, series: &SeriesView, width: f32) -> Rect {
    let tab = Rect::from_min_size(
        pos2(bar.center().x - width * 0.5, bar.bottom()),
        vec2(width, TAB_HEIGHT),
    );
    tiers::paint_tier0_joined(
        ui.painter(),
        tab,
        theme::radius(theme::RADIUS_PANEL),
        tiers::Joined {
            edge: tiers::Edge::Top,
            divides: false,
        },
    );
    let line = SeriesLine::lay_out(ui.ctx(), series, width - TAB_PAD * 2.0, false);
    line.paint(ui, tab.center().x - line.width() * 0.5, tab.center().y);
    tab
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
        paint_block_wall(ui, rect, x);
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

/// Draws one player's row: who they are from the half's outer edge inwards, mirrored for the side on
/// the right, then their numbers in the one order both halves share.
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
    paint_picked_race_chip(
        ui,
        centred(chip, metrics.chip),
        player.race,
        player.random,
        alpha,
    );
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

    // The numbers are one block, taken from whichever side the half is laid out from and read left
    // to right inside it.
    let mut cursor = EdgeCursor::from_left(cursor.take(metrics.stats_width()));
    draw_stat(
        ui,
        &mut cursor,
        metrics.minerals,
        player.race,
        player.minerals,
        alpha,
        metrics.value_size,
    );
    cursor.skip(STAT_GAP);
    draw_stat(
        ui,
        &mut cursor,
        metrics.gas,
        player.race,
        player.gas,
        alpha,
        metrics.value_size,
    );
    cursor.skip(STAT_GAP);
    // A supply block is production time a player is losing, so it is the one number on the bar
    // that changes color: a watcher scanning the bar sees the block before they have read either
    // half of the fraction. Blocked is at or past what their depots provide; a player at the
    // game's own ceiling is maxed out rather than blocked, and has nothing more to build.
    let supply_color = if supply_blocked(player.supply_used, player.supply_max) {
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
    if metrics.apm {
        cursor.skip(STAT_GAP);
        draw_apm(ui, &mut cursor, player.apm, alpha, metrics);
    }
}

/// The most supply the game lets anyone have, in the units the game shows.
const SUPPLY_CEILING: u32 = 200;

/// Whether a player can build nothing more until they provide more supply.
pub(crate) fn supply_blocked(used: u32, max: u32) -> bool {
    used > 0 && used >= max && max < SUPPLY_CEILING
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
    widgets::paint_resource_icon(
        ui.painter(),
        centred(inner.take(GLYPH), GLYPH),
        cell.glyph,
        player.race.resource_race(),
        alpha,
    );
    inner.skip(GLYPH_GAP);
    let value_rect = inner.take(cell.value_width);
    let cap_size = metrics.value_size * SUPPLY_CAP_RATIO;
    let spec = text::numeral(metrics.value_size).with_color(color);
    let job = {
        let mut job = spec.job(&player.supply_used.to_string());
        job.append(
            &format!("/{}", player.supply_max),
            0.0,
            text::numeral(cap_size)
                .with_color(theme::TEXT_DIM.gamma_multiply(alpha))
                .format(),
        );
        job
    };
    let galley = spec.layout(ui.ctx(), job);
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
    race: RaceView,
    value: u32,
    alpha: f32,
    value_size: f32,
) {
    let color = theme::TEXT_PRIMARY.gamma_multiply(alpha);
    // The glyph names the resource and the number follows it.
    let mut inner = EdgeCursor::from_left(cursor.take(cell.width()));
    let glyph_rect = centred(inner.take(GLYPH), GLYPH);
    widgets::paint_resource_icon(
        ui.painter(),
        glyph_rect,
        cell.glyph,
        race.resource_race(),
        alpha,
    );
    inner.skip(GLYPH_GAP);
    let value_rect = inner.take(cell.value_width);
    paint_count(
        ui,
        value_rect,
        &text::numeral(value_size).with_color(color),
        value,
        Align::LEFT,
    );
}

/// Draws the rate cell, which is labeled rather than given a glyph: it counts no resource, and the
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

    #[test]
    fn a_player_at_their_depots_cap_is_blocked_and_one_at_the_ceiling_is_not() {
        assert!(supply_blocked(9, 9));
        assert!(supply_blocked(30, 26));
        assert!(!supply_blocked(8, 9));
        assert!(!supply_blocked(200, 200));
        assert!(!supply_blocked(0, 0));
    }
    use crate::observer::RaceView;

    fn player(player_id: u8, team: u8) -> MatchupPlayerView {
        MatchupPlayerView {
            player_id,
            team,
            name: String::new(),
            color: Color32::WHITE,
            race: RaceView::Random,
            random: false,
            vision: true,
            minerals: 0,
            gas: 0,
            supply_used: 0,
            supply_max: 0,
            workers: 0,
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
            series: None,
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
    fn the_bar_keeps_its_design_widths_wherever_they_fit() {
        let (width, row) = MatchupForm::Duel.layout(1888.0, false);
        assert_eq!(width, BAR_WIDTH);
        assert!(row == DUEL_ROW);
        let (width, row) = MatchupForm::Stacked.layout(1888.0, false);
        assert_eq!(width, STACKED_WIDTH);
        assert!(row == STACKED_ROW);
        assert_eq!(MatchupForm::Duel.layout(1248.0, false).0, BAR_WIDTH);
    }

    #[test]
    fn a_narrow_screen_squeezes_the_halves_and_never_the_clock() {
        // A 4:3 screen, less the margin at each end.
        let (width, row) = MatchupForm::Stacked.layout(1248.0, false);
        assert_eq!(width, 1248.0);
        assert!(row.width() <= (1248.0 - CENTRE_WIDTH) * 0.5 + 0.01);
        // The breathing room goes first, so the names give up only the little it did not cover,
        // and keep more room than a duel's do. The rate is all there.
        assert!(row.name_width < STACKED_ROW.name_width);
        assert!(row.name_width > NAME_WIDTH);
        assert!(row.apm);
    }

    #[test]
    fn the_rate_is_the_last_thing_a_row_gives_up() {
        let side = |row: RowMetrics| row.width();
        let squeezed = DUEL_ROW.fitted(side(DUEL_ROW) - 40.0);
        assert!(squeezed.apm);
        assert_eq!(squeezed.name_width, NAME_WIDTH - 40.0);
        let squeezed = DUEL_ROW.fitted(side(DUEL_ROW) - 80.0);
        assert!(!squeezed.apm);
        assert_eq!(squeezed.name_width, MIN_NAME_WIDTH);
        assert!(squeezed.width() <= side(DUEL_ROW) - 80.0);
    }

    /// How wide `text` is when set as a number on a row laid out at `metrics`.
    fn value_width(metrics: RowMetrics, text: &str) -> f32 {
        let ctx = Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        let spec = text::numeral(metrics.value_size);
        let mut width = 0.0;
        let mut output = ctx.run_ui(egui::RawInput::default(), |_| {
            width = spec.layout(&ctx, spec.job(text)).size().x;
        });
        output.textures_delta.clear();
        width
    }

    #[test]
    fn the_rate_holds_four_digits_whole_at_every_width() {
        // Fast players and bots alike pass a thousand, and an elided rate reads as nothing at all.
        // Tabular digits all take one width, so any four of them are as wide as these.
        for row in [DUEL_ROW, STACKED_ROW, DUEL_ROW.fitted(SIDE_WIDTH - 40.0)] {
            assert!(
                value_width(row, "8888") <= row.apm_value,
                "{} > {}",
                value_width(row, "8888"),
                row.apm_value
            );
        }
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

    /// A series as long as a series line gets: a best of ninety-nine at twelve to eleven going
    /// into its twenty-fourth game, under fifty of the widest letter as its title.
    fn longest_series() -> SeriesView {
        SeriesView {
            title: Some("W".repeat(50)),
            format: SeriesFormat::BestOf { length: 99 },
            game_number: 24,
            scores: [12, 11],
        }
    }

    fn series_view(teams: &[u8], series: SeriesView) -> MatchupView {
        MatchupView {
            series: Some(series),
            ..view(teams)
        }
    }

    const SMALL_SCREEN: egui::Vec2 = vec2(1280.0, 720.0);

    /// The bar's rect and its tab's once a screen of `size` has settled around them.
    fn settled_bar(view: &MatchupView, size: egui::Vec2) -> (Rect, Option<Rect>) {
        crate::observer::test_support::settled_at(size, |ctx| {
            render_matchup_view(view, ctx, true).map(|outcome| (outcome.rect, outcome.tab))
        })
        .expect("the bar is drawn")
    }

    #[test]
    fn a_series_widens_the_bar_by_its_score_cells_and_leaves_its_height() {
        let wide = vec2(1920.0, 1080.0);
        for (teams, plain_width, height) in [
            (&[1, 2][..], 1200.0, BAR_HEIGHT),
            (&[1, 1, 2, 2][..], 1400.0, STACKED_HEIGHT),
            (&[1, 1, 1, 2, 2, 2][..], 160.0, BAR_HEIGHT),
        ] {
            let (plain, no_tab) = settled_bar(&view(teams), wide);
            assert_eq!(plain.size(), vec2(plain_width, height), "{teams:?}");
            assert!(no_tab.is_none());
            let (scored, tab) = settled_bar(&series_view(teams, longest_series()), wide);
            assert_eq!(
                scored.size(),
                vec2(plain_width + 100.0, height),
                "{teams:?}"
            );
            let tab = tab.expect("a series game hangs a tab");
            assert_eq!(tab.top(), scored.bottom());
            assert_eq!(tab.height(), TAB_HEIGHT);
            assert!((tab.center().x - scored.center().x).abs() < 0.5);
        }
    }

    #[test]
    fn a_narrow_screen_keeps_the_score_cells_whole_and_squeezes_the_halves() {
        let (width, row) = MatchupForm::Duel.layout(1248.0, true);
        assert_eq!(width, 1248.0);
        assert!((row.width() - (1248.0 - CENTRE_WIDTH - SCORES_WIDTH) * 0.5).abs() < 0.01);
        assert!(row.name_width < NAME_WIDTH);
        let (width, _) = MatchupForm::ClockOnly.layout(1248.0, true);
        assert_eq!(width, CLOCK_WIDTH + SCORES_WIDTH);
    }

    #[test]
    fn the_series_tab_keeps_to_the_room_beside_it_and_its_progress_stays_whole() {
        let screen = Rect::from_min_size(egui::Pos2::ZERO, SMALL_SCREEN);
        for teams in [
            &[1, 2][..],
            &[1, 1, 2, 2],
            &[1, 1, 1, 2, 2, 2],
            &[1, 1, 1, 1, 2, 2, 2, 2],
        ] {
            let view = series_view(teams, longest_series());
            let (bar, tab) = settled_bar(&view, SMALL_SCREEN);
            let tab = tab.expect("a series game hangs a tab");
            let room = tab_room(screen, view.form(), view.clock_block_width());
            assert!(tab.width() <= room + 0.01, "{teams:?}: {tab:?} in {room}");
            assert!(tab.width() >= TAB_MIN_WIDTH, "{teams:?}: {tab:?}");
            // Centered on the screen's middle line, so the room is the same either side of it.
            assert!((tab.center().x - screen.center().x).abs() < 0.5);
            assert!((bar.center().x - screen.center().x).abs() < 0.5);

            let (whole, width) = crate::observer::test_support::settled_at(SMALL_SCREEN, |ctx| {
                let line = SeriesLine::lay_out(
                    ctx,
                    &view.series.clone()?,
                    tab.width() - TAB_PAD * 2.0,
                    false,
                );
                Some((line.progress_whole(), line.width()))
            })
            .expect("the line is laid out");
            assert!(whole, "{teams:?}");
            assert!(
                width <= tab.width() - TAB_PAD * 2.0 + 0.01,
                "{teams:?}: {width}"
            );
        }
    }

    #[test]
    fn a_series_line_gives_up_its_title_before_its_progress() {
        let series = longest_series();
        let (with_room, squeezed, without_room) =
            crate::observer::test_support::settled_at(SMALL_SCREEN, |ctx| {
                let natural = SeriesLine::natural_width(ctx, &series, false);
                let progress_only = SeriesLine::natural_width(
                    ctx,
                    &SeriesView {
                        title: None,
                        ..series.clone()
                    },
                    false,
                );
                Some((
                    SeriesLine::lay_out(ctx, &series, natural, false),
                    SeriesLine::lay_out(ctx, &series, (natural + progress_only) * 0.5, false),
                    SeriesLine::lay_out(ctx, &series, progress_only, false),
                ))
            })
            .expect("the lines are laid out");
        assert!(with_room.title.as_ref().is_some_and(|title| !title.elided));
        assert!(squeezed.title.as_ref().is_some_and(|title| title.elided));
        assert!(without_room.title.is_none());
        for line in [with_room, squeezed, without_room] {
            assert!(line.progress_whole());
        }
    }

    #[test]
    fn the_team_cards_keep_clear_of_the_clock_block_a_series_widens() {
        let view = series_view(&[1, 1, 1, 2, 2, 2], longest_series());
        let cards = crate::observer::TeamCardsView {
            teams: view
                .halves()
                .each()
                .into_iter()
                .map(|(team, members)| crate::observer::TeamCardView {
                    team,
                    players: members
                        .iter()
                        .map(|player| crate::observer::TeamCardPlayerView {
                            player_id: player.player_id,
                            name: "W".repeat(24),
                            color: player.color,
                            race: player.race,
                            random: false,
                            vision: true,
                            minerals: 0,
                            gas: 0,
                            supply_used: 0,
                            supply_max: 0,
                            apm: 0,
                        })
                        .collect(),
                    totals: None,
                })
                .collect(),
        };
        let (bar, tab, card_rects) =
            crate::observer::test_support::settled_at(SMALL_SCREEN, |ctx| {
                let bar = render_matchup_view(&view, ctx, true)?;
                let cards = crate::observer::render_team_cards_view(
                    &cards,
                    ctx,
                    true,
                    view.clock_block_width(),
                );
                Some((bar.rect, bar.tab?, cards.rects))
            })
            .expect("the bar and the cards are drawn");
        assert_eq!(bar.width(), CLOCK_WIDTH + SCORES_WIDTH);
        assert_eq!(card_rects.len(), 2);
        for card in card_rects {
            for surface in [bar, tab] {
                assert!(
                    card.right() + crate::observer::WING_GAP <= surface.left() + 0.5
                        || card.left() >= surface.right() + crate::observer::WING_GAP - 0.5,
                    "{card:?} runs into {surface:?}"
                );
            }
        }
    }

    #[test]
    fn the_side_ahead_is_set_brighter_and_level_sides_alike() {
        let colors = |scores| {
            SeriesView {
                scores,
                ..longest_series()
            }
            .score_colors()
        };
        assert_eq!(colors([2, 1]), [theme::TEXT_PRIMARY, theme::TEXT_SECONDARY]);
        assert_eq!(colors([0, 1]), [theme::TEXT_SECONDARY, theme::TEXT_PRIMARY]);
        assert_eq!(colors([1, 1]), [theme::TEXT_PRIMARY, theme::TEXT_PRIMARY]);
    }

    #[test]
    fn a_series_is_drawn_only_for_a_game_of_two_sides() {
        assert!(
            series_view(&[1, 2], longest_series())
                .shown_series()
                .is_some()
        );
        assert!(
            series_view(&[1, 1, 2, 2], longest_series())
                .shown_series()
                .is_some()
        );
        assert!(
            series_view(&[1, 2, 3], longest_series())
                .shown_series()
                .is_none()
        );
        assert!(
            series_view(&[1, 1], longest_series())
                .shown_series()
                .is_none()
        );
        let unscored = series_view(&[1, 2, 3], longest_series());
        assert_eq!(unscored.clock_block_width(), CLOCK_WIDTH);
        assert_eq!(unscored.bar_depth(), STACKED_HEIGHT);
        let scored = series_view(&[1, 2], longest_series());
        assert_eq!(scored.bar_depth(), BAR_HEIGHT + TAB_HEIGHT);
    }
}
