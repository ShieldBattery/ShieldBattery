//! The on-screen count: what each player has in the part of the map the watcher is looking at,
//! shown for as long as Alt is held.
//!
//! A fight on screen is read as who has what there, and the stats wings only answer that for the
//! whole map. This answers it on the map itself. Every unit in view, short of buildings, gets a
//! health bar, which is the host's to draw among the units (the count only says which units get
//! one), and every group of a player's units gets a label hung just above it: their name on a thin band of their own color over a tile
//! for every kind of unit in the group with how many of it, in the order the host ranks the kinds.
//! A label goes where its units are, so it needs no room of its own on the screen; where two would
//! cover each other, the later one moves up out of the way, and one that would stand under a panel
//! steps out from under it where it can. Every count is set on a dark badge hanging off its tile's
//! corner, the largest thing on the label, so it reads on a small stream. A label covers no more of
//! the map than its band and tiles do, each edged with a dark line that sets it apart from units of
//! its player's color. All of it is drawn under the panels and dialogs.
//!
//! Units are picked with the mouse much as the game selects them, and once picked they are the only
//! ones counted and given bars, labelled where they go, until Alt is let go. Dragging a box picks
//! the units inside it, and while the box is being dragged it is drawn, with a label per player hung
//! over it counting what it covers. Clicking a unit picks it, and with Ctrl, every unit its owner has
//! of its kind in view. With Shift, what is picked is added to what already was, and a click on what
//! already was takes it back out. A click on nothing goes back to everything in view.
//!
//! What makes a group is how near its units stand on the map, so a group is the same units in a
//! window of any size, but never nearer on the screen than two labels need to stand apart: zoomed
//! out, groups apart on the map come close together on the screen and share a label (see
//! [`grouping`]). The workers gathering at a base are one group of their own, apart from an army
//! standing among them and labelled over the base's town hall, where the label stays put as they
//! go back and forth. Workers putting up buildings make groups of their own too.
//!
//! A group's label keeps its place on the map while its units mill about under it, as workers
//! mining do, and is only moved once the group has got out from under it, and then no further than
//! it takes to be over the group again (see [`hold`]): a group on the march draws its label along
//! at its own pace. A label that does have to move covers the distance quickly and stops (see
//! [`settle`]). While it moves, it is drawn where it is rather than on the nearest whole pixels,
//! which would step it along out of time with the units it follows.
//!
//! Pointing at a group's label shows which units it counts: a veil darkens the game view but for
//! a spot of light left on each of them (see [`veil_mesh`]), and their ids are handed to the host
//! to light the units themselves up where it can.

mod grouping;

use std::collections::HashMap;

use egui::emath::GuiRounding;
use egui::{
    Align, Area, Color32, Context, Id, Mesh, Order, Pos2, Rect, Sense, Shape, Stroke, StrokeKind,
    Ui, Vec2, pos2, vec2,
};

use crate::kit::motion;
use crate::kit::off_grid::paint_off_grid;
use crate::kit::text;
use crate::kit::theme;
use crate::observer::{
    ProductionIcon, owner_tint, paint_icon_glow, paint_owner_wash, paint_text, paint_tile_chrome,
    unit_codes, vision_alpha,
};

// A label's sizes, in points on a screen 1080 lines tall, which the overlay scales a point to keep
// to. They are set for a watcher of a stream 720 lines tall, where a point is two thirds of a
// pixel, to still read the counts through its encoding.

/// Height of the band a group's owner is named on.
const NAME_BAND_HEIGHT: f32 = 19.0;

/// Text size of the owner's name on the band.
const NAME_SIZE: f32 = 15.0;

/// How far the band's text is set in from either end of it.
const NAME_INSET: f32 = 6.0;

/// Gap between the band and the tiles under it.
const BAND_GAP: f32 = 2.0;

/// A unit kind's tile, and the gap between two of them, across a line and down to the next.
const TILE_WIDTH: f32 = 40.0;
const TILE_HEIGHT: f32 = 33.0;
const TILE_GAP: f32 = 4.0;

/// How many tiles a line holds before the next kind wraps onto a line of its own.
const TILES_PER_LINE: usize = 6;

/// Text size of the code a tile names its kind with where the host has no icon atlas.
const TILE_TEXT_SIZE: f32 = 12.0;

/// The badge a tile's count is set on: its height, its text size, how far its text is set in from
/// its ends, and how far it hangs below the tile, whose bottom right corner it sits over. Hung off
/// the tile so it covers less of the icon and reads as its own mark rather than as part of it.
const BADGE_HEIGHT: f32 = 18.0;
const BADGE_TEXT_SIZE: f32 = 17.0;
const BADGE_INSET: f32 = 4.0;
const BADGE_OVERHANG: f32 = 6.0;

/// How much bigger a label hung over a dragged box is than a group's: the watcher dragged it to read
/// it, and there is only ever one of it for each player.
const BOX_LABEL_SCALE: f32 = 1.3;

/// How dark the line around a label's band and each of its tiles is: what sets the label apart from
/// the units it stands over, which may be its own player's color.
const EDGE_ALPHA: f32 = 0.85;

/// How far above the top of a group's units its label's bottom edge sits.
const LIFT: f32 = 8.0;

/// Room kept between a label and the screen's edges, and between two labels or a label and a
/// panel.
const EDGE_MARGIN: f32 = 4.0;
const LABEL_GAP: f32 = 8.0;

/// How much of a player's color the band behind their name is, and how dark the base under it is,
/// so the name reads the same on any color and over any terrain.
const BAND_COLOR_ALPHA: f32 = 0.6;
const BAND_BASE_ALPHA: f32 = 0.7;

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
    /// health bar but is not counted (a larva or an egg).
    pub kind: Option<usize>,
    /// The work it is at, for a worker at work, which is grouped with the others at that work and
    /// never with an army standing among them. `None` for anything else, a worker pulled to fight
    /// included.
    pub job: Option<WorkerJob>,
    /// The orders it is on, as a number that is the same for two units on the same orders: told to
    /// go to the same place, or to do the same thing to the same target. Units sent somewhere
    /// together are grouped from further apart than others are. `None` for a unit with nothing
    /// to do.
    pub orders: Option<u64>,
    /// Where it stands, in shares of the game view (0 to 1 across and down it).
    pub position: Pos2,
    /// The box its body fills, in the same shares, which is what a click on it lands in. Nothing
    /// ([`Rect::NOTHING`]) for a unit that is counted but not on the map to be clicked, a worker
    /// inside a refinery.
    pub bounds: Rect,
    /// How far down the game view the top of what is drawn of it is, in the same shares: higher
    /// than the top of its body for most units, whose art stands taller than the box they take up
    /// on the ground. A label is hung clear of it.
    pub top: f32,
}

/// A base with workers of its own.
pub struct OnScreenBaseView {
    /// The middle of the top of what is drawn of its town hall, in shares of the game view, which
    /// is outside 0 to 1 for a town hall out of view. The label of the base's workers hangs over
    /// it: the one thing at a base that stays where it is while they go back and
    /// forth.
    pub top: Pos2,
}

/// The work a worker is at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkerJob {
    /// One of a base's own workers, gathering minerals or gas there or standing idle there. The
    /// base is the one at this index of [`OnScreenView::bases`].
    AtBase { base: usize },
    /// On its way to put up a building, or putting one up.
    Building,
}

/// Everything the on-screen count draws from.
#[derive(Default)]
pub struct OnScreenView {
    pub players: Vec<OnScreenPlayerView>,
    /// The icon of every kind of unit counted, in the order their tiles are drawn.
    pub kinds: Vec<ProductionIcon>,
    pub units: Vec<OnScreenUnitView>,
    /// The bases that have workers of their own.
    pub bases: Vec<OnScreenBaseView>,
    /// The part of the map the game view shows, in the map's pixels, which is what tells how far
    /// apart units stand on the map, and where on it a label stands as the view moves. `None` where
    /// it is not known.
    pub map_view: Option<Rect>,
    /// How the labels keep their places and move between them.
    pub tuning: CountTuning,
}

/// What of the count can be tuned: how its groups are made, and how a group's label keeps its
/// place and moves to a new one. Lengths are in the map's pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CountTuning {
    /// How far the middle of a group's top can get from where its label hangs before the label
    /// follows, as a share of half the group's width across and half its height down. A group
    /// spread wide can shift further under its label than a tight one before the label is off it.
    pub slack_share: f32,
    /// How far it can get whatever the group's size, added to the share.
    pub slack_least: f32,
    /// How long, in seconds, a label takes to cover most of the way to a new place.
    pub settle_secs: f32,
    /// The slowest a label moves to a new place, in pixels a second, so that it gets there and
    /// stops rather than creeping up on it.
    pub least_speed: f32,
    /// How long, in seconds, units have to have stood apart from their group, or with another,
    /// before they are counted that way: what keeps units that drift apart and close up again as
    /// they move from being split and joined, and their labels moved, each time.
    pub regroup_secs: f32,
    /// How far apart two units on the same orders can stand and still be together, which is
    /// further than units are otherwise (see [`grouping`]).
    pub same_orders_reach: f32,
    /// How dark the veil over the game view is while a group's label is pointed at, from 0, no
    /// veil at all, to 1, black.
    pub veil: f32,
    /// How far past a unit of the group pointed at the spot of light on it reaches before the veil
    /// starts to come back, and how far it takes to come back in full.
    pub spot_margin: f32,
    pub spot_fade: f32,
}

