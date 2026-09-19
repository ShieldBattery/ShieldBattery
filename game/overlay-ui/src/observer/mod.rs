//! The observer and replay panel set: what a watcher is told about a game they are not playing.
//!
//! Like every other screen here, each panel is a plain-data view-model plus a pure render fn over
//! it and an [`egui::Context`], so the injected game DLL and the preview host draw the same pixels
//! from the same code. The DLL builds the view-models from BW's own state once per frame; the
//! preview builds them from a simulated game.
//!
//! One [`ObserverView`] carries the whole set, because the panels are read together: a watcher
//! glancing at production is reading it against the supply and the bank on the matchup bar. The
//! shell decides which of them are on screen and what a click on one asks of the game.

mod control_groups;
mod dock;
mod economy;
mod graphs;
mod map_control;
mod matchup;
mod military;
mod production;
mod selection;
mod team_cards;
mod timeline;
mod unit_codes;

pub use control_groups::{
    ControlGroupView, ControlGroupsPlayerView, ControlGroupsView, render_control_groups_view,
};
pub use dock::{DockOutcome, render_obs_dock};
pub use economy::{EconomyPlayerView, EconomyView, render_economy_view};
pub use graphs::{
    GraphGrouping, GraphLineView, GraphSeries, GraphsOutcome, GraphsView, render_graphs_view,
};
pub use map_control::{MapControlSideView, MapControlView, render_map_control_view};
pub use matchup::{
    MatchupForm, MatchupOutcome, MatchupPlayerView, MatchupView, render_matchup_view,
};
pub use military::{MilitaryPlayerView, MilitaryView, render_military_view};
pub use production::{
    ProductionIcon, ProductionItemView, ProductionOutcome, ProductionPlayerView, ProductionView,
    render_production_view,
};
pub use selection::{
    ProductionProgressView, SelectedUnitView, SelectionCase, SelectionView, render_selection_view,
};
pub use team_cards::{
    TeamCardPlayerView, TeamCardTotalsView, TeamCardView, TeamCardsView, render_team_cards_view,
};
pub use timeline::{TimelineEventKind, TimelineEventView, TimelineView, render_timeline_view};
pub use unit_codes::unit_code;

use egui::{
    Align, Align2, Area, Color32, Context, Id, InnerResponse, Order, Rect, Stroke, StrokeKind, Ui,
    pos2, vec2,
};
use serde::{Deserialize, Serialize};

use crate::colors::{PROTOSS, RANDOM, TERRAN, ZERG};
use crate::kit::text::TextSpec;
use crate::kit::widgets::{self, ResourceGlyph};
use crate::kit::{motion, text, theme, tiers};
use crate::tr;

/// Everything the observer panels draw from this frame.
///
/// A host builds it for every frame it is watching a game, whether or not any panel is on screen:
/// the panels are toggled by keys that arrive between frames, and only the shell knows which of
/// them the watcher has hidden.
pub struct ObserverView {
    pub matchup: MatchupView,
    /// The corner cards a game too big for the matchup bar is read from, or `None` for one the bar
    /// still has room for. Two cards at most, because the design gives them the screen's two top
    /// corners and nothing else: a game split into more sides than that keeps the clock alone.
    pub team_cards: Option<TeamCardsView>,
    pub economy: EconomyView,
    pub military: MilitaryView,
    pub graphs: GraphsView,
    pub timeline: TimelineView,
    pub production: ProductionView,
    pub control_groups: ControlGroupsView,
    /// What the watcher has selected, for the panel that stands in for the console's own.
    pub selection: SelectionView,
    /// How much of the map each side holds, or `None` while the game has no such measurement to
    /// report. The bar is not drawn at all without one: a share bar with nothing behind it would
    /// read as a game where neither side holds anything.
    pub map_control: Option<MapControlView>,
}

impl ObserverView {
    /// Whether this game has teams worth telling apart from the players in them.
    ///
    /// What decides whether the graphs panel has two forms to switch between: a game with one
    /// player per side has exactly one set of lines, and a chord offering to switch to the other
    /// would be offering the same plot twice.
    pub fn has_teams(&self) -> bool {
        self.matchup.has_teams()
    }
}

