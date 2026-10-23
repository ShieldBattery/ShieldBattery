//! The race icons ShieldBattery draws everywhere else a race is shown: the hydralisk, the marine,
//! the zealot and the die of "I'm feeling lucky" for a random pick.
//!
//! They are the web client's own SVGs, rasterized here rather than tessellated: egui fills convex
//! paths only, and every one of these is a concave silhouette with holes in it. Each is rendered at
//! exactly the number of physical pixels it is drawn at and drawn on whole pixels, so its edges are
//! the rasterizer's anti-aliasing and nothing else, and the same pixels come out of the preview and
//! the game.

use std::collections::HashMap;

use egui::epaint::Vertex;
use egui::{
    Color32, ColorImage, Context, Id, Mesh, Painter, Pos2, Rect, Shape, TextureHandle,
    TextureOptions, Vec2, pos2, vec2,
};
use resvg::{tiny_skia, usvg};

use super::RaceView;

const ZERG_SVG: &str = include_str!("../../../../client/icons/starcraft/hydra_24px.svg");
const TERRAN_SVG: &str = include_str!("../../../../client/icons/starcraft/marine_24px.svg");
const PROTOSS_SVG: &str = include_str!("../../../../client/icons/starcraft/zealot_24px.svg");

/// Material Symbols' `ifl` glyph, filled, which the web client sets from the icon font for a random
/// pick. The font itself is not something the overlay carries, so this is the glyph's own outline
/// as Google publishes it for the 24px optical size.
const RANDOM_SVG: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M682.5-277.5Q700-295 700-320t-17.5-42.5Q665-380 640-380t-42.5 17.5Q580-345 580-320t17.5 42.5Q615-260 640-260t42.5-17.5Zm-160-160Q540-455 540-480t-17.5-42.5Q505-540 480-540t-42.5 17.5Q420-505 420-480t17.5 42.5Q455-420 480-420t42.5-17.5Zm-160-160Q380-615 380-640t-17.5-42.5Q345-700 320-700t-42.5 17.5Q260-665 260-640t17.5 42.5Q295-580 320-580t42.5-17.5ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Z"/></svg>"#;

/// Where an icon sits in the square it is drawn into, which its SVG's own frame does not say.
///
/// The icons are drawn by hand on a 24-unit grid with their outlines wherever the unit's pose put
/// them: the marine leans into his rifle, so most of his weight is left of the frame's middle and a
/// thin barrel reaches out to the right; the hydralisk is a heavy body under a light crest; the die
/// is a solid square that fills far more of its frame than any silhouette does. Centered by frame,
/// each would sit visibly off-middle in a round chip and the die would look a size larger than the
/// others.
///
/// Each offset starts from the point halfway between the middle of the icon's outline and the
/// middle of its weight (both measured by the tests below), which is where an eye puts a shape's
/// middle: the outline alone ignores that a thin limb weighs less than a body, and the weight alone
/// pushes a lone limb out to the chip's rim. The marine is then set by his outline's height rather
/// than his weight, which sits in his shoulders and would stand his feet on the rim, and the
/// zealot's blades are let back toward the middle by a hair.
#[derive(Copy, Clone, Debug, PartialEq)]
struct IconFit {
    /// How large the icon is drawn, relative to its frame filling the square.
    scale: f32,
    /// How far the icon's frame is moved from the square's middle, in fractions of the square.
    offset: Vec2,
}

impl IconFit {
    fn of(race: RaceView) -> IconFit {
        match race {
            RaceView::Zerg => IconFit {
                scale: 1.0,
                offset: vec2(0.019, -0.019),
            },
            RaceView::Terran => IconFit {
                scale: 1.0,
                offset: vec2(0.05, 0.005),
            },
            RaceView::Protoss => IconFit {
                scale: 1.0,
                offset: vec2(0.008, 0.011),
            },
            RaceView::Random => IconFit {
                scale: 0.85,
                offset: vec2(0.0, 0.0),
            },
        }
    }
}

fn svg(race: RaceView) -> &'static str {
    match race {
        RaceView::Zerg => ZERG_SVG,
        RaceView::Terran => TERRAN_SVG,
        RaceView::Protoss => PROTOSS_SVG,
        RaceView::Random => RANDOM_SVG,
    }
}

