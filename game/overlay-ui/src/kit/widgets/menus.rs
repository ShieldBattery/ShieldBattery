//! Menus a modal's controls open, the controls that open them, and the small glyphs their rows
//! carry.
//!
//! A menu is drawn above the modal it opens from and hangs off the control that opened it. It keeps
//! no state of its own: whether it is open is the caller's to hold, which lets a host close it from
//! a key as well as from a click.

use egui::{
    Align, Align2, Area, Color32, Context, Id, Order, Pos2, Rect, Response, Sense, Shape, Stroke,
    StrokeKind, Ui, Vec2, pos2, vec2,
};

use crate::colors::{
    AMBER60, BLUE60, BLUE70, BLUE80, BLUE99, GREY_BLUE60, GREY_BLUE70, GREY_BLUE80, GREY_BLUE95,
};
use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets::{focus_ring, state_overlay};
use crate::kit::{theme, tiers};

/// Padding between a menu's edge and its rows.
const MENU_PAD: f32 = 6.0;

/// Gap between a menu and the control it hangs off.
const MENU_GAP: f32 = 8.0;

/// A menu row's height, and the size of its label: roomy for a short list of actions, a step
/// smaller for a list of choices long enough to be read down.
const ROW_HEIGHT: f32 = 40.0;
const ROW_LABEL_SIZE: f32 = 14.0;
const COMPACT_ROW_HEIGHT: f32 = 36.0;
const COMPACT_ROW_LABEL_SIZE: f32 = 13.5;

/// Padding either side of a row's contents, and the gap between its glyph or bar and its label.
const ROW_PAD_X: f32 = 12.0;
const ROW_GAP: f32 = 10.0;

/// The size of the glyph in front of a row's label.
const ROW_GLYPH_SIZE: f32 = 15.0;

/// The bar of a player's color in front of a row's label.
const ROW_BAR: Vec2 = vec2(3.0, 13.0);

/// The size of the note at a row's far end.
const ROW_NOTE_SIZE: f32 = 11.0;

/// A square button carrying a glyph, the size the rows of a modal's table want.
const ICON_BUTTON_SIZE: f32 = 34.0;
const ICON_BUTTON_GLYPH_SIZE: f32 = 16.0;

/// A dropdown's trigger: its height, and the padding either side of its label.
const DROPDOWN_HEIGHT: f32 = 36.0;
const DROPDOWN_PAD_X: f32 = 14.0;
const DROPDOWN_LABEL_SIZE: f32 = 13.5;

/// Which side of the control that opened it a menu hangs on.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MenuSide {
    Below,
    /// Above, for a control near the bottom of the screen, where a menu opened downwards would run
    /// off it.
    Above,
}

/// What a menu reported back.
pub struct MenuResponse<R> {
    pub inner: R,
    /// Where the menu was drawn.
    pub rect: Rect,
    /// Whether a click landed outside both the menu and the control it hangs off, which closes it.
    pub clicked_outside: bool,
}

/// Draws a menu `width` wide hanging off `anchor` on `side`, its `align` edge lined up with the
/// anchor's: `Align::Min` lines up the left edges, `Align::Max` the right ones.
///
/// Drawn at the tooltip order, so it is above the modal it opens from; a menu opened over the
/// modal's own rows has to cover them.
pub fn popup_menu<R>(
    ctx: &Context,
    id: Id,
    anchor: Rect,
    side: MenuSide,
    align: Align,
    width: f32,
    add: impl FnOnce(&mut Ui) -> R,
) -> MenuResponse<R> {
    let x = match align {
        Align::Min => anchor.left(),
        Align::Center => anchor.center().x,
        Align::Max => anchor.right(),
    };
    let (y, pivot_y) = match side {
        MenuSide::Below => (anchor.bottom() + MENU_GAP, Align::Min),
        MenuSide::Above => (anchor.top() - MENU_GAP, Align::Max),
    };
    let area = Area::new(id)
        .order(Order::Tooltip)
        .pivot(Align2([align, pivot_y]))
        .fixed_pos(pos2(x, y))
        .constrain(true)
        .show(ctx, |ui| {
            let background = ui.painter().add(Shape::Noop);
            let inner = egui::Frame::NONE.inner_margin(MENU_PAD).show(ui, |ui| {
                ui.set_width(width - MENU_PAD * 2.0);
                ui.spacing_mut().item_spacing = Vec2::ZERO;
                add(ui)
            });
            ui.painter()
                .set(background, tiers::menu_chrome(inner.response.rect));
            inner.inner
        });
    let rect = area.response.rect;
    let clicked_outside = ctx.input(|input| {
        input.pointer.any_click()
            && input
                .pointer
                .interact_pos()
                .is_some_and(|pos| !rect.contains(pos) && !anchor.contains(pos))
    });
    MenuResponse {
        inner: area.inner,
        rect,
        clicked_outside,
    }
}

