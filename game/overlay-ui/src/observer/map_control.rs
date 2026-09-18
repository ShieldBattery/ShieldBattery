//! The map-control bar: how much of the map each side of the game holds.
//!
//! A single ambient strip under the matchup bar, narrow enough to read in one glance: the label,
//! each side's share as a percentage, and a bar growing in from each edge with whatever neither side
//! holds left in the middle.
//!
//! It is the one surface here drawn from a measurement the game does not keep, so a host that has
//! none reports `None` and the bar is not drawn at all. A share bar with nothing behind it would
//! read as a game where neither side holds anything, which is a claim rather than a gap.

use egui::{Align, Align2, Area, Color32, Context, Id, Order, Rect, Sense, Ui, UiBuilder, vec2};

use crate::kit::text;
use crate::kit::widgets;
use crate::kit::{motion, theme};
use crate::observer::{DOCK_RESERVE, EdgeCursor, WING_MARGIN, centred, paint_text};
use crate::tr;

/// How wide the bar is where there is room for all of it, in overlay points.
pub const BAR_WIDTH: f32 = 640.0;

/// The narrowest the bar is worth drawing. Below this the share itself is a sliver, and a sliver
/// that has to be measured against two percentages beside it is not a bar anyone reads.
const MIN_WIDTH: f32 = 320.0;

/// Gap kept between the bar and the stats wings on either side of it.
const WING_GAP: f32 = 8.0;

/// How tall it is. Short enough that it is a strip rather than a panel, which is why it paints its
/// own chrome instead of sitting in one: an ambient panel's own padding is taller than this.
pub const BAR_HEIGHT: f32 = 26.0;

/// How far its top edge sits below the screen's, which is just under the matchup bar.
const BAR_TOP: f32 = 72.0;

/// Padding between the bar's chrome and its contents.
const PADDING: f32 = 10.0;

/// Width the bar's own label is laid out in.
const LABEL_WIDTH: f32 = 92.0;

/// Gap between the label and the first percentage.
const LABEL_GAP: f32 = 10.0;

/// Width one side's percentage is laid out in.
const PERCENT_WIDTH: f32 = 40.0;

/// Gap between a percentage and the bar it belongs to.
const PERCENT_GAP: f32 = 8.0;

/// Height of the share bar itself, which the kit draws.
const SHARE_HEIGHT: f32 = 10.0;

/// Text size of the percentages.
const PERCENT_SIZE: f32 = 14.0;

/// What everything but the share itself takes of the bar.
const CHROME_WIDTH: f32 =
    PADDING * 2.0 + LABEL_WIDTH + LABEL_GAP + PERCENT_WIDTH * 2.0 + PERCENT_GAP * 2.0;

const _: () = assert!(CHROME_WIDTH < MIN_WIDTH);

/// One side of the game as the bar reads it.
#[derive(Copy, Clone)]
pub struct MapControlSideView {
    /// The color this side is on the map.
    pub color: Color32,
    /// How much of the map it holds, from 0 to 1.
    pub share: f32,
}

impl MapControlSideView {
    /// The share as the bar writes it.
    fn percent(self) -> String {
        format!("{}%", (self.share.clamp(0.0, 1.0) * 100.0).round() as u32)
    }
}

/// Everything the map-control bar draws from.
///
/// Two sides rather than a list of players: map control is a claim about territory, and territory is
/// held by whoever shares vision of it rather than by one player at a time.
#[derive(Copy, Clone)]
pub struct MapControlView {
    pub left: MapControlSideView,
    pub right: MapControlSideView,
}

/// How wide the bar can be on a screen of `screen_width`, or `None` where the stats wings leave it
/// no room worth having.
///
/// Measured against the wings whether or not they are on screen, because the wings and this bar are
/// shown by the same presets: a bar that grew every time a watcher hid a wing would move under them
/// as a number they are reading, which is worse than being one size all game.
fn width_for(screen_width: f32) -> Option<f32> {
    let side = WING_MARGIN
        + super::economy::PANEL_WIDTH.max(DOCK_RESERVE + super::military::PANEL_WIDTH)
        + WING_GAP;
    let available = screen_width - side * 2.0;
    let width = available.min(BAR_WIDTH);
    (width >= MIN_WIDTH).then_some(width)
}

/// Draws the map-control bar under the matchup bar, fading and sliding it in and out. Returns
/// nothing at all once it is gone, or on a screen too narrow to hold it beside the stats wings.
pub fn render_map_control_view(view: &MapControlView, ctx: &Context, shown: bool) -> Option<Rect> {
    let width = width_for(ctx.viewport_rect().width())?;
    let id = Id::new("sb_map_control_bar");
    let area = Area::new(id)
        .anchor(Align2::CENTER_TOP, vec2(0.0, BAR_TOP))
        .order(Order::Foreground);
    let inner = motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        draw_bar(ui, view, width)
    })?;
    Some(inner.response.rect)
}

fn draw_bar(ui: &mut Ui, view: &MapControlView, width: f32) {
    let (rect, _) = ui.allocate_exact_size(vec2(width, BAR_HEIGHT), Sense::hover());
    let corner_radius = theme::radius(theme::RADIUS_PANEL);
    ui.painter()
        .rect_filled(rect, corner_radius, theme::TIER0_FILL);
    ui.painter().add(egui::Shape::rect_stroke(
        rect,
        corner_radius,
        egui::Stroke::new(theme::HAIRLINE, theme::TIER0_STROKE),
        egui::StrokeKind::Inside,
    ));

    let mut cursor = EdgeCursor::from_left(rect);
    cursor.skip(PADDING);
    paint_text(
        ui,
        cursor.take(LABEL_WIDTH),
        &text::column_label(),
        &tr!("observer.mapControl", "Map control"),
        Align::LEFT,
    );
    cursor.skip(LABEL_GAP);
    paint_share(ui, cursor.take(PERCENT_WIDTH), view.left, Align::RIGHT);
    cursor.skip(PERCENT_GAP);
    let share = centred(cursor.take(width - CHROME_WIDTH), SHARE_HEIGHT);
    // The kit's share bar takes the width of whatever layout it is handed, and this one's place is
    // the design's, so it is given a scope of exactly the strip it belongs in.
    ui.scope_builder(UiBuilder::new().max_rect(share), |ui| {
        widgets::share_bar(
            ui,
            view.left.share,
            view.right.share,
            view.left.color,
            view.right.color,
        );
    });
    cursor.skip(PERCENT_GAP);
    paint_share(ui, cursor.take(PERCENT_WIDTH), view.right, Align::LEFT);
}

/// Paints one side's percentage in that side's own color, which is what ties it to its half of the
/// bar without a second label saying whose it is.
fn paint_share(ui: &Ui, rect: Rect, side: MapControlSideView, align: Align) {
    paint_text(
        ui,
        rect,
        &text::numeral(PERCENT_SIZE).with_color(side.color),
        &side.percent(),
        align,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_screen_with_no_room_beside_the_wings_gets_no_bar() {
        assert_eq!(width_for(1920.0), Some(BAR_WIDTH));
        assert_eq!(width_for(1280.0), None);
    }

    #[test]
    fn a_share_is_written_as_a_whole_percent() {
        let side = |share| MapControlSideView {
            color: Color32::WHITE,
            share,
        };
        assert_eq!(side(0.0).percent(), "0%");
        assert_eq!(side(0.615).percent(), "62%");
        // A host that reports more than the whole map is clamped rather than believed.
        assert_eq!(side(1.4).percent(), "100%");
    }
}
