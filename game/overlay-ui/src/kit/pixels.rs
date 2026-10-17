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

/// The screen height, in pixels, at which a point is one pixel.
pub const REFERENCE_HEIGHT: f32 = 1080.0;

/// The fewest points across a screen narrower than 16:10 is given. The surfaces along the edges are
/// laid out for a wide screen, and at a point to the pixel a 4:3 one leaves them crowding each
/// other out of it.
pub const NARROW_MIN_WIDTH: f32 = 1600.0;

/// The narrowest aspect ratio the overlay is laid out at without being scaled down for its width.
const WIDE_ENOUGH_ASPECT: f32 = 16.0 / 10.0;

/// How many pixels a point covers on a screen `width` x `height` pixels.
///
/// A point is a pixel at [`REFERENCE_HEIGHT`] lines and proportionally more on a taller screen, so
/// the overlay keeps its size relative to the screen. A shorter screen keeps a point to a pixel
/// rather than shrinking text past reading, unless it is narrower than 16:10: that one is scaled
/// down until it has [`NARROW_MIN_WIDTH`] points across.
pub fn pixels_per_point(width: f32, height: f32) -> f32 {
    if width <= 0.0 || height <= 0.0 {
        return 1.0;
    }
    let by_height = (height / REFERENCE_HEIGHT).max(1.0);
    if width >= height * WIDE_ENOUGH_ASPECT {
        return by_height;
    }
    by_height.min(width / NARROW_MIN_WIDTH)
}

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

    #[test]
    fn a_point_is_a_pixel_at_1080_lines_and_narrow_screens_are_scaled_for_width() {
        assert_eq!(pixels_per_point(1920.0, 1080.0), 1.0);
        assert_eq!(pixels_per_point(2560.0, 1440.0), 2560.0 / 1920.0);
        assert_eq!(pixels_per_point(1280.0, 720.0), 1.0);
        assert_eq!(pixels_per_point(1728.0, 1080.0), 1.0);
        assert_eq!(pixels_per_point(1440.0, 1080.0), 0.9);
        assert_eq!(pixels_per_point(1280.0, 960.0), 0.8);
        assert_eq!(pixels_per_point(1600.0, 1200.0), 1.0);
        assert_eq!(pixels_per_point(0.0, 0.0), 1.0);
    }

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
