//! The game's own resource icons for the overlay's panels: read out of the game's storage, cleared
//! of the square its web UI frames them in, and scaled down ahead of time.
//!
//! The web UI's icons are drawn on an opaque navy tile with a lighter edge, which on a panel reads
//! as a box around every number. The minerals and gas art is lifted off its tile by clearing the
//! tile's colors inward from its edge; supply's art is a dark figure cut out of a pale tile, so its
//! darkness is taken as the coverage of a figure drawn in supply's own color instead.

use std::ffi::CString;

use egui::{ColorImage, Context, TextureHandle, TextureOptions};
use image::imageops::FilterType;
use image::{ImageFormat, RgbaImage};
use overlay_ui::kit::widgets::{IconSizes, ResourceIcons};

/// The share of an icon's width its tile's edge takes on each side, which the art sits inside.
const TILE_EDGE: f32 = 6.0 / 56.0;

/// The pixel sizes an icon is scaled to, past its own. A panel draws the smallest that is at
/// least as big as it needs; anything between two of these is at most a third smaller than the
/// one it is drawn from, which the renderer's plain filtering keeps clean.
const SCALED_SIZES: [u32; 4] = [32, 24, 18, 14];

/// The races in the order [`ResourceIcons`] holds their art in, by the names the web UI files
/// them under.
const RACES: [&str; 3] = ["zerg", "terran", "protoss"];

/// The loaded icons: what the panels draw from, and the textures that must stay alive while they
/// do.
pub struct LoadedResourceIcons {
    pub icons: ResourceIcons,
    pub carbot: bool,
    _textures: Vec<TextureHandle>,
}

/// Loads every resource icon of the carbot or the regular set through `read`, which reads a file
/// out of the game's storage. An icon the game has no file for, or one that does not decode, is
/// left with no sizes, and its panels draw their own glyph for it.
pub fn load(
    ctx: &Context,
    carbot: bool,
    mut read: impl FnMut(&CString) -> Option<Vec<u8>>,
) -> LoadedResourceIcons {
    let prefix = if carbot { "carbot_" } else { "" };
    let mut textures = Vec::new();
    let mut load_one = |name: &str, kind: Art| -> IconSizes {
        let Ok(path) = CString::new(format!("webui/dist/lib/images/{prefix}icon_{name}.png"))
        else {
            return IconSizes::default();
        };
        let Some(art) = read(&path).and_then(|bytes| lift_art(&bytes, kind)) else {
            return IconSizes::default();
        };
        let mut sizes = Vec::new();
        for image in scaled(&art) {
            let size = image.width() as f32;
            let texture = ctx.load_texture(
                format!("sb_resource_{name}_{}", image.width()),
                ColorImage::from_rgba_premultiplied(
                    [image.width() as usize, image.height() as usize],
                    image.as_raw(),
                ),
                TextureOptions::LINEAR,
            );
            sizes.push((size, texture.id()));
            textures.push(texture);
        }
        sizes.sort_by(|a, b| a.0.total_cmp(&b.0));
        IconSizes(sizes)
    };
    let minerals = load_one("minerals", Art::OnTile);
    let gas = RACES.map(|race| load_one(&format!("gas_{race}"), Art::OnTile));
    let supply = RACES.map(|race| load_one(&format!("supply_{race}"), Art::CutOut));
    LoadedResourceIcons {
        icons: ResourceIcons {
            minerals,
            gas,
            supply,
        },
        carbot,
        _textures: textures,
    }
}

/// How an icon's art sits on its tile.
#[derive(Copy, Clone)]
enum Art {
    /// Drawn in color over the navy tile.
    OnTile,
    /// A dark figure cut out of a pale tile.
    CutOut,
}

/// Decodes an icon and returns its art alone, cropped to the inside of the tile's edge, with its
/// colors premultiplied by its coverage.
fn lift_art(png: &[u8], kind: Art) -> Option<RgbaImage> {
    let mut image = image::load_from_memory_with_format(png, ImageFormat::Png)
        .ok()?
        .to_rgba8();
    match kind {
        Art::OnTile => clear_tile(&mut image),
        Art::CutOut => image = figure_coverage(&image),
    }
    let edge = (image.width() as f32 * TILE_EDGE).round() as u32;
    let inner = image.width().min(image.height()).checked_sub(edge * 2)?;
    let mut art = image::imageops::crop_imm(&image, edge, edge, inner, inner).to_image();
    premultiply(&mut art);
    Some(art)
}

/// Whether a pixel is the tile's rather than the art's: clear already, or of the tile's navy and
/// the blue of its edge.
fn is_tile(pixel: &image::Rgba<u8>) -> bool {
    let [r, g, b, a] = pixel.0;
    let (r, g, b) = (f32::from(r), f32::from(g), f32::from(b));
    a < 10 || (b > r * 1.6 && b > g * 1.1 && r < 60.0 && g < 90.0)
}

