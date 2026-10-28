//! The glyphs that stand for a resource wherever a panel shows one of its numbers.
//!
//! The game's own icons live in its storage, which only the injected host can read, and a panel that
//! could be judged nowhere but inside StarCraft would not be judged at all. So every glyph is also a
//! path: the same shape renders in the game and in the preview, at any scale, with no texture behind
//! it. A host that has the game's icons hands them over (see [`set_resource_icons`]) and they are
//! drawn in the paths' place.

use std::sync::Arc;

use egui::{Color32, Context, Id, Painter, Rect, Shape, Stroke, StrokeKind, TextureId, pos2, vec2};

use crate::colors::{GREY_BLUE10, GREY_BLUE60};

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

/// How far the game's art is set in from the edge of the chip it is drawn in, and how round the
/// chip's corners are, as shares of the chip's side.
const ICON_INSET: f32 = 0.1;
const ICON_CORNER: f32 = 0.15;

/// How strongly the chip's edge is drawn.
const ICON_EDGE_ALPHA: f32 = 0.6;

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

/// Paints `glyph` centered in `rect`, fitted to the smaller of its sides and tinted by `alpha`, for
/// a number that is no one race's (see [`paint_resource_icon`]).
pub fn paint_resource_glyph(painter: &Painter, rect: Rect, glyph: ResourceGlyph, alpha: f32) {
    paint_resource_icon(painter, rect, glyph, None, alpha);
}

/// Paints `glyph` centered in `rect`, fitted to the smaller of its sides and tinted by `alpha`: the
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
    let square = Rect::from_center_size(rect.center(), vec2(side, side));
    let art = square.shrink(side * ICON_INSET);
    let pixels = art.width() * painter.ctx().pixels_per_point();
    if let Some(texture) = sizes.and_then(|sizes| sizes.for_pixels(pixels)) {
        // The art is the game's square tile's, cut off at the tile's edge, so it is set in a chip
        // of its own that makes the edge the chip's.
        let corner_radius = side * ICON_CORNER;
        painter.rect_filled(square, corner_radius, GREY_BLUE10.gamma_multiply(alpha));
        painter.rect_stroke(
            square,
            corner_radius,
            Stroke::new(
                theme::HAIRLINE,
                GREY_BLUE60.gamma_multiply(ICON_EDGE_ALPHA * alpha),
            ),
            StrokeKind::Inside,
        );
        let tint = match glyph {
            ResourceGlyph::Supply => glyph.color(),
            ResourceGlyph::Minerals | ResourceGlyph::Gas => Color32::WHITE,
        };
        let uv = Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0));
        painter.image(texture, art, uv, tint.gamma_multiply(alpha));
        return;
    }
    paint_drawn_glyph(painter, rect, glyph, alpha, side);
}

/// Paints the drawn form of `glyph`, a square `side` across centered in `rect`.
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

/// What a glyph heading a column of counts across players of every race stands for.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ColumnGlyph {
    Supply,
    Workers,
    Minerals,
    Gas,
}

/// `color` taken `amount` of the way toward `toward`, both opaque.
fn mix(color: Color32, toward: Color32, amount: f32) -> Color32 {
    let channel =
        |from: u8, to: u8| (from as f32 + (to as f32 - from as f32) * amount).round() as u8;
    Color32::from_rgb(
        channel(color.r(), toward.r()),
        channel(color.g(), toward.g()),
        channel(color.b(), toward.b()),
    )
}

/// How many straight edges a column glyph's curves are drawn with: enough that no corner shows at
/// the size a heading is drawn.
const COLUMN_GLYPH_CURVE_STEPS: usize = 16;

