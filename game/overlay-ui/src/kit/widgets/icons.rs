//! The glyphs that stand for a resource wherever a panel shows one of its numbers.
//!
//! The game's own icons live in its storage, which only the injected host can read, and a panel that
//! could be judged nowhere but inside StarCraft would not be judged at all. So every glyph is also a
//! path: the same shape renders in the game and in the preview, at any scale, with no texture behind
//! it. A host that has the game's icons hands them over (see [`set_resource_icons`]) and they are
//! drawn in the paths' place.

use std::sync::Arc;

use egui::{Color32, Context, Id, Painter, Rect, Shape, Stroke, TextureId, pos2, vec2};

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

/// Whose art a resource that differs by race is drawn in.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ResourceRace {
    Zerg,
    Terran,
    Protoss,
}

impl ResourceRace {
    fn index(self) -> usize {
        match self {
            ResourceRace::Zerg => 0,
            ResourceRace::Terran => 1,
            ResourceRace::Protoss => 2,
        }
    }
}

/// One icon, at each pixel size the host scaled it to, smallest first.
///
/// Scaled ahead of time rather than by the renderer, which samples a texture with no mipmaps: an
/// icon drawn at a third of its size that way loses its fine detail to aliasing.
#[derive(Clone, Default, Debug)]
pub struct IconSizes(pub Vec<(f32, TextureId)>);

impl IconSizes {
    /// The smallest of the sizes that is at least `pixels` across, or the largest there is.
    fn for_pixels(&self, pixels: f32) -> Option<TextureId> {
        self.0
            .iter()
            .find(|(size, _)| *size >= pixels)
            .or(self.0.last())
            .map(|&(_, texture)| texture)
    }
}

/// The game's own resource icons, as a host has them. Supply's is a silhouette in white, drawn in
/// supply's color; the others are drawn as they are.
#[derive(Clone, Default, Debug)]
pub struct ResourceIcons {
    pub minerals: IconSizes,
    /// Each race's, in [`ResourceRace`] order.
    pub gas: [IconSizes; 3],
    pub supply: [IconSizes; 3],
}

fn resource_icons_id() -> Id {
    Id::new("sb_resource_icons")
}

/// Hands the panels the game's own resource icons, or takes them back with `None`.
pub fn set_resource_icons(ctx: &Context, icons: Option<ResourceIcons>) {
    ctx.data_mut(|data| match icons {
        Some(icons) => {
            data.insert_temp(resource_icons_id(), Arc::new(icons));
        }
        None => data.remove::<Arc<ResourceIcons>>(resource_icons_id()),
    });
}

/// Paints `glyph` centred in `rect`, fitted to the smaller of its sides and tinted by `alpha`, for a
/// number that is no one race's (see [`paint_resource_icon`]).
pub fn paint_resource_glyph(painter: &Painter, rect: Rect, glyph: ResourceGlyph, alpha: f32) {
    paint_resource_icon(painter, rect, glyph, None, alpha);
}

/// Paints `glyph` centred in `rect`, fitted to the smaller of its sides and tinted by `alpha`: the
/// game's own icon, in `race`'s art where the resource differs by race, where the host has handed
/// the icons over, and the drawn glyph otherwise.
pub fn paint_resource_icon(
    painter: &Painter,
    rect: Rect,
    glyph: ResourceGlyph,
    race: Option<ResourceRace>,
    alpha: f32,
) {
    let side = rect.width().min(rect.height());
    if side <= 0.0 {
        return;
    }
    let icons = painter
        .ctx()
        .data(|data| data.get_temp::<Arc<ResourceIcons>>(resource_icons_id()));
    // A total over players of different races is drawn in terran's art, the one with no race's
    // creature in it: a canister and a depot.
    let race = race.unwrap_or(ResourceRace::Terran);
    let sizes = icons.as_deref().map(|icons| match glyph {
        ResourceGlyph::Minerals => &icons.minerals,
        ResourceGlyph::Gas => &icons.gas[race.index()],
        ResourceGlyph::Supply => &icons.supply[race.index()],
    });
    let pixels = side * painter.ctx().pixels_per_point();
    if let Some(texture) = sizes.and_then(|sizes| sizes.for_pixels(pixels)) {
        let tint = match glyph {
            ResourceGlyph::Supply => glyph.color(),
            ResourceGlyph::Minerals | ResourceGlyph::Gas => Color32::WHITE,
        };
        let uv = Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0));
        let square = Rect::from_center_size(rect.center(), vec2(side, side));
        painter.image(texture, square, uv, tint.gamma_multiply(alpha));
        return;
    }
    paint_drawn_glyph(painter, rect, glyph, alpha, side);
}

/// Paints the drawn form of `glyph`, a square `side` across centred in `rect`.
///
/// Every shape is built from a unit square and scaled, so one glyph is one size-independent
/// description rather than a set of hand-placed points per size it is used at.
fn paint_drawn_glyph(painter: &Painter, rect: Rect, glyph: ResourceGlyph, alpha: f32, side: f32) {
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
