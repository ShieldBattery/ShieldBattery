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

pub(crate) mod control_groups;
pub(crate) mod dock;
pub(crate) mod economy;
pub(crate) mod graphs;
pub(crate) mod layout;
pub(crate) mod map_control;
pub(crate) mod matchup;
pub(crate) mod military;
pub(crate) mod minimap;
pub(crate) mod production;
pub(crate) mod race_icon;
pub(crate) mod selection;
pub(crate) mod team_cards;
pub(crate) mod timeline;
mod unit_codes;

pub use control_groups::{
    ControlGroupView, ControlGroupsPlayerView, ControlGroupsView, render_control_groups_view,
};
pub use dock::{DockContext, DockOutcome, DockPlacement, render_obs_dock};
pub use economy::{EconomyPlayerView, EconomyView, render_economy_view};
pub use graphs::{
    GraphGrouping, GraphLineView, GraphSeries, GraphsOutcome, GraphsView, render_graphs_view,
};
pub use layout::{Span, StackAnchor, StackSlot};
pub use map_control::{MapControlSideView, MapControlView, render_map_control_view};
pub use matchup::{
    MatchupForm, MatchupOutcome, MatchupPlayerView, MatchupView, render_matchup_view,
};
pub use military::{MilitaryPlayerView, MilitaryView, render_military_view};
pub use minimap::{MinimapFrameOutcome, render_minimap_frame};
pub use production::{
    ProductionIcon, ProductionItemView, ProductionOutcome, ProductionPlayerView, ProductionView,
    WIREFRAME_LAYERS, Wireframe, render_production_view,
};
pub use selection::{
    ProductionProgressView, ResourcesLeftView, SelectedUnitClick, SelectedUnitView, SelectionCase,
    SelectionOutcome, SelectionView, UnitUpgradeView, UpgradeEffect, WeaponDamageView,
    render_selection_view,
};
pub use team_cards::{
    TeamCardPlayerView, TeamCardTotalsView, TeamCardView, TeamCardsView, render_team_cards_view,
};
pub use timeline::{
    ClickedEvent, FightDegree, MapPoint, Significance, TimelineEventKind, TimelineEventView,
    TimelineOutcome, TimelineView, render_timeline_view,
};
pub use unit_codes::unit_code;