/// Paints `glyph` centered in `rect`, fitted to the smaller of its sides, at `alpha`.
///
/// Always drawn, never the game's art: a heading stands over players of every race, which no one
/// race's icon names, and the game's icons are small bitmaps that soften once scaled to a heading's
/// size. Supply and workers are flat silhouettes, a figure and a wrench, in the plain style a
/// broadcast's headings take; minerals and gas are in the game's own manner, a cluster of blue
/// crystal and a geyser venting green, shaded and keyed with a dark edge the way its sprites are.
///
/// Every shape is built from a unit square and scaled, so each glyph is one size-independent
/// description.
pub fn paint_column_glyph(painter: &Painter, rect: Rect, glyph: ColumnGlyph, alpha: f32) {
    let side = rect.width().min(rect.height());
    if side <= 0.0 {
        return;
    }
    let square = Rect::from_center_size(rect.center(), vec2(side, side));
    let at = |x: f32, y: f32| pos2(square.left() + x * side, square.top() + y * side);
    let shape = |points: Vec<egui::Pos2>, fill: Color32, edge: Stroke| {
        painter.add(Shape::convex_polygon(points, fill, edge));
    };
    let faded = |color: Color32| color.gamma_multiply(alpha);
    // The dark edge the game's sprites are keyed against the ground with.
    let key = Stroke::new(theme::HAIRLINE, faded(GREY_BLUE10));
    match glyph {
        // A head over a pair of shoulders: what supply counts is the population a player can hold.
        // Cut off just under the shoulders and set in from the square's edges: a solid figure
        // fills far more of its square than the drawn glyphs beside it, and at their full extent
        // it reads a size larger than they do.
        ColumnGlyph::Supply => {
            let color = faded(theme::RESOURCE_SUPPLY);
            painter.circle_filled(at(0.50, 0.34), 0.15 * side, color);
            let shoulders = (0..=COLUMN_GLYPH_CURVE_STEPS)
                .map(|step| {
                    let angle =
                        std::f32::consts::PI * step as f32 / COLUMN_GLYPH_CURVE_STEPS as f32;
                    at(0.50 - 0.31 * angle.cos(), 0.84 - 0.28 * angle.sin())
                })
                .collect();
            shape(shoulders, color, Stroke::NONE);
        }
        // An open-ended wrench lying corner to corner, its jaw at the top right: the worker as the
        // one that builds, which is what every race's worker is to a watcher whatever it looks like.
        ColumnGlyph::Workers => {
            let color = faded(theme::RESOURCE_SUPPLY);
            // Laid out along the wrench's own length and across it, then turned onto the diagonal.
            let along = vec2(
                std::f32::consts::FRAC_1_SQRT_2,
                -std::f32::consts::FRAC_1_SQRT_2,
            );
            let across = vec2(
                std::f32::consts::FRAC_1_SQRT_2,
                std::f32::consts::FRAC_1_SQRT_2,
            );
            // Set down and to the left of the square's middle: the head is the heavy end, and a
            // wrench centered by its length reads as hanging off the top right corner.
            let centre = at(0.46, 0.54);
            let local = |a: f32, b: f32| centre + (along * a + across * b) * side;
            shape(
                vec![
                    local(-0.40, -0.07),
                    local(0.04, -0.07),
                    local(0.04, 0.07),
                    local(-0.40, 0.07),
                ],
                color,
                Stroke::NONE,
            );
            painter.circle_filled(local(-0.40, 0.0), 0.07 * side, color);
            shape(
                vec![
                    local(0.0, -0.12),
                    local(0.06, -0.21),
                    local(0.17, -0.21),
                    local(0.17, 0.21),
                    local(0.06, 0.21),
                    local(0.0, 0.12),
                ],
                color,
                Stroke::NONE,
            );
            for jaw in [-1.0, 1.0] {
                shape(
                    vec![
                        local(0.16, jaw * 0.21),
                        local(0.30, jaw * 0.21),
                        local(0.35, jaw * 0.15),
                        local(0.35, jaw * 0.07),
                        local(0.16, jaw * 0.07),
                    ],
                    color,
                    Stroke::NONE,
                );
            }
        }
        // A heap of mineral chunks the way the game's mineral fields are cut: crystals leaning
        // every which way, each split down its own tilted axis into a lit face and a shaded one, so
        // the facets and the seams between chunks all run on diagonals. Drawn back to front, every
        // chunk keyed off the ones behind it by the dark edge.
        ColumnGlyph::Minerals => {
            let base = theme::RESOURCE_MINERALS;
            let lit = faded(mix(base, Color32::WHITE, 0.5));
            let mid = faded(base);
            let deep = faded(mix(base, GREY_BLUE10, 0.5));
            const CHUNKS: [MineralChunk; 4] = [
                MineralChunk {
                    foot: (0.36, 0.92),
                    lean: -35.0,
                    length: 0.50,
                    width: 0.32,
                    nearer: false,
                },
                MineralChunk {
                    foot: (0.66, 0.92),
                    lean: 32.0,
                    length: 0.50,
                    width: 0.32,
                    nearer: false,
                },
                MineralChunk {
                    foot: (0.48, 0.95),
                    lean: -6.0,
                    length: 0.84,
                    width: 0.36,
                    nearer: true,
                },
                MineralChunk {
                    foot: (0.70, 0.95),
                    lean: 20.0,
                    length: 0.38,
                    width: 0.28,
                    nearer: true,
                },
            ];
            for MineralChunk {
                foot: (foot_x, foot_y),
                lean,
                length,
                width,
                nearer,
            } in CHUNKS
            {
                let lean = lean.to_radians();
                let (up_x, up_y) = (lean.sin(), -lean.cos());
                let (right_x, right_y) = (lean.cos(), lean.sin());
                let point = |along: f32, across: f32| {
                    at(
                        foot_x + up_x * along + right_x * across,
                        foot_y + up_y * along + right_y * across,
                    )
                };
                let half = width * 0.5;
                let shoulder = length * 0.7;
                let tip = point(length, 0.0);
                let foot = point(0.0, 0.0);
                let (light, dark) = if nearer { (lit, mid) } else { (mid, deep) };
                shape(
                    vec![
                        point(0.0, -half),
                        point(shoulder, -half),
                        tip,
                        point(shoulder, half),
                        point(0.0, half),
                    ],
                    dark,
                    key,
                );
                shape(
                    vec![tip, foot, point(0.0, -half), point(shoulder, -half)],
                    light,
                    Stroke::NONE,
                );
            }
        }
        // A vespene geyser venting: the top of the rock mound every map's gas comes out of,
        // whoever builds on it, two of its craters stepping toward the watcher, with clouds of
        // green gas rising off them. The plume is the larger part: it is the gas, and the rock
        // only says where it comes from.
        ColumnGlyph::Gas => {
            let base = theme::RESOURCE_GAS;
            // A crater: rock heaped `half` to either side of `x`, from its foot up to a flat top, lit
            // from the left, with its mouth a dark hollow sunk in the top.
            let crater = |x: f32, top: f32, foot: f32, half: f32, rock: Color32| {
                let shoulder = top + 0.32 * (foot - top);
                shape(
                    vec![
                        at(x - half, foot),
                        at(x - 0.70 * half, shoulder),
                        at(x - 0.38 * half, top),
                        at(x + 0.38 * half, top),
                        at(x + 0.70 * half, shoulder),
                        at(x + half, foot),
                    ],
                    faded(rock),
                    key,
                );
                shape(
                    vec![
                        at(x - half, foot),
                        at(x - 0.70 * half, shoulder),
                        at(x - 0.38 * half, top),
                        at(x - 0.18 * half, top),
                        at(x - 0.42 * half, foot),
                    ],
                    faded(mix(rock, Color32::WHITE, 0.25)),
                    Stroke::NONE,
                );
                let mouth = (0..COLUMN_GLYPH_CURVE_STEPS)
                    .map(|step| {
                        let angle =
                            std::f32::consts::TAU * step as f32 / COLUMN_GLYPH_CURVE_STEPS as f32;
                        at(
                            x + 0.35 * half * angle.cos(),
                            top + 0.01 + 0.10 * half * angle.sin(),
                        )
                    })
                    .collect();
                shape(mouth, faded(mix(rock, GREY_BLUE10, 0.65)), key);
            };
            // Separate clouds of gas, each a flat-bottomed puff: a crown and a smaller bump over a
            // rounded base. Later clouds are drawn in front of earlier ones, edged in a darker green
            // so their outline cuts across the cloud behind. The fills are opaque, since an edge
            // showing through a cloud would split it into its pieces.
            let edge = faded(mix(base, GREY_BLUE10, 0.5));
            let clouds = |clouds: &[GasCloud]| {
                for &GasCloud {
                    x,
                    bottom,
                    width,
                    bump_side,
                    age,
                } in clouds
                {
                    let side_of_bump = bump_side.sign();
                    let base_radius = 0.16 * width;
                    let base_reach = 0.5 * width - base_radius;
                    let lobes = [
                        (x - base_reach, bottom - base_radius, base_radius),
                        (x + base_reach, bottom - base_radius, base_radius),
                        (
                            x - 0.06 * width * side_of_bump,
                            bottom - 0.34 * width,
                            0.26 * width,
                        ),
                        (
                            x + 0.22 * width * side_of_bump,
                            bottom - 0.28 * width,
                            0.18 * width,
                        ),
                    ];
                    let base_span = Rect::from_min_max(
                        at(x - base_reach, bottom - 2.0 * base_radius),
                        at(x + base_reach, bottom),
                    );
                    let paint = |grow: f32, color: Color32| {
                        painter.rect_filled(base_span.expand(grow), 0.0, color);
                        for (lobe_x, lobe_y, radius) in lobes {
                            painter.circle_filled(at(lobe_x, lobe_y), radius * side + grow, color);
                        }
                    };
                    paint(key.width, edge);
                    paint(0.0, faded(mix(base, Color32::WHITE, age * 0.4)));
                }
            };
            // The crater further back, shaded a step darker, and the nearer one in front of its foot.
            crater(0.36, 0.62, 0.92, 0.32, mix(GEYSER_ROCK, GREY_BLUE10, 0.2));
            crater(0.64, 0.74, 0.99, 0.35, GEYSER_ROCK);
            // The gas, clear of both mouths so neither is hidden: a plume over the crater at the
            // back, its older cloud at the top, then a cloud over the nearer crater, in front of the
            // plume and edged over both of its clouds.
            clouds(&[
                GasCloud {
                    x: 0.40,
                    bottom: 0.27,
                    width: 0.36,
                    bump_side: Side::Right,
                    age: 1.0,
                },
                GasCloud {
                    x: 0.38,
                    bottom: 0.50,
                    width: 0.36,
                    bump_side: Side::Left,
                    age: 0.0,
                },
                GasCloud {
                    x: 0.71,
                    bottom: 0.45,
                    width: 0.40,
                    bump_side: Side::Right,
                    age: 0.5,
                },
            ]);
        }
    }
}

