//! The on-screen count: what each player has in the part of the map the watcher is looking at,
//! shown for as long as Alt is held.
//!
//! A fight on screen is read as who has what there, and the stats wings only answer that for the
//! whole map. This answers it on the map itself. Every unit in view gets a health bar under it, and
//! every group of a player's units gets a label hung just above it: their name on a thin band of
//! their own color over a tile for every kind of unit in the group with how many of it, in the
//! order the host ranks the kinds. A label goes where its units are, so it needs no room of its own
//! on the screen; where two would cover each other, the later one moves up out of the way.
//!
//! Dragging a box with Alt held picks what is inside it. While the box is being dragged it is drawn,
//! with a label per player hung over it counting what it covers; once the button is let go the box
//! is gone and the units it covered are the only ones counted and given bars, labelled where they
//! go, until Alt is let go. A click without a drag goes back to everything in view.
//!
//! What makes a group is measured on the screen rather than on the map, because the labels are a
//! fixed size on the screen: zoomed out, units a long way apart on the map are close together on
//! the screen and share a label, and zoomed in they get one each (see [`grouping`]).

mod grouping;

use egui::{
    Align, Area, Color32, Context, Id, Order, Pos2, Rect, Sense, Stroke, StrokeKind, Ui, Vec2,
    pos2, vec2,
};

use crate::colors::BLUE60;
use crate::kit::motion;
use crate::kit::text;
use crate::kit::theme;
use crate::observer::selection::health_tint;
use crate::observer::{
    ProductionIcon, owner_tint, paint_icon_glow, paint_owner_wash, paint_text, paint_tile_chrome,
    unit_codes, vision_alpha,
};

/// Height of the band a group's owner is named on.
const NAME_BAND_HEIGHT: f32 = 16.0;

/// Text size of the owner's name on the band.
const NAME_SIZE: f32 = 13.0;

/// How far the band's text is set in from either end of it.
const NAME_INSET: f32 = 5.0;

/// Gap between the band and the tiles under it.
const BAND_GAP: f32 = 2.0;

/// A unit kind's tile, and the gap between two of them, across a line and down to the next.
const TILE_WIDTH: f32 = 34.0;
const TILE_HEIGHT: f32 = 28.0;
const TILE_GAP: f32 = 3.0;

/// How many tiles a line holds before the next kind wraps onto a line of its own.
const TILES_PER_LINE: usize = 6;

/// Text size of the code a tile names its kind with where the host has no icon atlas.
const TILE_TEXT_SIZE: f32 = 10.0;

/// Text size of the count in a tile's corner, and how far in from the corner it sits.
const TILE_COUNT_SIZE: f32 = 11.0;
const TILE_COUNT_INSET: f32 = 2.0;

/// How far above the top of a group's units its label's bottom edge sits.
const LIFT: f32 = 8.0;

/// Room kept between a label and the screen's edges, and between two labels.
const EDGE_MARGIN: f32 = 4.0;
const LABEL_GAP: f32 = 4.0;

/// How much of a player's color the band behind their name is, and how dark the base under it is,
/// so the name reads the same on any color and over any terrain.
const BAND_COLOR_ALPHA: f32 = 0.6;
const BAND_BASE_ALPHA: f32 = 0.7;

/// The size of a unit's health bar, and of its shield bar where it has one: as wide as the unit,
/// within these bounds, and hung this far under it.
const BAR_MIN_WIDTH: f32 = 14.0;
const BAR_MAX_WIDTH: f32 = 56.0;
const HEALTH_BAR_HEIGHT: f32 = 3.0;
const SHIELD_BAR_HEIGHT: f32 = 2.0;
const BAR_DROP: f32 = 2.0;

/// The smallest box, in points either way, that counts as one dragged rather than a click.
const MIN_BOX: f32 = 6.0;

/// A player with units in view.
pub struct OnScreenPlayerView {
    pub name: String,
    /// The color this player is on the map, which is what ties a label to the units it counts.
    pub color: Color32,
    /// Whether the watcher currently sees the game through this player's eyes.
    pub vision: bool,
}

