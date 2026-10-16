//! The three levels of chrome the overlay draws its surfaces at.
//!
//! Tier 0 is ambient: it sits over live gameplay and stays quiet. Tier 1 is a hero surface that
//! carries the match's identity. Tier 2 owns the screen: it dims everything behind it and is the
//! only tier allowed to glow.

use std::sync::Arc;

use egui::epaint::tessellator::path::rounded_rectangle;
use egui::epaint::{CornerRadiusF32, Shadow};
use egui::{
    Align2, Area, Color32, Context, CornerRadius, Frame, Galley, Id, InnerResponse, Margin, Mesh,
    Order, Pos2, Rect, Response, Sense, Shape, Stroke, StrokeKind, Ui, Vec2, pos2, vec2,
};

use crate::kit::text;
use crate::kit::theme;

/// The shadow that lifts an ambient panel off the gameplay behind it. Small: these sit over a
/// moving picture, and the separation has to come from the edge rather than from a dark halo.
const PANEL_SHADOW: Shadow = Shadow {
    offset: [0, 2],
    blur: 10,
    spread: 0,
    color: Color32::from_black_alpha(89),
};

/// The shadow under a hero surface, which carries more of the screen and so sits further off it.
const HERO_SHADOW: Shadow = Shadow {
    offset: [0, 6],
    blur: 22,
    spread: 0,
    color: Color32::from_black_alpha(128),
};

/// The shadow under a modal, which owns the screen and is allowed to say so.
const DIALOG_SHADOW: Shadow = Shadow {
    offset: [0, 24],
    blur: 64,
    spread: 0,
    color: Color32::from_black_alpha(153),
};

/// Padding between a panel's chrome and its contents.
const PANEL_MARGIN: Margin = Margin {
    left: 12,
    right: 12,
    top: 10,
    bottom: 10,
};

/// What an ambient panel's chrome adds above and below its contents together.
pub const PANEL_MARGIN_HEIGHT: f32 = (PANEL_MARGIN.top + PANEL_MARGIN.bottom) as f32;

/// What an ambient panel's chrome adds either side of its contents together.
pub const PANEL_MARGIN_WIDTH: f32 = (PANEL_MARGIN.left + PANEL_MARGIN.right) as f32;

/// Padding between a dialog's chrome and its contents, wider because a modal has the room. A
/// dialog is built from three bands that share these side margins and differ only in how much room
/// they leave above and below what they hold.
const DIALOG_PAD_X: i8 = 28;

const DIALOG_HEADER_MARGIN: Margin = Margin {
    left: DIALOG_PAD_X,
    right: DIALOG_PAD_X,
    top: 22,
    bottom: 18,
};

/// The body leaves little room under itself, because the band that follows it brings its own top
/// padding and the two together are the gap the design draws.
const DIALOG_BODY_MARGIN: Margin = Margin {
    left: DIALOG_PAD_X,
    right: DIALOG_PAD_X,
    top: 18,
    bottom: 8,
};

const DIALOG_FOOTER_MARGIN: Margin = Margin {
    left: DIALOG_PAD_X,
    right: DIALOG_PAD_X,
    top: 12,
    bottom: 20,
};

/// How much room a dialog's bands leave their contents inside a dialog `outer_width` wide.
///
/// A `const fn` so a dialog whose columns are laid out from constants can check they add up at
/// compile time rather than discovering it on screen.
pub const fn dialog_content_width(outer_width: f32) -> f32 {
    outer_width - DIALOG_PAD_X as f32 * 2.0
}

/// How wide a dialog has to be for its bands to leave `content_width` points inside them.
///
/// A dialog laid out from the inside — a table of columns that add up to a width — is built against
/// this rather than against a number someone added the padding to by hand.
pub fn dialog_outer_width(content_width: f32) -> f32 {
    content_width + f32::from(DIALOG_PAD_X) * 2.0
}

/// How much room a panel's contents get inside a panel that is `outer_width` wide.
///
/// A panel placed on a grid is sized from the outside in, but egui sizes it from the inside out, so
/// a caller that knows where the panel's edges must land converts here rather than guessing at the
/// margin.
pub fn panel_content_width(outer_width: f32) -> f32 {
    outer_width - f32::from(PANEL_MARGIN.left) - f32::from(PANEL_MARGIN.right)
}

