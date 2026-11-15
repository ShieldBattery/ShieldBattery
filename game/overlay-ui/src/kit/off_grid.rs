//! Painting something that is on the move, between whole pixels.
//!
//! egui rounds the rects and text it is given to whole pixels, each on its own, which keeps a
//! surface that stands still crisp. One that slides is stepped along a pixel at a time by it, its
//! parts not all on the same frame, so it judders against anything in the game it is following.
//! What is painted through [`paint_off_grid`] is left where it was put instead.
//!
//! A rect can be told not to be rounded. Text cannot, so it is handed to egui as the mesh of its
//! glyphs instead, which egui leaves where it is. That mesh addresses the font atlas in shares of
//! its size, and the atlas can still grow while a frame is being laid out, so the text is only
//! marked as it is painted, and made into its mesh by [`leave_text_off_grid`] once the frame is
//! over and the atlas is the size it will be drawn at. A host that leaves that out draws the text
//! rounded, as egui would have.

use egui::epaint::{ClippedShape, TextShape};
use egui::layers::ShapeIdx;
use egui::{Color32, Context, Mesh, Shape, Stroke, Ui, Vec2};

/// What marks text as painted off the grid: an underline of no width, which draws nothing, in a
/// color nothing else underlines with.
const OFF_GRID_MARK: Stroke = Stroke {
    width: 0.0,
    color: Color32::from_rgba_premultiplied(1, 2, 3, 4),
};

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
    ui.ctx().graphics_mut(|layers| {
        let list = layers.entry(layer);
        for index in start..end {
            list.mutate_shape(ShapeIdx(index), |clipped| {
                mark_off_grid(&mut clipped.shape);
                clipped.shape.translate(offset);
            });
        }
    });
    result
}

/// Makes `shape` one that is tessellated where it is rather than on the nearest whole pixels, or,
/// for text, marks it to be made one by [`leave_text_off_grid`].
fn mark_off_grid(shape: &mut Shape) {
    match shape {
        Shape::Vec(shapes) => {
            for shape in shapes {
                mark_off_grid(shape);
            }
        }
        Shape::Rect(rect) => rect.round_to_pixels = Some(false),
        // Text that is turned or underlined is left as it is, which nothing painted off the grid
        // is.
        Shape::Text(text) if text.angle == 0.0 && text.underline == Stroke::NONE => {
            text.underline = OFF_GRID_MARK;
        }
        _ => {}
    }
}

/// Makes the text in `shapes` that was painted through [`paint_off_grid`] into the meshes that
/// leave it where it was put. A host calls this on a pass's shapes once the pass is over, just
/// before tessellating them.
pub fn leave_text_off_grid(ctx: &Context, shapes: &mut [ClippedShape]) {
    let font_image_size = ctx.fonts(|fonts| fonts.font_image_size());
    for clipped in shapes {
        text_to_mesh(&mut clipped.shape, font_image_size);
    }
}

fn text_to_mesh(shape: &mut Shape, font_image_size: [usize; 2]) {
    match shape {
        Shape::Vec(shapes) => {
            for shape in shapes {
                text_to_mesh(shape, font_image_size);
            }
        }
        Shape::Text(text) if text.underline == OFF_GRID_MARK => {
            *shape = Shape::mesh(text_mesh(text, font_image_size));
        }
        _ => {}
    }
}

/// `text` as the mesh egui would tessellate it into, but for starting it on a whole pixel, which a
/// text shape is given no way out of. `font_image_size` is the size of the font atlas the mesh is
/// drawn from.
fn text_mesh(text: &TextShape, font_image_size: [usize; 2]) -> Mesh {
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
                    } else if vertex.color == Color32::PLACEHOLDER {
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
    mesh
}

#[cfg(test)]
mod tests {
    use egui::epaint::Primitive;
    use egui::{FontId, Rect, pos2, vec2};

    use super::*;

    /// The shapes of one pass that paints through [`paint_off_grid`], moved by `offset`, and then
    /// whatever `after` does in the same pass, once the pass is over.
    fn painted(
        ctx: &Context,
        offset: Vec2,
        paint: impl Fn(&Ui),
        after: impl Fn(&Ui),
    ) -> Vec<ClippedShape> {
        let mut out = ctx.run_ui(egui::RawInput::default(), |ui| {
            paint_off_grid(ui, offset, || paint(ui));
            after(ui);
        });
        out.textures_delta.clear();
        leave_text_off_grid(ctx, &mut out.shapes);
        out.shapes
    }

    /// The meshes `shapes` tessellate into.
    fn meshes(ctx: &Context, shapes: Vec<ClippedShape>) -> Vec<Mesh> {
        ctx.tessellate(shapes, ctx.pixels_per_point())
            .into_iter()
            .filter_map(|clipped| match clipped.primitive {
                Primitive::Mesh(mesh) => Some(mesh),
                Primitive::Callback(_) => None,
            })
            .collect()
    }