impl CountTuning {
    pub const DEFAULT: CountTuning = CountTuning {
        slack_share: 0.75,
        slack_least: 12.0,
        settle_secs: 0.03,
        least_speed: 192.0,
        regroup_secs: 1.0,
        same_orders_reach: 220.0,
        veil: 0.56,
        spot_margin: 12.0,
        spot_fade: 28.0,
    };
}

impl Default for CountTuning {
    fn default() -> CountTuning {
        CountTuning::DEFAULT
    }
}

/// One label to draw: whose units it counts, how many of each kind (in drawing order), the point
/// on the screen it is hung over, how much bigger than a group's it is, and the group it labels, if
/// it labels one.
struct Label<'a> {
    player: &'a OnScreenPlayerView,
    /// Which of the view's players that is.
    owner: usize,
    kinds: Vec<(ProductionIcon, u32)>,
    /// The middle of the top of what it labels, until [`hold`] makes it where the label hangs.
    anchor: Pos2,
    /// How far across and down `anchor` can be from where the label hung the frame before without
    /// the label being moved, in points.
    slack: Vec2,
    scale: f32,
    /// The group's key, which is its for as long as it lasts. `None` for a dragged box's label.
    key: Option<u32>,
    /// The key of the group most of its units were in the frame before, whose label this one
    /// carries on from. Not `key` for a group new this frame, whose units left another's.
    was: Option<u32>,
}

/// What the count keeps of the frame before, while it is drawn: the groups, each one's label by
/// the group's key, and the labels on their way out.
#[derive(Clone, Default)]
struct Memory {
    groups: grouping::Groups,
    labels: HashMap<u32, Kept>,
    leaving: Vec<Leaving>,
    /// How far in the veil is, from 0 to 1, and the units it leaves lit, by id, sorted: those of
    /// the group last pointed at, kept while the veil goes so that it goes as it stood.
    veil: f32,
    lit: Vec<u32>,
}

/// How long, in seconds, the veil takes to cover most of the way in or out.
const VEIL_SECS: f32 = 0.04;

/// How big the squares the veil is made of are, in points. Its darkness is set at their corners
/// and runs evenly between, so they are small beside the fade at the edge of a spot of light.
const VEIL_CELL: f32 = 12.0;

/// A place the veil leaves lit: a circle on the screen, and how far past its edge the veil takes
/// to come back in full.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Spot {
    center: Pos2,
    radius: f32,
    fade: f32,
}

/// A group's label as it was the frame before: where it was, and what was on it, which is what is
/// drawn of it once its group has joined another (see [`Leaving`]).
#[derive(Clone, Debug, Default, PartialEq)]
struct Kept {
    /// The point on the map it hung over.
    hung: Pos2,
    /// Where on the map the middle of its bottom edge was drawn, which is still on its way to
    /// where the label was placed while the label is moving.
    at: Pos2,
    /// Where on the screen that was.
    drawn: Pos2,
    /// Whose it was, as an index into the view's players, what it counted, and its size.
    owner: usize,
    kinds: Vec<(ProductionIcon, u32)>,
    size: Vec2,
}

/// The label of a group that has joined another, on its way into the label of the group it joined:
/// drawn fading as it goes, so that two counts are seen to become one rather than one of them
/// going out.
#[derive(Clone, Debug, PartialEq)]
struct Leaving {
    owner: usize,
    kinds: Vec<(ProductionIcon, u32)>,
    size: Vec2,
    /// Where on the map the middle of its bottom edge is.
    at: Pos2,
    /// The key of the group its own joined.
    into: u32,
    /// How long, in seconds, it has been going.
    gone: f32,
}

/// How long, in seconds, a label takes to go once its group has joined another.
const LEAVE_SECS: f32 = 0.2;

/// The screen's points on the map and the map's pixels on the screen, for what is kept from frame
/// to frame to be kept on the map, where it stays put as the view pans. Without the part of the map
/// the view shows, the screen stands in for the map, a point to a pixel.
#[derive(Clone, Copy)]
struct OnMap {
    map_view: Option<Rect>,
    screen: Rect,
}

impl OnMap {
    fn new(map_view: Option<Rect>, screen: Rect) -> OnMap {
        OnMap {
            map_view: map_view.filter(|map_view| map_view.width() > 0.0 && map_view.height() > 0.0),
            screen,
        }
    }

    /// Where on the map a point of the screen is.
    fn map_point(self, point: Pos2) -> Pos2 {
        match self.map_view {
            Some(map_view) => {
                map_view.min + (point - self.screen.min) / self.screen.size() * map_view.size()
            }
            None => point,
        }
    }

    /// Where on the screen a point of the map is.
    fn screen_point(self, point: Pos2) -> Pos2 {
        match self.map_view {
            Some(map_view) => {
                self.screen.min + (point - map_view.min) / map_view.size() * self.screen.size()
            }
            None => point,
        }
    }

