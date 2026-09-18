//! The plots and bars that turn a stream of numbers into something readable at a glance.

use egui::{Color32, Mesh, Rect, Response, Sense, Shape, Stroke, StrokeKind, Ui, Vec2, pos2, vec2};

use crate::colors::{BLUE10, GREY_BLUE40};
use crate::kit::text;
use crate::kit::theme;

/// Width kept to the left of a plot for its value axis.
const Y_AXIS_WIDTH: f32 = 38.0;
/// Height kept under a plot for its time axis.
const X_AXIS_HEIGHT: f32 = 15.0;
/// Height kept above a plot for its legend, which sits outside the plot so it can never land on
/// the data it is naming.
const LEGEND_HEIGHT: f32 = 16.0;
/// Thickness of a plotted line.
const LINE_WIDTH: f32 = 1.5;
/// Height of a progress bar.
const PROGRESS_HEIGHT: f32 = 6.0;
/// Height of a two-sided share bar, which has to carry a label-sized gap between its halves.
const SHARE_HEIGHT: f32 = 10.0;

/// One line on a plot.
pub struct Series<'a> {
    pub label: &'a str,
    pub color: Color32,
    /// Evenly spaced samples, oldest first.
    pub values: &'a [f32],
    /// Whether the area under the line is washed in the series color.
    pub filled: bool,
}

/// A multi-series line chart with a value axis, a time axis and a legend.
///
/// `span_secs` is the game time the samples cover; the time axis is labelled from it, because a
/// plot of the last nine minutes and a plot of a whole game look identical without it.
pub fn line_plot(ui: &mut Ui, series: &[Series<'_>], size: Vec2, span_secs: u32) -> Response {
    let (rect, response) = ui.allocate_exact_size(size, Sense::hover());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let plot = Rect::from_min_max(
        pos2(rect.left() + Y_AXIS_WIDTH, rect.top() + LEGEND_HEIGHT),
        pos2(rect.right(), rect.bottom() - X_AXIS_HEIGHT),
    );
    if !plot.is_positive() {
        return response;
    }

    let painter = ui.painter();
    painter.rect_filled(
        plot,
        theme::radius(theme::RADIUS_TIGHT),
        theme::alpha(BLUE10, 0.55),
    );
    painter.add(Shape::rect_stroke(
        plot,
        theme::radius(theme::RADIUS_TIGHT),
        Stroke::new(theme::HAIRLINE, theme::TIER0_STROKE),
        StrokeKind::Inside,
    ));

    let peak = series
        .iter()
        .flat_map(|line| line.values.iter().copied())
        .fold(0.0f32, f32::max);
    let top_value = nice_ceiling(peak);
    let label_spec = text::numeral(11.0).with_color(theme::TEXT_LABEL);
    for (fraction, value) in [(0.0f32, top_value), (0.5, top_value * 0.5), (1.0, 0.0)] {
        let y = plot.top() + plot.height() * fraction;
        if fraction > 0.0 && fraction < 1.0 {
            painter.add(Shape::line_segment(
                [pos2(plot.left(), y), pos2(plot.right(), y)],
                Stroke::new(theme::HAIRLINE, theme::TIER0_DIVIDER),
            ));
        }
        let galley = label_spec.galley(ui, &short_number(value));
        ui.painter().galley(
            pos2(
                plot.left() - theme::SPACE_SM - galley.size().x,
                y - galley.size().y * 0.5,
            ),
            galley,
            theme::TEXT_LABEL,
        );
    }

    for line in series {
        let points = plot_points(plot, line.values, top_value);
        if points.len() < 2 {
            continue;
        }
        if line.filled {
            ui.painter()
                .add(area_under(&points, plot.bottom(), line.color));
        }
        ui.painter()
            .add(Shape::line(points, Stroke::new(LINE_WIDTH, line.color)));
    }

    for (fraction, secs) in [(0.0f32, 0), (0.5, span_secs / 2), (1.0, span_secs)] {
        let galley = label_spec.galley(ui, &mmss(secs));
        let x = plot.left() + plot.width() * fraction;
        let x = x.clamp(plot.left(), plot.right() - galley.size().x);
        ui.painter().galley(
            pos2(x, plot.bottom() + theme::SPACE_XS),
            galley,
            theme::TEXT_LABEL,
        );
    }

    let mut legend_right = rect.right();
    for line in series.iter().rev() {
        let galley = text::column_label().galley(ui, line.label);
        let swatch_width = 10.0;
        let left = legend_right - galley.size().x - swatch_width - theme::SPACE_XS;
        let middle = rect.top() + LEGEND_HEIGHT * 0.5;
        ui.painter().rect_filled(
            Rect::from_min_size(pos2(left, middle - 1.5), vec2(swatch_width, 3.0)),
            0,
            line.color,
        );
        ui.painter().galley(
            pos2(
                left + swatch_width + theme::SPACE_XS,
                middle - galley.size().y * 0.5,
            ),
            galley,
            line.color,
        );
        legend_right = left - theme::SPACE_MD;
    }
    response
}

/// A bare line over its own baseline, for a value that only needs its shape read.
pub fn sparkline(ui: &mut Ui, values: &[f32], size: Vec2, color: Color32) -> Response {
    let (rect, response) = ui.allocate_exact_size(size, Sense::hover());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let peak = nice_ceiling(values.iter().copied().fold(0.0f32, f32::max));
    let points = plot_points(rect, values, peak);
    ui.painter().add(Shape::line_segment(
        [
            pos2(rect.left(), rect.bottom()),
            pos2(rect.right(), rect.bottom()),
        ],
        Stroke::new(theme::HAIRLINE, theme::TIER0_DIVIDER),
    ));
    if points.len() >= 2 {
        ui.painter().add(area_under(&points, rect.bottom(), color));
        ui.painter()
            .add(Shape::line(points, Stroke::new(LINE_WIDTH, color)));
    }
    response
}

/// How far along something is, from 0 to 1.
pub fn progress_bar(ui: &mut Ui, fraction: f32, color: Color32) -> Response {
    let (rect, response) =
        ui.allocate_exact_size(vec2(ui.available_width(), PROGRESS_HEIGHT), Sense::hover());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    ui.painter()
        .rect_filled(rect, corner_radius, theme::alpha(GREY_BLUE40, 0.55));
    let mut filled = rect;
    filled.set_right(rect.left() + rect.width() * fraction.clamp(0.0, 1.0));
    if filled.width() > 0.0 {
        ui.painter().rect_filled(filled, corner_radius, color);
    }
    response
}

/// A bar split between two sides, each growing in from its own edge.
///
/// The two fractions are independent and need not add up to one: what is left over in the middle is
/// what neither side holds, which is exactly the reading a map-control bar wants.
pub fn share_bar(
    ui: &mut Ui,
    left_fraction: f32,
    right_fraction: f32,
    left_color: Color32,
    right_color: Color32,
) -> Response {
    let (rect, response) =
        ui.allocate_exact_size(vec2(ui.available_width(), SHARE_HEIGHT), Sense::hover());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    ui.painter()
        .rect_filled(rect, corner_radius, theme::alpha(GREY_BLUE40, 0.45));

    let left_width = rect.width() * left_fraction.clamp(0.0, 1.0);
    let right_width = rect.width() * right_fraction.clamp(0.0, 1.0);
    // Neither side may cross the middle, so a stale pair of fractions cannot draw one side over the
    // other and make a losing player look like a winning one.
    let left_width = left_width.min(rect.width() - right_width);
    if left_width > 0.0 {
        ui.painter().rect_filled(
            Rect::from_min_size(rect.left_top(), vec2(left_width, rect.height())),
            corner_radius,
            left_color,
        );
    }
    if right_width > 0.0 {
        ui.painter().rect_filled(
            Rect::from_min_size(
                pos2(rect.right() - right_width, rect.top()),
                vec2(right_width, rect.height()),
            ),
            corner_radius,
            right_color,
        );
    }
    response
}

/// Maps evenly spaced samples onto a rect, oldest at the left edge.
fn plot_points(rect: Rect, values: &[f32], top_value: f32) -> Vec<egui::Pos2> {
    if values.is_empty() {
        return Vec::new();
    }
    let top = top_value.max(f32::MIN_POSITIVE);
    let steps = (values.len() - 1).max(1) as f32;
    values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            pos2(
                rect.left() + rect.width() * index as f32 / steps,
                rect.bottom() - rect.height() * (value / top).clamp(0.0, 1.0),
            )
        })
        .collect()
}

