//! What a watcher sees past the map's bottom edge, once they have scrolled the view out from under
//! the bottom panels.
//!
//! The game draws nothing there, and a band of pure black under the map reads as a hole in the
//! screen. This is the overlay's own ground instead: the panels' deep navy, hatched the way an
//! editor marks ground nothing can stand on, and edged where the map ends.

use egui::{Context, LayerId, Pos2, Rect, Stroke, pos2};

use crate::colors::{GREY_BLUE10, GREY_BLUE30, GREY_BLUE60};
use crate::kit::theme;

/// Distance between two hatch lines, across them.
const HATCH_SPACING: f32 = 14.0;

/// How strongly the hatching and the edge are drawn over the ground.
const HATCH_ALPHA: f32 = 0.55;
const EDGE_ALPHA: f32 = 0.5;

/// Paints the ground past the map's bottom edge, which is `edge` of the screen's height down from
/// its top. Nothing while the edge is at or below the screen's bottom.
///
/// Under every panel: it is the game view's, not a surface of the overlay's.
pub fn paint_past_map_edge(ctx: &Context, edge: f32) {
    let screen = ctx.viewport_rect();
    let top = screen.top() + edge * screen.height();
    if !edge.is_finite() || top >= screen.bottom() {
        return;
    }
    let ground = Rect::from_min_max(pos2(screen.left(), top.max(screen.top())), screen.max);
    let painter = ctx
        .layer_painter(LayerId::background())
        .with_clip_rect(ground);
    painter.rect_filled(ground, 0.0, GREY_BLUE10);
    // Lines rising to the right at 45°, each starting from the ground's bottom edge. The first
    // starts the ground's height left of it, so the lines reach the ground's top-left corner too.
    let hatch = Stroke::new(theme::HAIRLINE, GREY_BLUE30.gamma_multiply(HATCH_ALPHA));
    let step = HATCH_SPACING * std::f32::consts::SQRT_2;
    let mut x = ground.left() - ground.height();
    while x < ground.right() {
        let start = Pos2::new(x, ground.bottom());
        let end = Pos2::new(x + ground.height(), ground.top());
        painter.line_segment([start, end], hatch);
        x += step;
    }
    if top >= screen.top() {
        painter.hline(
            ground.x_range(),
            top + theme::HAIRLINE * 0.5,
            Stroke::new(theme::HAIRLINE, GREY_BLUE60.gamma_multiply(EDGE_ALPHA)),
        );
    }
}