/// An ambient panel: flat fill, one hairline, nothing that competes with the game behind it.
///
/// The edge is painted rather than handed to the frame, because a frame counts its stroke as part
/// of its own margin: a panel placed on the design's grid would come out two points wider than the
/// width it was given, and every column inside it would be measured against the wrong number.
pub fn tier0_panel<R>(ui: &mut Ui, add: impl FnOnce(&mut Ui) -> R) -> InnerResponse<R> {
    let corner_radius = theme::radius(theme::RADIUS_PANEL);
    let inner = Frame::NONE
        .fill(theme::TIER0_FILL)
        .corner_radius(corner_radius)
        .shadow(PANEL_SHADOW)
        .inner_margin(PANEL_MARGIN)
        .show(ui, add);
    ui.painter().add(Shape::rect_stroke(
        inner.response.rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, theme::TIER0_STROKE),
        StrokeKind::Inside,
    ));
    inner
}

/// A hero panel: a vertical gradient, a lit top bevel and a blue edge.
///
/// `corner_radius` is a parameter because these panels hang off screen edges as often as they
/// float: a bar clamped to the top of the screen wants square corners there and round ones below.
pub fn tier1_panel<R>(
    ui: &mut Ui,
    corner_radius: CornerRadius,
    add: impl FnOnce(&mut Ui) -> R,
) -> InnerResponse<R> {
    let background = ui.painter().add(Shape::Noop);
    let inner = Frame::NONE.inner_margin(PANEL_MARGIN).show(ui, add);
    ui.painter()
        .set(background, tier1_chrome(inner.response.rect, corner_radius));
    inner
}

/// The shapes a tier-1 surface is built from, for callers that place their own rect.
pub fn tier1_chrome(rect: Rect, corner_radius: CornerRadius) -> Shape {
    let bevel_inset = theme::HAIRLINE * 1.5;
    Shape::Vec(vec![
        Shape::from(HERO_SHADOW.as_shape(rect, corner_radius)),
        gradient_round_rect(
            rect,
            corner_radius,
            [theme::TIER1_FILL_TOP, theme::TIER1_FILL_BOTTOM],
        ),
        Shape::line_segment(
            [
                pos2(
                    rect.left() + f32::from(corner_radius.nw),
                    rect.top() + bevel_inset,
                ),
                pos2(
                    rect.right() - f32::from(corner_radius.ne),
                    rect.top() + bevel_inset,
                ),
            ],
            Stroke::new(theme::HAIRLINE, theme::TIER1_BEVEL),
        ),
        Shape::rect_stroke(
            rect,
            corner_radius,
            Stroke::new(theme::HAIRLINE, theme::TIER1_STROKE),
            StrokeKind::Inside,
        ),
    ])
}

/// The shapes a tier-2 surface is built from: a gradient, two strokes with a gap between them, and
/// a stack of fading strokes outside that stand in for a blur the renderer cannot do.
pub fn tier2_chrome(rect: Rect) -> Shape {
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    let mut shapes = vec![
        Shape::from(DIALOG_SHADOW.as_shape(rect, corner_radius)),
        gradient_round_rect(
            rect,
            corner_radius,
            [theme::TIER2_FILL_TOP, theme::TIER2_FILL_BOTTOM],
        ),
        Shape::rect_stroke(
            rect,
            corner_radius,
            Stroke::new(theme::HAIRLINE, theme::TIER2_STROKE_INNER),
            StrokeKind::Inside,
        ),
        Shape::rect_stroke(
            rect.expand(theme::TIER2_STROKE_GAP),
            corner_radius,
            Stroke::new(theme::HAIRLINE, theme::TIER2_STROKE_OUTER),
            StrokeKind::Outside,
        ),
    ];
    for (step, color) in theme::TIER2_GLOW.iter().enumerate() {
        shapes.push(Shape::rect_stroke(
            rect.expand(theme::TIER2_STROKE_GAP + (step + 1) as f32),
            corner_radius,
            Stroke::new(theme::HAIRLINE, *color),
            StrokeKind::Outside,
        ));
    }
    for (step, color) in theme::TIER2_INNER_SHADOW.iter().enumerate() {
        shapes.push(Shape::rect_stroke(
            rect.shrink(theme::HAIRLINE + step as f32),
            corner_radius,
            Stroke::new(theme::HAIRLINE, *color),
            StrokeKind::Inside,
        ));
    }
    Shape::Vec(shapes)
}

