//! Keeping the chrome's lines crisp at any scale.
//!
//! The overlay is laid out in points, one point being one pixel at 1080p, and drawn at whatever the
//! screen's height makes of that: a third more pixels per point at 1440p. A line one point wide is
//! then one and a third pixels wide, which no screen can draw: it covers one pixel row whole and a
//! third of the next, and every border reads soft. So a hairline is drawn one physical pixel wide
//! at every scale, the way a browser draws a one-pixel border on a high-density screen. egui already
//! puts rect edges and line positions on whole pixels; a whole-pixel width is what lets the line
//! land on exactly one row of them.

use egui::epaint::{ClippedShape, Shape, Stroke};

use crate::kit::theme;

/// Narrows every stroke in `shapes` that is one [`theme::HAIRLINE`] wide to one physical pixel at
/// `pixels_per_point`. A host calls this on a pass's shapes just before tessellating them.
pub fn crisp_hairlines(shapes: &mut [ClippedShape], pixels_per_point: f32) {
    if pixels_per_point <= 1.0 {
        return;
    }
    let pixel = 1.0 / pixels_per_point;
    for clipped in shapes {
        crisp_shape(&mut clipped.shape, pixel);
    }
}

fn crisp_shape(shape: &mut Shape, pixel: f32) {
    let crisp = |width: &mut f32| {
        if *width == theme::HAIRLINE {
            *width = pixel;
        }
    };
    let crisp_stroke = |stroke: &mut Stroke| crisp(&mut stroke.width);
    match shape {
        Shape::Vec(shapes) => {
            for shape in shapes {
                crisp_shape(shape, pixel);
            }
        }
        Shape::Circle(circle) => crisp_stroke(&mut circle.stroke),
        Shape::Ellipse(ellipse) => crisp_stroke(&mut ellipse.stroke),
        Shape::LineSegment { stroke, .. } => crisp_stroke(stroke),
        Shape::Path(path) => crisp(&mut path.stroke.width),
        Shape::Rect(rect) => crisp_stroke(&mut rect.stroke),
        Shape::Noop
        | Shape::Text(_)
        | Shape::Mesh(_)
        | Shape::QuadraticBezier(_)
        | Shape::CubicBezier(_)
        | Shape::Callback(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use egui::{Color32, Rect, pos2};

    fn line(width: f32) -> ClippedShape {
        ClippedShape {
            clip_rect: Rect::EVERYTHING,
            shape: Shape::line_segment(
                [pos2(0.0, 0.0), pos2(10.0, 0.0)],
                Stroke::new(width, Color32::WHITE),
            ),
        }
    }

    fn width(shape: &ClippedShape) -> f32 {
        match &shape.shape {
            Shape::LineSegment { stroke, .. } => stroke.width,
            _ => unreachable!(),
        }
    }

    #[test]
    fn a_hairline_is_one_pixel_at_any_scale() {
        let mut shapes = [line(theme::HAIRLINE), line(2.0)];
        crisp_hairlines(&mut shapes, 1440.0 / 1080.0);
        assert_eq!(width(&shapes[0]) * 1440.0 / 1080.0, 1.0);
        // A deliberately heavier line keeps the weight it was drawn with.
        assert_eq!(width(&shapes[1]), 2.0);
    }

    #[test]
    fn nothing_moves_where_a_point_is_a_pixel() {
        let mut shapes = [line(theme::HAIRLINE)];
        crisp_hairlines(&mut shapes, 1.0);
        assert_eq!(width(&shapes[0]), theme::HAIRLINE);
    }
}