/// The race a player is playing, which decides the color and the letter of their chip.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum RaceView {
    Zerg,
    Terran,
    Protoss,
    /// Picked at random, and not yet resolved into one of the three.
    #[default]
    Random,
}

impl RaceView {
    pub const ALL: [RaceView; 4] = [
        RaceView::Zerg,
        RaceView::Terran,
        RaceView::Protoss,
        RaceView::Random,
    ];

    /// The race's own color, which its chip is drawn in.
    pub fn color(self) -> Color32 {
        match self {
            RaceView::Zerg => ZERG,
            RaceView::Terran => TERRAN,
            RaceView::Protoss => PROTOSS,
            RaceView::Random => RANDOM,
        }
    }

    /// The single letter that stands for the race on a chip.
    ///
    /// Translated, because the letter is an abbreviation of the race's name rather than a symbol:
    /// a Korean reader expects the first syllable of the Korean name, not a `Z`.
    pub fn letter(self) -> String {
        match self {
            RaceView::Zerg => tr!("observer.raceZerg", "Z"),
            RaceView::Terran => tr!("observer.raceTerran", "T"),
            RaceView::Protoss => tr!("observer.raceProtoss", "P"),
            RaceView::Random => tr!("observer.raceRandom", "R"),
        }
    }

    /// A short name for this race in a knob panel or a log line.
    pub fn label(self) -> &'static str {
        match self {
            RaceView::Zerg => "zerg",
            RaceView::Terran => "terran",
            RaceView::Protoss => "protoss",
            RaceView::Random => "random",
        }
    }
}

