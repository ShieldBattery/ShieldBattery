//! Glyphs from Material Symbols, the icon set the rest of ShieldBattery draws its controls' icons
//! from, for the overlay's controls that carry one.
//!
//! The font the web client sets them from is not something the overlay carries, so each glyph here
//! is its own outline as Google publishes it, filled, at the 24px optical size. Like the race icons
//! they are rasterized rather than tessellated, since egui fills convex paths only: each is rendered
//! at exactly the physical pixels it is drawn at and drawn on whole pixels, so its edges are the
//! rasterizer's anti-aliasing and nothing else.

use std::collections::HashMap;

use egui::{
    Color32, ColorImage, Context, Id, Painter, Pos2, Rect, TextureHandle, TextureOptions, Vec2,
    pos2,
};
use resvg::{tiny_skia, usvg};

/// A glyph of the set.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Symbol {
    /// `videocam`: a camera, for following someone's view.
    Videocam,
    /// `arrow_selector_tool`: the pointer, for what someone selects and clicks.
    ArrowSelectorTool,
}

impl Symbol {
    fn svg(self) -> &'static str {
        match self {
            Symbol::Videocam => {
                r#"<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h480q33 0 56.5 23.5T720-720v180l160-160v440L720-420v180q0 33-23.5 56.5T640-160H160Z"/></svg>"#
            }
            Symbol::ArrowSelectorTool => {
                r#"<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M551-80 406-392 240-160v-720l560 440H516l144 309-109 51Z"/></svg>"#
            }
        }
    }

    fn name(self) -> &'static str {
        match self {
            Symbol::Videocam => "videocam",
            Symbol::ArrowSelectorTool => "arrow-selector-tool",
        }
    }
}

/// How much of each pixel of a `pixels`-square raster `symbol` covers, row by row, its frame
/// filling the square. Empty if the SVG fails to parse, which would be a broken build rather than
/// anything a game can cause.
fn coverage(symbol: Symbol, pixels: u32) -> Vec<u8> {
    let Ok(tree) = usvg::Tree::from_str(symbol.svg(), &usvg::Options::default()) else {
        return Vec::new();
    };
    let Some(mut pixmap) = tiny_skia::Pixmap::new(pixels, pixels) else {
        return Vec::new();
    };
    let frame = tree.size();
    let scale = pixels as f32 / frame.width().max(frame.height());
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    pixmap.pixels().iter().map(|pixel| pixel.alpha()).collect()
}

/// The rasterized glyphs uploaded so far, by glyph and by the physical size they were drawn at.
///
/// A size is only ever drawn at one scale for as long as the screen keeps its resolution, so the
/// cache holds a handful of entries and is simply emptied should it ever outgrow that.
#[derive(Clone, Default)]
struct SymbolCache {
    textures: HashMap<(Symbol, u32), TextureHandle>,
}

/// How many textures the cache keeps before it is emptied: every glyph at a few sizes.
const CACHE_LIMIT: usize = 16;

fn texture(ctx: &Context, symbol: Symbol, pixels: u32) -> TextureHandle {
    let id = Id::new("kit::symbols");
    if let Some(texture) = ctx.data(|data| {
        data.get_temp::<SymbolCache>(id)
            .and_then(|cache| cache.textures.get(&(symbol, pixels)).cloned())
    }) {
        return texture;
    }
    // White, with the coverage in alpha, so a tint is the glyph's whole color.
    let texels = coverage(symbol, pixels)
        .into_iter()
        .map(Color32::from_white_alpha)
        .collect::<Vec<_>>();
    let image = if texels.len() == (pixels * pixels) as usize {
        ColorImage::new([pixels as usize, pixels as usize], texels)
    } else {
        ColorImage::filled([1, 1], Color32::TRANSPARENT)
    };
    let texture = ctx.load_texture(
        format!("symbol-{}-{pixels}", symbol.name()),
        image,
        TextureOptions::LINEAR,
    );
    ctx.data_mut(|data| {
        let cache = data.get_temp_mut_or_default::<SymbolCache>(id);
        if cache.textures.len() >= CACHE_LIMIT {
            cache.textures.clear();
        }
        cache.textures.insert((symbol, pixels), texture.clone());
    });
    texture
}

/// The square a glyph `size` points across is drawn into around `center`: as near that size and
/// that place as whole physical pixels allow at `pixels_per_point`, since the glyph is rasterized
/// for exactly the pixels it covers and a square straddling them would be resampled into a blur.
fn symbol_rect(center: Pos2, size: f32, pixels_per_point: f32) -> Rect {
    let pixels = (size * pixels_per_point).round().max(1.0);
    let corner = (center.to_vec2() * pixels_per_point - Vec2::splat(pixels * 0.5)).round();
    Rect::from_min_size(
        (corner / pixels_per_point).to_pos2(),
        Vec2::splat(pixels / pixels_per_point),
    )
}

/// Paints `symbol` in `color` centered on `center`, `size` points across, on whole pixels.
pub fn paint_symbol(painter: &Painter, center: Pos2, size: f32, symbol: Symbol, color: Color32) {
    let pixels_per_point = painter.ctx().pixels_per_point();
    let rect = symbol_rect(center, size, pixels_per_point);
    let pixels = (rect.width() * pixels_per_point).round() as u32;
    let texture = texture(painter.ctx(), symbol, pixels.max(1));
    painter.image(
        texture.id(),
        rect,
        Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
        color,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_glyph_parses_and_covers_part_of_its_square() {
        for symbol in [Symbol::Videocam, Symbol::ArrowSelectorTool] {
            let covered = coverage(symbol, 24);
            assert_eq!(covered.len(), 24 * 24, "{symbol:?}");
            let solid = covered.iter().filter(|&&alpha| alpha == 255).count();
            assert!(solid > 24 * 24 / 6, "{symbol:?} covers {solid} pixels");
            assert!(solid < 24 * 24 * 3 / 4, "{symbol:?} covers {solid} pixels");
        }
    }

    #[test]
    fn a_glyph_lands_on_whole_pixels_at_any_scale() {
        for pixels_per_point in [1.0, 1.25, 4.0 / 3.0, 2.0 / 3.0] {
            let rect = symbol_rect(pos2(100.37, 51.9), 16.0, pixels_per_point);
            for edge in [rect.left(), rect.top(), rect.right(), rect.bottom()] {
                let physical = edge * pixels_per_point;
                assert!(
                    (physical - physical.round()).abs() < 1e-3,
                    "{pixels_per_point}: {rect:?}"
                );
            }
        }
    }
}