    /// How many points across and down the screen one of the map's pixels takes up.
    fn points_per_pixel(self) -> Vec2 {
        self.map_view.map_or(Vec2::splat(1.0), |map_view| {
            self.screen.size() / map_view.size()
        })
    }
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
/// the count is up, and, of what was picked, while it fades out after.
#[derive(Clone, Default)]
struct PickState {
    drag: Option<(Pos2, Pos2)>,
    picked: Option<Vec<u32>>,
    steering: bool,
    /// Whether the count has gone since this was picked, which leaves it to be forgotten when the
    /// count next comes up.
    gone: bool,
}

/// What a frame of the on-screen count asks of the host.
#[derive(Default)]
pub struct OnScreenOutcome {
    /// Where on the minimap the watcher is pressing this frame, for the game's view to be moved to
    /// as a press there moves it without Alt. With Alt, the game would take a press there for a
    /// ping, which says nothing to anyone from a watcher.
    pub look: Option<Pos2>,
    /// The units to draw a health bar under, by id, sorted: every unit in view while the count
    /// is up, or the ones picked. Drawn by the host, in among the units as the game draws a
    /// selected unit's, where a bar drawn here would lie over whatever stands in front of it.
    pub health_bars: Vec<u32>,
    /// The units of the group whose label the pointer is over, by id, sorted, for the host to
    /// light up on the map: which units a label is counting is not always plain from where it
    /// hangs. None while the pointer is over no label.
    pub highlighted: Vec<u32>,
}

/// Draws the labels, fading them in and out together, and says which units get health bars.
/// `screen` is the rect the game view fills, `panels` the rects of the overlay's panels, and
/// `minimap` the minimap's square where it is up.
///
/// Drawn under every panel and dialog, which cover what they stand over of the map anyway, with
/// each label moved out from under the panels where it can be.
pub fn render_on_screen_view(
    view: &OnScreenView,
    ctx: &Context,
    shown: bool,
    screen: Rect,
    panels: &[Rect],
    minimap: Option<Rect>,
) -> OnScreenOutcome {
    let id = Id::new("sb_on_screen_units");
    let (pick, look) = follow_pick(ctx, id.with("pick"), shown, view, screen, panels, minimap);
    let health_bars = if shown {
        health_bars(view, &pick, screen)
    } else {
        Vec::new()
    };
    let memory_id = id.with("memory");
    let area = Area::new(id)
        .fixed_pos(screen.min)
        .order(Order::Background)
        .interactable(false);
    let mut drawn = false;
    let mut highlighted = Vec::new();
    // Pinned to the units they count, so they fade in and out where they stand rather than
    // sliding, and quickly: the count is up for as long as a key is held and no longer.
    motion::presence_area_quick(
        ctx,
        id.with("presence"),
        shown && !view.units.is_empty(),
        area,
        |ui| {
            drawn = true;
            ui.set_clip_rect(screen);
            ui.allocate_exact_size(screen.size(), Sense::hover());
            let before = ui
                .ctx()
                .data(|data| data.get_temp::<Memory>(memory_id))
                .unwrap_or_default();
            let on_map = OnMap::new(view.map_view, screen);
            let seconds = ui.input(|input| input.stable_dt);
            let (mut labels, groups) = match &pick {
                Pick::Dragging { dragged, adding_to } => {
                    paint_box(ui, *dragged);
                    let mut labels = box_labels(view, *dragged, screen);
                    let (grouped, groups) =
                        group_labels(view, on_map, &before.groups, seconds, |unit| {
                            !in_box(unit, *dragged, screen)
                                && adding_to.binary_search(&unit.id).is_ok()
                        });
                    labels.extend(grouped);
                    (labels, groups)
                }
                _ => group_labels(view, on_map, &before.groups, seconds, |unit| {
                    pick.includes(unit, screen)
                }),
            };
            hold(&mut labels, &before.labels, on_map);
            // The minimap is the game's own, and no panel of the overlay's covers it.
            let panels: Vec<Rect> = panels.iter().copied().chain(minimap).collect();
            let placed = place_labels(ui, labels, screen, &panels);
            let (placed, labels) = settle(placed, &before.labels, on_map, view.tuning, seconds);
            let leaving = leaving_labels(&before, &groups, &labels, view.tuning, seconds);
            // Nothing is pointed at while a box is being dragged, or once the count is going.
            let pointing = shown && !matches!(pick, Pick::Dragging { .. });
            let pointer = ui
                .input(|input| input.pointer.hover_pos())
                .filter(|_| pointing);
            let hovered = pointer.and_then(|pointer| label_under(&placed, &panels, pointer));
            if let Some(key) = hovered {
                highlighted = groups
                    .group_of
                    .iter()
                    .filter(|&(_, group)| *group == key)
                    .map(|(unit, _)| *unit)
                    .collect();
                highlighted.sort_unstable();
            }
            // The veil comes and goes quickly rather than at once, and goes with the spots it had.
            let veil = {
                let target = if hovered.is_some() { 1.0 } else { 0.0 };
                let now =
                    before.veil + (target - before.veil) * (1.0 - (-seconds / VEIL_SECS).exp());
                if (target - now).abs() < 0.02 {
                    target
                } else {
                    ui.ctx().request_repaint();
                    now
                }
            };
            let lit = match hovered {
                Some(_) => highlighted.clone(),
                None if veil > 0.0 => before.lit.clone(),
                None => Vec::new(),
            };
            let darkness = view.tuning.veil * veil;
            if darkness > 0.0 {
                let spots = lit_spots(view, &lit, on_map);
                ui.painter()
                    .add(Shape::mesh(veil_mesh(screen, &spots, darkness)));
            }
            let pixels_per_point = ui.ctx().pixels_per_point();
            let paint = |ui: &Ui, label: &Label, rect: Rect, moving: bool| {
                // Laid out on whole pixels, as it is drawn when it stands still.
                let still =
                    Rect::from_min_size(rect.min.round_to_pixels(pixels_per_point), rect.size());
                let hovered = label.key.is_some() && label.key == hovered;
                if moving {
                    paint_off_grid(ui, rect.min - still.min, || {
                        draw_label(ui, label, still, hovered)
                    });
                } else {
                    draw_label(ui, label, still, hovered);
                }
            };
            // Under the labels that are staying, each fading into the one it is joining.
            for label in &leaving {
                let Some(player) = view.players.get(label.owner) else {
                    continue;
                };
                let going = Label {
                    player,
                    owner: label.owner,
                    kinds: label.kinds.clone(),
                    anchor: Pos2::ZERO,
                    slack: Vec2::ZERO,
                    scale: 1.0,
                    key: None,
                    was: None,
                };
                let bottom = on_map.screen_point(label.at);
                let rect = Rect::from_min_size(
                    bottom - vec2(label.size.x / 2.0, label.size.y),
                    label.size,
                );
                ui.scope(|ui| {
                    let left = 1.0 - label.gone / LEAVE_SECS;
                    ui.multiply_opacity(left * left);
                    paint(ui, &going, rect, true);
                });
            }
            for Settled {
                label,
                rect,
                moving,
            } in &placed
            {
                paint(ui, label, *rect, *moving);
            }
            ui.ctx().data_mut(|data| {
                data.insert_temp(
                    memory_id,
                    Memory {
                        groups,
                        labels,
                        leaving,
                        veil,
                        lit,
                    },
                )
            });
        },
    );
    // Kept until the last of the count has faded, so that it fades as it stood.
    if !drawn {
        ctx.data_mut(|data| {
            data.remove::<Memory>(memory_id);
            if !shown {
                data.remove::<PickState>(id.with("pick"));
            }
        });
    }
    OnScreenOutcome {
        look,
        health_bars,
        highlighted,
    }
}

/// The spots of light the veil leaves on the units `lit` (by id, sorted): a circle around what is
/// drawn of each, with the margin and fade the view's tuning gives. A unit that is not on the map
/// to be seen, a worker inside a refinery, has none.
fn lit_spots(view: &OnScreenView, lit: &[u32], on_map: OnMap) -> Vec<Spot> {
    let screen = on_map.screen;
    let scale = on_map.points_per_pixel().x;
    view.units
        .iter()
        .filter(|unit| unit.bounds.is_finite() && lit.binary_search(&unit.id).is_ok())
        .map(|unit| {
            let body = body_on_screen(unit, screen);
            let top = on_screen(pos2(unit.position.x, unit.top), screen).y;
            let drawn = Rect::from_min_max(pos2(body.left(), top.min(body.top())), body.max);
            Spot {
                center: drawn.center(),
                radius: drawn.width().max(drawn.height()) / 2.0 + view.tuning.spot_margin * scale,
                fade: view.tuning.spot_fade * scale,
            }
        })
        .collect()
}

/// The veil over `screen`: black at `darkness` (0 to 1) everywhere but in `spots`, where there is
/// none of it, and coming back in full over each spot's fade past its edge.
///
/// A veil over the whole view rather than a darkening of the things in it, so that everything
/// that is not being pointed out goes back together: the ground and the water with the units on
/// them, under any graphics setting, since it is drawn over what the game has drawn.
fn veil_mesh(screen: Rect, spots: &[Spot], darkness: f32) -> Mesh {
    let columns = (screen.width() / VEIL_CELL).ceil().max(1.0) as usize;
    let rows = (screen.height() / VEIL_CELL).ceil().max(1.0) as usize;
    let step = vec2(
        screen.width() / columns as f32,
        screen.height() / rows as f32,
    );
    let across = columns + 1;
    let corner =
        |column: usize, row: usize| screen.min + vec2(column as f32 * step.x, row as f32 * step.y);
    // How much light each corner of the squares is in, from 0 to 1.
    let mut light = vec![0.0f32; across * (rows + 1)];
    for spot in spots {
        let reach = spot.radius + spot.fade;
        let cells = |from: f32, step: f32, most: usize| {
            let first = ((from - reach) / step).floor().clamp(0.0, most as f32) as usize;
            let last = ((from + reach) / step).ceil().clamp(0.0, most as f32) as usize;
            first..=last
        };
        for row in cells(spot.center.y - screen.top(), step.y, rows) {
            for column in cells(spot.center.x - screen.left(), step.x, columns) {
                let past = corner(column, row).distance(spot.center) - spot.radius;
                let back = (past / spot.fade.max(f32::EPSILON)).clamp(0.0, 1.0);
                // Eased at both ends, so a spot has no edge to it.
                let lit = 1.0 - back * back * (3.0 - 2.0 * back);
                let at = &mut light[row * across + column];
                *at = at.max(lit);
            }
        }
    }
    let mut mesh = Mesh::default();
    mesh.reserve_vertices(light.len());
    mesh.reserve_triangles(columns * rows * 2);
    for row in 0..=rows {
        for column in 0..=columns {
            let dark = darkness.clamp(0.0, 1.0) * (1.0 - light[row * across + column]);
            mesh.colored_vertex(
                corner(column, row),
                Color32::from_black_alpha((dark * 255.0).round() as u8),
            );
        }
    }
    for row in 0..rows {
        for column in 0..columns {
            let first = (row * across + column) as u32;
            let below = first + across as u32;
            mesh.add_triangle(first, first + 1, below);
            mesh.add_triangle(first + 1, below + 1, below);
        }
    }
    mesh
}

/// The key of the group whose label `pointer` is over: the last drawn of those it is over, which
/// is the one on top. None where one of `panels` covers the label there.
fn label_under(placed: &[Settled], panels: &[Rect], pointer: Pos2) -> Option<u32> {
    if panels.iter().any(|panel| panel.contains(pointer)) {
        return None;
    }
    placed
        .iter()
        .rev()
        .find(|settled| settled.label.key.is_some() && settled.rect.contains(pointer))
        .and_then(|settled| settled.label.key)
}

/// The units `pick` gives health bars, by id, sorted.
fn health_bars(view: &OnScreenView, pick: &Pick, screen: Rect) -> Vec<u32> {
    let mut ids: Vec<u32> = view
        .units
        .iter()
        .filter(|unit| pick.includes(unit, screen))
        .map(|unit| unit.id)
        .collect();
    ids.sort_unstable();
    ids
}

/// Follows what the watcher picks with the primary button while the count is up (see the module's
/// own docs), taking Ctrl and Shift as they are held when the button is let go, as the game does,
/// and a double-click as a Ctrl-click, as the game does too. A box too small to be one is a click.
/// A press on the minimap picks nothing, and the place on it the pointer is at is returned for as
/// long as the button stays down. A press on one of `panels` is the panel's, and picks nothing
/// either: the units under a panel are not what a click on its controls is after, and a click
/// there would otherwise drop what was picked. A box that started on the map can be dragged over
/// a panel all the same. All of it is dropped with the count, but for what was picked, which is
/// what is counted while the count fades out.
fn follow_pick(
    ctx: &Context,
    id: Id,
    shown: bool,
    view: &OnScreenView,
    screen: Rect,
    panels: &[Rect],
    minimap: Option<Rect>,
) -> (Pick, Option<Pos2>) {
    let mut state = ctx
        .data(|data| data.get_temp::<PickState>(id))
        .unwrap_or_default();
    if !shown {
        state.drag = None;
        state.steering = false;
        state.gone = true;
        let pick = match &state.picked {
            Some(ids) => Pick::Picked(ids.clone()),
            None => Pick::Everything,
        };
        ctx.data_mut(|data| data.insert_temp(id, state));
        return (pick, None);
    }
    if state.gone {
        state = PickState::default();
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
    let on_the_map = |at: Pos2| !panels.iter().any(|panel| panel.contains(at));
    if pressed
        && let Some(origin) = origin
        && on_the_map(origin)
    {
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
/// the module's own docs for what makes a group), and the groups themselves, to be kept for the
/// next frame. `before` is the groups of the frame before, `seconds` ago.
fn group_labels<'a>(
    view: &'a OnScreenView,
    on_map: OnMap,
    before: &grouping::Groups,
    seconds: f32,
    included: impl Fn(&OnScreenUnitView) -> bool,
) -> (Vec<Label<'a>>, grouping::Groups) {
    let screen = on_map.screen;
    let points_per_map_pixel = on_map
        .map_view
        .map_or(0.0, |map_view| screen.width() / map_view.width());
    let motion = view.tuning;
    let slack_least = on_map.points_per_pixel() * motion.slack_least;
    let mut labels = Vec::new();
    let mut groups = grouping::Groups {
        next_key: before.next_key,
        ..Default::default()
    };
    for (index, player) in view.players.iter().enumerate() {
        let units: Vec<&OnScreenUnitView> = view
            .units
            .iter()
            .filter(|unit| unit.player == index && unit.kind.is_some() && included(unit))
            .collect();
        let members: Vec<grouping::Member> = units
            .iter()
            .map(|unit| grouping::Member {
                at: on_screen(unit.position, screen),
                job: unit.job,
                orders: unit.orders,
            })
            .collect();
        let were_together = |a: usize, b: usize| {
            let group = |i: usize| before.group_of.get(&units[i].id);
            group(a).is_some_and(|group_a| group(b) == Some(group_a))
        };
        let stand = grouping::stand_together(
            &members,
            points_per_map_pixel,
            motion.same_orders_reach,
            were_together,
        );
        let ids: Vec<u32> = units.iter().map(|unit| unit.id).collect();
        let at_a_base: Vec<bool> = stand
            .iter()
            .map(|standing| {
                let first = standing.first().and_then(|&member| units[member].job);
                matches!(first, Some(WorkerJob::AtBase { .. }))
            })
            .collect();
        let settled = grouping::settle_into_groups(
            &stand,
            &at_a_base,
            &ids,
            before,
            &mut groups,
            seconds,
            motion.regroup_secs,
        );
        for (key, members) in settled {
            let members: Vec<&OnScreenUnitView> = members.into_iter().map(|i| units[i]).collect();
            let top = members
                .iter()
                .map(|unit| on_screen(pos2(unit.position.x, unit.top), screen).y)
                .fold(f32::INFINITY, f32::min);
            // Where the group's units stand: what the label is to stay over.
            let stand = Rect::from_points(
                &members
                    .iter()
                    .map(|unit| on_screen(unit.position, screen))
                    .collect::<Vec<_>>(),
            );
            // A base's workers are labelled at the base, which leaves the label nowhere to go.
            let base = match work_of(&members) {
                Some(WorkerJob::AtBase { base }) => view.bases.get(base),
                _ => None,
            };
            let (anchor, slack) = match base {
                Some(base) => (on_screen(base.top, screen), Vec2::ZERO),
                None => (
                    pos2(stand.center().x, top),
                    stand.size() / 2.0 * motion.slack_share + slack_least,
                ),
            };
            labels.push(Label {
                player,
                owner: index,
                anchor,
                slack,
                scale: 1.0,
                key: Some(key),
                was: carried_on_from(&members, &before.group_of),
                kinds: count_kinds(view, members),
            });
        }
    }
    (labels, groups)
}

/// The work most of `members` are at, or `None` where most are at none. A group is all at one
/// work but for the units that have yet to be counted out of it or into another.
fn work_of(members: &[&OnScreenUnitView]) -> Option<WorkerJob> {
    let mut at: Vec<(Option<WorkerJob>, usize)> = Vec::new();
    for unit in members {
        match at.iter_mut().find(|(job, _)| *job == unit.job) {
            Some((_, count)) => *count += 1,
            None => at.push((unit.job, 1)),
        }
    }
    // The first of two with as many, which is the one the group's first unit is at.
    let most = at.iter().map(|&(_, count)| count).max()?;
    at.into_iter()
        .find(|&(_, count)| count == most)
        .and_then(|(job, _)| job)
}

/// The key of the group most of `members` were in the frame before, given each unit's then. The
/// lower key where two had as many, so that the answer is the same from frame to frame.
fn carried_on_from(members: &[&OnScreenUnitView], before: &HashMap<u32, u32>) -> Option<u32> {
    most_of(
        members
            .iter()
            .filter_map(|unit| before.get(&unit.id).copied()),
    )
}

/// The key most of `keys` are, and the lower one where two come as often.
fn most_of(keys: impl Iterator<Item = u32>) -> Option<u32> {
    let mut counted: Vec<(u32, usize)> = Vec::new();
    for key in keys {
        match counted.iter_mut().find(|(counted, _)| *counted == key) {
            Some((_, count)) => *count += 1,
            None => counted.push((key, 1)),
        }
    }
    counted
        .into_iter()
        .max_by_key(|&(key, count)| (count, std::cmp::Reverse(key)))
        .map(|(key, _)| key)
}

/// The labels on their way out this frame, `seconds` after `before`: those that were then, moved
/// on toward the labels they are joining and nearer gone, less the ones that have gone, and the
/// label of every group that has joined another since. A group has joined another when it had a
/// label the frame before and has none in `now`, and most of what is still in view of its units is
/// in a group (as `groups` has them) that has one. One whose units have left the view, or died,
/// has joined nothing, and its label goes at once.
fn leaving_labels(
    before: &Memory,
    groups: &grouping::Groups,
    now: &HashMap<u32, Kept>,
    motion: CountTuning,
    seconds: f32,
) -> Vec<Leaving> {
    let mut leaving: Vec<Leaving> = before
        .leaving
        .iter()
        .map(|label| Leaving {
            gone: label.gone + seconds,
            ..label.clone()
        })
        .filter(|label| label.gone < LEAVE_SECS)
        .collect();
    for (key, kept) in &before.labels {
        if now.contains_key(key) {
            continue;
        }
        let units = before.groups.group_of.iter();
        let were_in_it = units.filter(|&(_, group)| group == key);
        let joined = most_of(were_in_it.filter_map(|(unit, _)| groups.group_of.get(unit).copied()));
        if let Some(into) = joined.filter(|into| now.contains_key(into)) {
            leaving.push(Leaving {
                owner: kept.owner,
                kinds: kept.kinds.clone(),
                size: kept.size,
                at: kept.at,
                into,
                gone: 0.0,
            });
        }
    }
    for label in &mut leaving {
        if let Some(joining) = now.get(&label.into) {
            label.at = approach(label.at, joining.at, motion, seconds);
        }
    }
    leaving
}

/// Leaves every group's label hanging where it hung the frame before, `before` by group, for as
/// long as that is still over its group: within the label's slack of the middle of the group's
/// top. One whose group has got further out from under it is moved only as far as it takes to be
/// within that again. A group whose units mill about, as workers mining do, moves the middle of its
/// top with every step they take, and its label would otherwise never be still; one on the march
/// keeps pushing its label on by as much as it moves, which is its label following it at its own
/// pace. A label new this frame, or one over a dragged box, hangs over the middle of the top of
/// what it labels.
fn hold(labels: &mut [Label], before: &HashMap<u32, Kept>, on_map: OnMap) {
    for label in labels {
        let Some(kept) = label.was.and_then(|key| before.get(&key)) else {
            continue;
        };
        let hung = on_map.screen_point(kept.hung);
        let (over, slack) = (label.anchor, label.slack);
        label.anchor = pos2(
            hung.x.clamp(over.x - slack.x, over.x + slack.x),
            hung.y.clamp(over.y - slack.y, over.y + slack.y),
        );
    }
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
                owner: index,
                kinds,
                anchor: dragged.center_top(),
                slack: Vec2::ZERO,
                scale: BOX_LABEL_SCALE,
                key: None,
                was: None,
            })
        })
        .collect()
}