/// Game time as the panels write it: `m:ss`, growing an hours field only once there is one.
///
/// A clock that carried a leading `0:` all game would spend two of its characters on nothing, and a
/// clock that dropped the hour once a game ran long would read as having restarted.
pub fn game_clock(seconds: u64) -> String {
    let minutes = seconds / 60;
    let seconds = seconds % 60;
    if minutes >= 60 {
        format!("{}:{:02}:{:02}", minutes / 60, minutes % 60, seconds)
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

/// Paints one line of text into a rect the caller has already placed, aligned within it and elided
/// rather than allowed to grow past it.
///
/// The observer panels place their cells by arithmetic rather than by egui layouts: their geometry
/// is fixed by the design and must not move as a number gains a digit or a name is translated, and
/// a cell that is drawn where the design puts it is easier to check against the design than one
/// that is the sum of everything laid out before it.
pub(crate) fn paint_text(ui: &Ui, rect: Rect, spec: &TextSpec, text: &str, align: Align) {
    if text.is_empty() || !ui.is_rect_visible(rect) {
        return;
    }
    let job = spec.job_truncated(text, rect.width());
    let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
    let x = match align {
        Align::RIGHT => rect.right() - galley.size().x,
        Align::Center => rect.center().x - galley.size().x * 0.5,
        Align::LEFT => rect.left(),
    };
    ui.painter().galley(
        pos2(x, rect.center().y - galley.size().y * 0.5),
        galley,
        spec.color,
    );
}

/// Paints a player's race chip: a disc in the race's color with the race's letter cut out of it.
///
/// Filled rather than outlined, because the race is the first thing read off a name: a disc of
/// color carries across a room where a ring of it reads as one more piece of chrome.
pub(crate) fn paint_race_chip(ui: &Ui, rect: Rect, race: RaceView, alpha: f32) {
    let diameter = rect.width().min(rect.height());
    ui.painter().circle_filled(
        rect.center(),
        diameter * 0.5,
        race.color().gamma_multiply(alpha),
    );
    let spec = crate::kit::text::player_name(diameter * RACE_LETTER_RATIO)
        .with_color(Color32::BLACK.gamma_multiply(alpha));
    paint_text(ui, rect, &spec, &race.letter(), Align::Center);
}

/// How much of a race chip's diameter its letter is set at.
const RACE_LETTER_RATIO: f32 = 0.46;

/// Paints the dot that marks whose a row is, where the row is too short for a bar of their color.
pub(crate) fn paint_player_dot(ui: &Ui, rect: Rect, color: Color32, diameter: f32) {
    ui.painter()
        .circle_filled(rect.center(), diameter * 0.5, color);
}

/// Paints the bar of a player's own color that marks which side of a panel is theirs.
pub(crate) fn paint_player_bar(ui: &Ui, rect: Rect, color: Color32, alpha: f32) {
    ui.painter().rect_filled(
        rect,
        theme::radius(theme::RADIUS_TIGHT),
        color.gamma_multiply(alpha),
    );
}

/// Outlines a tile the pointer is over, for the tiles that act when they are clicked.
pub(crate) fn paint_tile_chrome(ui: &Ui, rect: Rect, hovered: bool) {
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    ui.painter().rect_filled(
        rect,
        corner_radius,
        theme::alpha(crate::colors::GREY_BLUE10, 0.85),
    );
    ui.painter().add(egui::Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(
            theme::HAIRLINE,
            if hovered {
                theme::ACCENT
            } else {
                theme::alpha(crate::colors::BLUE80, 0.18)
            },
        ),
        StrokeKind::Inside,
    ));
}

/// How much of a panel a surface whose player has no vision is drawn at.
///
/// Vision is the one thing on these panels the watcher decides rather than the game: a player whose
/// vision is off is still in the game and still worth reading, so their half of a panel is dimmed
/// rather than emptied or removed.
pub(crate) const NO_VISION_ALPHA: f32 = 0.45;

/// The opacity a player's part of a panel is drawn at.
pub(crate) fn vision_alpha(vision: bool) -> f32 {
    if vision { 1.0 } else { NO_VISION_ALPHA }
}

/// A slot of a row, taken from whichever end of it the player's side starts at.
///
/// The matchup bar's two halves are mirror images, so one layout is written and read from the
/// outside in: the left half walks right from the screen's left, the right half walks left from its
/// right, and every cell lands where the mirror of the other half's is.
pub(crate) struct EdgeCursor {
    x: f32,
    step: f32,
    top: f32,
    bottom: f32,
}

impl EdgeCursor {
    /// A cursor starting at `rect`'s left edge and walking right.
    pub(crate) fn from_left(rect: Rect) -> EdgeCursor {
        EdgeCursor {
            x: rect.left(),
            step: 1.0,
            top: rect.top(),
            bottom: rect.bottom(),
        }
    }

    /// A cursor starting at `rect`'s right edge and walking left.
    pub(crate) fn from_right(rect: Rect) -> EdgeCursor {
        EdgeCursor {
            x: rect.right(),
            step: -1.0,
            top: rect.top(),
            bottom: rect.bottom(),
        }
    }

    /// Whether this cursor runs towards the screen's centre from the right, which is what mirrors
    /// the alignment inside each cell as well as the cells themselves.
    pub(crate) fn mirrored(&self) -> bool {
        self.step < 0.0
    }

    /// Which end of a cell its icon and its label sit at.
    pub(crate) fn outer_align(&self) -> Align {
        if self.mirrored() {
            Align::RIGHT
        } else {
            Align::LEFT
        }
    }

    /// Takes the next `width` of the row, returning the rect it covers.
    pub(crate) fn take(&mut self, width: f32) -> Rect {
        let next = self.x + width * self.step;
        let (left, right) = if self.mirrored() {
            (next, self.x)
        } else {
            (self.x, next)
        };
        self.x = next;
        Rect::from_min_max(pos2(left, self.top), pos2(right, self.bottom))
    }

    /// Skips `width` of the row.
    pub(crate) fn skip(&mut self, width: f32) {
        self.x += width * self.step;
    }
}

/// The same rect, inset vertically to `height` about its own middle.
pub(crate) fn centred(rect: Rect, height: f32) -> Rect {
    Rect::from_center_size(rect.center(), vec2(rect.width(), height))
}

/// Which edge of the screen a stats wing hangs off.
///
/// The wings are placed against the screen's own edges rather than at the absolute coordinates the
/// design card draws them at, so a 4:3 screen and an ultrawide one both keep them out of the middle
/// where the game is being played.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Wing {
    Left,
    Right,
}

/// How far a wing sits from the edge it hangs off.
pub(crate) const WING_MARGIN: f32 = 16.0;

/// Gap between the matchup bar and the topmost stats wing under it. With the bar in the form a
/// duel gives it, this is the design's own 78 points from the screen's top edge.
pub(crate) const WING_TOP_GAP: f32 = 14.0;

/// Gap between a panel and whatever the next one down is placed under.
pub(crate) const WING_GAP: f32 = 12.0;

