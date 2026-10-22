//! The timeline feed: the handful of things that happened that are worth putting a clock on.
//!
//! The lower of the two left-hand wings, at the kit's ambient tier. Newest at the top, because a
//! watcher glancing at it is asking what just happened rather than reading the game's history from
//! the beginning, and the feed is a fixed six rows tall whether or not it is full: a panel that grew
//! a row every time something happened would push everything under it around all game.
//!
//! A row names the thing it is about with the game's own icon and, where the host has one, the
//! game's own name for it. A host with no icon atlas draws the icon's number instead, which is
//! enough to judge the layout.
//!
//! In a replay a row is also a way back to its moment: clicking one moves playback to just before
//! it, so the watcher sees it happen rather than arriving after it has.

use egui::{Align, Color32, Context, Id, Rect, Sense, Ui, vec2};

use super::window::{Window, WingPlacement};
use crate::kit::text::{self, BodyWeight};
use crate::kit::theme;
use crate::kit::{tiers, widgets};
use crate::observer::{
    EdgeCursor, ProductionIcon, STAT_COLOR_BAR, STAT_ROW_GAP, Wing, centred, game_clock,
    paint_player_dot, paint_text, paint_tile_chrome,
};
use crate::shell::Panel;
use crate::{tr, tr_plural};

/// How wide the panel is, in overlay points.
pub const PANEL_WIDTH: f32 = 474.0;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = 450.0;

/// How many rows the feed is, full or not.
const ROWS: usize = 6;

/// Height of one row.
const ROW_HEIGHT: f32 = 24.0;

/// Width the clock at the head of a row is laid out in.
const TIME_WIDTH: f32 = 46.0;

/// Gap between the clock and the bar of the player's own color.
const TIME_GAP: f32 = 8.0;

/// Gap between that bar and the icon.
const BAR_GAP: f32 = 8.0;

/// Side of the icon tile.
const ICON: f32 = 18.0;

/// Gap between the icon and the text.
const ICON_GAP: f32 = 8.0;

/// What is left of the row for the text, which is where a translated line runs out of room first.
const TEXT_WIDTH: f32 =
    CONTENT_WIDTH - TIME_WIDTH - TIME_GAP - STAT_COLOR_BAR - BAR_GAP - ICON - ICON_GAP;

// A row whose cells took more than the panel holds would leave its text nowhere to go.
const _: () = assert!(TEXT_WIDTH > 0.0);

/// Text size of the clock at the head of a row, and of the line beside it.
const TIME_SIZE: f32 = 13.0;
const TEXT_SIZE: f32 = 13.5;

/// Diameter of the dot saying whose event a row is. A dot rather than a bar: the rows are a feed
/// rather than a table, and a column of bars would read as a table's first column.
const DOT: f32 = 8.0;

/// Text size of the icon's number, for a host with no atlas to draw it from.
const ICON_TEXT_SIZE: f32 = 10.0;

/// What happened.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum TimelineEventKind {
    /// A building finished.
    BuildingCompleted,
    /// A resource depot finished away from the player's own start location, which is the one
    /// building completion that changes the shape of the game rather than the shape of a base.
    ExpansionTaken,
    UpgradeCompleted,
    TechStarted,
    TechCompleted,
    /// A fight the player's side came out of ahead: it lost a smaller share of what it brought than
    /// the other side did of its own. `lost` is what the side lost, and `killed` what the sides it
    /// fought lost.
    FightWon {
        degree: FightDegree,
        lost: u32,
        killed: u32,
    },
    /// A fight both sides lost about as much of their own in, told from the player's side.
    FightEven {
        lost: u32,
        killed: u32,
    },
    /// A run on another player's workers, by the player who made it.
    WorkersKilled {
        count: u16,
    },
    /// Workers the player lost all at once, where who killed them can't be told.
    WorkersLost {
        count: u16,
    },
    /// Another player's resource depot, destroyed by the player.
    BaseDestroyed,
    /// The player's own resource depot, destroyed where who did it can't be told.
    BaseLost,
}

/// How far ahead a fight's winner came out of it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FightDegree {
    Close,
    Clear,
    Decisive,
}

