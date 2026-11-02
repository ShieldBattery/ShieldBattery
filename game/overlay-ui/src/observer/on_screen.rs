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
//! Units are picked with the mouse much as the game selects them, and once picked they are the only
//! ones counted and given bars, labelled where they go, until Alt is let go. Dragging a box picks
//! the units inside it, and while the box is being dragged it is drawn, with a label per player hung
//! over it counting what it covers. Clicking a unit picks it, and with Ctrl, every unit its owner has
//! of its kind in view. With Shift, what is picked is added to what already was, and a click on what
//! already was takes it back out. A click on nothing goes back to everything in view.
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

/// How far outside a unit's body a click still lands on it, since the smallest are only a few points
/// across.
const CLICK_SLOP: f32 = 3.0;

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
    /// The units the box being dragged covers, given in points, and those already picked that it
    /// is adding to (by id, sorted), which is none unless Shift is held.
    Dragging { dragged: Rect, adding_to: Vec<u32> },
    /// The units picked, by id, sorted.
    Picked(Vec<u32>),
}

impl Pick {
    /// Whether `unit` gets a bar, and is counted where it is a kind that is counted.
    fn includes(&self, unit: &OnScreenUnitView, screen: Rect) -> bool {
        match self {
            Pick::Everything => true,
            Pick::Dragging { dragged, adding_to } => {
                in_box(unit, *dragged, screen) || adding_to.binary_search(&unit.id).is_ok()
            }
            Pick::Picked(ids) => ids.binary_search(&unit.id).is_ok(),
        }
    }
}

/// Whether a box covers `unit`, which it does for a counted unit standing inside it: a box dragged
/// across an army is after the army, not the buildings it stands among.
fn in_box(unit: &OnScreenUnitView, dragged: Rect, screen: Rect) -> bool {
    unit.kind.is_some() && dragged.contains(on_screen(unit.position, screen))
}

/// The box being dragged, as where it started and where the pointer is, the units picked, and
/// whether the button went down on the minimap and has not come up, kept from frame to frame while
/// the count is up.
#[derive(Clone, Default)]
struct PickState {
    drag: Option<(Pos2, Pos2)>,
    picked: Option<Vec<u32>>,
    steering: bool,
}

/// Draws the health bars and labels, fading them all in and out together. `screen` is the rect the
/// game view fills, and `minimap` the minimap's square where it is up.
///
/// Returns where on the minimap the watcher is pressing this frame, for the game's view to be
/// moved to as a press there moves it without Alt. With Alt, the game would take a press there for
/// a ping, which says nothing to anyone from a watcher.
pub fn render_on_screen_view(
    view: &OnScreenView,
    ctx: &Context,
    shown: bool,
    screen: Rect,
    minimap: Option<Rect>,
) -> Option<Pos2> {
    let id = Id::new("sb_on_screen_units");
    let (pick, look) = follow_pick(ctx, id.with("pick"), shown, view, screen, minimap);
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
                Pick::Dragging { dragged, adding_to } => {
                    paint_box(ui, *dragged);
                    let mut labels = box_labels(view, *dragged, screen);
                    labels.extend(group_labels(view, screen, |unit| {
                        !in_box(unit, *dragged, screen) && adding_to.binary_search(&unit.id).is_ok()
                    }));
                    labels
                }
                _ => group_labels(view, screen, |unit| pick.includes(unit, screen)),
            };
            for (label, rect) in place_labels(ui, labels, screen) {
                draw_label(ui, view, &label, rect);
            }
        },
    );
    look
}