/// How much of each pixel of a `pixels`-square raster `race`'s icon covers, row by row, placed and
/// sized by its [`IconFit`]. Empty if the SVG fails to parse, which would be a broken build rather
/// than anything a game can cause.
fn coverage(race: RaceView, pixels: u32) -> Vec<u8> {
    coverage_with(svg(race), IconFit::of(race), pixels)
}

fn coverage_with(svg: &str, fit: IconFit, pixels: u32) -> Vec<u8> {
    let Ok(tree) = usvg::Tree::from_str(svg, &usvg::Options::default()) else {
        return Vec::new();
    };
    let Some(mut pixmap) = tiny_skia::Pixmap::new(pixels, pixels) else {
        return Vec::new();
    };
    let frame = tree.size();
    let side = pixels as f32;
    let scale = side / frame.width().max(frame.height()) * fit.scale;
    let transform = tiny_skia::Transform::from_translate(
        side * (0.5 + fit.offset.x),
        side * (0.5 + fit.offset.y),
    )
    .pre_scale(scale, scale)
    .pre_translate(-frame.width() * 0.5, -frame.height() * 0.5);
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    pixmap.pixels().iter().map(|pixel| pixel.alpha()).collect()
}

/// The rasterized icons uploaded so far, by race and by the physical size they were drawn at.
///
/// A size is only ever drawn at one scale for as long as the screen keeps its resolution, so the
/// cache holds a handful of entries and is simply emptied should it ever outgrow that, rather than
/// keeping every size a run of resolution changes has asked for.
#[derive(Clone, Default)]
struct IconCache {
    textures: HashMap<(RaceView, u32), TextureHandle>,
}

/// How many textures the cache keeps before it is emptied: every race at the three chip sizes the
/// panels use, with room to spare.
const CACHE_LIMIT: usize = 16;

fn texture(ctx: &Context, race: RaceView, pixels: u32) -> TextureHandle {
    let id = Id::new("observer::race_icons");
    if let Some(texture) = ctx.data(|data| {
        data.get_temp::<IconCache>(id)
            .and_then(|cache| cache.textures.get(&(race, pixels)).cloned())
    }) {
        return texture;
    }
    // White, with the coverage in alpha, so a tint is the icon's whole color. Straight alpha has
    // no other color to give a texel the icon only partly covers, and premultiplied white is just
    // the coverage again.
    let texels = coverage(race, pixels)
        .into_iter()
        .map(Color32::from_white_alpha)
        .collect::<Vec<_>>();
    let image = if texels.len() == (pixels * pixels) as usize {
        ColorImage::new([pixels as usize, pixels as usize], texels)
    } else {
        ColorImage::filled([1, 1], Color32::TRANSPARENT)
    };
    let texture = ctx.load_texture(
        format!("race-icon-{}-{pixels}", race.label()),
        image,
        TextureOptions::LINEAR,
    );
    ctx.data_mut(|data| {
        let cache = data.get_temp_mut_or_default::<IconCache>(id);
        if cache.textures.len() >= CACHE_LIMIT {
            cache.textures.clear();
        }
        cache.textures.insert((race, pixels), texture.clone());
    });
    texture
}

/// The square a race icon `size` points across is drawn into around `center`: as near that size
/// and that place as whole physical pixels allow at `pixels_per_point`.
///
/// Whole pixels, because the icon is rasterized for exactly the pixels it covers, and a square
/// straddling them would be resampled into a blur. Anything drawn around the icon centers itself
/// on this square rather than on `center`, so the icon's place within it is the one its
/// [`IconFit`] gives, to the pixel.
pub(crate) fn icon_rect(center: Pos2, size: f32, pixels_per_point: f32) -> Rect {
    let pixels = (size * pixels_per_point).round().max(1.0);
    let corner = (center.to_vec2() * pixels_per_point - Vec2::splat(pixels * 0.5)).round();
    Rect::from_min_size(
        (corner / pixels_per_point).to_pos2(),
        Vec2::splat(pixels / pixels_per_point),
    )
}