/// The shapes a menu hung off a modal's control is built from: the modal's own fill and inner edge,
/// lifted off the dialog under it by a short glow and a shadow. One edge rather than the modal's two,
/// because a menu is a part of the dialog it opens from rather than a second dialog.
pub fn menu_chrome(rect: Rect) -> Shape {
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    let mut shapes = vec![
        Shape::from(MENU_SHADOW.as_shape(rect, corner_radius)),
        gradient_round_rect(
            rect,
            corner_radius,
            [theme::MENU_FILL_TOP, theme::MENU_FILL_BOTTOM],
        ),
        Shape::rect_stroke(
            rect,
            corner_radius,
            Stroke::new(theme::HAIRLINE, theme::TIER2_STROKE_INNER),
            StrokeKind::Inside,
        ),
    ];
    for (step, color) in theme::TIER2_GLOW.iter().take(MENU_GLOW_STEPS).enumerate() {
        shapes.push(Shape::rect_stroke(
            rect.expand(step as f32 + 1.0),
            corner_radius,
            Stroke::new(theme::HAIRLINE, *color),
            StrokeKind::Outside,
        ));
    }
    Shape::Vec(shapes)
}

/// The shadow under a menu: a modal's, shortened, since a menu sits just above the dialog it opens
/// from rather than above the whole screen.
const MENU_SHADOW: Shadow = Shadow {
    offset: [0, 16],
    blur: 40,
    spread: 0,
    color: Color32::from_black_alpha(153),
};

/// How many of the modal's glow rings a menu keeps: the inner ones, which say "lit" without
/// reaching across the rows of the dialog under it.
const MENU_GLOW_STEPS: usize = 4;

/// What a modal dialog reported back.
pub struct DialogResponse<R> {
    pub inner: R,
    /// Whether the player clicked outside the dialog, which every modal treats as "dismiss".
    pub scrim_clicked: bool,
    pub response: Response,
}

/// Where a modal dialog stands, and how much of the game it dims.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DialogStage {
    /// Centred, the whole screen dimmed behind it: the dialog is all there is to look at.
    Centered,
    /// Near the top of the screen, growing downward, with the dimming only around it and gone by
    /// the screen's middle. For a dialog the player has to be able to see the game past: the chat
    /// lines SC:R draws above its console, and the chat box under them, stay clear.
    Raised,
}

/// How far down the screen a raised dialog's top edge sits, as a fraction of the screen's height:
/// clear of SC:R's resource counters along the top.
const RAISED_TOP: f32 = 0.1;

/// How far down the screen a raised dialog's dimming reaches before it is gone, as a fraction of
/// the screen's height, and how strong it is at its top, as a fraction of the scrim's own.
const RAISED_SCRIM_REACH: f32 = 0.55;
const RAISED_SCRIM_STRENGTH: f32 = 0.85;

/// A modal dialog: the screen dimmed behind it, the dialog centred on top.
///
/// The dialog's `Ui` is the full width of the chrome with no padding of its own, because a dialog
/// is a stack of bands and each band brings its own: see [`dialog_header`], [`dialog_body`] and
/// [`dialog_footer`], which every dialog is assembled from so they cannot drift apart.
pub fn tier2_dialog<R>(
    ctx: &Context,
    id: Id,
    width: f32,
    add: impl FnOnce(&mut Ui) -> R,
) -> DialogResponse<R> {
    tier2_dialog_staged(ctx, id, width, DialogStage::Centered, add)
}

/// [`tier2_dialog`] standing where `stage` puts it.
pub fn tier2_dialog_staged<R>(
    ctx: &Context,
    id: Id,
    width: f32,
    stage: DialogStage,
    add: impl FnOnce(&mut Ui) -> R,
) -> DialogResponse<R> {
    let screen = ctx.viewport_rect();
    let scrim_area = Area::new(id.with("scrim"))
        .order(Order::Middle)
        .fixed_pos(screen.min)
        .show(ctx, |ui| {
            // The whole screen still takes the clicks, however little of it is dimmed: the dialog
            // is modal either way.
            let (rect, response) = ui.allocate_exact_size(screen.size(), Sense::click());
            match stage {
                DialogStage::Centered => ui.painter().rect_filled(rect, 0, theme::SCRIM),
                DialogStage::Raised => ui.painter().add(raised_scrim(rect)),
            };
            response
        });
    let anchor = match stage {
        DialogStage::Centered => (Align2::CENTER_CENTER, Vec2::ZERO),
        DialogStage::Raised => (Align2::CENTER_TOP, vec2(0.0, screen.height() * RAISED_TOP)),
    };
    let dialog = Area::new(id)
        .order(Order::Foreground)
        .anchor(anchor.0, anchor.1)
        .show(ctx, |ui| {
            let background = ui.painter().add(Shape::Noop);
            let inner = Frame::NONE.show(ui, |ui| {
                ui.set_width(width);
                ui.spacing_mut().item_spacing = Vec2::ZERO;
                add(ui)
            });
            ui.painter()
                .set(background, tier2_chrome(inner.response.rect));
            inner.inner
        });
    DialogResponse {
        inner: dialog.inner,
        scrim_clicked: scrim_area.inner.clicked(),
        response: dialog.response,
    }
}