/// Gap between the matchup bar and the map-control strip hanging under it.
pub(crate) const MAP_CONTROL_GAP: f32 = 8.0;

/// How much of the right edge the obs dock owns, which the wings on that side stop short of.
///
/// Reserved at the dock's collapsed width, which is the form a watcher leaves it in all game: a
/// panel running under that column would have its last values covered by a control rather than by
/// a surface. The rail the dock expands into is allowed to sit over the panels, because it is
/// something the watcher has just opened and is reading rather than something in their way.
pub(crate) const DOCK_RESERVE: f32 = dock::COLLAPSED_WIDTH + WING_MARGIN;

/// Height of one player's row in a stats wing.
pub(crate) const STAT_ROW_HEIGHT: f32 = 30.0;

/// Gap between two players' rows.
pub(crate) const STAT_ROW_GAP: f32 = 4.0;

/// Height of the row of column headings over the players' rows.
pub(crate) const STAT_HEADING_HEIGHT: f32 = 14.0;

/// Width of the bar of the player's own color that leads their row.
pub(crate) const STAT_COLOR_BAR: f32 = 4.0;

/// Size of a resource glyph in a stats wing, and the gap between it and the number it names.
pub(crate) const STAT_GLYPH: f32 = 12.0;
pub(crate) const STAT_GLYPH_GAP: f32 = 5.0;

/// Text size of a number in a stats wing. Smaller than the matchup bar's, which is read at a glance
/// from across a room; these are read by someone who went looking for them.
pub(crate) const STAT_VALUE_SIZE: f32 = 19.0;

/// Text size of a player's name in a stats wing.
pub(crate) const STAT_NAME_SIZE: f32 = 16.0;

/// Where each of the observer's stacked surfaces puts its top edge this frame.
///
/// The wings are stacked rather than placed at the absolute heights the design card draws them at,
/// because a panel here is as tall as the players it reports on: a 4v4's economy table is four
/// times a duel's, and a timeline pinned under a duel's would be drawn straight through it. Each
/// height is measured off the panel above rather than computed from its contents, so the stack
/// follows what egui actually laid out instead of a second guess at it.
///
/// A panel the watcher has hidden leaves its place to the one under it rather than holding it
/// empty: what the watcher asked for by hiding a panel is the screen it was taking.
#[derive(Copy, Clone, Debug)]
pub(crate) struct WingTops {
    /// The upper wing on the left of the screen, and on the right.
    pub(crate) left: f32,
    pub(crate) right: f32,
}

impl WingTops {
    /// Both wings hung under the matchup bar, which is what a game with no team cards over them
    /// gets.
    pub(crate) fn under_bar(bar_height: f32) -> WingTops {
        let top = bar_height + WING_TOP_GAP;
        WingTops {
            left: top,
            right: top,
        }
    }

    /// Where the wing under one of these goes, given what the one above it came out as: under its
    /// bottom edge, or in its place when there is nothing above to sit under.
    pub(crate) fn below(top: f32, upper: Option<Rect>, screen_top: f32) -> f32 {
        match upper {
            Some(rect) => rect.bottom() - screen_top + WING_GAP,
            None => top,
        }
    }
}

/// Where the next panel up in the bottom-centre stack puts its own bottom edge, given what the one
/// under it came out as and the `base` the stack stands on.
pub(crate) fn stacked_bottom(base: f32, screen_bottom: f32, below: Option<Rect>) -> f32 {
    match below {
        Some(rect) => base.max(screen_bottom - rect.top() + WING_GAP),
        None => base,
    }
}

/// The offset a stacked surface is drawn at, eased from wherever it was drawn last frame.
///
/// Where a panel in a stack sits is decided by the panels around it, and those come and go: a
/// surface whose neighbour was just hidden would otherwise cross the neighbour's whole height in
/// one frame, and one whose neighbour is still fading out would cross it twice. egui starts an
/// animated value at its first target, so a surface being drawn for the first time is placed rather
/// than slid into place.
pub(crate) fn stacked_offset(ctx: &Context, id: Id, offset: f32) -> f32 {
    ctx.animate_value_with_time(id, offset, theme::MOTION_PANEL_SECS)
}