/// One unit in view.
pub struct OnScreenUnitView {
    /// Which unit it is, the same from frame to frame for as long as it lives, which is what a
    /// picked set of units is kept by.
    pub id: u32,
    /// Whose it is, as an index into [`OnScreenView::players`].
    pub player: usize,
    /// What kind it is, as an index into [`OnScreenView::kinds`], or `None` for a unit that gets a
    /// health bar but is not counted (a building).
    pub kind: Option<usize>,
    /// Where it stands, in shares of the game view (0 to 1 across and down it).
    pub position: Pos2,
    /// The box its body fills, in the same shares.
    pub bounds: Rect,
    /// How much of its health it has left, from 0 to 1, or `None` for one that cannot be hurt.
    pub health: Option<f32>,
    /// How much of its shields it has left, for a unit that has shields.
    pub shields: Option<f32>,
}

/// Everything the on-screen count draws from.
#[derive(Default)]
pub struct OnScreenView {
    pub players: Vec<OnScreenPlayerView>,
    /// The icon of every kind of unit counted, in the order their tiles are drawn.
    pub kinds: Vec<ProductionIcon>,
    pub units: Vec<OnScreenUnitView>,
}

/// One label to draw: whose units it counts, how many of each kind (in drawing order), and the top
/// middle of what it labels, which it is hung over.
struct Label<'a> {
    player: &'a OnScreenPlayerView,
    kinds: Vec<(usize, u32)>,
    anchor: Pos2,
}

/// What the count is about this frame.
enum Pick {
    /// Every unit in view.
    Everything,
    /// The units the box being dragged covers, given in points.
    Dragging(Rect),
    /// The units a box covered when it was let go, by id, sorted.
    Picked(Vec<u32>),
}

impl Pick {
    /// Whether `unit` gets a bar, and is counted where it is a kind that is counted.
    fn includes(&self, unit: &OnScreenUnitView, screen: Rect) -> bool {
        match self {
            Pick::Everything => true,
            Pick::Dragging(dragged) => {
                unit.kind.is_some() && dragged.contains(on_screen(unit.position, screen))
            }
            Pick::Picked(ids) => ids.binary_search(&unit.id).is_ok(),
        }
    }
}

/// The box being dragged, as where it started and where the pointer is, and the units the last one
/// picked, kept from frame to frame while the count is up.
#[derive(Clone, Default)]
struct PickState {
    drag: Option<(Pos2, Pos2)>,
    picked: Option<Vec<u32>>,
}

/// Draws the health bars and labels, fading them all in and out together. `screen` is the rect the
/// game view fills.
pub fn render_on_screen_view(view: &OnScreenView, ctx: &Context, shown: bool, screen: Rect) {
    let id = Id::new("sb_on_screen_units");
    let pick = follow_pick(ctx, id.with("pick"), shown, view, screen);
    let area = Area::new(id)
        .fixed_pos(screen.min)
        .order(Order::Foreground)
        .interactable(false);
    // Pinned to the units they count, so they fade in and out where they stand rather than sliding.
    motion::presence_area_along(
        ctx,
        id.with("presence"),
        shown && !view.units.is_empty(),
        area,
        Vec2::ZERO,
        |ui| {
            ui.set_clip_rect(screen);
            ui.allocate_exact_size(screen.size(), Sense::hover());
            for unit in view.units.iter().filter(|unit| pick.includes(unit, screen)) {
                draw_bars(ui, view, unit, screen);
            }
            let labels = match &pick {
                Pick::Dragging(dragged) => {
                    paint_box(ui, *dragged);
                    box_labels(view, *dragged, screen)
                }
                _ => group_labels(view, screen, |unit| pick.includes(unit, screen)),
            };
            for (label, rect) in place_labels(ui, labels, screen) {
                draw_label(ui, view, &label, rect);
            }
        },
    );
}