impl TimelineEventKind {
    /// What the row says happened, in a game where nobody shares a side. The thing it happened to
    /// is named by the icon beside it.
    pub(crate) fn label(self) -> String {
        match self {
            TimelineEventKind::BuildingCompleted => tr!("observer.eventBuilt", "Built"),
            TimelineEventKind::ExpansionTaken => tr!("observer.eventExpansion", "Expansion"),
            TimelineEventKind::UpgradeCompleted => {
                tr!("observer.eventUpgradeDone", "Upgrade complete")
            }
            TimelineEventKind::TechStarted => tr!("observer.eventTechStarted", "Research started"),
            TimelineEventKind::TechCompleted => tr!("observer.eventTechDone", "Research complete"),
            TimelineEventKind::FightWon { degree, .. } => match degree {
                FightDegree::Close => tr!("observer.eventFightWonClose", "Narrowly won a fight"),
                FightDegree::Clear => tr!("observer.eventFightWonClear", "Won a fight"),
                FightDegree::Decisive => {
                    tr!("observer.eventFightWonDecisive", "Won a fight decisively")
                }
            },
            TimelineEventKind::FightEven { .. } => tr!("observer.eventFightEven", "Even fight"),
            TimelineEventKind::WorkersKilled { count } => tr_plural!(
                "observer.eventWorkersKilled",
                u64::from(count),
                one = "Killed {{count}} worker",
                other = "Killed {{count}} workers"
            ),
            TimelineEventKind::WorkersLost { count } => tr_plural!(
                "observer.eventWorkersLost",
                u64::from(count),
                one = "Lost {{count}} worker",
                other = "Lost {{count}} workers"
            ),
            TimelineEventKind::BaseDestroyed => {
                tr!("observer.eventBaseDestroyed", "Destroyed a base")
            }
            TimelineEventKind::BaseLost => tr!("observer.eventBaseLost", "Lost a base"),
        }
    }

    /// What the row says happened, where the player shares a side with others as `team`: a fight is
    /// won by a side, whichever of its players did the most killing in it.
    fn team_label(self, team: u8) -> String {
        let team = super::team_name(team);
        match self {
            TimelineEventKind::FightWon { degree, .. } => match degree {
                FightDegree::Close => tr!(
                    "observer.eventTeamFightWonClose",
                    "{{team}} narrowly won a fight",
                    team = team
                ),
                FightDegree::Clear => {
                    tr!(
                        "observer.eventTeamFightWonClear",
                        "{{team}} won a fight",
                        team = team
                    )
                }
                FightDegree::Decisive => tr!(
                    "observer.eventTeamFightWonDecisive",
                    "{{team}} won a fight decisively",
                    team = team
                ),
            },
            other => other.label(),
        }
    }

    /// What a fight came to, quieter beside the line saying how it went, so the judgment can be
    /// checked against it. Nothing for the kinds that are not fights.
    pub(crate) fn detail(self) -> Option<String> {
        match self {
            TimelineEventKind::FightWon { lost, killed, .. }
            | TimelineEventKind::FightEven { lost, killed } => Some(tr!(
                "observer.eventFightTrade",
                "lost {{lost}}, killed {{killed}}",
                lost = lost,
                killed = killed
            )),
            _ => None,
        }
    }

    /// Whether this is a fight, won or even.
    pub fn is_fight(self) -> bool {
        matches!(
            self,
            TimelineEventKind::FightWon { .. } | TimelineEventKind::FightEven { .. }
        )
    }

    /// Whether a row of this kind names the thing it is about, as a building or a research does.
    /// The others say everything in their own line, and the thing beside them is only an icon:
    /// what a fight was fought with, whose workers were lost.
    pub fn names_its_subject(self) -> bool {
        matches!(
            self,
            TimelineEventKind::BuildingCompleted
                | TimelineEventKind::ExpansionTaken
                | TimelineEventKind::UpgradeCompleted
                | TimelineEventKind::TechStarted
                | TimelineEventKind::TechCompleted
        )
    }
}

/// How much an event matters to someone following the game.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Significance {
    /// Something that changes the course of the game: a base taken or lost, a tier or a research
    /// reached, a fight. Marked on the replay's seek bar as well as listed.
    Key,
    /// Part of how a player's game is going, worth listing but not marking: the buildings of an
    /// opening, an upgrade.
    Notable,
}