use egui::{
    Align, Align2, Area, Color32, Context, Id, InnerResponse, Order, Rect, Stroke, StrokeKind, Ui,
    Vec2, pos2, vec2,
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
    /// still has room for. Two cards at most: a game of more sides than that is cut into two halves
    /// rather than into more cards.
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

/// The race a player is playing, which decides the color and the icon of their chip.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default, Serialize, Deserialize)]
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

    /// Whose art a resource is drawn in for a player of this race, or `None` while a random pick
    /// has yet to resolve.
    pub(crate) fn resource_race(self) -> Option<widgets::ResourceRace> {
        match self {
            RaceView::Zerg => Some(widgets::ResourceRace::Zerg),
            RaceView::Terran => Some(widgets::ResourceRace::Terran),
            RaceView::Protoss => Some(widgets::ResourceRace::Protoss),
            RaceView::Random => None,
        }
    }

    /// The race's own color, which its chip is drawn in.
    pub fn color(self) -> Color32 {
        match self {
            RaceView::Zerg => ZERG,
            RaceView::Terran => TERRAN,
            RaceView::Protoss => PROTOSS,
            RaceView::Random => RANDOM,
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
    let galley = spec.layout(ui.ctx(), spec.job_truncated(text, rect.width()));
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

/// The ways a count can be written, longest first: the whole number, then thousands (or millions)
/// to one decimal, then to none. Each form is no longer than the one before it, and the last is
/// the shortest a count can be written without losing its magnitude.
///
/// Counts are truncated rather than rounded, so a form never claims more than the count holds:
/// 99,999 is `99.9k`, not `100.0k`.
fn count_forms(value: u32) -> Vec<String> {
    let mut forms = vec![value.to_string()];
    let (unit, suffix) = if value >= 1_000_000 {
        (1_000_000, 'M')
    } else if value >= 1_000 {
        (1_000, 'k')
    } else {
        return forms;
    };
    let tenths = value / (unit / 10);
    if tenths < 1000 {
        forms.push(format!("{}.{}{suffix}", tenths / 10, tenths % 10));
    }
    forms.push(format!("{}{suffix}", value / unit));
    forms
}

/// The longest form of `value` that fits `width` when set in `spec`, or the shortest form when none
/// does.
///
/// A fixed cell is sized for the counts a game normally holds, and a bank or an army value passes
/// that late in a long game. Measuring the text as it will be painted, rather than counting digits,
/// keeps the choice right for every cell and every type size.
pub(crate) fn fit_count(ctx: &Context, spec: &TextSpec, value: u32, width: f32) -> String {
    let mut forms = count_forms(value);
    let fits = forms
        .iter()
        .position(|form| spec.layout(ctx, spec.job(form)).size().x <= width)
        .unwrap_or(forms.len() - 1);
    forms.swap_remove(fits)
}

/// Paints a count into a rect the caller has already placed, as [`paint_text`] does, written in the
/// longest form that fits the rect (see [`fit_count`]).
pub(crate) fn paint_count(ui: &Ui, rect: Rect, spec: &TextSpec, value: u32, align: Align) {
    let text = fit_count(ui.ctx(), spec, value, rect.width());
    paint_text(ui, rect, spec, &text, align);
}

/// Paints a player's race chip: the race's icon in the race's color, over a faint disc of it.
///
/// The icon carries the color because it is what the rest of ShieldBattery shows a race as, and
/// a watcher who knows the hydralisk from the site reads it here without learning anything new.
/// The disc gives every race the same round footprint beside the name: the icons' silhouettes are
/// all different shapes, and without it a row's name would start at a different distance from
/// each of them.
pub(crate) fn paint_race_chip(ui: &Ui, rect: Rect, race: RaceView, alpha: f32) {
    let diameter = rect.width().min(rect.height());
    let icon = race_icon::icon_rect(
        rect.center(),
        diameter * RACE_ICON_RATIO,
        ui.ctx().pixels_per_point(),
    );
    // Around the icon's square rather than the rect's middle: the two differ by under a pixel,
    // which is nothing beside the name but would show as the icon sitting off-center in its disc.
    ui.painter().circle_filled(
        icon.center(),
        diameter * 0.5,
        race.color().gamma_multiply(RACE_DISC_ALPHA * alpha),
    );
    race_icon::paint_race_icon(ui.painter(), icon, race, race.color().gamma_multiply(alpha));
}

/// Paints a player's race chip as [`paint_race_chip`] does, for a player who may have left their
/// race to chance: one who did (`random`) gets the race the pick resolved to with a die hung over
/// the chip's lower right rim as a badge, which is how the site shows such a pick.
pub(crate) fn paint_picked_race_chip(
    ui: &Ui,
    rect: Rect,
    race: RaceView,
    random: bool,
    alpha: f32,
) {
    paint_race_chip(ui, rect, race, alpha);
    if !random {
        return;
    }
    let diameter = rect.width().min(rect.height());
    let center = rect.center() + Vec2::splat(diameter * RANDOM_DIE_OFFSET);
    let die = race_icon::die_rect(
        center,
        diameter * RANDOM_DIE_RATIO,
        ui.ctx().pixels_per_point(),
    );
    race_icon::paint_die(ui.painter(), die, RANDOM.gamma_multiply(alpha));
}

/// How strongly a race chip's disc is filled with the race's color: enough to read as the chip's
/// edge against the bar, faint enough that the icon in the same color stands out from it.
const RACE_DISC_ALPHA: f32 = 0.22;

/// How much of a race chip's diameter its icon's square is drawn at.
const RACE_ICON_RATIO: f32 = 0.84;

/// How much of a race chip's diameter the die badging a random pick spans, not counting its
/// keyline.
const RANDOM_DIE_RATIO: f32 = 0.4;

/// How far right of and below the chip's middle the die badging a random pick sits, as a share of
/// the chip's diameter: far enough out that it hangs over the rim and the race icon it marks stays
/// readable under it.
const RANDOM_DIE_OFFSET: f32 = 1.0 / 3.0;

/// Paints the dot that marks whose a row is, where the row is too short for a bar of their color.
pub(crate) fn paint_player_dot(ui: &Ui, rect: Rect, color: Color32, diameter: f32) {
    ui.painter()
        .circle_filled(rect.center(), diameter * 0.5, color);
}

/// How far an owner's color is lifted toward white before a unit's icon is tinted with it.
const OWNER_TINT_LIFT: f32 = 0.9;

/// How strongly a tile showing a unit is washed in its owner's color, and how strongly its edge is
/// drawn in it.
const OWNER_WASH_ALPHA: f32 = 0.1;
const OWNER_EDGE_ALPHA: f32 = 0.7;

/// The color a unit's icon is tinted with for `owner`: their color brought up to full brightness
/// and lifted most of the way toward white.
///
/// The game's icons are grey renders (white line art in SD) that a tint can only darken, and the
/// renders are mostly mid greys already: anything more than a cast of the owner's color sinks them
/// into the panel. The tile around the icon carries the color instead (see [`paint_owner_wash`]).
pub(crate) fn owner_tint(owner: Color32) -> Color32 {
    let [r, g, b, _] = full_brightness(owner).to_array();
    let lift = |value: u8| (value as f32 + (255.0 - value as f32) * OWNER_TINT_LIFT).round() as u8;
    Color32::from_rgb(lift(r), lift(g), lift(b))
}

/// `color` scaled up until its brightest channel is full, keeping its hue.
fn full_brightness(color: Color32) -> Color32 {
    let [r, g, b, _] = color.to_array();
    let peak = r.max(g).max(b).max(1) as f32;
    let scale = |value: u8| (value as f32 * 255.0 / peak).round() as u8;
    Color32::from_rgb(scale(r), scale(g), scale(b))
}

/// How bright the light pooled behind a unit's icon is at its middle.
const ICON_GLOW_ALPHA: f32 = 0.14;

/// Pools a soft light behind a unit's icon drawn in `rect`: the game's renders are dark at their
/// edges (zerg ones throughout), and against the dark panel their silhouettes would dissolve.
///
/// Three rings rather than a gradient, standing in for a blur the way the other halos do.
pub(crate) fn paint_icon_glow(painter: &egui::Painter, rect: Rect, alpha: f32) {
    let radius = rect.width().min(rect.height()) * 0.5;
    for (scale, strength) in [(0.95, 0.175), (0.75, 0.3), (0.55, 0.5)] {
        painter.circle_filled(
            rect.center(),
            radius * scale,
            Color32::WHITE.gamma_multiply(ICON_GLOW_ALPHA * strength * alpha),
        );
    }
}

/// Washes a tile showing one of `owner`'s units in their color and edges it in that color at full
/// brightness: what says whose it is at a glance, and a ground the icon's dark parts stand out
/// from.
pub(crate) fn paint_owner_wash(painter: &egui::Painter, rect: Rect, owner: Color32, alpha: f32) {
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    painter.rect_filled(
        rect,
        corner_radius,
        owner.gamma_multiply(OWNER_WASH_ALPHA * alpha),
    );
    painter.rect_stroke(
        rect,
        corner_radius,
        Stroke::new(
            theme::HAIRLINE,
            full_brightness(owner).gamma_multiply(OWNER_EDGE_ALPHA * alpha),
        ),
        StrokeKind::Inside,
    );
}

/// Paints the bar of a player's own color that marks which side of a panel is theirs.
pub(crate) fn paint_player_bar(ui: &Ui, rect: Rect, color: Color32, alpha: f32) {
    ui.painter().rect_filled(
        rect,
        theme::radius(theme::RADIUS_TIGHT),
        color.gamma_multiply(alpha),
    );
}

/// Paints a square of a player's color, where a row names one player and the bar's sliver of color
/// would be too little to tell their color by. A faint light edge keeps the dark colors (blue, navy)
/// reading as a square against the panel rather than sinking into it.
pub(crate) fn paint_player_swatch(ui: &Ui, rect: Rect, color: Color32) {
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    ui.painter().rect_filled(rect, corner_radius, color);
    ui.painter().rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, theme::alpha(theme::TEXT_PRIMARY, 0.25)),
        StrokeKind::Inside,
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

    /// Whether this cursor runs towards the screen's center from the right, which is what mirrors
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

/// The largest rect with an icon frame's proportions that fits inside its tile, centered in it.
///
/// The atlas holds frames of different shapes, and drawing one into a tile of another shape
/// stretches it. A frame whose size is unknown fills the tile.
pub(crate) fn fit_icon(tile: Rect, size: Option<Vec2>) -> Rect {
    let Some(size) = size.filter(|size| size.x > 0.0 && size.y > 0.0) else {
        return tile;
    };
    let scale = (tile.width() / size.x).min(tile.height() / size.y);
    Rect::from_center_size(tile.center(), size * scale)
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
#[derive(Copy, Clone, PartialEq)]
pub(crate) enum Wing {
    Left,
    /// The right edge, stood in from by `inset`: the dock's column while the dock is there.
    Right {
        inset: f32,
    },
}

/// How far a wing sits from the edge it hangs off.
pub(crate) const WING_MARGIN: f32 = 16.0;

/// Gap between the matchup bar and the topmost stats wing under it. With the bar in the form a
/// duel gives it, this is the design's own 78 points from the screen's top edge.
pub(crate) const WING_TOP_GAP: f32 = 14.0;

/// Gap between a panel and whatever the next one down is placed under.
pub(crate) const WING_GAP: f32 = 12.0;

/// The narrowest run of the bottom edge the centered stack is given beside the replay plate. Any
/// narrower and the plate is lifted out of the stack's way instead: the narrowest any of the stack's
/// panels is drawn at.
pub(crate) const MIN_STACK_WIDTH: f32 = {
    let widest = if control_groups::MIN_WIDTH > production::MIN_WIDTH {
        control_groups::MIN_WIDTH
    } else {
        production::MIN_WIDTH
    };
    if widest > selection::PANEL_WIDTH {
        widest
    } else {
        selection::PANEL_WIDTH
    }
};

/// The narrowest run of the bottom edge the bottom panels are laid along as one row rather than
/// stacked in the middle of it: the production and control-group column at the design's width of
/// the wider of the two, and the selection panel beside it. Any narrower and the row would have to
/// squeeze the column that a stack has the room to draw whole.
pub(crate) const ROW_WIDTH: f32 = {
    let column = if control_groups::PANEL_WIDTH > production::PANEL_WIDTH {
        control_groups::PANEL_WIDTH
    } else {
        production::PANEL_WIDTH
    };
    column + WING_GAP + selection::PANEL_WIDTH
};

/// Gap between the matchup bar and the map-control strip hanging under it.
pub(crate) const MAP_CONTROL_GAP: f32 = 8.0;

/// How much of the right edge the obs dock owns, which the wings on that side stop short of.
///
/// Reserved at the dock's collapsed width, which is the form a watcher leaves it in all game: a
/// panel running under that column would have its last values covered by a control rather than by
/// a surface. The rail the dock expands into is allowed to sit over the panels, because it is
/// something the watcher has just opened and is reading rather than something in their way.
pub(crate) const DOCK_RESERVE: f32 = dock::COLLAPSED_WIDTH + WING_MARGIN;

/// How far the surfaces on the right edge stand in from it this frame: the dock's column while they
/// have to keep `clear` of it, and nothing once they do not, eased between the two so they follow
/// the dock off the edge and make way for it coming back rather than jumping either way.
pub(crate) fn dock_inset(ctx: &Context, clear: bool) -> f32 {
    ctx.animate_value_with_time(
        Id::new("sb_dock_inset"),
        settled_dock_inset(clear),
        theme::MOTION_PANEL_SECS,
    )
}

/// Where [`dock_inset`] is heading: what a surface arriving on the right edge stands in by, since
/// it has no place of its own to ease from and arriving from the side would read as a second motion
/// on top of its own entrance.
pub(crate) fn settled_dock_inset(clear: bool) -> f32 {
    if clear { DOCK_RESERVE } else { 0.0 }
}

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

/// How tall a stats wing's table is, chrome included, with a row for each player of `teams` (their
/// sides, in the order the rows list them): the panel's header, the row of column headings, every
/// player's row, and the rule over each side after the first where the table is split into sides.
///
/// Worked out rather than measured, because a wing has to know whether it fits under the surfaces
/// below it before it is drawn: one drawn to find out would already be on screen over them.
pub(crate) fn stat_table_height(teams: impl Iterator<Item = u8> + Clone) -> f32 {
    let rows = teams.clone().count() as f32;
    let dividers = if teams_worth_dividing(teams.clone()) {
        let mut sides = 0usize;
        let mut current = None;
        for team in teams {
            if current != Some(team) {
                current = Some(team);
                sides += 1;
            }
        }
        sides.saturating_sub(1) as f32
    } else {
        0.0
    };
    tiers::PANEL_MARGIN_HEIGHT
        + widgets::PANEL_HEADER_HEIGHT
        + STAT_HEADING_HEIGHT
        + rows * (STAT_ROW_GAP + STAT_ROW_HEIGHT)
        + dividers * (STAT_ROW_GAP + STAT_HEADING_HEIGHT)
}

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

    /// Where the wing under one of these goes: under the one above it while that one is drawn, and
    /// in its place once it is gone, crossing the difference at the stack's own pace while the wing
    /// is `settled` on screen (see [`eased_stack_share`]).
    pub(crate) fn below(
        ctx: &Context,
        id: Id,
        top: f32,
        upper: Option<Rect>,
        settled: bool,
    ) -> f32 {
        top + eased_stack_share(ctx, id, upper, settled)
    }
}

/// What one surface of a stack adds under the surfaces above it: its own height and the gap over it
/// while it is drawn, and nothing once it is gone.
pub(crate) fn stack_share(rect: Option<Rect>) -> f32 {
    rect.map_or(0.0, |rect| rect.height() + WING_GAP)
}

/// [`stack_share`], eased as the surface comes and goes.
///
/// A stack is placed from what each surface adds rather than from where each one was drawn, so that
/// everything above a surface crosses it as one: two panels each easing toward the one under them
/// would set off at different times and run through each other on the way. egui starts an animated
/// value at its first target, so a surface drawn for the first time is placed rather than slid into
/// place.
///
/// Eased only while the surface under it was `settled` on screen the frame before. One arriving
/// takes its place at once and makes its own short entrance from there: two panels shown together
/// would otherwise have the lower one start from where the upper one is and travel its whole height.
pub(crate) fn eased_stack_share(ctx: &Context, id: Id, rect: Option<Rect>, settled: bool) -> f32 {
    let secs = if settled {
        theme::MOTION_PANEL_SECS
    } else {
        0.0
    };
    ctx.animate_value_with_time(id, stack_share(rect), secs)
}

/// The side of the square BW's minimap owns in the screen's bottom-left corner, in design units.
///
/// The game scales its console with the screen's height, so in points the square is that many
/// 1080ths of the screen's own height: the full 348 on any screen at least 1080 tall, and less on a
/// shorter one, where a point is a pixel and the console shrinks with the screen.
pub(crate) const MINIMAP_RESERVE_UNITS: f32 = 348.0;

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
/// around this one leave it: a wing whose neighbor was just hidden moves up the neighbor's whole
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
        Wing::Right { inset } => (Align2::RIGHT_TOP, -(WING_MARGIN + inset)),
    };
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

/// Paints one resource cell of a stats wing: the glyph that says which resource, in `race`'s art,
/// then the number, aligned within the room to its right the way the column it sits in aligns its
/// values.
pub(crate) fn paint_resource_value(
    ui: &Ui,
    rect: Rect,
    glyph: ResourceGlyph,
    race: RaceView,
    value: u32,
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
    widgets::paint_resource_icon(ui.painter(), glyph_rect, glyph, race.resource_race(), alpha);
    let value_rect = Rect::from_min_max(
        pos2(glyph_rect.right() + STAT_GLYPH_GAP, rect.top()),
        rect.right_bottom(),
    );
    paint_count(
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

/// What the panels' own tests draw with: a context with the overlay's fonts, and passes enough of
/// it for a panel to settle into the size it is drawn at.
#[cfg(test)]
pub(crate) mod test_support {
    use egui::{Context, Rect, pos2, vec2};

    /// The rect `draw` reports once a 1920x1080 screen has settled around it: the passes it takes
    /// an area to learn its size and a panel to finish its entrance.
    pub(crate) fn settled_rect(mut draw: impl FnMut(&Context) -> Option<Rect>) -> Option<Rect> {
        let ctx = Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        let mut rect = None;
        for pass in 0..6 {
            let raw = egui::RawInput {
                screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(1920.0, 1080.0))),
                time: Some(f64::from(pass) * 0.25),
                ..Default::default()
            };
            ctx.begin_pass(raw);
            rect = draw(&ctx);
            let mut out = ctx.end_pass();
            let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
            // A layout check has no GPU texture store to hand the atlas to.
            out.textures_delta.clear();
        }
        rect
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_icon_keeps_its_frames_proportions_inside_its_tile() {
        let tile = Rect::from_min_size(pos2(10.0, 20.0), vec2(40.0, 40.0));

        let wide = fit_icon(tile, Some(vec2(60.0, 30.0)));
        assert_eq!(
            wide,
            Rect::from_center_size(tile.center(), vec2(40.0, 20.0))
        );

        let tall = fit_icon(tile, Some(vec2(30.0, 60.0)));
        assert_eq!(
            tall,
            Rect::from_center_size(tile.center(), vec2(20.0, 40.0))
        );

        let square = fit_icon(tile, Some(vec2(32.0, 32.0)));
        assert_eq!(square, tile);

        assert_eq!(fit_icon(tile, None), tile);
        assert_eq!(fit_icon(tile, Some(vec2(0.0, 30.0))), tile);
    }

    #[test]
    fn counts_have_a_whole_form_and_shorter_truncated_ones() {
        assert_eq!(count_forms(0), ["0"]);
        assert_eq!(count_forms(999), ["999"]);
        assert_eq!(count_forms(1_000), ["1000", "1.0k", "1k"]);
        assert_eq!(count_forms(9_999), ["9999", "9.9k", "9k"]);
        assert_eq!(count_forms(12_345), ["12345", "12.3k", "12k"]);
        assert_eq!(count_forms(99_999), ["99999", "99.9k", "99k"]);
        assert_eq!(count_forms(123_456), ["123456", "123k"]);
        assert_eq!(count_forms(1_234_567), ["1234567", "1.2M", "1M"]);
        assert_eq!(count_forms(123_456_789), ["123456789", "123M"]);
        assert_eq!(count_forms(u32::MAX), ["4294967295", "4294M"]);
    }

    /// Runs `check` inside a pass of a context with the overlay's fonts.
    fn with_ctx(check: impl FnOnce(&Context)) {
        let ctx = Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        ctx.begin_pass(egui::RawInput::default());
        check(&ctx);
        // A layout check has no GPU texture store to hand the atlas to.
        ctx.end_pass().textures_delta.clear();
    }

    #[test]
    fn a_count_is_written_whole_when_it_fits_and_compact_when_it_does_not() {
        with_ctx(|ctx| {
            let spec = text::numeral(STAT_VALUE_SIZE);
            let width_of = |text: &str| spec.layout(ctx, spec.job(text)).size().x;
            // The army cells' room for a number: 57 px less the glyph and its gap.
            let room = 57.0 - STAT_GLYPH - STAT_GLYPH_GAP;

            assert_eq!(fit_count(ctx, &spec, 4_321, room), "4321");
            let big = fit_count(ctx, &spec, 12_345, room);
            assert_eq!(big, "12.3k");
            assert!(width_of(&big) <= room);

            // Room for the whole number keeps it whole, and room for nothing falls back to the
            // shortest form rather than to the elided one.
            assert_eq!(fit_count(ctx, &spec, 12_345, width_of("12345")), "12345");
            assert_eq!(fit_count(ctx, &spec, 12_345, 1.0), "12k");
        });
    }

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
        // Four sides of two are four blocks of rows, each worth a rule of its own.
        assert!(teams_worth_dividing([1, 1, 2, 2, 3, 3, 4, 4]));
    }

    #[test]
    fn a_surface_adds_its_height_and_the_gap_over_it_to_the_stack() {
        let upper = Rect::from_min_max(pos2(0.0, 92.0), pos2(400.0, 250.0));
        assert_eq!(stack_share(Some(upper)), 158.0 + WING_GAP);
        // A surface hidden or empty adds nothing, so the next one stands where it stood.
        assert_eq!(stack_share(None), 0.0);
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