/// Whether a table of rows in team order is worth splitting into the sides they belong to.
///
/// A game with one player per side is already one row per side, so a rule between every pair of
/// them would be a rule for nothing: what the dividers exist for is a block of rows that add up to
/// one side's game.
pub(crate) fn teams_worth_dividing(teams: impl IntoIterator<Item = u8>) -> bool {
    let mut sides = 0usize;
    let mut longest = 0usize;
    let mut run = 0usize;
    let mut current: Option<u8> = None;
    for team in teams {
        if current != Some(team) {
            current = Some(team);
            sides += 1;
            run = 0;
        }
        run += 1;
        longest = longest.max(run);
    }
    sides > 1 && longest > 1
}

/// Paints the rule that separates one team's rows from the next one's, naming the team it opens.
pub(crate) fn paint_team_divider(ui: &Ui, rect: Rect, team: u8) {
    let label = team_name(team);
    let spec = text::column_label();
    let galley = spec.galley(ui, &label);
    let width = galley.size().x;
    paint_text(ui, rect, &spec, &label, Align::LEFT);
    let line_left = rect.left() + width + theme::SPACE_SM;
    if line_left < rect.right() {
        ui.painter().add(egui::Shape::line_segment(
            [
                pos2(line_left, rect.center().y),
                pos2(rect.right(), rect.center().y),
            ],
            Stroke::new(theme::HAIRLINE, theme::TIER0_DIVIDER),
        ));
    }
}

/// What a team is called wherever one is named: on a divider, on a corner card, in a legend.
pub fn team_name(team: u8) -> String {
    tr!("observer.teamName", "Team {{number}}", number = team)
}

/// Draws one of the stats wings: an ambient panel of a fixed width, hung off one edge of the screen
/// with its top edge at `top`, fading and sliding in and out. Returns nothing at all once it is
/// gone.
///
/// The panel slides to `top` rather than being placed at it, because `top` is where the panels
/// around this one leave it: a wing whose neighbour was just hidden moves up the neighbour's whole
/// height, and a jump that far reads as a panel that was redrawn somewhere else.
///
/// The wings are sized from the outside in, because the design places their outer edges on a grid;
/// egui sizes a panel from its contents out, so the width given here is the panel's and the width
/// its contents get is what is left of it inside the chrome.
pub(crate) fn wing_panel<R>(
    ctx: &Context,
    id: Id,
    wing: Wing,
    top: f32,
    width: f32,
    shown: bool,
    add: impl FnOnce(&mut Ui) -> R,
) -> Option<InnerResponse<R>> {
    let (align, offset_x) = match wing {
        Wing::Left => (Align2::LEFT_TOP, WING_MARGIN),
        Wing::Right => (Align2::RIGHT_TOP, -(WING_MARGIN + DOCK_RESERVE)),
    };
    let top = stacked_offset(ctx, id.with("top"), top);
    let area = Area::new(id)
        .anchor(align, vec2(offset_x, top))
        .order(Order::Foreground);
    motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        tiers::tier0_panel(ui, |ui| {
            // The rows are stacked by the gaps each panel writes and by nothing else: these are
            // fixed layouts, and egui's own item spacing would add to every one of them.
            ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
            ui.set_width(tiers::panel_content_width(width));
            add(ui)
        })
        .inner
    })
}

/// Paints one heading over a column of values, aligned the way the column's values are.
pub(crate) fn paint_column_heading(ui: &Ui, rect: Rect, label: &str, align: Align) {
    paint_text(ui, rect, &text::column_label(), label, align);
}