/// One thing that happened.
pub struct TimelineEventView {
    /// How far into the game it happened, in seconds.
    pub secs: u64,
    /// The color of the player it happened to.
    pub color: Color32,
    pub kind: TimelineEventKind,
    pub significance: Significance,
    /// The game's own icon for whatever the event is about, or `None` for an event that names no
    /// particular thing.
    pub icon: Option<ProductionIcon>,
    /// What the game calls whatever the event is about, in the game's language, or `None` where the
    /// host has no name for it.
    pub name: Option<String>,
    /// The side the player is on, where they share it with others: a fight is told as that side's.
    pub team: Option<u8>,
    /// Where on the map it happened, or `None` where the host cannot say.
    pub position: Option<MapPoint>,
}

impl TimelineEventView {
    /// What the row says happened.
    pub(crate) fn label(&self) -> String {
        match self.team {
            Some(team) => self.kind.team_label(team),
            None => self.kind.label(),
        }
    }
}

/// A place on the game's map, in map pixels.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct MapPoint {
    pub x: i16,
    pub y: i16,
}

/// An event a watcher clicked, as the panels report it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ClickedEvent {
    /// How far into the game it happened, in seconds.
    pub secs: u64,
    /// Where on the map it happened, if the host said.
    pub position: Option<MapPoint>,
}

/// Everything the timeline draws from.
pub struct TimelineView {
    /// What happened, newest first. At most [`ROWS`] of them are in view at once, and the rest are
    /// scrolled back through.
    pub events: Vec<TimelineEventView>,
}

impl TimelineView {
    /// Whether anything has happened yet.
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }
}

/// What the panel's chrome takes from top to bottom around its rows.
const CHROME_HEIGHT: f32 = tiers::PANEL_MARGIN_HEIGHT + widgets::PANEL_HEADER_HEIGHT;

/// How many rows fit in a panel whose top is at `top` and which must end above `floor`, at most
/// [`ROWS`]. Zero when not even the first fits, which is a panel not worth drawing.
fn rows_that_fit(top: f32, floor: f32) -> usize {
    let room = floor - top - CHROME_HEIGHT;
    if room < ROW_HEIGHT {
        return 0;
    }
    let further = ((room - ROW_HEIGHT) / (ROW_HEIGHT + STAT_ROW_GAP)).floor() as usize;
    (1 + further).min(ROWS)
}

/// Whether at least one row of the feed fits between `top` and `floor`.
pub(crate) fn fits(top: f32, floor: f32) -> bool {
    rows_that_fit(top, floor) > 0
}

/// What the watcher did with the timeline this frame.
pub struct TimelineOutcome {
    /// Where the panel is on screen, for the host's hit testing.
    pub rect: Rect,
    pub closed: bool,
    /// The event whose row was clicked.
    pub clicked: Option<ClickedEvent>,
}

/// Draws the timeline against the left edge of the screen at `top`, fading and sliding it in and
/// out. Returns nothing at all once it is gone.
///
/// Before anything has happened it is still drawn, with a line saying so: a watcher turning the
/// feed on early in a game would otherwise see nothing come of the key and take it for broken.
///
/// The panel ends above `floor`, showing fewer rows at once to do so: it is the lowest thing hung
/// on the left edge, and under it is the corner the game's minimap owns. A feed short a few rows is
/// still the feed; a feed drawn over the minimap is neither.
///
/// `seekable` is whether the game being watched can be moved to a time, which only a replay can: a
/// row then answers the pointer, says what a click on it does, and reports the click.
pub fn render_timeline_view(
    view: &TimelineView,
    ctx: &Context,
    window: Window<'_>,
    top: f32,
    floor: f32,
    seekable: bool,
) -> Option<TimelineOutcome> {
    let id = Id::new("sb_timeline_panel");
    let (top, floor) = if window.prefs.floating() {
        let screen = ctx.viewport_rect();
        (screen.top(), screen.bottom())
    } else {
        (top, floor)
    };
    let rows = rows_that_fit(top, floor);
    let window = Window {
        shown: window.shown && (window.prefs.collapsed || rows > 0),
        prefs: window.prefs,
    };
    let inner = window.show(
        ctx,
        id,
        WingPlacement {
            wing: Wing::Left,
            top,
            width: PANEL_WIDTH,
        },
        Panel::Timeline,
        &tr!("observer.panelTimeline", "Timeline"),
        |ui| draw_panel(ui, view, rows, seekable),
    )?;
    Some(TimelineOutcome {
        rect: inner.rect,
        closed: inner.closed,
        clicked: inner.inner,
    })
}