/// How a menu row's label is colored.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum MenuTone {
    #[default]
    Normal,
    /// An action that costs the player something, or someone else.
    Danger,
    /// A choice that is still there to take but stands back from the rest, like a player the
    /// reader has muted.
    Dim,
}

/// One row of a menu.
#[derive(Clone, Default)]
pub struct MenuRow<'a> {
    label: &'a str,
    glyph: Option<Glyph>,
    bar: Option<Color32>,
    tone: MenuTone,
    selected: bool,
    note: Option<&'a str>,
    compact: bool,
}

impl<'a> MenuRow<'a> {
    pub fn new(label: &'a str) -> MenuRow<'a> {
        MenuRow {
            label,
            ..MenuRow::default()
        }
    }

    /// A glyph in front of the label, saying what kind of action the row is.
    pub fn glyph(mut self, glyph: Glyph) -> Self {
        self.glyph = Some(glyph);
        self
    }

    /// A bar of a player's color in front of the label, for a row that stands for a player.
    pub fn bar(mut self, color: Color32) -> Self {
        self.bar = Some(color);
        self
    }

    pub fn tone(mut self, tone: MenuTone) -> Self {
        self.tone = tone;
        self
    }

    /// Marks the row as the current choice: lit, with a check at its far end.
    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    /// A word at the row's far end that qualifies the choice without being part of it.
    pub fn note(mut self, note: &'a str) -> Self {
        self.note = Some(note);
        self
    }

    /// The smaller row of a list of choices.
    pub fn compact(mut self) -> Self {
        self.compact = true;
        self
    }

    pub fn show(self, ui: &mut Ui) -> Response {
        let (height, label_size) = match self.compact {
            true => (COMPACT_ROW_HEIGHT, COMPACT_ROW_LABEL_SIZE),
            false => (ROW_HEIGHT, ROW_LABEL_SIZE),
        };
        let width = ui.available_width();
        let (rect, response) = ui.allocate_exact_size(vec2(width, height), Sense::click());
        if !ui.is_rect_visible(rect) {
            return response;
        }
        let corner_radius = theme::radius(theme::RADIUS_TIGHT);
        let lit = self.selected || response.hovered();
        if lit {
            ui.painter()
                .rect_filled(rect, corner_radius, theme::MENU_ROW_LIT);
        }
        let color = match self.tone {
            MenuTone::Danger => theme::TEXT_DANGER,
            _ if lit => BLUE99,
            MenuTone::Normal => GREY_BLUE95,
            MenuTone::Dim => GREY_BLUE70,
        };
        let mut left = rect.left() + ROW_PAD_X;
        if let Some(glyph) = self.glyph {
            let glyph_rect = Rect::from_min_size(
                pos2(left, rect.center().y - ROW_GLYPH_SIZE * 0.5),
                Vec2::splat(ROW_GLYPH_SIZE),
            );
            paint_glyph(ui.painter(), glyph_rect, glyph, color);
            left = glyph_rect.right() + ROW_GAP;
        }
        if let Some(bar) = self.bar {
            let bar_rect =
                Rect::from_min_size(pos2(left, rect.center().y - ROW_BAR.y * 0.5), ROW_BAR);
            ui.painter().rect_filled(bar_rect, theme::radius(1), bar);
            left = bar_rect.right() + ROW_GAP;
        }
        let mut right = rect.right() - ROW_PAD_X;
        if self.selected {
            let check = Rect::from_min_size(
                pos2(
                    right - ROW_GLYPH_SIZE,
                    rect.center().y - ROW_GLYPH_SIZE * 0.5,
                ),
                Vec2::splat(ROW_GLYPH_SIZE),
            );
            paint_glyph(ui.painter(), check, Glyph::Check, AMBER60);
            right = check.left() - ROW_GAP;
        } else if let Some(note) = self.note {
            let galley = text::body(ROW_NOTE_SIZE, BodyWeight::Regular)
                .with_color(GREY_BLUE60)
                .galley(ui, note);
            let pos = pos2(
                right - galley.size().x,
                rect.center().y - galley.size().y * 0.5,
            );
            right = pos.x - ROW_GAP;
            ui.painter().galley(pos, galley, GREY_BLUE60);
        }
        let job = text::body(label_size, BodyWeight::Regular)
            .with_color(color)
            .job_truncated(self.label, (right - left).max(0.0));
        let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
        ui.painter().galley(
            pos2(left, rect.center().y - galley.size().y * 0.5),
            galley,
            color,
        );
        focus_ring(ui, &response, rect, corner_radius);
        response
    }
}

/// The rule between two groups of a menu's rows.
pub fn menu_separator(ui: &mut Ui) {
    let width = ui.available_width();
    let (rect, _) = ui.allocate_exact_size(vec2(width, MENU_PAD * 2.0 + 1.0), Sense::hover());
    let y = rect.center().y;
    ui.painter().line_segment(
        [pos2(rect.left() + 4.0, y), pos2(rect.right() - 4.0, y)],
        Stroke::new(theme::HAIRLINE, theme::alpha(BLUE70, 0.40)),
    );
}

/// What an icon button is saying about the thing it controls.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum IconButtonState {
    #[default]
    Rest,
    /// What it controls is switched on, and on is the exception worth seeing across a table: a
    /// player muted, say.
    Raised,
    /// The menu it opens is open.
    Open,
}