/// How many of `units` there are of each kind, with the kind's icon, in the kinds' drawing order.
fn count_kinds<'a>(
    view: &OnScreenView,
    units: impl IntoIterator<Item = &'a OnScreenUnitView>,
) -> Vec<(ProductionIcon, u32)> {
    let mut counts = vec![0u32; view.kinds.len()];
    for kind in units.into_iter().filter_map(|unit| unit.kind) {
        if let Some(count) = counts.get_mut(kind) {
            *count += 1;
        }
    }
    counts
        .into_iter()
        .zip(&view.kinds)
        .filter(|&(count, _)| count > 0)
        .map(|(count, icon)| (*icon, count))
        .collect()
}

/// The size of a label of `kinds` kinds whose owner's name is `name_width` wide at `scale`.
fn label_size(kinds: usize, name_width: f32, scale: f32) -> Vec2 {
    let columns = kinds.clamp(1, TILES_PER_LINE) as f32;
    let lines = kinds.div_ceil(TILES_PER_LINE).max(1) as f32;
    let tiles = vec2(
        TILE_WIDTH * columns + TILE_GAP * (columns - 1.0),
        LINE_HEIGHT * lines + TILE_GAP * (lines - 1.0),
    );
    vec2(
        (tiles.x * scale).max(name_width + NAME_INSET * scale * 2.0),
        (NAME_BAND_HEIGHT + BAND_GAP + tiles.y) * scale,
    )
}

