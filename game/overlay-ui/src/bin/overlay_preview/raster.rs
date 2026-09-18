//! A CPU rasterizer for tessellated egui meshes.
//!
//! The overlay's tessellated output is the same data the game hands its renderer, so rasterizing it
//! here produces an image of what the overlay looks like in game without a GPU, a window, or
//! StarCraft. That makes a scenario's appearance something a command can write to a PNG and a diff
//! can compare.

use std::collections::HashMap;

use egui::epaint::{ClippedPrimitive, ImageData, Primitive};
use egui::{Color32, Pos2, TextureId, TexturesDelta};
use image::RgbaImage;

/// A CPU-side mirror of the game context's texture store, kept up to date from its texture deltas.
#[derive(Default)]
pub struct TextureStore {
    textures: HashMap<TextureId, CpuTexture>,
}

struct CpuTexture {
    size: [usize; 2],
    /// Premultiplied sRGBA, row by row from the top.
    pixels: Vec<Color32>,
}

impl TextureStore {
    pub fn new() -> TextureStore {
        TextureStore::default()
    }

    /// Applies one pass's texture delta, consuming it.
    pub fn apply(&mut self, delta: &mut TexturesDelta) {
        for (id, image_deltas) in delta.set.drain() {
            for image_delta in image_deltas {
                let ImageData::Color(image) = &image_delta.image;
                match image_delta.pos {
                    None => {
                        self.textures.insert(
                            id,
                            CpuTexture {
                                size: image.size,
                                pixels: image.pixels.clone(),
                            },
                        );
                    }
                    Some([x, y]) => {
                        let Some(texture) = self.textures.get_mut(&id) else {
                            continue;
                        };
                        for row in 0..image.size[1] {
                            let dst_y = y + row;
                            if dst_y >= texture.size[1] {
                                break;
                            }
                            let width = image.size[0].min(texture.size[0].saturating_sub(x));
                            let src = &image.pixels[row * image.size[0]..][..width];
                            let dst_start = dst_y * texture.size[0] + x;
                            texture.pixels[dst_start..dst_start + width].copy_from_slice(src);
                        }
                    }
                }
            }
        }
        for id in delta.free.drain() {
            self.textures.remove(&id);
        }
    }

    /// Bilinearly samples a texture, clamping at its edges. This matches the filtering egui asks for
    /// on its font atlas; the alternative (nearest) would only differ where a mesh is scaled, which
    /// the overlay never does.
    fn sample(&self, id: TextureId, uv: Pos2) -> [f32; 4] {
        let Some(texture) = self.textures.get(&id) else {
            // A mesh whose texture never arrived still shows its vertex colors rather than
            // vanishing, which makes the missing texture visible instead of silent.
            return [1.0, 1.0, 1.0, 1.0];
        };
        let [w, h] = texture.size;
        if w == 0 || h == 0 {
            return [1.0, 1.0, 1.0, 1.0];
        }
        let x = uv.x * w as f32 - 0.5;
        let y = uv.y * h as f32 - 0.5;
        let x0 = x.floor();
        let y0 = y.floor();
        let fx = x - x0;
        let fy = y - y0;
        let clamp = |v: f32, max: usize| (v.max(0.0) as usize).min(max - 1);
        let xs = [clamp(x0, w), clamp(x0 + 1.0, w)];
        let ys = [clamp(y0, h), clamp(y0 + 1.0, h)];
        let mut out = [0.0f32; 4];
        for (j, sy) in ys.iter().enumerate() {
            for (i, sx) in xs.iter().enumerate() {
                let weight =
                    if i == 0 { 1.0 - fx } else { fx } * if j == 0 { 1.0 - fy } else { fy };
                if weight == 0.0 {
                    continue;
                }
                let texel = texture.pixels[sy * w + sx];
                for (channel, value) in out.iter_mut().enumerate() {
                    *value += weight * texel[channel] as f32 / 255.0;
                }
            }
        }
        out
    }
}