/// A square button carrying a glyph, for a row's actions that are too frequent to spell out.
pub fn icon_button(ui: &mut Ui, glyph: Glyph, state: IconButtonState) -> Response {
    let (rect, response) = ui.allocate_exact_size(Vec2::splat(ICON_BUTTON_SIZE), Sense::click());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    let (fill, stroke, glyph_color) = match state {
        IconButtonState::Rest => (
            Color32::TRANSPARENT,
            theme::alpha(BLUE70, 0.35),
            GREY_BLUE80,
        ),
        IconButtonState::Raised => (
            theme::alpha(AMBER60, 0.12),
            theme::alpha(AMBER60, 0.50),
            theme::TEXT_WARNING,
        ),
        IconButtonState::Open => (
            theme::alpha(BLUE60, 0.30),
            theme::alpha(BLUE80, 0.80),
            BLUE99,
        ),
    };
    if state == IconButtonState::Open {
        paint_glow(ui, rect, BLUE60);
    }
    ui.painter().rect_filled(rect, corner_radius, fill);
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, stroke),
        StrokeKind::Inside,
    ));
    let glyph_rect = Rect::from_center_size(rect.center(), Vec2::splat(ICON_BUTTON_GLYPH_SIZE));
    let glyph_color = if response.hovered() && state == IconButtonState::Rest {
        BLUE99
    } else {
        glyph_color
    };
    paint_glyph(ui.painter(), glyph_rect, glyph, glyph_color);
    state_overlay(ui, &response, rect, corner_radius);
    focus_ring(ui, &response, rect, corner_radius);
    response
}

/// The control a dropdown menu opens from: the current choice and a chevron, its edge lit while the
/// menu is open.
pub fn dropdown_button(ui: &mut Ui, label: &str, min_width: f32, open: bool) -> Response {
    let spec = text::body(DROPDOWN_LABEL_SIZE, BodyWeight::Medium).with_color(BLUE99);
    let galley = spec.galley(ui, label);
    let chevron = vec2(11.0, 7.0);
    let width = (DROPDOWN_PAD_X * 2.0 + galley.size().x + ROW_GAP + chevron.x).max(min_width);
    let (rect, response) = ui.allocate_exact_size(vec2(width, DROPDOWN_HEIGHT), Sense::click());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    paint_glow(ui, rect, BLUE60);
    ui.painter().rect_filled(
        rect,
        corner_radius,
        theme::alpha(Color32::from_rgb(24, 44, 90), 0.50),
    );
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(
            theme::HAIRLINE,
            theme::alpha(
                BLUE80,
                if open || response.hovered() {
                    0.90
                } else {
                    0.60
                },
            ),
        ),
        StrokeKind::Inside,
    ));
    ui.painter().galley(
        pos2(
            rect.left() + DROPDOWN_PAD_X,
            rect.center().y - galley.size().y * 0.5,
        ),
        galley,
        BLUE99,
    );
    let chevron_rect = Rect::from_min_size(
        pos2(
            rect.right() - DROPDOWN_PAD_X - chevron.x,
            rect.center().y - chevron.y * 0.5,
        ),
        chevron,
    );
    paint_chevron(ui.painter(), chevron_rect, GREY_BLUE80);
    state_overlay(ui, &response, rect, corner_radius);
    focus_ring(ui, &response, rect, corner_radius);
    response
}