/// Follows what the watcher picks with the primary button while the count is up (see the module's
/// own docs), taking Ctrl and Shift as they are held when the button is let go, as the game does,
/// and a double-click as a Ctrl-click, as the game does too. A box too small to be one is a click.
/// A press on the minimap picks nothing, and the place on it the pointer is at is returned for as
/// long as the button stays down. All of it is dropped with the count.
fn follow_pick(
    ctx: &Context,
    id: Id,
    shown: bool,
    view: &OnScreenView,
    screen: Rect,
    minimap: Option<Rect>,
) -> (Pick, Option<Pos2>) {
    if !shown {
        ctx.data_mut(|data| data.remove::<PickState>(id));
        return (Pick::Everything, None);
    }
    let (pressed, down, origin, latest, modifiers, double_clicked) = ctx.input(|input| {
        (
            input.pointer.primary_pressed(),
            input.pointer.primary_down(),
            input.pointer.press_origin(),
            input.pointer.latest_pos(),
            input.modifiers,
            input
                .pointer
                .button_double_clicked(egui::PointerButton::Primary),
        )
    });
    let mut state = ctx
        .data(|data| data.get_temp::<PickState>(id))
        .unwrap_or_default();
    if pressed && let Some(origin) = origin {
        if minimap.is_some_and(|minimap| minimap.contains(origin)) {
            state.steering = true;
        } else {
            state.drag = Some((origin, origin));
        }
    }
    let mut look = None;
    if state.steering {
        // Kept to the minimap, so a drag off its edge holds the view at the map's edge.
        look = minimap.zip(latest).map(|(minimap, at)| minimap.clamp(at));
        state.steering = down;
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
            let chosen: Vec<u32> = if big_enough {
                view.units
                    .iter()
                    .filter(|unit| in_box(unit, dragged, screen))
                    .map(|unit| unit.id)
                    .collect()
            } else {
                match unit_under(view, *end, screen) {
                    Some(unit) if modifiers.ctrl || double_clicked => same_kind(view, unit),
                    Some(unit) => vec![unit.id],
                    None => Vec::new(),
                }
            };
            let toggles = !big_enough;
            state.picked = repick(state.picked.take(), chosen, modifiers.shift, toggles);
            state.drag = None;
        }
    }
    let pick = match (dragging, &state.picked) {
        (Some(dragged), picked) => Pick::Dragging {
            dragged,
            adding_to: picked
                .as_ref()
                .filter(|_| modifiers.shift)
                .cloned()
                .unwrap_or_default(),
        },
        (None, Some(ids)) => Pick::Picked(ids.clone()),
        (None, None) => Pick::Everything,
    };
    ctx.data_mut(|data| data.insert_temp(id, state));
    (pick, look)
}

/// What is picked once `chosen` is: it alone, or with `adding` what was picked as well. Where
/// `toggles` and everything chosen was already picked, it is taken back out instead, as a
/// Shift-click on a unit already selected deselects it in the game. Nothing picked is `None`, which
/// counts everything in view.
fn repick(
    picked: Option<Vec<u32>>,
    mut chosen: Vec<u32>,
    adding: bool,
    toggles: bool,
) -> Option<Vec<u32>> {
    let mut ids = if adding {
        picked.unwrap_or_default()
    } else {
        Vec::new()
    };
    chosen.sort_unstable();
    let all_picked = chosen.iter().all(|id| ids.binary_search(id).is_ok());
    if adding && toggles && !chosen.is_empty() && all_picked {
        ids.retain(|id| chosen.binary_search(id).is_err());
    } else {
        ids.extend(chosen);
        ids.sort_unstable();
        ids.dedup();
    }
    (!ids.is_empty()).then_some(ids)
}

/// The unit a click at `point` lands on: of those whose body it is on or near, the one whose middle
/// it is nearest.
fn unit_under(view: &OnScreenView, point: Pos2, screen: Rect) -> Option<&OnScreenUnitView> {
    let distance = |unit: &OnScreenUnitView| on_screen(unit.position, screen).distance(point);
    view.units
        .iter()
        .filter(|unit| {
            body_on_screen(unit, screen)
                .expand(CLICK_SLOP)
                .contains(point)
        })
        .min_by(|a, b| distance(a).total_cmp(&distance(b)))
}

/// Every unit in view that `unit`'s owner has of its kind, or just `unit` where it is not a kind
/// that is counted.
fn same_kind(view: &OnScreenView, unit: &OnScreenUnitView) -> Vec<u32> {
    if unit.kind.is_none() {
        return vec![unit.id];
    }
    view.units
        .iter()
        .filter(|other| other.player == unit.player && other.kind == unit.kind)
        .map(|other| other.id)
        .collect()
}

/// Where a point given in shares of the game view is on the screen.
fn on_screen(share: Pos2, screen: Rect) -> Pos2 {
    screen.min + share.to_vec2() * screen.size()
}