/// One crystal of the minerals glyph, in fractions of the glyph's square.
struct MineralChunk {
    /// Where its foot stands.
    foot: (f32, f32),
    /// How far it leans from upright, in degrees, clockwise.
    lean: f32,
    /// How long it is from foot to tip, and how wide.
    length: f32,
    width: f32,
    /// Whether it is one of the nearer crystals, which are lit a step brighter.
    nearer: bool,
}

/// One cloud of the gas glyph, in fractions of the glyph's square.
#[derive(Copy, Clone)]
struct GasCloud {
    /// Where its middle is across the square, and where its flat base is down it.
    x: f32,
    bottom: f32,
    width: f32,
    /// Which side of its crown the smaller bump is on.
    bump_side: Side,
    /// How old it is, from 0 leaving the vent to 1 the oldest: an older cloud has paled further.
    age: f32,
}

#[derive(Copy, Clone)]
enum Side {
    Left,
    Right,
}

impl Side {
    /// -1 to the left, 1 to the right.
    fn sign(self) -> f32 {
        match self {
            Side::Left => -1.0,
            Side::Right => 1.0,
        }
    }
}

/// The weathered stone a vespene geyser's vent is built up from.
const GEYSER_ROCK: Color32 = Color32::from_rgb(0x6E, 0x66, 0x5C);