/// The dimming behind a raised dialog: the scrim at the top of the screen, falling smoothly to
/// nothing by [`RAISED_SCRIM_REACH`] of the way down it.
fn raised_scrim(screen: Rect) -> Shape {
    const ROWS: usize = 12;
    let reach = screen.top() + screen.height() * RAISED_SCRIM_REACH;
    let mut mesh = Mesh::default();
    for row in 0..=ROWS {
        let along = row as f32 / ROWS as f32;
        let y = screen.top() + (reach - screen.top()) * along;
        let falloff = 1.0 - along * along * (3.0 - 2.0 * along);
        let color = theme::SCRIM.gamma_multiply(RAISED_SCRIM_STRENGTH * falloff);
        mesh.colored_vertex(pos2(screen.left(), y), color);
        mesh.colored_vertex(pos2(screen.right(), y), color);
    }
    for row in 0..ROWS as u32 {
        let top = row * 2;
        mesh.add_triangle(top, top + 1, top + 2);
        mesh.add_triangle(top + 1, top + 3, top + 2);
    }
    Shape::mesh(mesh)
}

/// A dialog's top band: what the dialog is about, ruled off from the rest of it.
pub fn dialog_header<R>(ui: &mut Ui, add: impl FnOnce(&mut Ui) -> R) -> R {
    let inner = band(ui, DIALOG_HEADER_MARGIN, add);
    let rect = inner.response.rect;
    ui.painter().add(Shape::line_segment(
        [
            pos2(rect.left(), rect.bottom() - theme::HAIRLINE * 0.5),
            pos2(rect.right(), rect.bottom() - theme::HAIRLINE * 0.5),
        ],
        Stroke::new(theme::HAIRLINE, theme::TIER2_DIVIDER),
    ));
    inner.inner
}

/// A dialog's middle band: whatever it is the dialog exists to show.
pub fn dialog_body<R>(ui: &mut Ui, add: impl FnOnce(&mut Ui) -> R) -> R {
    band(ui, DIALOG_BODY_MARGIN, add).inner
}

/// A dialog's middle band with no padding of its own, for a body that scrolls.
///
/// The body's contents are cut at the band's edge, and a band padded like [`dialog_body`] would
/// put that cut a few points inside the rules above and below it, where a half-drawn row reads as
/// a mistake rather than as a window onto more of the list. The caller pads its columns itself,
/// inside the scrolling region.
pub fn dialog_body_flush<R>(ui: &mut Ui, add: impl FnOnce(&mut Ui) -> R) -> R {
    band(ui, Margin::ZERO, add).inner
}

/// A dialog's bottom band: the rules and asides that belong under everything else.
pub fn dialog_footer<R>(ui: &mut Ui, add: impl FnOnce(&mut Ui) -> R) -> R {
    band(ui, DIALOG_FOOTER_MARGIN, add).inner
}

/// A dialog's bottom band, ruled off from the body above it.
///
/// For a dialog whose body scrolls: the rule is where the body's contents are cut, and without it
/// a row clipped at that edge reads as a layout that ran out of room rather than as a window onto
/// more of the list.
pub fn dialog_footer_ruled<R>(ui: &mut Ui, add: impl FnOnce(&mut Ui) -> R) -> R {
    let inner = band(ui, DIALOG_FOOTER_MARGIN, add);
    let rect = inner.response.rect;
    ui.painter().add(Shape::line_segment(
        [
            pos2(rect.left(), rect.top() + theme::HAIRLINE * 0.5),
            pos2(rect.right(), rect.top() + theme::HAIRLINE * 0.5),
        ],
        Stroke::new(theme::HAIRLINE, theme::TIER2_DIVIDER),
    ));
    inner.inner
}

/// One band of a dialog, the full width of the chrome and padded by its own margin.
fn band<R>(ui: &mut Ui, margin: Margin, add: impl FnOnce(&mut Ui) -> R) -> InnerResponse<R> {
    let width = ui.available_width();
    Frame::NONE.inner_margin(margin).show(ui, |ui| {
        ui.set_width(width - f32::from(margin.left) - f32::from(margin.right));
        ui.spacing_mut().item_spacing = Vec2::ZERO;
        add(ui)
    })
}

