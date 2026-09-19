//! The plots and bars that turn a stream of numbers into something readable at a glance.

use egui::{
    Color32, Id, Mesh, Pos2, Rect, Response, Sense, Shape, Stroke, StrokeKind, Ui, Vec2, pos2, vec2,
};

use crate::colors::{BLUE10, GREY_BLUE40, GREY_BLUE80};
use crate::kit::text::{self, BodyWeight};
use crate::kit::theme;
use crate::kit::widgets::tooltip;

/// Width kept to the left of a plot for its value axis.
const Y_AXIS_WIDTH: f32 = 38.0;
/// Height kept under a plot for its time axis.
const X_AXIS_HEIGHT: f32 = 15.0;
/// Height kept above a plot for its legend, which sits outside the plot so it can never land on
/// the data it is naming.
const LEGEND_HEIGHT: f32 = 16.0;
/// Thickness of a plotted line.
const LINE_WIDTH: f32 = 1.5;
/// Thickness of the one line the pointer is nearest, which is how a plot of five says which of them
/// the readings beside the pointer are being read off.
const LINE_WIDTH_NEAR: f32 = 2.5;
/// The line dropped through the sample the pointer is nearest. A shade stronger than the grid it
/// crosses, because it has to be followed from the axis to the dots without being mistaken for one
/// more gridline.
const CROSSHAIR: Color32 = theme::alpha(GREY_BLUE80, 0.32);
/// Radius of the dot marking where a series sits at the crosshair, and of the nearest one.
const SAMPLE_DOT: f32 = 2.5;
const SAMPLE_DOT_NEAR: f32 = 3.5;
/// Width of the colour swatch that opens a row of the hover card, matching the legend's.
const SWATCH: Vec2 = vec2(12.0, 2.0);
/// Gap between a hover row's label and its value, which is the least they may ever come to.
const HOVER_VALUE_GAP: f32 = theme::SPACE_LG;
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
///
/// While the pointer rests over the plot it is read rather than glanced at, so the plot drops a
/// crosshair through the sample nearest the pointer, marks every series where it crosses, and hangs
/// a card off the pointer listing what each of them is worth there. A host that forwards no pointer
/// gets none of that and the same plot as ever.
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

    let hover = hover_state(&response, plot, series, top_value);
    if let Some(hover) = &hover {
        ui.painter().add(Shape::line_segment(
            [pos2(hover.x, plot.top()), pos2(hover.x, plot.bottom())],
            Stroke::new(theme::HAIRLINE, CROSSHAIR),
        ));
    }

    for (slot, line) in series.iter().enumerate() {
        let points = plot_points(plot, line.values, top_value);
        if points.len() < 2 {
            continue;
        }
        if line.filled {
            ui.painter()
                .add(area_under(&points, plot.bottom(), line.color));
        }
        let width = match hover.as_ref().is_some_and(|hover| hover.is_nearest(slot)) {
            true => LINE_WIDTH_NEAR,
            false => LINE_WIDTH,
        };
        ui.painter()
            .add(Shape::line(points, Stroke::new(width, line.color)));
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

    if let Some(hover) = &hover {
        for (slot, reading) in hover.readings.iter().enumerate() {
            let radius = match hover.nearest == Some(slot) {
                true => SAMPLE_DOT_NEAR,
                false => SAMPLE_DOT,
            };
            ui.painter().circle_filled(
                pos2(hover.x, reading.y),
                radius,
                series[reading.series].color,
            );
        }
        hover_card(ui, response.id.with("hover"), hover, series, span_secs);
    }
    response
}

/// One series' reading at the crosshair.
struct Reading {
    /// Which series it belongs to.
    series: usize,
    value: f32,
    /// Where the series is drawn at the crosshair.
    y: f32,
}

/// What the pointer is resting on: the sample it is nearest, and every series' reading there.
struct Hover {
    /// Which sample of the longest series the crosshair falls on, and how many it has.
    index: usize,
    count: usize,
    /// Where the crosshair is dropped.
    x: f32,
    /// Where the pointer is, which is what the card hangs off.
    pointer: Pos2,
    readings: Vec<Reading>,
    /// Which reading the pointer is nearest, as an index into `readings`.
    nearest: Option<usize>,
}

impl Hover {
    /// Whether the series in `slot` is the one the pointer is nearest.
    fn is_nearest(&self, slot: usize) -> bool {
        self.nearest
            .is_some_and(|nearest| self.readings[nearest].series == slot)
    }

    /// How far into the game the crosshair's sample was taken, over samples spanning `span_secs`.
    fn seconds(&self, span_secs: u32) -> u32 {
        let steps = self.count.saturating_sub(1).max(1) as f32;
        (span_secs as f32 * self.index as f32 / steps).round() as u32
    }
}