/// The washed area between a plotted line and the bottom of its plot.
fn area_under(points: &[egui::Pos2], bottom: f32, color: Color32) -> Shape {
    let mut mesh = Mesh::default();
    let fill = color.gamma_multiply(0.18);
    for point in points {
        mesh.colored_vertex(*point, fill);
        mesh.colored_vertex(pos2(point.x, bottom), fill);
    }
    for index in 0..points.len().saturating_sub(1) as u32 {
        let base = index * 2;
        mesh.add_triangle(base, base + 1, base + 2);
        mesh.add_triangle(base + 1, base + 3, base + 2);
    }
    Shape::mesh(mesh)
}

/// A round number at or above `value`, so an axis is labelled 600 rather than 587.
fn nice_ceiling(value: f32) -> f32 {
    if value <= 0.0 {
        return 1.0;
    }
    let magnitude = 10f32.powf(value.log10().floor());
    let steps = [1.0, 1.5, 2.0, 3.0, 5.0, 7.5, 10.0];
    for step in steps {
        let candidate = step * magnitude;
        if candidate >= value {
            return candidate;
        }
    }
    10.0 * magnitude
}

/// An axis label short enough to sit in the gutter: 1.2k rather than 1200.
fn short_number(value: f32) -> String {
    if value >= 10_000.0 {
        format!("{:.0}k", value / 1000.0)
    } else if value >= 1000.0 {
        format!("{:.1}k", value / 1000.0)
    } else {
        format!("{value:.0}")
    }
}

/// Seconds as the game clock shows them.
fn mmss(secs: u32) -> String {
    format!("{}:{:02}", secs / 60, secs % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn axis_tops_are_round_numbers() {
        assert_eq!(nice_ceiling(587.0), 750.0);
        assert_eq!(nice_ceiling(1200.0), 1500.0);
        assert_eq!(nice_ceiling(0.0), 1.0);
    }

    #[test]
    fn clock_labels_pad_seconds() {
        assert_eq!(mmss(0), "0:00");
        assert_eq!(mmss(65), "1:05");
        assert_eq!(mmss(1080), "18:00");
    }
}
