//! The pieces panels are assembled from: headers, stat rows, tags and the waiting indicator.

use egui::{Align, Layout, Response, Sense, Shape, Stroke, Ui, Vec2, pos2, vec2};

use crate::colors::{AMBER60, GREY_BLUE80};
use crate::kit::motion;
use crate::kit::text;
use crate::kit::theme;
use crate::kit::widgets::{kbd, state_overlay};

/// Height of a panel's title row.
const HEADER_HEIGHT: f32 = 20.0;

/// Height of one label-and-value row.
const STAT_ROW_HEIGHT: f32 = 22.0;

/// Radius of one waiting dot, and the gap between two of them.
const DOT_RADIUS: f32 = 3.0;
const DOT_GAP: f32 = 10.0;

/// How wide a status dot's column is. A caller laying out a fixed row needs this before the dot is
/// drawn, so it is a constant rather than something read back off the widget.
pub const STATUS_DOT_DIAMETER: f32 = 9.0;

/// How far a pulsing status dot fades at the bottom of its cycle. Shallow, because the dot is a
/// color as much as a signal: one that faded far enough to read as grey would say the wrong thing
/// at the bottom of every breath.
const STATUS_DOT_DIM: f32 = 0.65;

/// A panel's title row: the title on the left, the key that opens the panel on the right.
pub fn panel_header(ui: &mut Ui, title: &str, hotkey: Option<&str>) -> Response {
    header(ui, title, hotkey, false).0
}

/// The same row with a close affordance, returning whether it was clicked.
pub fn panel_header_with_close(ui: &mut Ui, title: &str, hotkey: Option<&str>) -> bool {
    header(ui, title, hotkey, true).1
}

fn header(ui: &mut Ui, title: &str, hotkey: Option<&str>, closable: bool) -> (Response, bool) {
    let row = ui.horizontal(|ui| {
        ui.set_min_height(HEADER_HEIGHT);
        ui.label(text::panel_title().job(title));
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            let closed = closable && close_button(ui).clicked();
            if let Some(key) = hotkey {
                kbd(ui, key);
            }
            closed
        })
        .inner
    });
    ui.add_space(theme::SPACE_XS);
    divider(ui);
    ui.add_space(theme::SPACE_SM);
    (row.response, row.inner)
}

/// A hairline across the panel, for separating groups of rows.
pub fn divider(ui: &mut Ui) {
    let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 1.0), Sense::hover());
    ui.painter().add(Shape::line_segment(
        [
            pos2(rect.left(), rect.center().y),
            pos2(rect.right(), rect.center().y),
        ],
        Stroke::new(theme::HAIRLINE, theme::TIER0_DIVIDER),
    ));
}

/// The cross that dismisses a panel, drawn rather than typed so no font has to carry the glyph.
fn close_button(ui: &mut Ui) -> Response {
    let (rect, response) = ui.allocate_exact_size(vec2(18.0, 18.0), Sense::click());
    let color = if response.hovered() {
        theme::TEXT_PRIMARY
    } else {
        theme::TEXT_DIM
    };
    let arm = rect.shrink(5.0);
    let stroke = Stroke::new(theme::HAIRLINE + 0.4, color);
    ui.painter().add(Shape::line_segment(
        [arm.left_top(), arm.right_bottom()],
        stroke,
    ));
    ui.painter().add(Shape::line_segment(
        [arm.right_top(), arm.left_bottom()],
        stroke,
    ));
    state_overlay(ui, &response, rect, theme::radius(theme::RADIUS_TIGHT));
    response
}

/// One labelled value: the label in small capitals, the value in condensed numerals hard right.
pub fn stat_row(ui: &mut Ui, label: &str, value: &str) -> Response {
    let (rect, response) =
        ui.allocate_exact_size(vec2(ui.available_width(), STAT_ROW_HEIGHT), Sense::hover());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let label_galley = text::column_label().galley(ui, label);
    let value_galley = text::numeral(17.0).galley(ui, value);
    let painter = ui.painter();
    painter.galley(
        pos2(rect.left(), rect.center().y - label_galley.size().y * 0.5),
        label_galley,
        theme::TEXT_LABEL,
    );
    painter.galley(
        pos2(
            rect.right() - value_galley.size().x,
            rect.center().y - value_galley.size().y * 0.5,
        ),
        value_galley,
        theme::TEXT_PRIMARY,
    );
    response
}