/// Clears the tile from around the art: everything of the tile's colors reachable from the image's
/// edge without crossing the art. Dark blue inside the art stays, since nothing of the tile reaches
/// it.
fn clear_tile(image: &mut RgbaImage) {
    let (width, height) = image.dimensions();
    let mut seen = vec![false; (width * height) as usize];
    let mut pending: Vec<(u32, u32)> = Vec::new();
    for x in 0..width {
        pending.push((x, 0));
        pending.push((x, height - 1));
    }
    for y in 0..height {
        pending.push((0, y));
        pending.push((width - 1, y));
    }
    while let Some((x, y)) = pending.pop() {
        let index = (y * width + x) as usize;
        if seen[index] {
            continue;
        }
        seen[index] = true;
        let pixel = image.get_pixel_mut(x, y);
        if !is_tile(pixel) {
            continue;
        }
        pixel.0[3] = 0;
        if x > 0 {
            pending.push((x - 1, y));
        }
        if x + 1 < width {
            pending.push((x + 1, y));
        }
        if y > 0 {
            pending.push((x, y - 1));
        }
        if y + 1 < height {
            pending.push((x, y + 1));
        }
    }
}

/// A cut-out figure as coverage of a white one: the darker a pixel of the tile, the more of the
/// figure it is.
fn figure_coverage(image: &RgbaImage) -> RgbaImage {
    // Lighter than this is all tile and darker than the other end is all figure, which takes the
    // figure's own antialiased edge as a soft edge rather than a hard one.
    const TILE_LIGHTNESS: f32 = 175.0;
    const RAMP: f32 = 140.0;
    RgbaImage::from_fn(image.width(), image.height(), |x, y| {
        let [r, g, b, a] = image.get_pixel(x, y).0;
        let lightness = (f32::from(r) + f32::from(g) + f32::from(b)) / 3.0;
        let coverage = ((TILE_LIGHTNESS - lightness) / RAMP).clamp(0.0, 1.0) * f32::from(a) / 255.0;
        image::Rgba([255, 255, 255, (coverage * 255.0).round() as u8])
    })
}

fn premultiply(image: &mut RgbaImage) {
    for pixel in image.pixels_mut() {
        let [r, g, b, a] = pixel.0;
        let scale = |channel: u8| ((u32::from(channel) * u32::from(a) + 127) / 255) as u8;
        pixel.0 = [scale(r), scale(g), scale(b), a];
    }
}

/// The art at its own size and at each of [`SCALED_SIZES`] below it. Scaled premultiplied, so the
/// cleared tile's color never bleeds into the art's edge.
fn scaled(art: &RgbaImage) -> Vec<RgbaImage> {
    let mut sizes = vec![art.clone()];
    for size in SCALED_SIZES {
        if size < art.width() {
            let mut image = image::imageops::resize(art, size, size, FilterType::Lanczos3);
            // Lanczos rings past the coverage it was given; a premultiplied color is never more
            // than its alpha.
            for pixel in image.pixels_mut() {
                let a = pixel.0[3];
                for channel in &mut pixel.0[..3] {
                    *channel = (*channel).min(a);
                }
            }
            sizes.push(image);
        }
    }
    sizes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tile_with_art() -> RgbaImage {
        RgbaImage::from_fn(20, 20, |x, y| {
            let inside = (6..14).contains(&x) && (6..14).contains(&y);
            match inside {
                true => image::Rgba([80, 200, 250, 255]),
                false => image::Rgba([2, 13, 41, 255]),
            }
        })
    }

    #[test]
    fn the_tile_clears_and_the_art_stays() {
        let mut image = tile_with_art();
        clear_tile(&mut image);
        assert_eq!(image.get_pixel(1, 1).0[3], 0);
        assert_eq!(image.get_pixel(10, 10).0[3], 255);
    }

    #[test]
    fn a_dark_figure_becomes_coverage() {
        let image = RgbaImage::from_fn(4, 1, |x, _| match x {
            0 => image::Rgba([220, 220, 245, 255]),
            _ => image::Rgba([10, 10, 20, 255]),
        });
        let figure = figure_coverage(&image);
        assert_eq!(figure.get_pixel(0, 0).0[3], 0);
        assert_eq!(figure.get_pixel(1, 0).0[3], 255);
    }

    #[test]
    fn scaled_colors_stay_within_their_coverage() {
        let mut image = tile_with_art();
        clear_tile(&mut image);
        premultiply(&mut image);
        let art = image::imageops::resize(&image, 40, 40, FilterType::Nearest);
        for size in scaled(&art) {
            for pixel in size.pixels() {
                let [r, g, b, a] = pixel.0;
                assert!(r <= a && g <= a && b <= a);
            }
        }
    }
}