/// Paints `race`'s icon in `color` into `rect`, a square from [`icon_rect`].
pub(crate) fn paint_race_icon(painter: &Painter, rect: Rect, race: RaceView, color: Color32) {
    let pixels = (rect.width() * painter.ctx().pixels_per_point()).round() as u32;
    let texture = texture(painter.ctx(), race, pixels.max(1));
    painter.image(
        texture.id(),
        rect,
        Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
        color,
    );
}

/// Where a random-pick die's pips sit on whole pixels: the die's side and its pips' side, and where
/// each pip on the diagonal from the top left corner starts, all in pixels.
///
/// The die is drawn by hand on the pixel grid rather than rasterized from the glyph, because it
/// spans only a dozen pixels or fewer: at that size the glyph's pips fall between pixels and blur
/// into the body. Pips that are whole pixels, centered and with clear pixels around them, still
/// read as a die.
#[derive(Clone, Debug, PartialEq)]
struct DieLayout {
    side: u32,
    pip: u32,
    offsets: Vec<u32>,
}

/// The pips' smallest side in pixels: a single-pixel pip is too faint to read as one.
const MIN_PIP: u32 = 2;

/// The layout for a die near `pixels` across: three pips where three of at least [`MIN_PIP`] fit,
/// and two below that, which read where three would be crammed into dots. A die is allowed a pixel
/// either way of the size asked for, since that is often what lets its pips sit centered.
fn die_layout(pixels: u32) -> DieLayout {
    let sides = [pixels, pixels + 1, pixels.saturating_sub(1)];
    for count in [3, 2] {
        for pip in (MIN_PIP..=4).rev() {
            for side in sides {
                if let Some(layout) = fit_pips(side, pip, count) {
                    return layout;
                }
            }
        }
    }
    // The smallest die two pips fit on, for a badge too small to hold any.
    fit_pips(7, MIN_PIP, 2).expect("a 7 pixel die holds two pips")
}

/// Lays `count` pips `pip` pixels across on the diagonal of a die `side` pixels across, if they fit
/// centered, with at least a pixel clear between each of them and the edge and gaps between them
/// close to the margins outside them. Where the two can't be equal the margins take the extra
/// pixel, which keeps the corner pips clear of the die's rounded corners.
fn fit_pips(side: u32, pip: u32, count: u32) -> Option<DieLayout> {
    let room = side.checked_sub(count * pip)?;
    let gaps = count - 1;
    let (margin, gap) = (1..=room / 2)
        .filter_map(|margin| {
            let rest = room - 2 * margin;
            (rest % gaps == 0).then_some((margin, rest / gaps))
        })
        .filter(|&(_, gap)| gap >= 1 && gap <= pip + 1)
        .min_by_key(|&(margin, gap)| (margin.abs_diff(gap), std::cmp::Reverse(margin)))?;
    let offsets = (0..count)
        .map(|index| margin + index * (pip + gap))
        .collect();
    Some(DieLayout { side, pip, offsets })
}

/// How solid the keyline around the die and the pips in it are: close to the bar's own dark, so
/// the die reads as set on the chip rather than as part of the race icon it overlaps.
const DIE_KEYLINE_ALPHA: f32 = 0.85;

/// How much of the pixel at (`x`, `y`) a square from `min` to `max` on both axes covers, with its
/// corners rounded to `radius`, sampled on a 4x4 grid.
fn rounded_square_coverage(x: u32, y: u32, min: f32, max: f32, radius: f32) -> f32 {
    const SAMPLES: u32 = 4;
    let mut covered = 0;
    for sample_y in 0..SAMPLES {
        for sample_x in 0..SAMPLES {
            let px = x as f32 + (sample_x as f32 + 0.5) / SAMPLES as f32;
            let py = y as f32 + (sample_y as f32 + 0.5) / SAMPLES as f32;
            if px < min || px > max || py < min || py > max {
                continue;
            }
            let dx = (min + radius - px).max(px - (max - radius)).max(0.0);
            let dy = (min + radius - py).max(py - (max - radius)).max(0.0);
            if dx * dx + dy * dy <= radius * radius {
                covered += 1;
            }
        }
    }
    covered as f32 / (SAMPLES * SAMPLES) as f32
}