/// Draws a dialog's title with a faint amber glow behind it.
pub fn dialog_title(ui: &mut Ui, title: &str) {
    glowing_text(ui, &text::dialog_title(), title, theme::ACCENT);
}

/// Draws `label` in `spec` with a faint glow of `glow` behind it.
///
/// The glow stands in for a blurred shadow (10 units wide at a dialog title's size, a third of the
/// text's alpha in total), which the game's renderer cannot blur for us: the same text is stamped
/// around itself at three radii, each ring so faint that no single copy reads as a second outline.
/// The rings start well outside the glyph strokes and thin out with distance, so the sum is a soft
/// field behind the letters rather than a fat edge on them, and the letters themselves stay sharp.
/// The radii grow with the text, so a headline's glow is as soft relative to its letters as a
/// title's is.
pub fn glowing_text(ui: &mut Ui, spec: &text::TextSpec, label: &str, glow: Color32) {
    let galley = spec.galley(ui, label);
    let halo = spec
        .clone()
        .with_color(Color32::PLACEHOLDER)
        .galley(ui, label);
    let size = galley.size();
    // Exactly as wide as the letters, so a caller decides where the text sits by the layout it
    // puts this in rather than by a rule of its own.
    let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
    let origin = rect.min;
    let painter = ui.painter();
    for stamp in glow_stamps(origin, &halo, glow, spec.font.size) {
        painter.add(stamp);
    }
    painter.galley(origin, galley, spec.color);
}

/// The stamps [`glowing_text`] lays behind its letters, for a caller that paints the letters
/// itself: `halo` is the text laid out in [`Color32::PLACEHOLDER`] at `origin`, set in a face
/// `size` points tall.
pub fn glow_stamps(
    origin: Pos2,
    halo: &Arc<Galley>,
    glow: Color32,
    size: f32,
) -> impl Iterator<Item = Shape> {
    const STAMPS_PER_RING: usize = 8;
    let spread = (size / text::dialog_title().font.size).max(1.0);
    [(10.0f32, 0.005f32), (6.0, 0.008), (3.0, 0.011)]
        .into_iter()
        .flat_map(move |(radius, alpha)| {
            let color = glow.gamma_multiply(alpha);
            (0..STAMPS_PER_RING).map(move |step| {
                let angle = std::f32::consts::TAU * step as f32 / STAMPS_PER_RING as f32;
                (vec2(angle.cos(), angle.sin()) * radius * spread, color)
            })
        })
        .map(move |(offset, color)| Shape::galley(origin + offset, halo.clone(), color))
}

/// Dims the whole screen, for a caller that owns its modal layer itself.
pub fn scrim(ui: &Ui) {
    let screen = ui.ctx().viewport_rect();
    ui.painter().rect_filled(screen, 0, theme::SCRIM);
}

/// A rounded rectangle filled with a vertical gradient.
///
/// egui's own gradient shape is a plain quad, so a rounded one has to be built here: the rounded
/// outline fanned out from its centre, with every vertex colored by where it sits between the top
/// and bottom edges.
pub fn gradient_round_rect(
    rect: Rect,
    corner_radius: CornerRadius,
    [top, bottom]: [Color32; 2],
) -> Shape {
    if !rect.is_positive() {
        return Shape::Noop;
    }
    let mut path = Vec::new();
    rounded_rectangle(&mut path, rect, CornerRadiusF32::from(corner_radius));
    if path.len() < 3 {
        return Shape::Noop;
    }
    let height = rect.height().max(f32::MIN_POSITIVE);
    let color_at =
        |y: f32| lerp_premultiplied(top, bottom, ((y - rect.top()) / height).clamp(0.0, 1.0));

    let mut mesh = Mesh::default();
    let centre = rect.center();
    mesh.colored_vertex(centre, color_at(centre.y));
    for point in &path {
        mesh.colored_vertex(*point, color_at(point.y));
    }
    let ring = path.len() as u32;
    for index in 0..ring {
        mesh.add_triangle(0, 1 + index, 1 + (index + 1) % ring);
    }
    Shape::mesh(mesh)
}

/// Blends two premultiplied colors, which is the space every shape's vertices are already in.
fn lerp_premultiplied(from: Color32, to: Color32, t: f32) -> Color32 {
    let channel = |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * t).round() as u8;
    Color32::from_rgba_premultiplied(
        channel(from.r(), to.r()),
        channel(from.g(), to.g()),
        channel(from.b(), to.b()),
        channel(from.a(), to.a()),
    )
}
