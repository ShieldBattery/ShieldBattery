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
use crate::kit::widgets;
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

/// Draws the timeline against the left edge of the screen at `top`, fading and sliding it in and
/// out. Returns nothing at all once it is gone, or before anything has happened.
pub fn render_timeline_view(
    view: &TimelineView,
    ctx: &Context,
    shown: bool,
    top: f32,
) -> Option<Rect> {
    let id = Id::new("sb_timeline_panel");
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

fn draw_panel(ui: &mut Ui, view: &TimelineView) {
    widgets::panel_header(ui, &tr!("observer.panelTimeline", "Timeline"), Some("T"));
    for index in 0..ROWS {
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

    #[test]
    fn the_rows_fill_the_panels_own_width() {
        assert_eq!(
            crate::kit::tiers::panel_content_width(PANEL_WIDTH),
            CONTENT_WIDTH
        );
    }
}