/// The box `unit`'s body fills on the screen.
fn body_on_screen(unit: &OnScreenUnitView, screen: Rect) -> Rect {
    Rect::from_min_max(
        on_screen(unit.bounds.min, screen),
        on_screen(unit.bounds.max, screen),
    )
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
            let inside = view
                .units
                .iter()
                .filter(|unit| unit.player == index && in_box(unit, dragged, screen));
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
    let body = body_on_screen(unit, screen);
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

    /// A counted unit of `player`'s of `kind` standing at `x`, `y` in shares of the view.
    fn unit_of(id: u32, player: usize, kind: usize, x: f32, y: f32) -> OnScreenUnitView {
        OnScreenUnitView {
            player,
            kind: Some(kind),
            ..unit_at(id, x, y)
        }
    }

    /// What [`follow_pick`] makes of one frame of `events`, with the count up while `shown`.
    fn pick_frame(
        ctx: &Context,
        view: &OnScreenView,
        shown: bool,
        events: Vec<egui::Event>,
    ) -> Pick {
        pick_frame_with(ctx, view, shown, egui::Modifiers::NONE, events)
    }

    /// [`pick_frame`] with `modifiers` held.
    fn pick_frame_with(
        ctx: &Context,
        view: &OnScreenView,
        shown: bool,
        modifiers: egui::Modifiers,
        events: Vec<egui::Event>,
    ) -> Pick {
        let input = FrameInput {
            shown,
            modifiers,
            ..FrameInput::default()
        };
        frame(ctx, view, input, events).0
    }

    /// What one frame of the count is given besides its events.
    struct FrameInput {
        shown: bool,
        modifiers: egui::Modifiers,
        minimap: Option<Rect>,
        /// How long after the frame before it this one comes, which is long enough by default for
        /// no two clicks to be taken for a double-click.
        seconds: f64,
    }

    impl Default for FrameInput {
        fn default() -> FrameInput {
            FrameInput {
                shown: true,
                modifiers: egui::Modifiers::NONE,
                minimap: None,
                seconds: 0.5,
            }
        }
    }

    /// What [`follow_pick`] makes of one frame of `events`.
    fn frame(
        ctx: &Context,
        view: &OnScreenView,
        input: FrameInput,
        mut events: Vec<egui::Event>,
    ) -> (Pick, Option<Pos2>) {
        let screen = Rect::from_min_size(Pos2::ZERO, vec2(1000.0, 1000.0));
        let mut result = (Pick::Everything, None);
        // As the host reports them, after the frame's other events.
        events.push(egui::Event::ModifiersChanged(input.modifiers));
        let time = ctx.input(|state| state.time) + input.seconds;
        let mut out = ctx.run_ui(
            egui::RawInput {
                screen_rect: Some(screen),
                time: Some(time),
                events,
                ..Default::default()
            },
            |_| {
                result = follow_pick(
                    ctx,
                    Id::new("pick"),
                    input.shown,
                    view,
                    screen,
                    input.minimap,
                )
            },
        );
        out.textures_delta.clear();
        result
    }

    /// What is picked after a click at `x`, `y` in shares of the view with `modifiers` held.
    fn click(
        ctx: &Context,
        view: &OnScreenView,
        modifiers: egui::Modifiers,
        x: f32,
        y: f32,
    ) -> Pick {
        let at = pos2(x * 1000.0, y * 1000.0);
        pick_frame_with(
            ctx,
            view,
            true,
            modifiers,
            vec![egui::Event::PointerMoved(at)],
        );
        pick_frame_with(ctx, view, true, modifiers, vec![button(at, true)]);
        pick_frame_with(ctx, view, true, modifiers, vec![button(at, false)])
    }

    /// What is picked after a box is dragged from `from` to `to` with `modifiers` held.
    fn drag(
        ctx: &Context,
        view: &OnScreenView,
        modifiers: egui::Modifiers,
        from: Pos2,
        to: Pos2,
    ) -> Pick {
        pick_frame_with(
            ctx,
            view,
            true,
            modifiers,
            vec![egui::Event::PointerMoved(from)],
        );
        pick_frame_with(ctx, view, true, modifiers, vec![button(from, true)]);
        pick_frame_with(
            ctx,
            view,
            true,
            modifiers,
            vec![egui::Event::PointerMoved(to)],
        );
        pick_frame_with(ctx, view, true, modifiers, vec![button(to, false)])
    }

    fn picked(pick: &Pick) -> &[u32] {
        match pick {
            Pick::Picked(ids) => ids,
            _ => &[],
        }
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
        assert!(matches!(
            dragging,
            Pick::Dragging { dragged, .. } if dragged == Rect::from_two_pos(start, end)
        ));
        let picked = pick_frame(&ctx, &view, true, vec![button(end, false)]);
        assert!(matches!(&picked, Pick::Picked(ids) if ids == &[7]));
        let later = pick_frame(&ctx, &view, true, vec![]);
        assert!(matches!(&later, Pick::Picked(ids) if ids == &[7]));
        // A click on nothing is the way back to everything.
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

    #[test]
    fn shift_adds_boxes_and_clicks_to_what_is_picked_and_clicks_take_it_back_out() {
        let ctx = Context::default();
        let view = OnScreenView {
            units: vec![
                unit_at(1, 0.1, 0.1),
                unit_at(2, 0.5, 0.5),
                unit_at(3, 0.9, 0.9),
            ],
            ..Default::default()
        };
        let none = egui::Modifiers::NONE;
        let shift = egui::Modifiers::SHIFT;
        assert_eq!(picked(&click(&ctx, &view, none, 0.1, 0.1)), [1]);
        assert_eq!(picked(&click(&ctx, &view, shift, 0.5, 0.5)), [1, 2]);
        let boxed = drag(&ctx, &view, shift, pos2(850.0, 850.0), pos2(950.0, 950.0));
        assert_eq!(picked(&boxed), [1, 2, 3]);
        // A box only ever adds, even over units already picked.
        let boxed = drag(&ctx, &view, shift, pos2(450.0, 450.0), pos2(950.0, 950.0));
        assert_eq!(picked(&boxed), [1, 2, 3]);
        assert_eq!(picked(&click(&ctx, &view, shift, 0.5, 0.5)), [1, 3]);
        // Shift-clicking nothing changes nothing, where a plain click there drops the pick.
        assert_eq!(picked(&click(&ctx, &view, shift, 0.3, 0.7)), [1, 3]);
        // A plain click picks the one unit afresh.
        assert_eq!(picked(&click(&ctx, &view, none, 0.5, 0.5)), [2]);
        // Taking the last one out leaves nothing picked, which is everything again.
        assert!(matches!(
            click(&ctx, &view, shift, 0.5, 0.5),
            Pick::Everything
        ));
    }

    #[test]
    fn while_shift_is_held_a_box_being_dragged_still_counts_what_was_picked() {
        let ctx = Context::default();
        let view = OnScreenView {
            units: vec![unit_at(1, 0.1, 0.1), unit_at(2, 0.5, 0.5)],
            ..Default::default()
        };
        click(&ctx, &view, egui::Modifiers::NONE, 0.1, 0.1);
        let shift = egui::Modifiers::SHIFT;
        let from = pos2(450.0, 450.0);
        pick_frame_with(
            &ctx,
            &view,
            true,
            shift,
            vec![egui::Event::PointerMoved(from)],
        );
        pick_frame_with(&ctx, &view, true, shift, vec![button(from, true)]);
        let to = egui::Event::PointerMoved(pos2(550.0, 550.0));
        let dragging = pick_frame_with(&ctx, &view, true, shift, vec![to]);
        let screen = Rect::from_min_size(Pos2::ZERO, vec2(1000.0, 1000.0));
        assert!(dragging.includes(&view.units[0], screen));
        assert!(dragging.includes(&view.units[1], screen));
    }

    #[test]
    fn ctrl_clicking_picks_the_owners_whole_kind_in_view() {
        let ctx = Context::default();
        let view = OnScreenView {
            units: vec![
                unit_of(1, 0, 0, 0.1, 0.1),
                unit_of(2, 0, 0, 0.2, 0.2),
                unit_of(3, 0, 1, 0.3, 0.3),
                unit_of(4, 1, 0, 0.6, 0.6),
                unit_of(5, 1, 0, 0.7, 0.7),
            ],
            ..Default::default()
        };
        let ctrl = egui::Modifiers::CTRL;
        let both = egui::Modifiers::CTRL | egui::Modifiers::SHIFT;
        assert_eq!(picked(&click(&ctx, &view, ctrl, 0.1, 0.1)), [1, 2]);
        assert_eq!(picked(&click(&ctx, &view, both, 0.7, 0.7)), [1, 2, 4, 5]);
        // Without Shift it starts over.
        assert_eq!(picked(&click(&ctx, &view, ctrl, 0.6, 0.6)), [4, 5]);
        // And with it, on a kind already picked, takes that kind back out.
        click(&ctx, &view, both, 0.3, 0.3);
        assert_eq!(picked(&click(&ctx, &view, both, 0.6, 0.6)), [3]);
    }

    #[test]
    fn a_double_click_picks_as_a_ctrl_click_does() {
        let ctx = Context::default();
        let view = OnScreenView {
            units: vec![
                unit_of(1, 0, 0, 0.1, 0.1),
                unit_of(2, 0, 0, 0.2, 0.2),
                unit_of(3, 1, 0, 0.6, 0.6),
            ],
            ..Default::default()
        };
        let at = pos2(100.0, 100.0);
        let quick = || FrameInput {
            seconds: 0.05,
            ..FrameInput::default()
        };
        frame(&ctx, &view, quick(), vec![egui::Event::PointerMoved(at)]);
        frame(&ctx, &view, quick(), vec![button(at, true)]);
        let (once, _) = frame(&ctx, &view, quick(), vec![button(at, false)]);
        assert_eq!(picked(&once), [1]);
        frame(&ctx, &view, quick(), vec![button(at, true)]);
        let (twice, _) = frame(&ctx, &view, quick(), vec![button(at, false)]);
        assert_eq!(picked(&twice), [1, 2]);
    }

    #[test]
    fn a_press_on_the_minimap_looks_where_it_is_held_and_picks_nothing() {
        let ctx = Context::default();
        let view = OnScreenView {
            units: vec![unit_at(1, 0.05, 0.85)],
            ..Default::default()
        };
        let minimap = Rect::from_min_size(pos2(0.0, 800.0), vec2(200.0, 200.0));
        let on_minimap = || FrameInput {
            minimap: Some(minimap),
            ..FrameInput::default()
        };
        let at = pos2(50.0, 850.0);
        frame(
            &ctx,
            &view,
            on_minimap(),
            vec![egui::Event::PointerMoved(at)],
        );
        let (_, pressed) = frame(&ctx, &view, on_minimap(), vec![button(at, true)]);
        assert_eq!(pressed, Some(at));
        // Dragged off the minimap's edge, the look stays on its edge.
        let off = vec![egui::Event::PointerMoved(pos2(400.0, 900.0))];
        let (dragging, held) = frame(&ctx, &view, on_minimap(), off);
        assert!(matches!(dragging, Pick::Everything));
        assert_eq!(held, Some(pos2(200.0, 900.0)));
        let let_go = vec![button(pos2(400.0, 900.0), false)];
        let (released, _) = frame(&ctx, &view, on_minimap(), let_go);
        assert!(matches!(released, Pick::Everything));
        let (after, look) = frame(&ctx, &view, on_minimap(), vec![]);
        assert!(matches!(after, Pick::Everything));
        assert_eq!(look, None);
    }

    #[test]
    fn a_click_lands_on_the_unit_whose_middle_is_nearest() {
        let screen = Rect::from_min_size(Pos2::ZERO, vec2(1000.0, 1000.0));
        let mut big = unit_at(1, 0.5, 0.5);
        big.bounds = Rect::from_center_size(big.position, vec2(0.1, 0.1));
        let view = OnScreenView {
            units: vec![big, unit_at(2, 0.52, 0.52)],
            ..Default::default()
        };
        let under = |x, y| unit_under(&view, pos2(x, y), screen).map(|unit| unit.id);
        assert_eq!(under(518.0, 518.0), Some(2));
        assert_eq!(under(505.0, 505.0), Some(1));
        // A small unit is still hit a little outside its body.
        assert_eq!(under(527.0, 520.0), Some(2));
        assert_eq!(under(700.0, 700.0), None);
    }
}