/// Follows the box the watcher drags with the primary button while the count is up, and what it
/// picks once the button is let go. A box too small to be one is a click, which picks nothing and
/// so goes back to everything in view, as does a box that covered nothing; all of it is dropped
/// with the count.
fn follow_pick(ctx: &Context, id: Id, shown: bool, view: &OnScreenView, screen: Rect) -> Pick {
    if !shown {
        ctx.data_mut(|data| data.remove::<PickState>(id));
        return Pick::Everything;
    }
    let (pressed, down, origin, latest) = ctx.input(|input| {
        (
            input.pointer.primary_pressed(),
            input.pointer.primary_down(),
            input.pointer.press_origin(),
            input.pointer.latest_pos(),
        )
    });
    let mut state = ctx
        .data(|data| data.get_temp::<PickState>(id))
        .unwrap_or_default();
    if pressed && let Some(origin) = origin {
        state.drag = Some((origin, origin));
    }
    let mut dragging = None;
    if let Some((start, end)) = state.drag.as_mut() {
        if let Some(latest) = latest {
            *end = latest;
        }
        let dragged = Rect::from_two_pos(*start, *end);
        let big_enough = dragged.width() >= MIN_BOX && dragged.height() >= MIN_BOX;
        if down {
            dragging = big_enough.then_some(dragged);
        } else {
            let covered = Pick::Dragging(dragged);
            let mut ids: Vec<u32> = view
                .units
                .iter()
                .filter(|unit| covered.includes(unit, screen))
                .map(|unit| unit.id)
                .collect();
            ids.sort_unstable();
            state.picked = (big_enough && !ids.is_empty()).then_some(ids);
            state.drag = None;
        }
    }
    let pick = match (dragging, &state.picked) {
        (Some(dragged), _) => Pick::Dragging(dragged),
        (None, Some(ids)) => Pick::Picked(ids.clone()),
        (None, None) => Pick::Everything,
    };
    ctx.data_mut(|data| data.insert_temp(id, state));
    pick
}

/// Where a point given in shares of the game view is on the screen.
fn on_screen(share: Pos2, screen: Rect) -> Pos2 {
    screen.min + share.to_vec2() * screen.size()
}

/// The labels for every group of every player's counted units that `included` lets through (see
/// the module's own docs for what makes a group).
fn group_labels<'a>(
    view: &'a OnScreenView,
    screen: Rect,
    included: impl Fn(&OnScreenUnitView) -> bool,
) -> Vec<Label<'a>> {
    let mut labels = Vec::new();
    for (index, player) in view.players.iter().enumerate() {
        let units: Vec<&OnScreenUnitView> = view
            .units
            .iter()
            .filter(|unit| unit.player == index && unit.kind.is_some() && included(unit))
            .collect();
        let points: Vec<Pos2> = units
            .iter()
            .map(|unit| on_screen(unit.position, screen))
            .collect();
        for members in grouping::stand_together(&points) {
            let members: Vec<&OnScreenUnitView> = members.into_iter().map(|i| units[i]).collect();
            let top = members
                .iter()
                .map(|unit| on_screen(unit.bounds.min, screen).y)
                .fold(f32::INFINITY, f32::min);
            let (left, right) = members
                .iter()
                .map(|unit| on_screen(unit.position, screen).x)
                .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), x| {
                    (lo.min(x), hi.max(x))
                });
            labels.push(Label {
                player,
                kinds: count_kinds(view, members),
                anchor: pos2((left + right) / 2.0, top),
            });
        }
    }
    labels
}

/// One label for each player with counted units inside `dragged`, all hung over its top edge.
fn box_labels<'a>(view: &'a OnScreenView, dragged: Rect, screen: Rect) -> Vec<Label<'a>> {
    view.players
        .iter()
        .enumerate()
        .filter_map(|(index, player)| {
            let covered = Pick::Dragging(dragged);
            let inside = view
                .units
                .iter()
                .filter(|unit| unit.player == index && covered.includes(unit, screen));
            let kinds = count_kinds(view, inside);
            (!kinds.is_empty()).then(|| Label {
                player,
                kinds,
                anchor: dragged.center_top(),
            })
        })
        .collect()
}

/// How many of `units` there are of each kind, in the kinds' drawing order.
fn count_kinds<'a>(
    view: &OnScreenView,
    units: impl IntoIterator<Item = &'a OnScreenUnitView>,
) -> Vec<(usize, u32)> {
    let mut counts = vec![0u32; view.kinds.len()];
    for kind in units.into_iter().filter_map(|unit| unit.kind) {
        if let Some(count) = counts.get_mut(kind) {
            *count += 1;
        }
    }
    counts
        .into_iter()
        .enumerate()
        .filter(|&(_, count)| count > 0)
        .collect()
}