/// Reads the pointer against the plot, or nothing at all when it is elsewhere or there is nothing
/// plotted to read.
fn hover_state(
    response: &Response,
    plot: Rect,
    series: &[Series<'_>],
    top_value: f32,
) -> Option<Hover> {
    let pointer = response.hover_pos().filter(|pos| plot.contains(*pos))?;
    // The samples are spread over the plot by the longest series, since that is the one drawn from
    // edge to edge; a shorter one holds at its last sample rather than reporting a value it has
    // none of.
    let count = series.iter().map(|line| line.values.len()).max()?;
    if count < 2 {
        return None;
    }
    let index = nearest_sample(plot, pointer.x, count);
    let readings: Vec<Reading> = series
        .iter()
        .enumerate()
        .filter_map(|(slot, line)| {
            let last = line.values.len().checked_sub(1)?;
            let value = *line.values.get(index.min(last))?;
            Some(Reading {
                series: slot,
                value,
                y: sample_y(plot, value, top_value),
            })
        })
        .collect();
    if readings.is_empty() {
        return None;
    }
    let distances: Vec<f32> = readings.iter().map(|reading| reading.y).collect();
    Some(Hover {
        index,
        count,
        x: sample_x(plot, index, count),
        pointer,
        nearest: nearest_series(&distances, pointer.y),
        readings,
    })
}

/// Hangs the readings off the pointer: when the sample was taken, then one row per series, biggest
/// first, so the order on the card is the order the lines are stacked on the plot.
fn hover_card(ui: &Ui, id: Id, hover: &Hover, series: &[Series<'_>], span_secs: u32) {
    let mut rows: Vec<(&Series<'_>, f32, bool)> = hover
        .readings
        .iter()
        .enumerate()
        .map(|(slot, reading)| {
            (
                &series[reading.series],
                reading.value,
                hover.nearest == Some(slot),
            )
        })
        .collect();
    rows.sort_by(|left, right| right.1.total_cmp(&left.1));
    let time = mmss(hover.seconds(span_secs));

    tooltip(ui.ctx(), id, hover.pointer, |ui| {
        let header = text::numeral(11.0)
            .with_color(theme::TEXT_DIM)
            .galley(ui, &time);
        let laid: Vec<_> = rows
            .iter()
            .map(|(line, value, nearest)| {
                // Only the line the pointer is nearest is spelled out at full strength: five rows
                // of primary text would be five things shouting, and the one being asked about
                // would be none of them.
                let color = match nearest {
                    true => theme::TEXT_PRIMARY,
                    false => theme::TEXT_SECONDARY,
                };
                (
                    line.color,
                    text::body(12.0, BodyWeight::Medium)
                        .with_color(color)
                        .galley(ui, line.label),
                    text::numeral(12.0)
                        .with_color(color)
                        .galley(ui, &short_number(*value)),
                )
            })
            .collect();
        let labels = laid
            .iter()
            .map(|(_, label, _)| label.size().x)
            .fold(0.0, f32::max);
        let values = laid
            .iter()
            .map(|(_, _, value)| value.size().x)
            .fold(0.0, f32::max);
        let width =
            (SWATCH.x + theme::SPACE_SM + labels + HOVER_VALUE_GAP + values).max(header.size().x);

        ui.spacing_mut().item_spacing = vec2(0.0, theme::SPACE_XS);
        let (rect, _) = ui.allocate_exact_size(vec2(width, header.size().y), Sense::hover());
        let color = theme::TEXT_DIM;
        ui.painter().galley(rect.left_top(), header, color);
        for (swatch, label, value) in laid {
            let height = label.size().y.max(value.size().y);
            let (rect, _) = ui.allocate_exact_size(vec2(width, height), Sense::hover());
            let painter = ui.painter();
            painter.rect_filled(
                Rect::from_center_size(pos2(rect.left() + SWATCH.x * 0.5, rect.center().y), SWATCH),
                0,
                swatch,
            );
            let left = rect.left() + SWATCH.x + theme::SPACE_SM;
            let middle = rect.center().y;
            painter.galley(
                pos2(left, middle - label.size().y * 0.5),
                label,
                theme::TEXT_SECONDARY,
            );
            painter.galley(
                pos2(rect.right() - value.size().x, middle - value.size().y * 0.5),
                value,
                theme::TEXT_SECONDARY,
            );
        }
    });
}

/// Which of `count` samples spread evenly across `plot` sits nearest `pointer_x`.
///
/// A pointer past either end takes the end sample rather than none: the plot is read by sweeping
/// along it, and a reading that blanked out at the edges would blank out exactly where the last
/// sample — the one a watcher checks most — is drawn.
fn nearest_sample(plot: Rect, pointer_x: f32, count: usize) -> usize {
    let Some(last) = count.checked_sub(1) else {
        return 0;
    };
    let width = plot.width().max(f32::MIN_POSITIVE);
    let fraction = ((pointer_x - plot.left()) / width).clamp(0.0, 1.0);
    ((fraction * last as f32).round() as usize).min(last)
}

/// Which of `ys` the pointer is nearest, or `None` when nothing is plotted there.
///
/// A tie goes to the first, which is the series the legend names first: two lines crossing under
/// the pointer are the one place the pick is arbitrary, and an arbitrary pick that at least never
/// changes is one the watcher can move away from.
fn nearest_series(ys: &[f32], pointer_y: f32) -> Option<usize> {
    ys.iter()
        .enumerate()
        .map(|(index, y)| (index, (y - pointer_y).abs()))
        .reduce(|best, candidate| match candidate.1 < best.1 {
            true => candidate,
            false => best,
        })
        .map(|(index, _)| index)
}

/// A bare line over its own baseline, for a value that only needs its shape read. Scaled to a round
/// number at or above the series' own peak.
pub fn sparkline(ui: &mut Ui, values: &[f32], size: Vec2, color: Color32) -> Response {
    let peak = nice_ceiling(values.iter().copied().fold(0.0f32, f32::max));
    sparkline_to(ui, values, peak, size, color)
}

/// The same line plotted against a `top` the caller decides.
///
/// A series whose own peak is not its scale needs this: a measurement with a floor under which
/// jitter must not be amplified to full height, or one the caller has already normalized and does
/// not want normalized again.
pub fn sparkline_to(ui: &mut Ui, values: &[f32], top: f32, size: Vec2, color: Color32) -> Response {
    let (rect, response) = ui.allocate_exact_size(size, Sense::hover());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let points = plot_points(rect, values, top);
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
fn plot_points(rect: Rect, values: &[f32], top_value: f32) -> Vec<Pos2> {
    values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            pos2(
                sample_x(rect, index, values.len()),
                sample_y(rect, *value, top_value),
            )
        })
        .collect()
}

/// Where the sample at `index` of `count` evenly spaced ones falls across `rect`.
fn sample_x(rect: Rect, index: usize, count: usize) -> f32 {
    let steps = count.saturating_sub(1).max(1) as f32;
    rect.left() + rect.width() * index as f32 / steps
}

/// Where a value sits in a rect scaled to `top_value`.
fn sample_y(rect: Rect, value: f32, top_value: f32) -> f32 {
    let top = top_value.max(f32::MIN_POSITIVE);
    rect.bottom() - rect.height() * (value / top).clamp(0.0, 1.0)
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

    fn plot() -> Rect {
        Rect::from_min_size(pos2(100.0, 0.0), vec2(400.0, 150.0))
    }

    #[test]
    fn the_pointer_takes_the_sample_its_nearest_half_step_falls_on() {
        // Five samples over 400 points is one every hundred, so the step's own halves are where the
        // pick changes hands.
        assert_eq!(nearest_sample(plot(), 100.0, 5), 0);
        assert_eq!(nearest_sample(plot(), 149.0, 5), 0);
        assert_eq!(nearest_sample(plot(), 151.0, 5), 1);
        assert_eq!(nearest_sample(plot(), 320.0, 5), 2);
        assert_eq!(nearest_sample(plot(), 500.0, 5), 4);
    }

    #[test]
    fn a_pointer_past_either_end_holds_at_the_end_sample() {
        assert_eq!(nearest_sample(plot(), -900.0, 5), 0);
        assert_eq!(nearest_sample(plot(), 9000.0, 5), 4);
    }

    #[test]
    fn a_plot_of_one_sample_or_none_has_only_the_first_to_pick() {
        assert_eq!(nearest_sample(plot(), 300.0, 1), 0);
        assert_eq!(nearest_sample(plot(), 300.0, 0), 0);
    }

    #[test]
    fn the_nearest_series_is_the_one_drawn_closest_above_or_below() {
        let ys = [40.0f32, 90.0, 120.0];
        assert_eq!(nearest_series(&ys, 0.0), Some(0));
        assert_eq!(nearest_series(&ys, 100.0), Some(1));
        assert_eq!(nearest_series(&ys, 119.0), Some(2));
        assert_eq!(nearest_series(&[], 50.0), None);
    }

    #[test]
    fn a_pointer_exactly_between_two_series_keeps_picking_the_first() {
        assert_eq!(nearest_series(&[40.0, 60.0], 50.0), Some(0));
        assert_eq!(nearest_series(&[60.0, 40.0], 50.0), Some(0));
    }
}