/// The height of a line of tiles, with the count badges hanging under it.
const LINE_HEIGHT: f32 = TILE_HEIGHT + BADGE_OVERHANG;

/// Where every label goes: centered over what it labels and clear of the screen's edges, the
/// labels lowest on screen placed first so that a label that would cover one already placed is
/// moved up above it, and under every placed label instead where that would take it off the top.
/// Then one that would stand under one of `panels` is moved out from under it (see
/// [`out_from_under`]).
fn place_labels<'a>(
    ui: &Ui,
    labels: Vec<Label<'a>>,
    screen: Rect,
    panels: &[Rect],
) -> Vec<(Label<'a>, Rect)> {
    let mut wanted: Vec<(Label, Rect)> = labels
        .into_iter()
        .map(|label| {
            let name = name_spec(1.0, label.scale).galley(ui, &label.player.name);
            let size = label_size(label.kinds.len(), name.size().x, label.scale);
            let bottom_center = label.anchor - vec2(0.0, LIFT);
            let rect = Rect::from_min_size(bottom_center - vec2(size.x / 2.0, size.y), size);
            let rect = keep_on_screen(rect, screen);
            (label, rect)
        })
        .collect();
    wanted.sort_by(|(_, a), (_, b)| b.bottom().total_cmp(&a.bottom()));
    let mut placed: Vec<(Label, Rect)> = Vec::with_capacity(wanted.len());
    for (label, mut rect) in wanted {
        let labels: Vec<Rect> = placed.iter().map(|(_, other)| *other).collect();
        while let Some(&blocking) = labels.iter().find(|&&other| covers(other, rect)) {
            rect = rect.translate(vec2(0.0, blocking.top() - LABEL_GAP - rect.bottom()));
            if rect.top() < screen.top() + EDGE_MARGIN {
                // No room above what it collided with: hung under the lowest label instead, which
                // nothing placed so far reaches past.
                let lowest = labels.iter().map(Rect::bottom).fold(f32::MIN, f32::max);
                rect = rect.translate(vec2(0.0, lowest + LABEL_GAP - rect.top()));
                break;
            }
        }
        let rect = out_from_under(rect, panels, &labels, screen);
        placed.push((label, rect));
    }
    placed
}

/// How far a label is moved at most to stand clear of a panel. Any further and it would stand
/// away from the units it labels, so it is left where it is, under the panel, which covers those
/// units as well.
const MAX_PANEL_SHIFT: f32 = 120.0;

/// Whether `other` and a label at `rect` are too close, leaving less than [`LABEL_GAP`] between.
fn covers(other: Rect, rect: Rect) -> bool {
    other.expand(LABEL_GAP / 2.0).intersects(rect)
}

/// `rect` moved the least it takes to stand clear of every one of `panels` it is under: just past
/// one of their edges, on screen, and clear of the other panels and of `labels`, the ones already
/// placed. Left where it is when there is no such place within [`MAX_PANEL_SHIFT`].
fn out_from_under(rect: Rect, panels: &[Rect], labels: &[Rect], screen: Rect) -> Rect {
    let under: Vec<Rect> = panels
        .iter()
        .copied()
        .filter(|&panel| covers(panel, rect))
        .collect();
    if under.is_empty() {
        return rect;
    }
    let room = screen.shrink(EDGE_MARGIN);
    let clear = |moved: &Rect| {
        room.contains_rect(*moved)
            && panels
                .iter()
                .chain(labels)
                .all(|&other| !covers(other, *moved))
    };
    under
        .iter()
        .flat_map(|panel| {
            [
                vec2(0.0, panel.top() - LABEL_GAP - rect.bottom()),
                vec2(0.0, panel.bottom() + LABEL_GAP - rect.top()),
                vec2(panel.left() - LABEL_GAP - rect.right(), 0.0),
                vec2(panel.right() + LABEL_GAP - rect.left(), 0.0),
            ]
        })
        .filter(|shift| shift.length() <= MAX_PANEL_SHIFT)
        .map(|shift| rect.translate(shift))
        .filter(clear)
        .min_by(|a, b| {
            let shift = |moved: &Rect| moved.min.distance(rect.min);
            shift(a).total_cmp(&shift(b))
        })
        .unwrap_or(rect)
}

/// The labels `placed`, each drawn on its way from where it was drawn the frame before, `before` by
/// group, to where it is placed, with whether it moved on the screen since then, and where each
/// group's label now is. A label goes most of the way in [`CountTuning::settle_secs`] and never
/// slower than [`CountTuning::least_speed`], so it is quick about a move and then still. Where it
/// was is kept on the map, so a label doesn't trail its units as the view pans. A label new this
/// frame, or one over a dragged box, is drawn where it is placed.
fn settle<'a>(
    placed: Vec<(Label<'a>, Rect)>,
    before: &HashMap<u32, Kept>,
    on_map: OnMap,
    motion: CountTuning,
    seconds: f32,
) -> (Vec<Settled<'a>>, HashMap<u32, Kept>) {
    let mut kept = HashMap::new();
    let settled = placed
        .into_iter()
        .map(|(label, rect)| {
            let Some(key) = label.key else {
                return Settled {
                    label,
                    rect,
                    moving: false,
                };
            };
            let was = label.was.and_then(|key| before.get(&key));
            let wanted = on_map.map_point(rect.center_bottom());
            let at = was.map_or(wanted, |was| approach(was.at, wanted, motion, seconds));
            let bottom = on_map.screen_point(at);
            // Panning can take what was on the screen a frame ago off it.
            let rect = keep_on_screen(
                Rect::from_min_size(
                    bottom - vec2(rect.width() / 2.0, rect.height()),
                    rect.size(),
                ),
                on_map.screen,
            );
            let drawn = rect.center_bottom();
            let moving = was.is_some_and(|was| was.drawn.distance(drawn) > STILL);
            let hung = on_map.map_point(label.anchor);
            kept.insert(
                key,
                Kept {
                    hung,
                    at,
                    drawn,
                    owner: label.owner,
                    kinds: label.kinds.clone(),
                    size: rect.size(),
                },
            );
            Settled {
                label,
                rect,
                moving,
            }
        })
        .collect();
    (settled, kept)
}

/// A label where it is drawn this frame, and whether it moved on the screen since the frame before.
struct Settled<'a> {
    label: Label<'a>,
    rect: Rect,
    moving: bool,
}

/// How far a label can be drawn from where it was the frame before, in points, and still count as
/// standing still: what the arithmetic of putting it on the map and back leaves.
const STILL: f32 = 0.01;

/// Where something at `from` that is making for `to` is `seconds` later.
fn approach(from: Pos2, to: Pos2, motion: CountTuning, seconds: f32) -> Pos2 {
    let gap = to - from;
    let distance = gap.length();
    let share = 1.0 - (-seconds / motion.settle_secs.max(f32::EPSILON)).exp();
    let step = (distance * share).max(motion.least_speed * seconds);
    if step >= distance {
        to
    } else {
        from + gap * (step / distance)
    }
}