/// The size of the label for a group of `kinds` kinds whose owner's name is `name_width` wide.
fn label_size(kinds: usize, name_width: f32) -> Vec2 {
    let columns = kinds.clamp(1, TILES_PER_LINE) as f32;
    let lines = kinds.div_ceil(TILES_PER_LINE).max(1) as f32;
    let tiles = vec2(
        TILE_WIDTH * columns + TILE_GAP * (columns - 1.0),
        TILE_HEIGHT * lines + TILE_GAP * (lines - 1.0),
    );
    vec2(
        tiles.x.max(name_width + NAME_INSET * 2.0),
        NAME_BAND_HEIGHT + BAND_GAP + tiles.y,
    )
}

/// Where every label goes: centered over what it labels and clear of the screen's edges, the
/// labels lowest on screen placed first so that a label that would cover one already placed is
/// moved up above it, and under every placed label instead where that would take it off the top.
fn place_labels<'a>(ui: &Ui, labels: Vec<Label<'a>>, screen: Rect) -> Vec<(Label<'a>, Rect)> {
    let mut wanted: Vec<(Label, Rect)> = labels
        .into_iter()
        .map(|label| {
            let name_width = name_spec(1.0).galley(ui, &label.player.name).size().x;
            let size = label_size(label.kinds.len(), name_width);
            let bottom_center = label.anchor - vec2(0.0, LIFT);
            let rect = Rect::from_min_size(bottom_center - vec2(size.x / 2.0, size.y), size);
            let rect = keep_on_screen(rect, screen);
            (label, rect)
        })
        .collect();
    wanted.sort_by(|(_, a), (_, b)| b.bottom().total_cmp(&a.bottom()));
    let mut placed: Vec<(Label, Rect)> = Vec::with_capacity(wanted.len());
    for (label, mut rect) in wanted {
        while let Some(blocking) = placed
            .iter()
            .map(|(_, other)| *other)
            .find(|other| other.expand(LABEL_GAP / 2.0).intersects(rect))
        {
            rect = rect.translate(vec2(0.0, blocking.top() - LABEL_GAP - rect.bottom()));
            if rect.top() < screen.top() + EDGE_MARGIN {
                // No room above what it collided with: hung under the lowest label instead, which
                // nothing placed so far reaches past.
                let lowest = placed
                    .iter()
                    .map(|(_, other)| other.bottom())
                    .fold(f32::MIN, f32::max);
                rect = rect.translate(vec2(0.0, lowest + LABEL_GAP - rect.top()));
                break;
            }
        }
        placed.push((label, rect));
    }
    placed
}

/// `rect` moved the least it takes to sit inside `screen`, short of its edges.
fn keep_on_screen(rect: Rect, screen: Rect) -> Rect {
    let room = screen.shrink(EDGE_MARGIN);
    let dx = (room.left() - rect.left()).max(0.0) + (room.right() - rect.right()).min(0.0);
    let dy = (room.top() - rect.top()).max(0.0) + (room.bottom() - rect.bottom()).min(0.0);
    rect.translate(vec2(dx, dy))
}

fn name_spec(alpha: f32) -> text::TextSpec {
    text::player_name(NAME_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha))
}

/// Paints the box the watcher dragged: a hairline edge over a faint wash, so what is inside it
/// still reads.
fn paint_box(ui: &Ui, dragged: Rect) {
    let painter = ui.painter();
    painter.rect_filled(dragged, 0.0, theme::alpha(theme::TEXT_PRIMARY, 0.06));
    painter.rect_stroke(
        dragged,
        0.0,
        Stroke::new(theme::HAIRLINE, theme::alpha(theme::TEXT_PRIMARY, 0.8)),
        StrokeKind::Inside,
    );
}