    fn paint_numbers(ui: &Ui, at: egui::Pos2) {
        ui.painter().text(
            at,
            egui::Align2::LEFT_TOP,
            "12",
            FontId::proportional(14.0),
            Color32::RED,
        );
    }

    #[test]
    fn a_rect_is_moved_and_no_longer_rounded_to_pixels() {
        let ctx = Context::default();
        let rect = Rect::from_min_size(pos2(10.0, 20.0), vec2(30.0, 5.0));
        let shapes = painted(
            &ctx,
            vec2(0.25, -0.4),
            |ui| {
                ui.painter().rect_filled(rect, 0.0, Color32::WHITE);
            },
            |_| {},
        );
        let rects: Vec<_> = shapes
            .iter()
            .filter_map(|clipped| match &clipped.shape {
                Shape::Rect(rect) => Some(rect),
                _ => None,
            })
            .collect();
        let [moved] = rects.as_slice() else {
            panic!("{shapes:?}");
        };
        assert_eq!(moved.rect, rect.translate(vec2(0.25, -0.4)));
        assert_eq!(moved.round_to_pixels, Some(false));
    }

    #[test]
    fn text_becomes_a_mesh_of_its_glyphs_where_it_was_put() {
        let ctx = Context::default();
        let at = pos2(40.0, 50.0);
        let offset = vec2(0.5, 0.25);
        let shapes = painted(&ctx, offset, |ui| paint_numbers(ui, at), |_| {});
        let text: Vec<_> = shapes
            .iter()
            .filter_map(|clipped| match &clipped.shape {
                Shape::Mesh(mesh) => Some(mesh),
                _ => None,
            })
            .collect();
        let [mesh] = text.as_slice() else {
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

    #[test]
    fn text_is_drawn_from_the_atlas_as_it_is_once_the_frame_is_laid_out() {
        let ctx = Context::default();
        let at = pos2(40.0, 50.0);
        // Laid out after the text is painted, in the same pass: glyphs the atlas has no room for
        // until it grows.
        let grow = |ui: &Ui| {
            for size in [120.0, 160.0, 200.0, 240.0] {
                let _ = ui.painter().layout_no_wrap(
                    "ABCDEFGHIJKLMNOPQRSTUVWXYZ".to_owned(),
                    FontId::proportional(size),
                    Color32::WHITE,
                );
            }
        };
        // The atlas is there to be measured from the first pass on.
        let mut out = ctx.run_ui(egui::RawInput::default(), |_| {});
        out.textures_delta.clear();
        let before = ctx.fonts(|fonts| fonts.font_image_size());
        let shapes = painted(&ctx, Vec2::ZERO, |ui| paint_numbers(ui, at), grow);
        assert_ne!(ctx.fonts(|fonts| fonts.font_image_size()), before);
        let off_grid = meshes(&ctx, shapes);
        // The same text painted as egui paints it, on the atlas as it now is.
        let mut out = ctx.run_ui(egui::RawInput::default(), |ui| paint_numbers(ui, at));
        out.textures_delta.clear();
        let plain = meshes(&ctx, out.shapes);
        let uvs = |meshes: &[Mesh]| -> Vec<egui::Pos2> {
            let glyphs = meshes.iter().flat_map(|mesh| &mesh.vertices);
            glyphs.map(|vertex| vertex.uv).collect()
        };
        assert!(!uvs(&off_grid).is_empty());
        assert_eq!(uvs(&off_grid), uvs(&plain));
    }

    #[test]
    fn text_a_host_leaves_marked_is_drawn_as_egui_draws_it() {
        let ctx = Context::default();
        let at = pos2(40.0, 50.0);
        let mut out = ctx.run_ui(egui::RawInput::default(), |ui| {
            paint_off_grid(ui, vec2(0.3, 0.3), || paint_numbers(ui, at));
        });
        out.textures_delta.clear();
        // Never made into a mesh of its own: rounded to the pixel it is nearest, and nothing
        // drawn for its mark.
        let marked = meshes(&ctx, out.shapes);
        let mut out = ctx.run_ui(egui::RawInput::default(), |ui| paint_numbers(ui, at));
        out.textures_delta.clear();
        let plain = meshes(&ctx, out.shapes);
        let places = |meshes: &[Mesh]| -> Vec<egui::Pos2> {
            let glyphs = meshes.iter().flat_map(|mesh| &mesh.vertices);
            glyphs.map(|vertex| vertex.pos).collect()
        };
        assert_eq!(places(&marked), places(&plain));
    }
}