/// The die's texels for `layout`: white, so a tint is its whole color, with softly
/// rounded corners, inside a pixel of keyline in the bar's dark that shows through its pips. The
/// pips are square and on whole pixels, so none of the body bleeds into them; only pips large
/// enough to have pixels of their own inside them get rounded corners. Returns the texture's side,
/// keyline included, with the texels row by row.
fn die_texels(layout: &DieLayout) -> (u32, Vec<Color32>) {
    let side = layout.side + 2;
    let radius = (layout.side as f32 * 0.2).max(1.5);
    let pip_radius = if layout.pip >= 3 { 1.0 } else { 0.0 };
    let [dark_r, dark_g, dark_b, _] = crate::colors::BLUE10.to_array();
    let mut texels = Vec::with_capacity((side * side) as usize);
    for y in 0..side {
        for x in 0..side {
            let keyline =
                rounded_square_coverage(x, y, 0.0, side as f32, radius + 1.0) * DIE_KEYLINE_ALPHA;
            let mut body = rounded_square_coverage(x, y, 1.0, side as f32 - 1.0, radius);
            for &offset in &layout.offsets {
                let min = (offset + 1) as f32;
                body *=
                    1.0 - rounded_square_coverage(x, y, min, min + layout.pip as f32, pip_radius);
            }
            // The body laid over the keyline, in straight alpha.
            let alpha = body + keyline * (1.0 - body);
            let channel = |dark: u8| {
                if alpha <= 0.0 {
                    return 0;
                }
                let value = (255.0 * body + dark as f32 * keyline * (1.0 - body)) / alpha;
                value.round() as u8
            };
            texels.push(Color32::from_rgba_unmultiplied(
                channel(dark_r),
                channel(dark_g),
                channel(dark_b),
                (alpha * 255.0).round() as u8,
            ));
        }
    }
    (side, texels)
}

/// The die textures uploaded so far, by the side of the body they were drawn for.
#[derive(Clone, Default)]
struct DieCache {
    textures: HashMap<u32, TextureHandle>,
}

/// How many die textures the cache keeps before it is emptied: the die at the three chip sizes,
/// with room to spare.
const DIE_CACHE_LIMIT: usize = 8;

fn die_texture(ctx: &Context, pixels: u32) -> TextureHandle {
    let id = Id::new("observer::random_die");
    if let Some(texture) = ctx.data(|data| {
        data.get_temp::<DieCache>(id)
            .and_then(|cache| cache.textures.get(&pixels).cloned())
    }) {
        return texture;
    }
    let (side, texels) = die_texels(&die_layout(pixels));
    let texture = ctx.load_texture(
        format!("random-die-{pixels}"),
        ColorImage::new([side as usize, side as usize], texels),
        TextureOptions::NEAREST,
    );
    ctx.data_mut(|data| {
        let cache = data.get_temp_mut_or_default::<DieCache>(id);
        if cache.textures.len() >= DIE_CACHE_LIMIT {
            cache.textures.clear();
        }
        cache.textures.insert(pixels, texture.clone());
    });
    texture
}

/// Where the die badging a random pick goes around `center`, for a body near `size` points across:
/// the body side in pixels it was asked for, which its texture is built and cached by, and the
/// square it is drawn into, on whole pixels at the side its [`DieLayout`] settles on with the
/// keyline included. Both come from the one layout, so the texture is drawn at exactly its own
/// size; a layout worked out again from the side it settled on can step up another pixel.
fn die_placement(center: Pos2, size: f32, pixels_per_point: f32) -> (u32, Rect) {
    let pixels = (size * pixels_per_point).round().max(1.0) as u32;
    let side = die_layout(pixels).side + 2;
    let rect = icon_rect(center, side as f32 / pixels_per_point, pixels_per_point);
    (pixels, rect)
}

/// Paints the die badging a random pick in `color` around `center`, with a body near `size` points
/// across. The keyline takes `color`'s alpha too, so the badge fades with the chip it is on.
pub(crate) fn paint_die(painter: &Painter, center: Pos2, size: f32, color: Color32) {
    let (pixels, rect) = die_placement(center, size, painter.ctx().pixels_per_point());
    let texture = die_texture(painter.ctx(), pixels);
    painter.image(
        texture.id(),
        rect,
        Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
        color,
    );
}

