//! The glyphs that stand for a resource wherever a panel shows one of its numbers.
//!
//! The game's own icons live in atlases that only the injected host can draw from, and a panel that
//! could be judged nowhere but inside StarCraft would not be judged at all. These are paths instead:
//! the same shape renders in the game and in the preview, at any scale, with no texture behind it.

use egui::{Color32, Painter, Rect, Shape, Stroke, pos2, vec2};

use crate::kit::theme;

/// Which resource a glyph stands for.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ResourceGlyph {
    Minerals,
    Gas,
    Supply,
}

impl ResourceGlyph {
    /// The color this resource is drawn in everywhere it appears.
    pub fn color(self) -> Color32 {
        match self {
            ResourceGlyph::Minerals => theme::RESOURCE_MINERALS,
            ResourceGlyph::Gas => theme::RESOURCE_GAS,
            ResourceGlyph::Supply => theme::RESOURCE_SUPPLY,
        }
    }
}

/// Paints `glyph` centred in `rect`, fitted to the smaller of its sides and tinted by `alpha`.
///
/// Every shape is built from a unit square and scaled, so one glyph is one size-independent
/// description rather than a set of hand-placed points per size it is used at.
pub fn paint_resource_glyph(painter: &Painter, rect: Rect, glyph: ResourceGlyph, alpha: f32) {
    let side = rect.width().min(rect.height());
    if side <= 0.0 {
        return;
    }
    let square = Rect::from_center_size(rect.center(), vec2(side, side));
    let at = |x: f32, y: f32| pos2(square.left() + x * side, square.top() + y * side);
    let color = glyph.color().gamma_multiply(alpha);
    match glyph {
        // A mineral shard: a faceted crystal, with the facet drawn as a lighter edge down its
        // middle rather than as a second shape, so the glyph stays one silhouette at 14 points.
        ResourceGlyph::Minerals => {
            painter.add(Shape::convex_polygon(
                vec![
                    at(0.50, 0.02),
                    at(0.96, 0.36),
                    at(0.78, 0.98),
                    at(0.22, 0.98),
                    at(0.04, 0.36),
                ],
                color,
                Stroke::NONE,
            ));
            painter.add(Shape::line_segment(
                [at(0.50, 0.02), at(0.50, 0.98)],
                Stroke::new(theme::HAIRLINE, Color32::WHITE.gamma_multiply(0.35 * alpha)),
            ));
        }
        // A vespene geyser: a tapered vent with its plume clipped off at the top edge.
        ResourceGlyph::Gas => {
            painter.add(Shape::convex_polygon(
                vec![
                    at(0.12, 0.98),
                    at(0.88, 0.98),
                    at(0.70, 0.34),
                    at(0.30, 0.34),
                ],
                color,
                Stroke::NONE,
            ));
            painter.add(Shape::convex_polygon(
                vec![
                    at(0.34, 0.26),
                    at(0.66, 0.26),
                    at(0.58, 0.02),
                    at(0.42, 0.02),
                ],
                color.gamma_multiply(0.7),
                Stroke::NONE,
            ));
        }
        // Supply: a depot roof over its base, which is the shape every race's supply building shares
        // in the game's own counters.
        ResourceGlyph::Supply => {
            painter.add(Shape::convex_polygon(
                vec![at(0.50, 0.04), at(0.98, 0.48), at(0.02, 0.48)],
                color,
                Stroke::NONE,
            ));
            painter.rect_filled(
                Rect::from_min_max(at(0.20, 0.56), at(0.80, 0.96)),
                theme::radius(theme::RADIUS_TIGHT),
                color,
            );
        }
    }
}