/// A soft ring of `color` just outside `rect`, for a control that is lit.
fn paint_glow(ui: &Ui, rect: Rect, color: Color32) {
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    for (step, alpha) in [(1.0f32, 0.22f32), (2.0, 0.12), (3.0, 0.06), (4.0, 0.03)] {
        ui.painter().add(Shape::rect_stroke(
            rect.expand(step),
            corner_radius,
            Stroke::new(theme::HAIRLINE, color.gamma_multiply(alpha)),
            StrokeKind::Outside,
        ));
    }
}

/// The small line drawings a menu row or an icon button carries.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Glyph {
    /// A speaker, sounding.
    Speaker,
    /// A speaker, crossed out.
    SpeakerMuted,
    /// A circle struck through.
    Block,
    /// A flag on a pole.
    Flag,
    /// A head and shoulders.
    Person,
    /// Three dots in a row, for a menu of further actions.
    More,
    /// A check mark.
    Check,
}

/// Paints `glyph` in `color` into the square `rect`.
///
/// Every glyph is drawn on a 16-unit grid scaled to the square, so the strokes keep their weight
/// relative to the glyph at every size.
pub fn paint_glyph(painter: &egui::Painter, rect: Rect, glyph: Glyph, color: Color32) {
    let scale = rect.width() / 16.0;
    let at = |x: f32, y: f32| rect.min + vec2(x, y) * scale;
    let stroke = |width: f32| Stroke::new(width * scale, color);
    let line = |points: &[(f32, f32)], width: f32| {
        Shape::line(
            points.iter().map(|&(x, y)| at(x, y)).collect(),
            stroke(width),
        )
    };
    let speaker = || {
        [
            Shape::convex_polygon(
                vec![at(2.0, 6.0), at(2.0, 10.0), at(5.0, 10.0), at(5.0, 6.0)],
                color,
                Stroke::NONE,
            ),
            Shape::convex_polygon(
                vec![at(5.0, 6.0), at(5.0, 10.0), at(9.0, 13.0), at(9.0, 3.0)],
                color,
                Stroke::NONE,
            ),
        ]
    };
    let shapes: Vec<Shape> = match glyph {
        Glyph::Speaker => {
            let mut shapes = speaker().to_vec();
            shapes.push(line(
                &[
                    (11.5, 5.5),
                    (12.6, 6.4),
                    (13.1, 8.0),
                    (12.6, 9.6),
                    (11.5, 10.5),
                ],
                1.2,
            ));
            shapes
        }
        Glyph::SpeakerMuted => {
            let mut shapes = speaker().to_vec();
            shapes.push(line(&[(10.5, 5.5), (14.0, 10.5)], 1.3));
            shapes.push(line(&[(14.0, 5.5), (10.5, 10.5)], 1.3));
            shapes
        }
        Glyph::Block => vec![
            Shape::circle_stroke(at(8.0, 8.0), 6.0 * scale, stroke(1.3)),
            line(&[(3.8, 3.8), (12.2, 12.2)], 1.3),
        ],
        Glyph::Flag => vec![
            line(&[(4.0, 2.0), (4.0, 14.0)], 1.3),
            line(
                &[
                    (4.0, 2.0),
                    (12.0, 2.0),
                    (10.0, 5.0),
                    (12.0, 8.0),
                    (4.0, 8.0),
                ],
                1.3,
            ),
        ],
        Glyph::Person => vec![
            Shape::circle_stroke(at(8.0, 5.0), 2.6 * scale, stroke(1.3)),
            line(
                &[
                    (2.8, 13.5),
                    (4.0, 11.0),
                    (5.8, 9.7),
                    (8.0, 9.3),
                    (10.2, 9.7),
                    (12.0, 11.0),
                    (13.2, 13.5),
                ],
                1.3,
            ),
        ],
        Glyph::More => [3.0, 8.0, 13.0]
            .into_iter()
            .map(|x| Shape::circle_filled(at(x, 8.0), 1.5 * scale, color))
            .collect(),
        Glyph::Check => vec![line(&[(2.5, 8.2), (6.0, 11.6), (13.5, 4.0)], 1.7)],
    };
    painter.extend(shapes);
}

/// Paints a dropdown's chevron into `rect`.
fn paint_chevron(painter: &egui::Painter, rect: Rect, color: Color32) {
    let points: Vec<Pos2> = vec![
        rect.left_top(),
        pos2(rect.center().x, rect.bottom()),
        rect.right_top(),
    ];
    painter.add(Shape::line(points, Stroke::new(1.4, color)));
}