/// Paints `race`'s icon into `rect`, a square from [`icon_rect`], tinted by `color` at each point
/// of it: for an icon that fades out across its own extent rather than ending at its edges.
///
/// The tint is sampled on a grid over the square and blended between the samples, so it has to
/// change smoothly; a grid a sixteenth of the icon across follows any falloff that does.
pub(crate) fn paint_race_icon_shaded(
    painter: &Painter,
    rect: Rect,
    race: RaceView,
    color: impl Fn(Pos2) -> Color32,
) {
    const STEPS: u32 = 16;
    let pixels = (rect.width() * painter.ctx().pixels_per_point()).round() as u32;
    let texture = texture(painter.ctx(), race, pixels.max(1));
    let mut mesh = Mesh::with_texture(texture.id());
    for row in 0..=STEPS {
        for column in 0..=STEPS {
            let uv = pos2(column as f32, row as f32) / STEPS as f32;
            let position = rect.min + uv.to_vec2() * rect.size();
            mesh.vertices.push(Vertex {
                pos: position,
                uv,
                color: color(position),
            });
        }
    }
    let stride = STEPS + 1;
    for row in 0..STEPS {
        for column in 0..STEPS {
            let corner = row * stride + column;
            mesh.add_triangle(corner, corner + 1, corner + stride);
            mesh.add_triangle(corner + 1, corner + stride + 1, corner + stride);
        }
    }
    painter.add(Shape::mesh(mesh));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The middle of the box an icon's coverage fills and the middle of its weight, in fractions of
    /// the square.
    struct Measure {
        outline: Vec2,
        weight: Vec2,
    }

    fn measure(coverage: &[u8], pixels: u32) -> Measure {
        let mut min = Vec2::splat(f32::MAX);
        let mut max = Vec2::splat(f32::MIN);
        let mut sum = Vec2::ZERO;
        let mut total = 0.0;
        for (index, &alpha) in coverage.iter().enumerate() {
            if alpha == 0 {
                continue;
            }
            let x = (index as u32 % pixels) as f32;
            let y = (index as u32 / pixels) as f32;
            min = min.min(vec2(x, y));
            max = max.max(vec2(x + 1.0, y + 1.0));
            let weight = alpha as f32 / 255.0;
            sum += vec2(x + 0.5, y + 0.5) * weight;
            total += weight;
        }
        let side = pixels as f32;
        Measure {
            outline: (min + max) * 0.5 / side,
            weight: sum / total / side,
        }
    }

    #[test]
    fn every_icon_sits_whole_inside_its_square_at_every_chip_size() {
        // The chips' sizes at 1080p and 1440p, and one large enough to show any clipping plainly.
        for pixels in [15, 18, 20, 22, 25, 29, 200] {
            for race in RaceView::ALL {
                let coverage = coverage(race, pixels);
                assert_eq!(coverage.len(), (pixels * pixels) as usize, "{race:?}");
                assert!(coverage.iter().any(|&alpha| alpha > 0), "{race:?}");
                let last = pixels - 1;
                let on_edge = coverage.iter().enumerate().any(|(index, &alpha)| {
                    let (x, y) = (index as u32 % pixels, index as u32 / pixels);
                    alpha > 0 && (x == 0 || y == 0 || x == last || y == last)
                });
                assert!(!on_edge, "{race:?} is clipped at {pixels} pixels");
            }
        }
    }

    #[test]
    fn every_icon_is_placed_near_its_measured_middle() {
        // A loose bound: the fits are tuned by eye from the measured middle, and this only catches
        // a fit that has lost track of it, such as an offset with its sign flipped.
        let pixels = 480;
        for race in RaceView::ALL {
            let measure = measure(&coverage(race, pixels), pixels);
            let middle = (measure.outline + measure.weight) * 0.5;
            let off = (middle - Vec2::splat(0.5)).abs();
            assert!(off.x < 0.04 && off.y < 0.04, "{race:?} is {off:?} off");
        }
    }

    #[test]
    fn the_marine_is_moved_toward_his_rifle() {
        // Centered by his frame, his weight sits well left of the middle; the fit moves him right.
        let pixels = 480;
        let unfitted = coverage_with(
            TERRAN_SVG,
            IconFit {
                scale: 1.0,
                offset: Vec2::ZERO,
            },
            pixels,
        );
        let unfitted = measure(&unfitted, pixels);
        let fitted = measure(&coverage(RaceView::Terran, pixels), pixels);
        assert!(unfitted.weight.x < 0.42);
        assert!(fitted.weight.x > unfitted.weight.x + 0.04);
    }

    #[test]
    fn an_icon_square_lands_on_whole_pixels_around_its_center() {
        for pixels_per_point in [1.0, 900.0 / 1080.0, 1440.0 / 1080.0, 2.0] {
            for center in [pos2(289.0, 23.5), pos2(1631.3, 62.71), pos2(49.5, 115.25)] {
                for size in [15.12, 18.48, 21.84] {
                    let rect = icon_rect(center, size, pixels_per_point);
                    let corner = rect.min.to_vec2() * pixels_per_point;
                    let side = rect.width() * pixels_per_point;
                    for value in [corner.x, corner.y, side] {
                        assert!(
                            (value - value.round()).abs() < 1e-3,
                            "{value} at {center:?}"
                        );
                    }
                    assert!((side - size * pixels_per_point).abs() <= 0.5);
                    let drift = (rect.center() - center) * pixels_per_point;
                    assert!(drift.x.abs() <= 0.5 + 1e-3 && drift.y.abs() <= 0.5 + 1e-3);
                }
            }
        }
    }

    #[test]
    fn a_dies_pips_sit_centered_on_whole_pixels() {
        for pixels in 1..=32 {
            let layout = die_layout(pixels);
            let first = layout.offsets[0];
            let last = *layout.offsets.last().unwrap();
            assert!(layout.pip >= MIN_PIP, "{pixels}: {layout:?}");
            assert!(first >= 1, "{pixels}: {layout:?}");
            assert_eq!(
                first,
                layout.side - (last + layout.pip),
                "{pixels}: {layout:?}"
            );
            for pair in layout.offsets.windows(2) {
                assert!(pair[1] > pair[0] + layout.pip, "{pixels}: {layout:?}");
            }
            if pixels >= 7 {
                assert!(layout.side.abs_diff(pixels) <= 1, "{pixels}: {layout:?}");
            }
        }
    }

    #[test]
    fn a_die_shows_three_pips_where_they_fit_and_two_below() {
        assert_eq!(die_layout(8).offsets.len(), 2);
        for pixels in 9..=32 {
            assert_eq!(die_layout(pixels).offsets.len(), 3, "{pixels}");
        }
    }

    #[test]
    fn no_body_bleeds_into_a_dies_pips() {
        let keyline = Color32::from_rgba_unmultiplied(
            crate::colors::BLUE10.r(),
            crate::colors::BLUE10.g(),
            crate::colors::BLUE10.b(),
            (DIE_KEYLINE_ALPHA * 255.0).round() as u8,
        );
        for pixels in 7..=24 {
            let layout = die_layout(pixels);
            let (side, texels) = die_texels(&layout);
            // A pip with rounded corners only keeps its pixels inside them clear.
            let inset = u32::from(layout.pip >= 3);
            for &offset in &layout.offsets {
                for y in offset + inset..offset + layout.pip - inset {
                    for x in offset + inset..offset + layout.pip - inset {
                        let texel = texels[((y + 1) * side + x + 1) as usize];
                        assert_eq!(texel, keyline, "{pixels}: pixel ({x}, {y})");
                    }
                }
            }
        }
    }

    #[test]
    fn a_die_is_drawn_at_exactly_its_textures_size() {
        for pixels_per_point in [1.0, 900.0 / 1080.0, 1.25, 1440.0 / 1080.0, 1.5, 2.0] {
            for chip in [18.0, 22.0, 26.0] {
                let size = chip * 0.4;
                let (pixels, rect) = die_placement(pos2(100.3, 50.6), size, pixels_per_point);
                let (side, _) = die_texels(&die_layout(pixels));
                let drawn = rect.width() * pixels_per_point;
                assert!(
                    (drawn - side as f32).abs() < 1e-3,
                    "{chip}pt at {pixels_per_point}: {side}px texture in {drawn}px"
                );
            }
        }
    }
}
