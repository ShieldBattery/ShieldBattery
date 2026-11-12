//! Painting something that is on the move, between whole pixels.
//!
//! egui rounds the rects and text it is given to whole pixels, each on its own, which keeps a
//! surface that stands still crisp. One that slides is stepped along a pixel at a time by it, its
//! parts not all on the same frame, so it judders against anything in the game it is following.
//! What is painted through [`paint_off_grid`] is left where it was put instead.

use egui::layers::ShapeIdx;
use egui::{Mesh, Shape, Stroke, Ui, Vec2, epaint::TextShape};

/// Paints what `paint` paints into `ui`'s layer moved by `offset`, none of it rounded to whole
/// pixels. `paint` lays it out as it would standing still, on whole pixels, and `offset` is how far
/// off them it is this frame.
pub fn paint_off_grid<R>(ui: &Ui, offset: Vec2, paint: impl FnOnce() -> R) -> R {
    let layer = ui.layer_id();
    let next = || {
        ui.ctx()
            .graphics(|layers| layers.get(layer).map_or(0, |list| list.next_idx().0))
    };
    let start = next();
    let result = paint();
    let end = next();
    let font_image_size = ui.ctx().fonts(|fonts| fonts.font_image_size());
    ui.ctx().graphics_mut(|layers| {
        let list = layers.entry(layer);
        for index in start..end {
            list.mutate_shape(ShapeIdx(index), |clipped| {
                leave_off_grid(&mut clipped.shape, font_image_size);
                clipped.shape.translate(offset);
            });
        }
    });
    result
}

/// Makes `shape` one egui tessellates where it is rather than on the nearest whole pixels.
fn leave_off_grid(shape: &mut Shape, font_image_size: [usize; 2]) {
    match shape {
        Shape::Vec(shapes) => {
            for shape in shapes {
                leave_off_grid(shape, font_image_size);
            }
        }
        Shape::Rect(rect) => rect.round_to_pixels = Some(false),
        Shape::Text(text) => {
            if let Some(mesh) = text_mesh(text, font_image_size) {
                *shape = Shape::mesh(mesh);
            }
        }
        _ => {}
    }
}

/// `text` as the mesh egui would tessellate it into, but for starting it on a whole pixel, which a
/// text shape is given no way out of. `None` for text turned or underlined, which nothing painted
/// off the grid is.
fn text_mesh(text: &TextShape, font_image_size: [usize; 2]) -> Option<Mesh> {
    if text.angle != 0.0 || text.underline != Stroke::NONE {
        return None;
    }
    let mut mesh = Mesh::default();
    let texel = Vec2::new(
        1.0 / font_image_size[0].max(1) as f32,
        1.0 / font_image_size[1].max(1) as f32,
    );
    for row in &text.galley.rows {
        let row_pos = text.pos + row.pos.to_vec2();
        let first = mesh.vertices.len() as u32;
        mesh.indices
            .extend(row.visuals.mesh.indices.iter().map(|index| index + first));
        mesh.vertices.extend(
            row.visuals
                .mesh
                .vertices
                .iter()
                .enumerate()
                .map(|(i, vertex)| {
                    let mut vertex = *vertex;
                    if let Some(color) = text.override_text_color {
                        if row.visuals.glyph_vertex_range.contains(&i) {
                            vertex.color = color;
                        }
                    } else if vertex.color == egui::Color32::PLACEHOLDER {
                        vertex.color = text.fallback_color;
                    }
                    if text.opacity_factor < 1.0 {
                        vertex.color = vertex.color.gamma_multiply(text.opacity_factor);
                    }
                    vertex.pos = row_pos + vertex.pos.to_vec2();
                    vertex.uv = (vertex.uv.to_vec2() * texel).to_pos2();
                    vertex
                }),
        );
    }
    Some(mesh)
}

#[cfg(test)]
mod tests {
    use egui::{Color32, FontId, Rect, pos2, vec2};

    use super::*;

    /// The shapes one frame paints through [`paint_off_grid`], moved by `offset`.
    fn painted(offset: Vec2, paint: impl Fn(&Ui)) -> Vec<Shape> {
        let ctx = egui::Context::default();
        let mut shapes = Vec::new();
        let mut out = ctx.run_ui(egui::RawInput::default(), |ui| {
            let from = ui.ctx().graphics(|layers| {
                layers
                    .get(ui.layer_id())
                    .map_or(0, |list| list.next_idx().0)
            });
            paint_off_grid(ui, offset, || paint(ui));
            shapes = ui.ctx().graphics(|layers| {
                layers
                    .get(ui.layer_id())
                    .map(|list| {
                        list.all_entries()
                            .skip(from)
                            .map(|clipped| clipped.shape.clone())
                            .collect()
                    })
                    .unwrap_or_default()
            });
        });
        out.textures_delta.clear();
        shapes
    }

    #[test]
    fn a_rect_is_moved_and_no_longer_rounded_to_pixels() {
        let rect = Rect::from_min_size(pos2(10.0, 20.0), vec2(30.0, 5.0));
        let shapes = painted(vec2(0.25, -0.4), |ui| {
            ui.painter().rect_filled(rect, 0.0, Color32::WHITE);
        });
        let [Shape::Rect(moved)] = shapes.as_slice() else {
            panic!("{shapes:?}");
        };
        assert_eq!(moved.rect, rect.translate(vec2(0.25, -0.4)));
        assert_eq!(moved.round_to_pixels, Some(false));
    }

    #[test]
    fn text_becomes_a_mesh_of_its_glyphs_where_it_was_put() {
        let at = pos2(40.0, 50.0);
        let offset = vec2(0.5, 0.25);
        let shapes = painted(offset, |ui| {
            ui.painter().text(
                at,
                egui::Align2::LEFT_TOP,
                "12",
                FontId::proportional(14.0),
                Color32::RED,
            );
        });
        let [Shape::Mesh(mesh)] = shapes.as_slice() else {
            panic!("{shapes:?}");
        };
        assert!(!mesh.vertices.is_empty());
        assert!(
            mesh.vertices
                .iter()
                .all(|vertex| vertex.color == Color32::RED)
        );
        // The font atlas, addressed in shares of it.
        assert_eq!(mesh.texture_id, egui::TextureId::default());
        assert!(
            mesh.vertices
                .iter()
                .all(|vertex| vertex.uv.x <= 1.0 && vertex.uv.y <= 1.0)
        );
        // Starting where it was put, off the pixel grid.
        let left = mesh
            .vertices
            .iter()
            .map(|v| v.pos.x)
            .fold(f32::INFINITY, f32::min);
        assert!(
            left >= at.x + offset.x && left < at.x + offset.x + 4.0,
            "{left}"
        );
        assert!((left - offset.x).fract().abs() < 1e-3, "{left}");
    }
}
