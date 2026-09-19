//! The timeline feed: the handful of things that happened that are worth putting a clock on.
//!
//! The lower of the two left-hand wings, at the kit's ambient tier. Newest at the top, because a
//! watcher glancing at it is asking what just happened rather than reading the game's history from
//! the beginning, and the feed is a fixed six rows tall whether or not it is full: a panel that grew
//! a row every time something happened would push everything under it around all game.
//!
//! A row names the thing it is about with the game's own icon rather than with its name. There are
//! several hundred units, upgrades and technologies, the game does not hand out their names in a
//! form the overlay can read, and a caster recognises the icon faster than they read a word anyway.
//! A host with no icon atlas draws the icon's number instead, which is enough to judge the layout.

use egui::{Align, Color32, Context, Id, Rect, Sense, Ui, pos2, vec2};

use crate::kit::text::{self, BodyWeight};
use crate::kit::theme;
use crate::kit::{tiers, widgets};
use crate::observer::{
    EdgeCursor, ProductionIcon, STAT_COLOR_BAR, STAT_ROW_GAP, Wing, centred, game_clock,
    paint_player_dot, paint_text, paint_tile_chrome, wing_panel,
};
use crate::tr;

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
    UpgradeStarted,
    UpgradeCompleted,
    TechStarted,
    TechCompleted,
}

impl TimelineEventKind {
    /// What the row says happened. The thing it happened to is named by the icon beside it.
    fn label(self) -> String {
        match self {
            TimelineEventKind::BuildingCompleted => tr!("observer.eventBuilt", "Built"),
            TimelineEventKind::ExpansionTaken => tr!("observer.eventExpansion", "Expansion"),
            TimelineEventKind::UpgradeStarted => {
                tr!("observer.eventUpgradeStarted", "Upgrade started")
            }
            TimelineEventKind::UpgradeCompleted => {
                tr!("observer.eventUpgradeDone", "Upgrade complete")
            }
            TimelineEventKind::TechStarted => tr!("observer.eventTechStarted", "Research started"),
            TimelineEventKind::TechCompleted => tr!("observer.eventTechDone", "Research complete"),
        }
    }
}

/// One thing that happened.
pub struct TimelineEventView {
    /// How far into the game it happened, in seconds.
    pub secs: u64,
    /// The color of the player it happened to.
    pub color: Color32,
    pub kind: TimelineEventKind,
    /// The game's own icon for whatever the event is about, or `None` for an event that names no
    /// particular thing.
    pub icon: Option<ProductionIcon>,
}

/// Everything the timeline draws from.
pub struct TimelineView {
    /// What happened, newest first. Only the first [`ROWS`] of them are ever drawn; a host is free
    /// to keep more, since nothing but the panel's height decides how many fit.
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

/// Draws the timeline against the left edge of the screen at `top`, fading and sliding it in and
/// out. Returns nothing at all once it is gone, or before anything has happened.
///
/// The panel ends above `floor`, dropping its oldest rows to do so: it is the lowest thing hung on
/// the left edge, and under it is the corner the game's minimap owns. A feed short a few rows is
/// still the feed; a feed drawn over the minimap is neither.
pub fn render_timeline_view(
    view: &TimelineView,
    ctx: &Context,
    shown: bool,
    top: f32,
    floor: f32,
) -> Option<Rect> {
    let id = Id::new("sb_timeline_panel");
    let rows = rows_that_fit(top, floor);
    let inner = wing_panel(
        ctx,
        id,
        Wing::Left,
        top,
        PANEL_WIDTH,
        shown && !view.is_empty() && rows > 0,
        |ui| draw_panel(ui, view, rows),
    )?;
    Some(inner.response.rect)
}

fn draw_panel(ui: &mut Ui, view: &TimelineView, rows: usize) {
    widgets::panel_header(ui, &tr!("observer.panelTimeline", "Timeline"), Some("T"));
    for index in 0..rows {
        if index > 0 {
            ui.add_space(STAT_ROW_GAP);
        }
        let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, ROW_HEIGHT), Sense::hover());
        if let Some(event) = view.events.get(index) {
            draw_row(ui, row, event);
        }
    }
}

/// Draws one row: when it happened, whose it was, what it was about, and what happened to it.
fn draw_row(ui: &Ui, row: Rect, event: &TimelineEventView) {
    let mut cursor = EdgeCursor::from_left(row);
    paint_text(
        ui,
        cursor.take(TIME_WIDTH),
        &text::body(TIME_SIZE, BodyWeight::Medium).with_color(theme::TEXT_DIM),
        &game_clock(event.secs),
        Align::RIGHT,
    );
    cursor.skip(TIME_GAP);
    paint_player_dot(ui, cursor.take(STAT_COLOR_BAR), event.color, DOT);
    cursor.skip(BAR_GAP);
    draw_icon(ui, centred(cursor.take(ICON), ICON), event.icon);
    cursor.skip(ICON_GAP);
    paint_text(
        ui,
        cursor.take(TEXT_WIDTH),
        &text::body(TEXT_SIZE, BodyWeight::Regular).with_color(crate::colors::GREY_BLUE95),
        &event.kind.label(),
        Align::LEFT,
    );
}

/// Draws the tile naming what an event was about, or nothing at all for an event about nothing.
fn draw_icon(ui: &Ui, rect: Rect, icon: Option<ProductionIcon>) {
    let Some(icon) = icon else {
        return;
    };
    paint_tile_chrome(ui, rect, false);
    match icon.texture {
        Some(texture) => {
            ui.painter().image(
                texture,
                rect.shrink(theme::HAIRLINE),
                Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
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
                    icon: None,
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
                screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(1920.0, 1080.0))),
                ..Default::default()
            };
            ctx.begin_pass(raw);
            height = render_timeline_view(view, &ctx, true, top, floor).map(|rect| rect.height());
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