/// Draws the panel, returning the event whose row was clicked.
fn draw_panel(
    ui: &mut Ui,
    view: &TimelineView,
    rows: usize,
    seekable: bool,
) -> Option<ClickedEvent> {
    if view.is_empty() {
        let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, ROW_HEIGHT), Sense::hover());
        paint_text(
            ui,
            row,
            &text::body(TIME_SIZE, BodyWeight::Regular).with_color(theme::TEXT_DIM),
            &tr!("observer.timelineEmpty", "Nothing has happened yet"),
            Align::LEFT,
        );
        return None;
    }
    let mut clicked = None;
    // `rows` of the feed are in view, newest first, and the wheel scrolls back through the rest.
    ui.spacing_mut().item_spacing.y = STAT_ROW_GAP;
    let height = rows as f32 * ROW_HEIGHT + rows.saturating_sub(1) as f32 * STAT_ROW_GAP;
    egui::ScrollArea::vertical()
        .id_salt("sb_timeline_rows")
        .scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden)
        .max_height(height)
        .min_scrolled_height(height)
        .auto_shrink([false, false])
        .show_rows(ui, ROW_HEIGHT, view.events.len(), |ui, range| {
            let width = ui.available_width();
            // The rows' wash reaches past their sides (see below), which the area would clip.
            ui.set_clip_rect(ui.clip_rect().expand2(vec2(theme::SPACE_XS, 0.0)));
            for event in &view.events[range] {
                let sense = match seekable {
                    true => Sense::click(),
                    false => Sense::hover(),
                };
                let (row, response) = ui.allocate_exact_size(vec2(width, ROW_HEIGHT), sense);
                if seekable {
                    // The kit's wash runs a little past the row's own cells, so the row reads as
                    // one target rather than as its clock or its text.
                    let wash = row.expand2(vec2(theme::SPACE_XS, STAT_ROW_GAP * 0.5));
                    widgets::state_overlay(ui, &response, wash, theme::radius(theme::RADIUS_TIGHT));
                    if response.clicked() {
                        clicked = Some(ClickedEvent {
                            secs: event.secs,
                            position: event.position,
                        });
                    }
                }
                draw_row(ui, row, event);
            }
        });
    clicked
}

/// Draws one row: when it happened, whose it was, what it was about, and what happened to it.
fn draw_row(ui: &Ui, row: Rect, event: &TimelineEventView) {
    let mut cursor = EdgeCursor::from_left(row);
    paint_text(
        ui,
        cursor.take(TIME_WIDTH),
        &text::body(TIME_SIZE, BodyWeight::Medium).with_color(theme::TEXT_SECONDARY),
        &game_clock(event.secs),
        Align::RIGHT,
    );
    cursor.skip(TIME_GAP);
    paint_player_dot(ui, cursor.take(STAT_COLOR_BAR), event.color, DOT);
    cursor.skip(BAR_GAP);
    draw_icon(ui, centred(cursor.take(ICON), ICON), event.icon);
    cursor.skip(ICON_GAP);
    let text_rect = cursor.take(TEXT_WIDTH);
    let label = text::body(TEXT_SIZE, BodyWeight::Regular).with_color(crate::colors::GREY_BLUE95);
    // The thing first and what happened to it after, quieter: a watcher scanning the feed is
    // looking for a building or an upgrade, and "Built" six times over names none of them. A fight
    // says how it went first and what it came to after.
    let (lead, lead_spec, rest) = match (&event.name, event.kind.detail()) {
        (Some(name), _) => (
            name.clone(),
            text::body(TEXT_SIZE, BodyWeight::Medium).with_color(theme::TEXT_PRIMARY),
            Some(event.label()),
        ),
        (None, detail) => (event.label(), label.clone(), detail),
    };
    match rest {
        Some(rest) => {
            let lead_width = lead_spec
                .galley(ui, &lead)
                .size()
                .x
                .min(text_rect.width() * NAME_SHARE);
            let (lead_rect, after) = text_rect.split_left_right_at_x(text_rect.left() + lead_width);
            paint_text(ui, lead_rect, &lead_spec, &lead, Align::LEFT);
            paint_text(
                ui,
                after.with_min_x(after.left() + theme::SPACE_SM),
                &label.with_color(theme::TEXT_DIM),
                &rest,
                Align::LEFT,
            );
        }
        None => paint_text(ui, text_rect, &lead_spec, &lead, Align::LEFT),
    }
}

