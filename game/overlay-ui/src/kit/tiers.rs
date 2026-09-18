//! The three levels of chrome the overlay draws its surfaces at.
//!
//! Tier 0 is ambient: it sits over live gameplay and stays quiet. Tier 1 is a hero surface that
//! carries the match's identity. Tier 2 owns the screen: it dims everything behind it and is the
//! only tier allowed to glow.

use egui::epaint::CornerRadiusF32;
use egui::epaint::tessellator::path::rounded_rectangle;
use egui::{
    Align2, Area, Color32, Context, CornerRadius, Frame, Id, InnerResponse, Margin, Mesh, Order,
    Rect, Response, Sense, Shape, Stroke, StrokeKind, Ui, Vec2, pos2, vec2,
};

use crate::kit::text;
use crate::kit::theme;

/// Padding between a panel's chrome and its contents.
const PANEL_MARGIN: Margin = Margin {
    left: 12,
    right: 12,
    top: 10,
    bottom: 10,
};

/// Padding between a dialog's chrome and its contents, wider because a modal has the room.
const DIALOG_MARGIN: Margin = Margin {
    left: 24,
    right: 24,
    top: 18,
    bottom: 20,
};

/// How much room a panel's contents get inside a panel that is `outer_width` wide.
///
/// A panel placed on a grid is sized from the outside in, but egui sizes it from the inside out, so
/// a caller that knows where the panel's edges must land converts here rather than guessing at the
/// margin.
pub fn panel_content_width(outer_width: f32) -> f32 {
    outer_width - f32::from(PANEL_MARGIN.left) - f32::from(PANEL_MARGIN.right)
}

/// An ambient panel: flat fill, one hairline, nothing that competes with the game behind it.
pub fn tier0_panel<R>(ui: &mut Ui, add: impl FnOnce(&mut Ui) -> R) -> InnerResponse<R> {
    Frame::NONE
        .fill(theme::TIER0_FILL)
        .stroke(Stroke::new(theme::HAIRLINE, theme::TIER0_STROKE))
        .corner_radius(theme::radius(theme::RADIUS_PANEL))
        .inner_margin(PANEL_MARGIN)
        .show(ui, add)
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
    Shape::Vec(shapes)
}

/// What a modal dialog reported back.
pub struct DialogResponse<R> {
    pub inner: R,
    /// Whether the player clicked outside the dialog, which every modal treats as "dismiss".
    pub scrim_clicked: bool,
    pub response: Response,
}

/// A modal dialog: the screen dimmed behind it, the dialog centred on top with a glowing title.
pub fn tier2_dialog<R>(
    ctx: &Context,
    id: Id,
    title: &str,
    width: f32,
    add: impl FnOnce(&mut Ui) -> R,
) -> DialogResponse<R> {
    let screen = ctx.viewport_rect();
    let scrim_area = Area::new(id.with("scrim"))
        .order(Order::Middle)
        .fixed_pos(screen.min)
        .show(ctx, |ui| {
            let (rect, response) = ui.allocate_exact_size(screen.size(), Sense::click());
            ui.painter().rect_filled(rect, 0, theme::SCRIM);
            response
        });
    let dialog = Area::new(id)
        .order(Order::Foreground)
        .anchor(Align2::CENTER_CENTER, Vec2::ZERO)
        .show(ctx, |ui| {
            let background = ui.painter().add(Shape::Noop);
            let inner = Frame::NONE.inner_margin(DIALOG_MARGIN).show(ui, |ui| {
                ui.set_width(width);
                dialog_title(ui, title);
                ui.add_space(theme::SPACE_MD);
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

/// Draws a dialog's title with a faint amber glow behind it.
///
/// The glow stands in for a blurred shadow (10 units wide, a third of the text's alpha in total),
/// which the game's renderer cannot blur for us: the same text is stamped around itself at three
/// radii, each ring so faint that no single copy reads as a second outline. The rings start well
/// outside the glyph strokes and thin out with distance, so the sum is a soft field behind the
/// letters rather than a fat edge on them, and the letters themselves stay sharp.
pub fn dialog_title(ui: &mut Ui, title: &str) {
    let spec = text::dialog_title();
    let galley = spec.galley(ui, title);
    let halo = spec
        .clone()
        .with_color(Color32::PLACEHOLDER)
        .galley(ui, title);
    let size = galley.size();
    let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), size.y), Sense::hover());
    let origin = pos2(rect.center().x - size.x * 0.5, rect.top());
    let painter = ui.painter();
    const STAMPS_PER_RING: usize = 8;
    for (radius, alpha) in [(10.0f32, 0.005f32), (6.0, 0.008), (3.0, 0.011)] {
        let color = theme::ACCENT.gamma_multiply(alpha);
        for step in 0..STAMPS_PER_RING {
            let angle = std::f32::consts::TAU * step as f32 / STAMPS_PER_RING as f32;
            let offset = vec2(angle.cos(), angle.sin()) * radius;
            painter.galley(origin + offset, halo.clone(), color);
        }
    }
    painter.galley(origin, galley, spec.color);
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