/// `rect` moved the least it takes to sit inside `screen`, short of its edges.
fn keep_on_screen(rect: Rect, screen: Rect) -> Rect {
    let room = screen.shrink(EDGE_MARGIN);
    let dx = (room.left() - rect.left()).max(0.0) + (room.right() - rect.right()).min(0.0);
    let dy = (room.top() - rect.top()).max(0.0) + (room.bottom() - rect.bottom()).min(0.0);
    rect.translate(vec2(dx, dy))
}

fn name_spec(alpha: f32, scale: f32) -> text::TextSpec {
    text::player_name(NAME_SIZE * scale).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha))
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

/// Draws one label into `rect`: the owner's name on a band of their color as wide as the label,
/// then a tile for each kind, wrapping onto as many lines as it takes, the band and every tile
/// edged with a dark line, or a light one while the pointer is over the label.
fn draw_label(ui: &Ui, label: &Label, rect: Rect, hovered: bool) {
    let player = label.player;
    let scale = label.scale;
    let alpha = vision_alpha(player.vision);
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    let painter = ui.painter();
    let edge = |rect: Rect| {
        painter.rect_stroke(
            rect,
            corner_radius,
            Stroke::new(
                theme::HAIRLINE,
                if hovered {
                    theme::TEXT_PRIMARY.gamma_multiply(alpha)
                } else {
                    Color32::BLACK.gamma_multiply(EDGE_ALPHA * alpha)
                },
            ),
            StrokeKind::Outside,
        );
    };
    let band = Rect::from_min_size(rect.min, vec2(rect.width(), NAME_BAND_HEIGHT * scale));
    edge(band);
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
        band.shrink2(vec2(NAME_INSET * scale, 0.0)),
        &name_spec(alpha, scale),
        &player.name,
        Align::Center,
    );

    let (tile_width, tile_height) = (TILE_WIDTH * scale, TILE_HEIGHT * scale);
    let gap = TILE_GAP * scale;
    let columns = label.kinds.len().clamp(1, TILES_PER_LINE) as f32;
    let tiles_width = tile_width * columns + gap * (columns - 1.0);
    // The tiles are centered under the band, which is wider than them where the name is.
    let left = rect.center().x - tiles_width / 2.0;
    let top = band.bottom() + BAND_GAP * scale;
    for (i, (icon, count)) in label.kinds.iter().enumerate() {
        let (line, column) = (i / TILES_PER_LINE, i % TILES_PER_LINE);
        let tile = Rect::from_min_size(
            pos2(
                left + column as f32 * (tile_width + gap),
                top + line as f32 * (LINE_HEIGHT * scale + gap),
            ),
            vec2(tile_width, tile_height),
        );
        edge(tile);
        draw_tile(ui, tile, icon, player.color, alpha, scale);
        draw_badge(ui, tile, *count, alpha, scale);
    }
}

/// Draws one kind's tile: its icon washed in its `owner`'s color.
fn draw_tile(ui: &Ui, rect: Rect, icon: &ProductionIcon, owner: Color32, alpha: f32, scale: f32) {
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
            &text::body(TILE_TEXT_SIZE * scale, text::BodyWeight::Semibold)
                .with_color(theme::TEXT_SECONDARY.gamma_multiply(alpha)),
            &unit_codes::code_or_index(icon.index),
            Align::Center,
        ),
    }
}

