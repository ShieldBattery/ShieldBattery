//! The square of a player's color that marks whatever is theirs: a row of a panel, a choice in a
//! menu.

use egui::{Color32, Rect, Stroke, StrokeKind, Ui, Vec2};

use crate::kit::theme;

/// Side of the square of a player's color that marks their row in a panel.
pub const PLAYER_SWATCH: f32 = 12.0;

/// Paints a square of a player's color, at `alpha` of itself, which is what ties a row to the
/// player's units on the map. A square rather than a thin bar, whose sliver of color is too little
/// to tell a color by. A faint light edge keeps the dark colors (blue, navy) reading as a square
/// against the panel rather than sinking into it.
pub fn paint_player_swatch(ui: &Ui, rect: Rect, color: Color32, alpha: f32) {
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    ui.painter()
        .rect_filled(rect, corner_radius, color.gamma_multiply(alpha));
    ui.painter().rect_stroke(
        rect,
        corner_radius,
        Stroke::new(
            theme::HAIRLINE,
            theme::alpha(theme::TEXT_PRIMARY, 0.25 * alpha),
        ),
        StrokeKind::Inside,
    );
}

/// Paints a [`PLAYER_SWATCH`] square of a player's color in the middle of `column`.
pub fn paint_player_swatch_in(ui: &Ui, column: Rect, color: Color32, alpha: f32) {
    let square = Rect::from_center_size(column.center(), Vec2::splat(PLAYER_SWATCH));
    paint_player_swatch(ui, square, color, alpha);
}