/// One cell of a table: text elided into a slot of exactly `size`, vertically centred in it.
///
/// A table whose columns are sized by their contents shifts every time a value changes width, and
/// over gameplay that reads as flicker. Columns are given their width by the panel instead, and
/// anything too long for one loses its tail.
pub fn text_cell(
    ui: &mut Ui,
    spec: &text::TextSpec,
    value: &str,
    size: Vec2,
    align: Align,
) -> Response {
    let (rect, response) = ui.allocate_exact_size(size, Sense::hover());
    if value.is_empty() || !ui.is_rect_visible(rect) {
        return response;
    }
    let job = spec.job_truncated(value, size.x);
    let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
    let x = match align {
        Align::RIGHT => rect.right() - galley.size().x,
        Align::Center => rect.center().x - galley.size().x * 0.5,
        Align::LEFT => rect.left(),
    };
    ui.painter().galley(
        pos2(x, rect.center().y - galley.size().y * 0.5),
        galley,
        spec.color,
    );
    response
}

/// How loudly a tag speaks.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TagStyle {
    /// Something the player should notice: a replay, a warning, an active mode.
    Amber,
    /// A plain fact about the row it sits on.
    Neutral,
    /// A fact that is only worth reading if you went looking for it.
    Muted,
    /// A tag whose hue is the fact: one of a set that is told apart by color, like which scope a
    /// chat line went to. The edge is drawn stronger than the kit's plain tags so the hue reads
    /// from a glance down a column, and `filled` tints the chip's inside as well, for the one
    /// member of a list that deserves the extra weight.
    Hue { color: egui::Color32, filled: bool },
}

impl TagStyle {
    /// The tag's edge and its text. A tag is an outline rather than a filled chip: these sit over
    /// live gameplay in rows with numbers, and a filled one would read as a control to click.
    fn colors(self) -> (egui::Color32, egui::Color32) {
        match self {
            TagStyle::Amber => (theme::alpha(AMBER60, 0.40), AMBER60),
            TagStyle::Neutral => (theme::alpha(GREY_BLUE80, 0.28), GREY_BLUE80),
            TagStyle::Muted => (theme::alpha(GREY_BLUE80, 0.16), theme::TEXT_LABEL),
            TagStyle::Hue { color, .. } => (theme::alpha(color, 0.60), color),
        }
    }

    /// What the inside of the tag is tinted with, for the styles that tint it at all.
    fn fill(self) -> Option<egui::Color32> {
        match self {
            TagStyle::Hue {
                color,
                filled: true,
            } => Some(theme::alpha(color, 0.22)),
            _ => None,
        }
    }
}

/// Paints a tag's chrome, which every one of them wears whatever brought its size.
fn paint_tag_chrome(ui: &Ui, rect: egui::Rect, style: TagStyle) {
    let (edge, _) = style.colors();
    if let Some(fill) = style.fill() {
        ui.painter()
            .rect_filled(rect, theme::radius(theme::RADIUS_CHIP), fill);
    }
    ui.painter().add(Shape::rect_stroke(
        rect,
        theme::radius(theme::RADIUS_CHIP),
        Stroke::new(theme::HAIRLINE, edge),
        egui::StrokeKind::Inside,
    ));
}

/// Vertical padding a tag adds around its label.
const TAG_PAD_Y: f32 = theme::SPACE_XS + 2.0;

/// How tall a tag set in the label style is, for a row that centres other things on it.
pub fn tag_height(ui: &Ui) -> f32 {
    text::column_label().row_height(ui) + TAG_PAD_Y
}

/// A small chip of status text.
pub fn tag(ui: &mut Ui, label: &str, style: TagStyle) -> Response {
    tag_sized(ui, label, style, f32::INFINITY)
}

/// A chip that elides its label rather than growing past `max_width`.
///
/// A tag sitting in a column of a table or a list is part of that layout's grid: one carrying a
/// player-chosen name would otherwise push everything beside it out of place.
pub fn tag_sized(ui: &mut Ui, label: &str, style: TagStyle, max_width: f32) -> Response {
    let (_, text_color) = style.colors();
    let job = text::column_label().job_truncated(label, (max_width - theme::SPACE_SM).max(0.0));
    let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
    // An elided galley can still come back a hair over the width it was given (the ellipsis is
    // added after the fit), so the chip is clamped rather than trusted: this width is a column in
    // someone's layout.
    let size = vec2(
        (galley.size().x + theme::SPACE_MD).min(max_width),
        galley.size().y + TAG_PAD_Y,
    );
    let (rect, response) = ui.allocate_exact_size(size, Sense::hover());
    if ui.is_rect_visible(rect) {
        paint_tag_chrome(ui, rect, style);
        ui.painter()
            .galley(rect.center() - galley.size() * 0.5, galley, text_color);
    }
    response
}