/// Draws how many of a kind there are on a dark badge over the bottom right corner of its `tile`,
/// hanging below it: the number the label is read for, so set larger than anything else on it.
fn draw_badge(ui: &Ui, tile: Rect, count: u32, alpha: f32, scale: f32) {
    let text = count.to_string();
    let spec = text::numeral(BADGE_TEXT_SIZE * scale)
        .with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha));
    let height = BADGE_HEIGHT * scale;
    let width = (spec.galley(ui, &text).size().x + BADGE_INSET * scale * 2.0).max(height);
    let bottom = tile.bottom() + BADGE_OVERHANG * scale;
    let badge = Rect::from_min_max(
        pos2(tile.right() - width, bottom - height),
        pos2(tile.right(), bottom),
    );
    let painter = ui.painter();
    painter.rect_filled(
        badge,
        height / 2.0,
        Color32::BLACK.gamma_multiply(0.9 * alpha),
    );
    painter.rect_stroke(
        badge,
        height / 2.0,
        Stroke::new(
            theme::HAIRLINE,
            theme::alpha(theme::TEXT_PRIMARY, 0.35 * alpha),
        ),
        StrokeKind::Inside,
    );
    paint_text(ui, badge, &spec, &text, Align::Center);
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
            job: None,
            orders: None,
            position,
            bounds: Rect::from_center_size(position, vec2(0.01, 0.01)),
            top: y - 0.005,
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
        panels: Vec<Rect>,
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
                panels: Vec::new(),
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
                    &input.panels,
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
        // And letting go of Alt forgets a pick, once the count has faded out counting it.
        pick_frame(&ctx, &view, true, vec![button(start, true)]);
        pick_frame(&ctx, &view, true, vec![egui::Event::PointerMoved(end)]);
        pick_frame(&ctx, &view, true, vec![button(end, false)]);
        let fading = pick_frame(&ctx, &view, false, vec![]);
        assert!(matches!(&fading, Pick::Picked(ids) if ids == &[7]));
        assert!(matches!(
            pick_frame(&ctx, &view, true, vec![]),
            Pick::Everything
        ));
    }

    #[test]
    fn a_press_on_a_panel_is_the_panel_s_and_a_box_from_the_map_can_cross_one() {
        let ctx = Context::default();
        let view = OnScreenView {
            units: vec![unit_at(7, 0.2, 0.2), unit_at(9, 0.8, 0.8)],
            ..Default::default()
        };
        // A panel over the second unit.
        let panel = Rect::from_min_max(pos2(700.0, 700.0), pos2(1000.0, 1000.0));
        let with_panel = |events: Vec<egui::Event>| {
            let input = FrameInput {
                panels: vec![panel],
                ..FrameInput::default()
            };
            frame(&ctx, &view, input, events).0
        };
        // With the first unit picked, a click on the panel neither picks the unit under it nor
        // drops the pick, as a click on the bare map beside it would.
        let on_unit = pos2(200.0, 200.0);
        with_panel(vec![egui::Event::PointerMoved(on_unit)]);
        with_panel(vec![button(on_unit, true)]);
        let picked = with_panel(vec![button(on_unit, false)]);
        assert!(matches!(&picked, Pick::Picked(ids) if ids == &[7]));
        let on_panel = pos2(800.0, 800.0);
        with_panel(vec![egui::Event::PointerMoved(on_panel)]);
        let pressed = with_panel(vec![button(on_panel, true)]);
        assert!(matches!(&pressed, Pick::Picked(ids) if ids == &[7]));
        let released = with_panel(vec![button(on_panel, false)]);
        assert!(matches!(&released, Pick::Picked(ids) if ids == &[7]));
        // A box begun on the map and let go over the panel picks what it covers, under the
        // panel as well.
        let start = pos2(100.0, 100.0);
        with_panel(vec![egui::Event::PointerMoved(start)]);
        with_panel(vec![button(start, true)]);
        with_panel(vec![egui::Event::PointerMoved(pos2(900.0, 900.0))]);
        let boxed = with_panel(vec![button(pos2(900.0, 900.0), false)]);
        assert!(matches!(&boxed, Pick::Picked(ids) if ids == &[7, 9]));
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
    fn a_label_moves_the_least_it_takes_out_from_under_a_panel() {
        let screen = Rect::from_min_size(Pos2::ZERO, vec2(1000.0, 1000.0));
        let size = vec2(80.0, 60.0);
        let bottom = Rect::from_min_max(pos2(0.0, 800.0), pos2(400.0, 1000.0));
        let label = Rect::from_min_size(pos2(300.0, 780.0), size);
        let moved = out_from_under(label, &[bottom], &[], screen);
        assert_eq!(moved, label.translate(vec2(0.0, 800.0 - LABEL_GAP - 840.0)));
        // Just over a wing's inner edge, it steps out past that edge.
        let wing = Rect::from_min_max(pos2(0.0, 200.0), pos2(300.0, 700.0));
        let label = Rect::from_min_size(pos2(280.0, 400.0), size);
        let moved = out_from_under(label, &[wing], &[], screen);
        assert_eq!(moved, label.translate(vec2(300.0 + LABEL_GAP - 280.0, 0.0)));
        // With no room above a panel along the top, it goes under it.
        let top = Rect::from_min_max(pos2(0.0, 0.0), pos2(1000.0, 100.0));
        let label = Rect::from_min_size(pos2(300.0, 30.0), size);
        let moved = out_from_under(label, &[top], &[], screen);
        assert_eq!(moved.top(), top.bottom() + LABEL_GAP);
        // A place already taken by a label is no way out.
        let taken = Rect::from_min_size(pos2(300.0, 108.0), size);
        let moved = out_from_under(label, &[top], &[taken], screen);
        assert_eq!(moved, label);
        // Deep under a big panel, it stays with its units rather than stand far from them.
        let deep = Rect::from_min_size(pos2(100.0, 400.0), size);
        assert_eq!(out_from_under(deep, &[wing], &[], screen), deep);
        // And a label clear of everything stays put.
        let clear = Rect::from_min_size(pos2(600.0, 400.0), size);
        assert_eq!(out_from_under(clear, &[bottom, top], &[], screen), clear);
    }

    /// A view of the screen 1000 points square onto 500 pixels of the map: two points to a pixel.
    fn on_map() -> OnMap {
        OnMap::new(
            Some(Rect::from_min_size(
                pos2(2000.0, 3000.0),
                vec2(500.0, 500.0),
            )),
            Rect::from_min_size(Pos2::ZERO, vec2(1000.0, 1000.0)),
        )
    }

    fn nobody() -> OnScreenPlayerView {
        OnScreenPlayerView {
            name: String::new(),
            color: Color32::WHITE,
            vision: true,
        }
    }

    /// The label of the group `key`, which was the same group the frame before.
    fn label_of(player: &OnScreenPlayerView, key: Option<u32>) -> Label<'_> {
        Label {
            player,
            owner: 0,
            kinds: Vec::new(),
            anchor: Pos2::ZERO,
            slack: Vec2::ZERO,
            scale: 1.0,
            key,
            was: key,
        }
    }

    fn assert_close(a: Pos2, b: Pos2) {
        assert!(a.distance(b) < 1e-2, "{a:?} is not {b:?}");
    }

    #[test]
    fn a_label_stays_put_over_a_group_milling_about_and_is_drawn_along_by_one_on_the_march() {
        let on_map = on_map();
        let player = nobody();
        // Where group 1's label hangs, with the middle of the group's top `x` across the screen
        // and the label free to be 20 points off it either way.
        let held = |x: f32, before: &HashMap<u32, Kept>, on_map: OnMap| {
            let mut labels = [label_of(&player, Some(1))];
            labels[0].anchor = pos2(x, 300.0);
            labels[0].slack = vec2(20.0, 10.0);
            hold(&mut labels, before, on_map);
            labels[0].anchor
        };
        let hung_at = |anchor: Pos2, on_map: OnMap| {
            let kept = Kept {
                hung: on_map.map_point(anchor),
                ..Default::default()
            };
            HashMap::from([(1, kept)])
        };
        // New: over the middle of its group's top.
        assert_close(held(500.0, &HashMap::new(), on_map), pos2(500.0, 300.0));
        // The middle shifting about under it leaves it where it hung.
        let before = hung_at(pos2(500.0, 300.0), on_map);
        for x in [485.0, 512.0, 520.0, 480.0] {
            assert_close(held(x, &before, on_map), pos2(500.0, 300.0));
        }
        // Further than its slack, and it is moved only as far as puts it back within that.
        assert_close(held(530.0, &before, on_map), pos2(510.0, 300.0));
        // The view panning 50 pixels of map moves its group 100 points across the screen, and it
        // with them.
        let panned = OnMap::new(
            on_map.map_view.map(|view| view.translate(vec2(50.0, 0.0))),
            on_map.screen,
        );
        assert_close(held(412.0, &before, panned), pos2(400.0, 300.0));
        // A group on the march, 8 points a frame: once it has taken up the slack, the label
        // goes as far as the group does every frame.
        let mut before = before;
        let mut at = 500.0;
        let mut steps = Vec::new();
        for frame in 1..=10 {
            let hung = held(500.0 + 8.0 * frame as f32, &before, on_map);
            steps.push(hung.x - at);
            at = hung.x;
            before = hung_at(hung, on_map);
        }
        assert!(
            steps[..2].iter().all(|&step| step.abs() < 1e-2),
            "{steps:?}"
        );
        assert!(
            steps[3..].iter().all(|&step| (step - 8.0).abs() < 1e-2),
            "{steps:?}"
        );
    }

    #[test]
    fn a_group_carries_on_the_label_of_the_group_most_of_its_units_were_in() {
        let units = [
            unit_at(1, 0.1, 0.1),
            unit_at(2, 0.1, 0.1),
            unit_at(3, 0.1, 0.1),
            unit_at(4, 0.1, 0.1),
        ];
        let members: Vec<&OnScreenUnitView> = units.iter().collect();
        // The unit the group was keyed by has left it, and one from another group has joined.
        let before = HashMap::from([(1, 1), (2, 1), (3, 1), (4, 7)]);
        assert_eq!(carried_on_from(&members[1..], &before), Some(1));
        // As many from each of two groups: the lower key, whichever way round they come.
        let before = HashMap::from([(2, 9), (3, 5)]);
        assert_eq!(carried_on_from(&members[1..3], &before), Some(5));
        let before = HashMap::from([(2, 5), (3, 9)]);
        assert_eq!(carried_on_from(&members[1..3], &before), Some(5));
        // Nothing to carry on from for units new to the view.
        assert_eq!(carried_on_from(&members, &HashMap::new()), None);
    }

    #[test]
    fn a_label_hangs_from_the_top_of_what_is_drawn_of_its_units() {
        // A unit whose art stands taller than its body, next to one whose doesn't.
        let mut tall = unit_at(1, 0.5, 0.5);
        tall.top = 0.46;
        let view = OnScreenView {
            players: vec![nobody()],
            kinds: vec![ProductionIcon {
                texture: None,
                index: 0,
                size: None,
                margin: 0.0,
                wireframe: None,
            }],
            units: vec![tall, unit_at(2, 0.52, 0.5)],
            ..Default::default()
        };
        let (labels, _) = group_labels(&view, on_map(), &Default::default(), 0.016, |_| true);
        assert_eq!(labels.len(), 1);
        assert_close(labels[0].anchor, pos2(510.0, 460.0));
    }

    #[test]
    fn the_workers_gathering_at_a_base_are_labelled_over_its_town_hall() {
        let gathering = |id, x, y| OnScreenUnitView {
            job: Some(WorkerJob::AtBase { base: 0 }),
            ..unit_at(id, x, y)
        };
        let mut view = OnScreenView {
            players: vec![nobody()],
            kinds: vec![ProductionIcon {
                texture: None,
                index: 0,
                size: None,
                margin: 0.0,
                wireframe: None,
            }],
            units: vec![gathering(1, 0.7, 0.5), gathering(2, 0.9, 0.3)],
            bases: vec![OnScreenBaseView {
                top: pos2(0.4, 0.2),
            }],
            ..Default::default()
        };
        let anchor = |view: &OnScreenView| {
            let (mut labels, _) =
                group_labels(view, on_map(), &Default::default(), 0.016, |_| true);
            assert_eq!(labels.len(), 1);
            // Wherever it hung before, it hangs over the town hall.
            let kept = Kept {
                hung: on_map().map_point(pos2(900.0, 900.0)),
                ..Default::default()
            };
            labels[0].was = Some(1);
            hold(&mut labels, &HashMap::from([(1, kept)]), on_map());
            labels[0].anchor
        };
        assert_close(anchor(&view), pos2(400.0, 200.0));
        // And stays there as they go about their gathering.
        view.units[0].position = pos2(0.45, 0.35);
        view.units[1].position = pos2(0.95, 0.6);
        assert_close(anchor(&view), pos2(400.0, 200.0));
    }

    #[test]
    fn a_label_is_quick_to_a_new_place_and_then_still_and_keeps_to_the_map_as_the_view_pans() {
        let on_map = on_map();
        let motion = CountTuning::default();
        let player = nobody();
        let size = vec2(80.0, 60.0);
        let placed = |key, at: Pos2| vec![(label_of(&player, key), Rect::from_min_size(at, size))];
        // New: where it is placed, standing still.
        let (first, kept) = settle(
            placed(Some(1), pos2(400.0, 400.0)),
            &HashMap::new(),
            on_map,
            motion,
            0.016,
        );
        assert_close(first[0].rect.min, pos2(400.0, 400.0));
        assert!(!first[0].moving);
        assert_close(kept[&1].at, pos2(2220.0, 3230.0));
        // The view panned so its units stand 100 points further left: so does it, at once.
        let panned = OnMap::new(
            on_map.map_view.map(|view| view.translate(vec2(50.0, 0.0))),
            on_map.screen,
        );
        let (followed, _) = settle(
            placed(Some(1), pos2(300.0, 400.0)),
            &kept,
            panned,
            motion,
            0.016,
        );
        assert_close(followed[0].rect.min, pos2(300.0, 400.0));
        assert!(followed[0].moving);
        // Placed elsewhere: a good part of the way there a frame later, and there within a quarter
        // of a second, rather than ever closer to it.
        let mut kept = kept;
        let mut frames = 0;
        loop {
            let (moved, now) = settle(
                placed(Some(1), pos2(500.0, 400.0)),
                &kept,
                on_map,
                motion,
                0.016,
            );
            let x = moved[0].rect.min.x;
            frames += 1;
            kept = now;
            if frames == 1 {
                assert!(x > 420.0 && x < 480.0, "{x}");
                assert!(moved[0].moving);
            }
            if (x - 500.0).abs() < 1e-2 {
                break;
            }
            assert!(frames < 15, "still {x} after {frames} frames");
        }
        let (still, kept) = settle(
            placed(Some(1), pos2(500.0, 400.0)),
            &kept,
            on_map,
            motion,
            0.016,
        );
        assert_close(still[0].rect.min, pos2(500.0, 400.0));
        assert!(!still[0].moving);
        // A box's label stands where it is placed, and nothing is kept of it.
        let (boxed, kept) = settle(placed(None, pos2(10.0, 10.0)), &kept, on_map, motion, 0.016);
        assert_eq!(boxed[0].rect.min, pos2(10.0, 10.0));
        assert!(kept.is_empty());
    }

    #[test]
    fn the_label_of_a_group_that_joins_another_goes_into_that_one_s_and_fades() {
        let motion = CountTuning::default();
        let label_at = |x: f32| Kept {
            at: pos2(x, 100.0),
            size: vec2(80.0, 60.0),
            ..Default::default()
        };
        let groups_of = |pairs: &[(u32, u32)]| grouping::Groups {
            group_of: pairs.iter().copied().collect(),
            ..Default::default()
        };
        // Unit 1 in a group of its own, then in the group of units 2 and 3.
        let before = Memory {
            groups: groups_of(&[(1, 7), (2, 8), (3, 8)]),
            labels: HashMap::from([(7, label_at(100.0)), (8, label_at(300.0))]),
            ..Default::default()
        };
        let joined = groups_of(&[(1, 8), (2, 8), (3, 8)]);
        let now = HashMap::from([(8, label_at(300.0))]);
        let leaving = leaving_labels(&before, &joined, &now, motion, 0.016);
        assert_eq!(leaving.len(), 1);
        assert_eq!((leaving[0].into, leaving[0].gone), (8, 0.0));
        // On its way to the label of the group it joined.
        assert!(leaving[0].at.x > 100.0 && leaving[0].at.x < 300.0);
        // Still going a tenth of a second on, nearer the other, and gone within a fifth.
        let before = Memory {
            groups: joined.clone(),
            labels: now.clone(),
            leaving,
            ..Default::default()
        };
        let going = leaving_labels(&before, &joined, &now, motion, 0.1);
        assert_eq!(going.len(), 1);
        assert!(going[0].at.x > before.leaving[0].at.x);
        let before = Memory {
            leaving: going,
            ..before
        };
        assert!(leaving_labels(&before, &joined, &now, motion, 0.1).is_empty());
        // A group whose units have left the view has joined nothing.
        let before = Memory {
            groups: groups_of(&[(1, 7), (2, 8)]),
            labels: HashMap::from([(7, label_at(100.0)), (8, label_at(300.0))]),
            ..Default::default()
        };
        let left = groups_of(&[(2, 8)]);
        assert!(leaving_labels(&before, &left, &now, motion, 0.016).is_empty());
    }

    #[test]
    fn the_veil_is_dark_everywhere_but_in_the_spots_and_comes_back_past_their_edges() {
        let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(480.0, 240.0));
        let spot = Spot {
            center: pos2(120.0, 120.0),
            radius: 24.0,
            fade: 48.0,
        };
        let mesh = veil_mesh(screen, &[spot], 0.5);
        // A corner for every 12 points either way, the whole screen covered.
        assert_eq!(mesh.vertices.len(), 41 * 21);
        assert_eq!(mesh.indices.len(), 40 * 20 * 6);
        let dark_at = |x: f32, y: f32| {
            let at = pos2(x, y);
            let vertex = mesh.vertices.iter().find(|vertex| vertex.pos == at);
            vertex.map(|vertex| vertex.color.a())
        };
        // None of it in the spot, all of it well away, and part of it in between.
        assert_eq!(dark_at(120.0, 120.0), Some(0));
        assert_eq!(dark_at(132.0, 120.0), Some(0));
        assert_eq!(dark_at(480.0, 240.0), Some(128));
        assert_eq!(dark_at(120.0, 204.0), Some(128));
        let between = dark_at(168.0, 120.0).unwrap();
        assert!(between > 0 && between < 128, "{between}");
        // No spots: dark all over. A spot off the screen changes nothing on it.
        let off = Spot {
            center: pos2(-500.0, -500.0),
            ..spot
        };
        for mesh in [veil_mesh(screen, &[], 0.5), veil_mesh(screen, &[off], 0.5)] {
            assert!(mesh.vertices.iter().all(|vertex| vertex.color.a() == 128));
        }
    }

    #[test]
    fn a_spot_of_light_is_left_around_what_is_drawn_of_each_unit_pointed_out() {
        let mut tall = unit_at(1, 0.5, 0.5);
        tall.top = 0.46;
        let mut inside = unit_at(3, 0.2, 0.2);
        inside.bounds = Rect::NOTHING;
        let view = OnScreenView {
            units: vec![tall, unit_at(2, 0.7, 0.7), inside],
            ..Default::default()
        };
        // Two points to a pixel of the map: a margin of 12 pixels is 24 points.
        let spots = lit_spots(&view, &[1, 3], on_map());
        assert_eq!(spots.len(), 1);
        // From the top of what is drawn of it, 460, to the bottom of its body, 505.
        assert_close(spots[0].center, pos2(500.0, 482.5));
        assert!((spots[0].radius - (22.5 + 24.0)).abs() < 1e-2);
        assert!((spots[0].fade - 56.0).abs() < 1e-2);
    }

    #[test]
    fn the_label_pointed_at_is_the_one_on_top_and_none_under_a_panel() {
        let player = nobody();
        let settled = |key, min: Pos2| Settled {
            label: label_of(&player, key),
            rect: Rect::from_min_size(min, vec2(80.0, 60.0)),
            moving: false,
        };
        // Two labels overlapping, the second drawn over the first, and a dragged box's label.
        let placed = [
            settled(Some(1), pos2(100.0, 100.0)),
            settled(Some(2), pos2(150.0, 120.0)),
            settled(None, pos2(400.0, 400.0)),
        ];
        assert_eq!(label_under(&placed, &[], pos2(110.0, 110.0)), Some(1));
        assert_eq!(label_under(&placed, &[], pos2(160.0, 130.0)), Some(2));
        assert_eq!(label_under(&placed, &[], pos2(300.0, 300.0)), None);
        // A box's label counts no group.
        assert_eq!(label_under(&placed, &[], pos2(410.0, 410.0)), None);
        // A panel over a label is what the pointer is on there.
        let panel = Rect::from_min_size(pos2(90.0, 90.0), vec2(40.0, 40.0));
        assert_eq!(label_under(&placed, &[panel], pos2(110.0, 110.0)), None);
        assert_eq!(label_under(&placed, &[panel], pos2(200.0, 150.0)), Some(2));
    }

    #[test]
    fn health_bars_go_to_every_unit_in_view_or_to_the_ones_picked() {
        let screen = Rect::from_min_size(Pos2::ZERO, vec2(1000.0, 1000.0));
        // One of them a larva, which is given a bar though it is not counted.
        let mut larva = unit_at(3, 0.3, 0.3);
        larva.kind = None;
        let view = OnScreenView {
            units: vec![unit_at(9, 0.1, 0.1), larva, unit_at(5, 0.5, 0.5)],
            ..Default::default()
        };
        assert_eq!(health_bars(&view, &Pick::Everything, screen), vec![3, 5, 9]);
        assert_eq!(
            health_bars(&view, &Pick::Picked(vec![5, 9]), screen),
            vec![5, 9]
        );
        // A box being dragged covers what is counted inside it, added to what was picked.
        let dragging = Pick::Dragging {
            dragged: Rect::from_min_max(pos2(50.0, 50.0), pos2(350.0, 350.0)),
            adding_to: vec![5],
        };
        assert_eq!(health_bars(&view, &dragging, screen), vec![5, 9]);
    }

    #[test]
    fn a_unit_that_is_not_on_the_map_is_counted_but_cannot_be_clicked() {
        let screen = Rect::from_min_size(Pos2::ZERO, vec2(1000.0, 1000.0));
        // A worker inside a refinery, where the refinery stands.
        let mut inside = unit_at(4, 0.5, 0.5);
        inside.bounds = Rect::NOTHING;
        let view = OnScreenView {
            units: vec![inside],
            ..Default::default()
        };
        assert!(unit_under(&view, pos2(500.0, 500.0), screen).is_none());
        // A box dragged over where it is still takes it in.
        let dragged = Rect::from_min_max(pos2(400.0, 400.0), pos2(600.0, 600.0));
        assert!(in_box(&view.units[0], dragged, screen));
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
