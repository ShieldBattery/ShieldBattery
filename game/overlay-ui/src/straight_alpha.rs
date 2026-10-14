//! The overlay's colors in the form SC:R's renderer blends.
//!
//! egui's colors and textures are premultiplied by alpha, but no blend mode SC:R's renderers offer
//! blends premultiplied colors: the one that blends at all multiplies the source by its alpha
//! itself. Handed over as is, everything translucent would have its alpha applied twice and draw
//! much fainter than egui means it to, so the game DLL hands over textures and vertex colors
//! unmultiplied. The preview host can render through the same conversion, to show what the game
//! draws rather than what egui means.

use egui::Color32;
use egui::epaint::Vertex;

/// The straight-alpha color of every vertex of a mesh.
///
/// egui's anti-aliasing fades every edge out over a strip of triangles whose outer vertices are
/// fully transparent, and premultiplied, a fully transparent color is black. Interpolated across a
/// triangle in straight alpha, that black darkens the edge along with fading it, so every circle,
/// stroke and rounded corner gets a dark, hard rim. A vertex nothing of shows has no color of its
/// own to keep, so each takes the color of the most opaque vertex it shares a triangle with: across
/// the strip only alpha then changes, which blends exactly as egui's premultiplied fade would.
pub fn vertex_colors<I: Copy + Into<u32>>(vertices: &[Vertex], indices: &[I]) -> Vec<[u8; 4]> {
    let mut colors = vertices
        .iter()
        .map(|vertex| vertex.color.to_srgba_unmultiplied())
        .collect::<Vec<_>>();
    let mut borrowed = vec![false; colors.len()];
    for triangle in indices.as_chunks::<3>().0 {
        let corners = triangle.map(|index| index.into() as usize);
        let Some(&donor) = corners
            .iter()
            .filter(|&&corner| corner < colors.len())
            .max_by_key(|&&corner| colors[corner][3])
        else {
            continue;
        };
        let [r, g, b, alpha] = colors[donor];
        if alpha == 0 {
            continue;
        }
        for corner in corners {
            if corner < colors.len() && colors[corner][3] == 0 && !borrowed[corner] {
                colors[corner] = [r, g, b, 0];
                borrowed[corner] = true;
            }
        }
    }
    colors
}

/// A texel of an egui texture with straight alpha.
///
/// A fully transparent texel has no color to unmultiply, and left black it would darken whatever
/// it is filtered together with: the edge of every glyph. It is given white instead, the color of
/// everything the overlay uploads, which is egui's font atlas (white glyphs and white shapes, tinted
/// by vertex color).
pub fn texel(pixel: Color32) -> [u8; 4] {
    match pixel.a() {
        0 => [255, 255, 255, 0],
        _ => pixel.to_srgba_unmultiplied(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use egui::pos2;

    fn vertex(color: Color32) -> Vertex {
        Vertex {
            pos: pos2(0.0, 0.0),
            uv: pos2(0.0, 0.0),
            color,
        }
    }

    #[test]
    fn a_fading_edge_keeps_its_color_while_its_alpha_falls() {
        let fill = Color32::from_rgb(193, 163, 245);
        let half = Color32::from_rgba_unmultiplied(100, 200, 50, 128);
        // A feathered edge: two filled vertices and two fully transparent ones outside them, then a
        // half-transparent vertex fading out to a transparent one of its own.
        let vertices = [
            vertex(fill),
            vertex(fill),
            vertex(Color32::TRANSPARENT),
            vertex(Color32::TRANSPARENT),
            vertex(half),
            vertex(Color32::TRANSPARENT),
        ];
        let indices: [u16; 9] = [0, 1, 2, 1, 2, 3, 4, 5, 4];
        let colors = vertex_colors(&vertices, &indices);
        assert_eq!(colors[0], [193, 163, 245, 255]);
        assert_eq!(colors[2], [193, 163, 245, 0]);
        assert_eq!(colors[3], [193, 163, 245, 0]);
        let [r, g, b, a] = colors[4];
        assert_eq!(colors[5], [r, g, b, 0]);
        assert!(a > 0);
    }

    #[test]
    fn transparent_atlas_texels_are_white() {
        assert_eq!(texel(Color32::TRANSPARENT), [255, 255, 255, 0]);
        assert_eq!(texel(Color32::from_white_alpha(64)), [255, 255, 255, 64]);
    }
}