/// Draws a unit's bars centered under it: its shields where it has them, then its health in the
/// color of how hurt it is, each on a dark track so it reads over any terrain.
fn draw_bars(ui: &Ui, view: &OnScreenView, unit: &OnScreenUnitView, screen: Rect) {
    let Some(health) = unit.health else {
        return;
    };
    let alpha = view
        .players
        .get(unit.player)
        .map_or(1.0, |player| vision_alpha(player.vision));
    let body = Rect::from_min_max(
        on_screen(unit.bounds.min, screen),
        on_screen(unit.bounds.max, screen),
    );
    let width = body.width().clamp(BAR_MIN_WIDTH, BAR_MAX_WIDTH);
    let left = on_screen(unit.position, screen).x - width / 2.0;
    let mut top = body.bottom() + BAR_DROP;
    if let Some(shields) = unit.shields {
        let bar = Rect::from_min_size(pos2(left, top), vec2(width, SHIELD_BAR_HEIGHT));
        paint_bar(ui, bar, shields, BLUE60, alpha);
        top = bar.bottom();
    }
    let bar = Rect::from_min_size(pos2(left, top), vec2(width, HEALTH_BAR_HEIGHT));
    paint_bar(ui, bar, health, health_tint(health), alpha);
}

/// Paints one bar: a dark track, then however much of it is filled.
fn paint_bar(ui: &Ui, rect: Rect, fraction: f32, color: Color32, alpha: f32) {
    let painter = ui.painter();
    painter.rect_filled(
        rect.expand(theme::HAIRLINE),
        0.0,
        Color32::BLACK.gamma_multiply(0.75 * alpha),
    );
    let mut filled = rect;
    filled.set_right(rect.left() + rect.width() * fraction.clamp(0.0, 1.0));
    if filled.width() > 0.0 {
        painter.rect_filled(filled, 0.0, color.gamma_multiply(alpha));
    }
}

/// Draws one label into `rect`: the owner's name on a band of their color as wide as the label,
/// then a tile for each kind, wrapping onto as many lines as it takes.
fn draw_label(ui: &Ui, view: &OnScreenView, label: &Label, rect: Rect) {
    let player = label.player;
    let alpha = vision_alpha(player.vision);
    let band = Rect::from_min_size(rect.min, vec2(rect.width(), NAME_BAND_HEIGHT));
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    let painter = ui.painter();
    painter.rect_filled(
        band,
        corner_radius,
        Color32::BLACK.gamma_multiply(BAND_BASE_ALPHA * alpha),
    );
    painter.rect_filled(
        band,
        corner_radius,
        player.color.gamma_multiply(BAND_COLOR_ALPHA * alpha),
    );
    paint_text(
        ui,
        band.shrink2(vec2(NAME_INSET, 0.0)),
        &name_spec(alpha),
        &player.name,
        Align::Center,
    );

    let columns = label.kinds.len().clamp(1, TILES_PER_LINE) as f32;
    let tiles_width = TILE_WIDTH * columns + TILE_GAP * (columns - 1.0);
    // The tiles are centered under the band, which is wider than them where the name is.
    let left = rect.center().x - tiles_width / 2.0;
    let top = band.bottom() + BAND_GAP;
    for (i, &(kind, count)) in label.kinds.iter().enumerate() {
        let Some(icon) = view.kinds.get(kind) else {
            continue;
        };
        let (line, column) = (i / TILES_PER_LINE, i % TILES_PER_LINE);
        let tile = Rect::from_min_size(
            pos2(
                left + column as f32 * (TILE_WIDTH + TILE_GAP),
                top + line as f32 * (TILE_HEIGHT + TILE_GAP),
            ),
            vec2(TILE_WIDTH, TILE_HEIGHT),
        );
        draw_tile(ui, tile, icon, count, player.color, alpha);
    }
}