/// Rasterizes tessellated primitives over a backdrop into an RGBA image.
///
/// `primitives` are in the game context's points; `pixels_per_point` scales them to `size_px`.
/// egui's tessellator already feathers every edge, so no further anti-aliasing is applied: sampling
/// pixel centres reproduces exactly what a GPU would draw. Colors are premultiplied sRGBA and are
/// blended in that space rather than in linear light, which is a touch heavier on text edges than
/// the game's shader but does not move anything.
pub fn rasterize(
    primitives: &[ClippedPrimitive],
    textures: &TextureStore,
    size_px: [u32; 2],
    pixels_per_point: f32,
    backdrop: Option<&RgbaImage>,
) -> RgbaImage {
    let width = size_px[0].max(1) as usize;
    let height = size_px[1].max(1) as usize;
    let mut buffer = vec![[0.0f32; 4]; width * height];
    fill_background(&mut buffer, width, height, backdrop);

    for primitive in primitives {
        let Primitive::Mesh(mesh) = &primitive.primitive else {
            continue;
        };
        let clip = primitive.clip_rect;
        let clip_x0 = (clip.min.x * pixels_per_point).floor().max(0.0) as usize;
        let clip_y0 = (clip.min.y * pixels_per_point).floor().max(0.0) as usize;
        let clip_x1 = ((clip.max.x * pixels_per_point).ceil().max(0.0) as usize).min(width);
        let clip_y1 = ((clip.max.y * pixels_per_point).ceil().max(0.0) as usize).min(height);
        if clip_x0 >= clip_x1 || clip_y0 >= clip_y1 {
            continue;
        }
        for triangle in mesh.indices.as_chunks::<3>().0 {
            let vertices = [
                &mesh.vertices[triangle[0] as usize],
                &mesh.vertices[triangle[1] as usize],
                &mesh.vertices[triangle[2] as usize],
            ];
            let points = vertices.map(|v| (v.pos.to_vec2() * pixels_per_point).to_pos2());
            let area = (points[1] - points[0]).x * (points[2] - points[0]).y
                - (points[1] - points[0]).y * (points[2] - points[0]).x;
            if area.abs() < 1e-6 {
                continue;
            }
            let min_x = points.iter().fold(f32::MAX, |a, p| a.min(p.x));
            let max_x = points.iter().fold(f32::MIN, |a, p| a.max(p.x));
            let min_y = points.iter().fold(f32::MAX, |a, p| a.min(p.y));
            let max_y = points.iter().fold(f32::MIN, |a, p| a.max(p.y));
            let x0 = (min_x.floor().max(0.0) as usize).max(clip_x0);
            let x1 = ((max_x.ceil().max(0.0) as usize) + 1).min(clip_x1);
            let y0 = (min_y.floor().max(0.0) as usize).max(clip_y0);
            let y1 = ((max_y.ceil().max(0.0) as usize) + 1).min(clip_y1);
            for y in y0..y1 {
                for x in x0..x1 {
                    let point = Pos2::new(x as f32 + 0.5, y as f32 + 0.5);
                    // Barycentric weights from the signed sub-triangle areas, divided by the signed
                    // total: the sign cancels, so both winding orders rasterize the same. egui is
                    // not consistent about winding, so this must not care.
                    let w0 = edge(points[1], points[2], point) / area;
                    let w1 = edge(points[2], points[0], point) / area;
                    let w2 = 1.0 - w0 - w1;
                    if w0 < 0.0 || w1 < 0.0 || w2 < 0.0 {
                        continue;
                    }
                    let uv = Pos2::new(
                        w0 * vertices[0].uv.x + w1 * vertices[1].uv.x + w2 * vertices[2].uv.x,
                        w0 * vertices[0].uv.y + w1 * vertices[1].uv.y + w2 * vertices[2].uv.y,
                    );
                    let texel = textures.sample(mesh.texture_id, uv);
                    let mut src = [0.0f32; 4];
                    for (channel, value) in src.iter_mut().enumerate() {
                        let vertex_color = w0 * vertices[0].color[channel] as f32
                            + w1 * vertices[1].color[channel] as f32
                            + w2 * vertices[2].color[channel] as f32;
                        *value = vertex_color / 255.0 * texel[channel];
                    }
                    let dst = &mut buffer[y * width + x];
                    let inverse_alpha = 1.0 - src[3];
                    for channel in 0..4 {
                        dst[channel] = src[channel] + dst[channel] * inverse_alpha;
                    }
                }
            }
        }
    }

    let mut out = RgbaImage::new(width as u32, height as u32);
    for (pixel, value) in out.pixels_mut().zip(buffer.iter()) {
        // The background is opaque, so premultiplied and straight alpha agree here; forcing the
        // alpha keeps a rounding shortfall from making the PNG faintly translucent.
        pixel.0 = [to_u8(value[0]), to_u8(value[1]), to_u8(value[2]), u8::MAX];
    }
    out
}

/// Twice the signed area of the triangle `(a, b, point)`.
fn edge(a: Pos2, b: Pos2, point: Pos2) -> f32 {
    (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
}

fn to_u8(value: f32) -> u8 {
    (value * 255.0 + 0.5).clamp(0.0, 255.0) as u8
}

fn fill_background(
    buffer: &mut [[f32; 4]],
    width: usize,
    height: usize,
    backdrop: Option<&RgbaImage>,
) {
    let Some(backdrop) = backdrop.filter(|b| b.width() > 0 && b.height() > 0) else {
        let fill = crate::EMPTY_SCREEN_FILL;
        let fill = [
            fill.r() as f32 / 255.0,
            fill.g() as f32 / 255.0,
            fill.b() as f32 / 255.0,
            1.0,
        ];
        buffer.fill(fill);
        return;
    };
    // Stretched to the emulated screen, which is what the interactive host does with it too.
    let (src_w, src_h) = (backdrop.width() as f32, backdrop.height() as f32);
    for y in 0..height {
        let sy = ((y as f32 + 0.5) / height as f32 * src_h - 0.5)
            .clamp(0.0, src_h - 1.0)
            .round() as u32;
        for x in 0..width {
            let sx = ((x as f32 + 0.5) / width as f32 * src_w - 0.5)
                .clamp(0.0, src_w - 1.0)
                .round() as u32;
            let texel = backdrop.get_pixel(sx, sy).0;
            buffer[y * width + x] = [
                texel[0] as f32 / 255.0,
                texel[1] as f32 / 255.0,
                texel[2] as f32 / 255.0,
                1.0,
            ];
        }
    }
}