/// A chip of exactly `size`, for a tag standing in a fixed layout.
///
/// [`tag_sized`] grows with its label, which moves everything beside it every time the label
/// changes width — unacceptable for a value that changes while the player is reading it. The caller
/// brings the type style as well, because a tag carrying a value is set in numerals where one
/// carrying a word is set in the label style; the tag's own color wins over the style's.
pub fn tag_exact(
    ui: &mut Ui,
    spec: &text::TextSpec,
    label: &str,
    style: TagStyle,
    size: Vec2,
) -> Response {
    let (_, text_color) = style.colors();
    let job = spec
        .clone()
        .with_color(text_color)
        .job_truncated(label, (size.x - theme::SPACE_SM).max(0.0));
    let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
    let (rect, response) = ui.allocate_exact_size(size, Sense::hover());
    if ui.is_rect_visible(rect) {
        paint_tag_chrome(ui, rect, style);
        ui.painter()
            .galley(rect.center() - galley.size() * 0.5, galley, text_color);
    }
    response
}

/// A paragraph whose lines are centred on each other, for the notes under a dialog's contents.
///
/// A centred block of left-aligned lines reads as a block that has been nudged, so the centring is
/// done inside the layout rather than by placing the widget.
pub fn centered_paragraph(
    ui: &mut Ui,
    spec: &text::TextSpec,
    value: &str,
    wrap_width: f32,
) -> Response {
    let galley = ui
        .ctx()
        .fonts_mut(|fonts| fonts.layout_job(spec.job_centered(value, wrap_width)));
    let width = ui.available_width().max(wrap_width);
    let (rect, response) = ui.allocate_exact_size(vec2(width, galley.size().y), Sense::hover());
    if ui.is_rect_visible(rect) {
        ui.painter()
            .galley(pos2(rect.center().x, rect.top()), galley, spec.color);
    }
    response
}

/// One dot saying what the thing beside it is doing. A pulsing dot breathes on the kit's own
/// period, which is what tells "still trying" apart from "still fine" without a second word.
pub fn status_dot(ui: &mut Ui, color: egui::Color32, pulsing: bool) -> Response {
    let (rect, response) = ui.allocate_exact_size(
        vec2(STATUS_DOT_DIAMETER, STATUS_DOT_DIAMETER),
        Sense::hover(),
    );
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let brightness = if pulsing {
        // The kit's pulse is already a wave rather than a phase, and it is only ridden down part of
        // the way: a dot that faded to nothing would be missing every time a glance landed on it.
        ui.ctx().request_repaint();
        STATUS_DOT_DIM + (1.0 - STATUS_DOT_DIM) * motion::pulse_phase(ui.ctx())
    } else {
        1.0
    };
    ui.painter().circle_filled(
        rect.center(),
        STATUS_DOT_DIAMETER * 0.5,
        color.gamma_multiply(brightness),
    );
    response
}

/// Three dots breathing in turn, for "this is still happening".
pub fn pulsing_dots(ui: &mut Ui) -> Response {
    let width = DOT_RADIUS * 2.0 * 3.0 + DOT_GAP * 2.0;
    let (rect, response) =
        ui.allocate_exact_size(vec2(width, DOT_RADIUS * 2.0 + 4.0), Sense::hover());
    let phase = motion::pulse_phase(ui.ctx());
    for index in 0..3 {
        // Each dot trails the one before it by a third of the cycle, so the row reads as a wave
        // rather than as three things blinking together.
        let offset = (phase + index as f32 / 3.0).fract();
        let brightness = 0.35 + 0.65 * (1.0 - (offset * 2.0 - 1.0).abs());
        let centre = pos2(
            rect.left() + DOT_RADIUS + index as f32 * (DOT_RADIUS * 2.0 + DOT_GAP),
            rect.center().y,
        );
        ui.painter().circle_filled(
            centre,
            DOT_RADIUS,
            theme::TEXT_DIM.gamma_multiply(brightness),
        );
    }
    ui.ctx().request_repaint();
    response
}