/// The most of a row's text a name may take, leaving what happened to it room to be read.
const NAME_SHARE: f32 = 0.62;

/// Draws the tile naming what an event was about, or nothing at all for an event about nothing.
fn draw_icon(ui: &Ui, rect: Rect, icon: Option<ProductionIcon>) {
    let Some(icon) = icon else {
        return;
    };
    paint_tile_chrome(ui, rect, false);
    match icon.texture {
        Some(texture) => {
            icon.paint(
                ui.painter(),
                texture,
                rect.shrink(theme::HAIRLINE),
                Color32::WHITE,
            );
        }
        None => paint_text(
            ui,
            rect,
            &text::numeral(ICON_TEXT_SIZE).with_color(theme::TEXT_DIM),
            &icon.index.to_string(),
            Align::Center,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn events(count: usize) -> TimelineView {
        TimelineView {
            events: (0..count)
                .map(|index| TimelineEventView {
                    secs: 600 - index as u64 * 30,
                    color: Color32::WHITE,
                    kind: TimelineEventKind::BuildingCompleted,
                    significance: Significance::Notable,
                    icon: None,
                    name: None,
                    team: None,
                    position: None,
                })
                .collect(),
        }
    }

    /// Renders `view` a few times at `top` and returns the height the panel settled on.
    fn settled_height(view: &TimelineView, top: f32, floor: f32) -> Option<f32> {
        let ctx = egui::Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        let mut height = None;
        for _ in 0..4 {
            let raw = egui::RawInput {
                screen_rect: Some(Rect::from_min_size(egui::Pos2::ZERO, vec2(1920.0, 1080.0))),
                ..Default::default()
            };
            ctx.begin_pass(raw);
            height = render_timeline_view(
                view,
                &ctx,
                Window {
                    shown: true,
                    prefs: &mut Default::default(),
                },
                top,
                floor,
                false,
            )
            .map(|outcome| outcome.rect.height());
            let mut out = ctx.end_pass();
            let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
            out.textures_delta.clear();
        }
        height
    }

    /// The chrome the row count is measured against must be what the panel actually draws, or a
    /// panel told it fits would still be drawn over the minimap.
    #[test]
    fn the_panel_is_its_chrome_plus_its_rows() {
        let view = events(ROWS);
        let full = settled_height(&view, 100.0, 1080.0).expect("the panel draws");
        assert_eq!(
            full,
            CHROME_HEIGHT + ROW_HEIGHT * ROWS as f32 + STAT_ROW_GAP * (ROWS as f32 - 1.0)
        );
        // A floor that leaves room for three rows and a bit gets three.
        let floor = 100.0 + CHROME_HEIGHT + ROW_HEIGHT * 3.0 + STAT_ROW_GAP * 2.0 + 5.0;
        assert_eq!(rows_that_fit(100.0, floor), 3);
        let three = settled_height(&view, 100.0, floor).expect("the panel draws");
        assert_eq!(three, CHROME_HEIGHT + ROW_HEIGHT * 3.0 + STAT_ROW_GAP * 2.0);
        // A floor with no room for even the first row is a panel not drawn at all.
        assert_eq!(rows_that_fit(100.0, 100.0 + CHROME_HEIGHT), 0);
        assert_eq!(settled_height(&view, 100.0, 100.0 + CHROME_HEIGHT), None);
    }

    #[test]
    fn the_rows_fill_the_panels_own_width() {
        assert_eq!(
            crate::kit::tiers::panel_content_width(PANEL_WIDTH),
            CONTENT_WIDTH
        );
    }
}