/// Paints one resource cell of a stats wing: the glyph that says which resource, then the number,
/// aligned within the room to its right the way the column it sits in aligns its values.
pub(crate) fn paint_resource_value(
    ui: &Ui,
    rect: Rect,
    glyph: ResourceGlyph,
    value: &str,
    align: Align,
    alpha: f32,
) {
    let glyph_rect = centred(
        Rect::from_min_max(
            rect.left_top(),
            pos2(rect.left() + STAT_GLYPH, rect.bottom()),
        ),
        STAT_GLYPH,
    );
    widgets::paint_resource_glyph(ui.painter(), glyph_rect, glyph, alpha);
    let value_rect = Rect::from_min_max(
        pos2(glyph_rect.right() + STAT_GLYPH_GAP, rect.top()),
        rect.right_bottom(),
    );
    paint_text(
        ui,
        value_rect,
        &text::numeral(STAT_VALUE_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
        value,
        align,
    );
}

/// Paints what leads a player's row in a stats wing: the bar of their own color, then their name.
///
/// Both cells are taken from `cursor`, so a wing's columns are placed by one walk across the row and
/// the identity block cannot drift from the values beside it.
pub(crate) fn paint_stat_identity(
    ui: &Ui,
    cursor: &mut EdgeCursor,
    gap: f32,
    name_width: f32,
    name: &str,
    color: Color32,
    alpha: f32,
) {
    let bar = cursor.take(STAT_COLOR_BAR);
    paint_player_bar(
        ui,
        centred(bar, bar.height() - theme::SPACE_XS),
        color,
        // The color bar keeps more of itself than the rest of a vision-less row: it is what says
        // whose row this is, and two rows dimmed alike are hard to tell apart at a glance.
        if alpha < 1.0 { 0.5 } else { 1.0 },
    );
    cursor.skip(gap);
    let name_rect = cursor.take(name_width);
    paint_text(
        ui,
        name_rect,
        &text::player_name(STAT_NAME_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
        name,
        Align::LEFT,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clock_grows_an_hours_field_only_once_there_is_one() {
        assert_eq!(game_clock(0), "0:00");
        assert_eq!(game_clock(65), "1:05");
        assert_eq!(game_clock(3599), "59:59");
        assert_eq!(game_clock(3600), "1:00:00");
        assert_eq!(game_clock(3725), "1:02:05");
    }

    #[test]
    fn a_table_is_split_only_where_a_side_holds_more_than_one_row() {
        assert!(!teams_worth_dividing([1, 2]));
        assert!(!teams_worth_dividing([1, 2, 3, 4]));
        assert!(!teams_worth_dividing([1]));
        assert!(!teams_worth_dividing([1, 1]));
        assert!(teams_worth_dividing([1, 1, 2, 2]));
        assert!(teams_worth_dividing([1, 1, 1, 2, 2, 2]));
        assert!(teams_worth_dividing([1, 2, 2]));
    }

    #[test]
    fn a_wing_takes_the_place_of_the_one_above_it_when_there_is_none() {
        let screen_top = 0.0;
        let upper = Rect::from_min_max(pos2(0.0, 92.0), pos2(400.0, 250.0));
        assert_eq!(
            WingTops::below(92.0, Some(upper), screen_top),
            250.0 + WING_GAP
        );
        assert_eq!(WingTops::below(92.0, None, screen_top), 92.0);
    }

    #[test]
    fn the_bottom_stack_sits_on_whatever_is_under_it() {
        let screen_bottom = 1080.0;
        let panel = Rect::from_min_max(pos2(0.0, 900.0), pos2(600.0, 1064.0));
        assert_eq!(
            stacked_bottom(WING_MARGIN, screen_bottom, Some(panel)),
            180.0 + WING_GAP
        );
        // A panel hidden or empty leaves the one above it standing on the base itself.
        assert_eq!(
            stacked_bottom(WING_MARGIN, screen_bottom, None),
            WING_MARGIN
        );
        // The base is a floor: a panel whose top is above it never pulls the next one down.
        let base = 200.0;
        let short = Rect::from_min_max(pos2(0.0, 1040.0), pos2(600.0, 1064.0));
        assert_eq!(stacked_bottom(base, screen_bottom, Some(short)), base);
    }

    #[test]
    fn mirrored_cells_land_on_their_opposites() {
        let row = Rect::from_min_max(pos2(0.0, 0.0), pos2(100.0, 20.0));
        let mut left = EdgeCursor::from_left(row);
        let mut right = EdgeCursor::from_right(row);
        left.skip(4.0);
        right.skip(4.0);
        let left_cell = left.take(30.0);
        let right_cell = right.take(30.0);
        assert_eq!(left_cell.left(), 4.0);
        assert_eq!(left_cell.right(), 34.0);
        assert_eq!(right_cell.right(), 96.0);
        assert_eq!(right_cell.left(), 66.0);
        assert_eq!(left.outer_align(), Align::LEFT);
        assert_eq!(right.outer_align(), Align::RIGHT);
    }
}