/// Draws one kind's tile: its icon washed in its `owner`'s color, and how many of it there are.
fn draw_tile(ui: &Ui, rect: Rect, icon: &ProductionIcon, count: u32, owner: Color32, alpha: f32) {
    paint_tile_chrome(ui, rect, false);
    paint_owner_wash(ui.painter(), rect, owner, alpha);
    let icon_rect = rect.shrink(theme::HAIRLINE);
    match icon.texture {
        Some(texture) => {
            paint_icon_glow(ui.painter(), icon_rect, alpha);
            icon.paint(
                ui.painter(),
                texture,
                icon_rect,
                owner_tint(owner).gamma_multiply(alpha),
            );
        }
        None => paint_text(
            ui,
            icon_rect,
            &text::body(TILE_TEXT_SIZE, text::BodyWeight::Semibold)
                .with_color(theme::TEXT_SECONDARY.gamma_multiply(alpha)),
            &unit_codes::code_or_index(icon.index),
            Align::Center,
        ),
    }
    // Tucked into the corner as the production tiles' counts are, so the tile still reads as one
    // thing with a number on it rather than as two boxes.
    let spec = text::body(TILE_COUNT_SIZE, text::BodyWeight::Semibold);
    let galley = spec.galley(ui, &count.to_string());
    ui.painter().galley(
        pos2(
            rect.right() - TILE_COUNT_INSET - galley.size().x,
            rect.bottom() - TILE_COUNT_INSET - galley.size().y,
        ),
        galley,
        theme::TEXT_PRIMARY.gamma_multiply(alpha),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A counted unit of the first player's standing at `x`, `y` in shares of the view.
    fn unit_at(id: u32, x: f32, y: f32) -> OnScreenUnitView {
        let position = pos2(x, y);
        OnScreenUnitView {
            id,
            player: 0,
            kind: Some(0),
            position,
            bounds: Rect::from_center_size(position, vec2(0.01, 0.01)),
            health: Some(1.0),
            shields: None,
        }
    }

    /// What [`follow_pick`] makes of one frame of `events`, with the count up while `shown`.
    fn pick_frame(
        ctx: &Context,
        view: &OnScreenView,
        shown: bool,
        events: Vec<egui::Event>,
    ) -> Pick {
        let screen = Rect::from_min_size(Pos2::ZERO, vec2(1000.0, 1000.0));
        let mut pick = Pick::Everything;
        let mut out = ctx.run_ui(
            egui::RawInput {
                screen_rect: Some(screen),
                events,
                ..Default::default()
            },
            |_| pick = follow_pick(ctx, Id::new("pick"), shown, view, screen),
        );
        out.textures_delta.clear();
        pick
    }

    fn button(pos: Pos2, pressed: bool) -> egui::Event {
        egui::Event::PointerButton {
            pos,
            button: egui::PointerButton::Primary,
            pressed,
            modifiers: Default::default(),
        }
    }

    #[test]
    fn a_dragged_box_keeps_counting_what_it_covered_until_the_count_goes() {
        let ctx = Context::default();
        let view = OnScreenView {
            units: vec![unit_at(7, 0.2, 0.2), unit_at(9, 0.8, 0.8)],
            ..Default::default()
        };
        let start = pos2(100.0, 100.0);
        let end = pos2(300.0, 300.0);
        pick_frame(&ctx, &view, true, vec![egui::Event::PointerMoved(start)]);
        pick_frame(&ctx, &view, true, vec![button(start, true)]);
        let dragging = pick_frame(&ctx, &view, true, vec![egui::Event::PointerMoved(end)]);
        assert!(matches!(dragging, Pick::Dragging(rect) if rect == Rect::from_two_pos(start, end)));
        let picked = pick_frame(&ctx, &view, true, vec![button(end, false)]);
        assert!(matches!(&picked, Pick::Picked(ids) if ids == &[7]));
        let later = pick_frame(&ctx, &view, true, vec![]);
        assert!(matches!(&later, Pick::Picked(ids) if ids == &[7]));
        // A click is the way back to everything.
        pick_frame(&ctx, &view, true, vec![button(end, true)]);
        let clicked = pick_frame(&ctx, &view, true, vec![button(end, false)]);
        assert!(matches!(clicked, Pick::Everything));
        // And letting go of Alt forgets a pick.
        pick_frame(&ctx, &view, true, vec![button(start, true)]);
        pick_frame(&ctx, &view, true, vec![egui::Event::PointerMoved(end)]);
        pick_frame(&ctx, &view, true, vec![button(end, false)]);
        pick_frame(&ctx, &view, false, vec![]);
        assert!(matches!(
            pick_frame(&ctx, &view, true, vec![]),
            Pick::Everything
        ));
    }
}
