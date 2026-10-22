//! The selection panel: what the watcher has selected, laid out the way the game's own console lays
//! out the middle of itself.
//!
//! An observer who hides the console loses the one thing on it they still use, which is the
//! selection. This panel is that part of the console alone, at the kit's ambient tier and about the
//! console's own footprint, with every number where a watcher's eye already goes for it.
//!
//! A unit is drawn as the game's own icon where the host has the atlas and as its short code where
//! it has not. The tint the console puts on a wireframe goes on the tile's outline and on the bar
//! under each small tile: green, yellow and red as the unit's health falls through two thirds and a
//! third.
//!
//! The panel reads a selection as one [`SelectionCase`] at a time:
//!
//! - Nothing selected is nothing drawn. A box that only says it is empty is a box in the way.
//! - Several units are the console's grid: two rows of six, in the game's order.
//! - One unit is drawn large beside its name, owner, a bar per pool, its upgrades and its kills.
//! - One building is drawn smaller with its readouts under it, and its upgrades where it has any.
//!   A mineral field, a geyser, or a geyser built on reads out what is left to mine in it, and a
//!   building with others of its kind stacked on it says how many there are.
//! - One thing making something shows the console's queue, or a single slot for anything working
//!   through one thing alone; a building going up shows only its progress.
//! - One transport or bunker with units inside shows them in the console's cargo slots.
//!
//! The body is the same height whichever of those is drawn, so the panels stacked on it stay where
//! they are as the watcher clicks from one unit to the next.

use egui::{
    Align, Align2, Area, Color32, Context, Id, Order, Pos2, Rect, Sense, Shape, Stroke, StrokeKind,
    Ui, Vec2, pos2, vec2,
};

use crate::colors::{BLUE60, BLUE80, GREY_BLUE10, GREY_BLUE20, GREY_BLUE60, PURPLE70};
use crate::kit::text;
use crate::kit::widgets::{ResourceGlyph, ResourceRace};
use crate::kit::{motion, theme, tiers, widgets};
use crate::observer::{
    ProductionIcon, StackSlot, centred, paint_player_swatch, paint_text, unit_codes,
};
use crate::tr;

/// One selected unit.
pub struct SelectedUnitView {
    /// The game's own icon for this kind of unit.
    pub icon: ProductionIcon,
    /// What the game calls this kind of unit, in the game's language, or `None` where the host has
    /// no name for it.
    pub name: Option<String>,
    /// The color of the player who owns it, and their name.
    pub owner_color: Color32,
    pub owner_name: String,
    /// The game's own slot of the player who owns it, or `None` for a unit nobody owns.
    pub owner: Option<u8>,
    /// Hit points, current and full, or `None` for something the console gives no hit points:
    /// anything invincible, which every mineral field and geyser is.
    pub hit_points: Option<(u32, u32)>,
    /// Shields, current and full, for a unit that has any.
    pub shields: Option<(u32, u32)>,
    /// Energy, current and full, for a unit that has any.
    pub energy: Option<(u32, u32)>,
    /// How many units it has killed.
    pub kills: u32,
    /// The one line the console writes under a unit selected alone. `None` for nothing to say, and
    /// only read out for a unit selected alone, so a host may leave it `None` for any other.
    pub status: Option<UnitStatusView>,
    /// Whether it is a building rather than a unit.
    pub building: bool,
    /// What is left to mine in it, for a mineral field, a geyser, or the building on a geyser.
    pub resources: Option<ResourcesLeftView>,
    /// How many buildings of its kind stand on its spot, itself among them, for a building with
    /// others stacked on it. `None` for one standing alone. Only read out for a building selected
    /// alone, so a host may leave it `None` for any other.
    pub stacked: Option<u32>,
    /// What it is making, for a building training a unit, researching, or upgrading, and for a
    /// morphing egg or cocoon. `None` while it is idle or is not the kind of thing that makes
    /// anything.
    pub production: Option<ProductionProgressView>,
    /// The units inside it, for a transport or a bunker. Empty for anything else, and for a
    /// transport that is empty.
    pub cargo: Vec<SelectedUnitView>,
    /// The upgrades it fights with, in the order the console lists them: its armor, its shields for
    /// a unit that has any, then whatever improves its weapons. Only read out for a unit selected
    /// alone, and not under a queue or cargo, which leave no room for them, so a host may leave it
    /// empty for any other.
    pub upgrades: Vec<UnitUpgradeView>,
}

/// The line the console writes under a unit selected alone, in the game's language: what has been
/// done to it, such as a parasite on it or its being a hallucination, or failing that what it is, a
/// detector or a Terran's rank.
pub struct UnitStatusView {
    pub text: String,
    /// The color the console writes it in.
    pub color: StatusColor,
}

/// The colors the console writes its status lines in, each drawn in this overlay's own shade of it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum StatusColor {
    /// The console's text color, for a line that only says what the unit is.
    Default,
    Green,
    Red,
    Yellow,
    White,
}

/// What is left to mine in a resource.
pub struct ResourcesLeftView {
    /// Which resource it holds.
    pub glyph: ResourceGlyph,
    /// Whose art the resource's icon is drawn in, for a geyser a race has built on; `None` for the
    /// bare resource.
    pub race: Option<ResourceRace>,
    pub amount: u32,
}

/// One upgrade a unit fights with, at the level its owner has taken it to.
pub struct UnitUpgradeView {
    /// The game's own icon for the upgrade.
    pub icon: ProductionIcon,
    /// The effective upgrade level, including unit-specific armor bonuses such as Chitinous
    /// Plating. Excludes the unit's base armor.
    pub level: u8,
    /// What the game calls it, for the card that names it under the pointer; `None` where the host
    /// cannot say.
    pub name: Option<String>,
    /// What it comes to on this unit, which the same card puts a number to.
    pub effect: UpgradeEffect,
}

/// What an upgrade improves on the unit it is read for.
pub enum UpgradeEffect {
    /// The unit's armor: what it has of its own, and what its upgrades add to that.
    Armor { base: u32, bonus: u32 },
    /// The unit's shields, which the panel already puts a number to.
    Shields,
    /// The unit's weapons that this upgrade improves, which is two for a unit that fires something
    /// different at air than at ground.
    Damage(Vec<WeaponDamageView>),
}

/// What one of a unit's weapons deals.
pub struct WeaponDamageView {
    /// What the game calls the weapon, or `None` where the host cannot say.
    pub name: Option<String>,
    /// What one hit deals unupgraded, and what the weapon's upgrade adds to that at its level.
    pub base: u32,
    pub bonus: u32,
    /// How many hits one attack is.
    pub hits: u32,
}

/// What a selected unit is in the middle of making.
pub struct ProductionProgressView {
    /// The game's own icon for what is being made.
    pub icon: ProductionIcon,
    /// What the game calls what is being made, in the game's language, or `None` where the host has
    /// no name for it.
    pub name: Option<String>,
    /// How far along it is, from 0 to 1.
    pub progress: f32,
    /// What is waiting behind it, for a building training units, whose queue the console draws as a
    /// row of slots; empty while nothing is waiting. `None` for something with no queue at all:
    /// research, an upgrade, or a morph, each of which is one thing worked through alone.
    pub queue: Option<Vec<ProductionIcon>>,
    /// Whether what is being made is the selected thing itself: a building going up, rather than
    /// something coming out of it or something it is turning into.
    pub is_subject: bool,
}

impl SelectedUnitView {
    /// How much of what keeps this unit alive it still has, from 0 to 1.
    ///
    /// Shields count into the same fraction as hit points, because they are the same reading to a
    /// watcher: a dragoon at full health with its shields stripped is a dragoon that has just lost
    /// a fight, and a wireframe that stayed green through that would say the opposite.
    ///
    /// A unit the game keeps no health for reads as whole rather than as dead, since a fraction of
    /// nothing is a unit with no health to report rather than one about to die.
    pub fn health_fraction(&self) -> f32 {
        let (mut current, mut full) = self
            .hit_points
            .map_or((0.0, 0.0), |(current, full)| (current as f32, full as f32));
        if let Some((shields, shields_full)) = self.shields {
            current += shields as f32;
            full += shields_full as f32;
        }
        if full <= 0.0 {
            return 1.0;
        }
        (current / full).clamp(0.0, 1.0)
    }

    /// The tint its tile's edge says how much of it is left in, or `None` for something with
    /// nothing that can be worn down, whose edge would only be saying it is whole.
    fn health_edge(&self) -> Option<Color32> {
        (self.hit_points.is_some() || self.shields.is_some())
            .then(|| health_tint(self.health_fraction()))
    }
}

/// Everything the selection panel draws from.
///
/// In the game's own order, which is the order the console's wireframes take: the first unit is the
/// one the game treats as the selection's subject, and the one whose numbers are read out when it
/// stands alone.
#[derive(Default)]
pub struct SelectionView {
    pub units: Vec<SelectedUnitView>,
}

impl SelectionView {
    /// The most units the game lets a selection hold, and the most the grid draws.
    pub const MAX_UNITS: usize = 12;

    /// Which reading this selection is, which is the one thing that decides what the body draws.
    pub fn case(&self) -> SelectionCase {
        match self.units.as_slice() {
            [] => SelectionCase::Empty,
            [subject] if subject.production.is_some() => SelectionCase::Producing,
            [subject] if !subject.cargo.is_empty() => SelectionCase::Loaded,
            // A resource has nothing of a unit's to read out, and what it does have, the panel
            // reads out where a building's go.
            [subject] if subject.building || subject.resources.is_some() => SelectionCase::Building,
            [_] => SelectionCase::Unit,
            _ => SelectionCase::Many,
        }
    }
}

/// One of the readings the console gives a selection, and this panel with it.
///
/// What is being made wins over what is being carried, for the one thing that can be doing both: a
/// bunker's cargo is its guns, but a bunker is only ever making something while it is being
/// repaired into existence, and that is the reading a watcher went to the panel for.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SelectionCase {
    /// Nothing at all is selected.
    Empty,
    /// Several units, read as the grid alone.
    Many,
    /// One unit, read out as its own numbers and the upgrades it fights with.
    Unit,
    /// One building, read out as its own numbers and the upgrades it fights with.
    Building,
    /// One unit or building with something on the way out of it.
    Producing,
    /// One unit or building with units inside it.
    Loaded,
}

/// How wide the panel is, in overlay points: about what the console's own middle section takes at
/// the design's scale, which is narrower than the production and control-group panels.
pub const PANEL_WIDTH: f32 = 460.0;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = PANEL_WIDTH - 24.0;

/// Size of the tile a selection of one is drawn at, standing in for the console's wireframe.
const SUBJECT_TILE: f32 = 64.0;

/// Width of the column the subject is drawn in, with its readouts under it. Wider than the tile, so
/// a building's four-digit hit points fit under it on one line.
const SUBJECT_COLUMN: f32 = 92.0;

/// Height of one readout under the subject, and the gap between the tile and the first of them.
const READOUT_ROW: f32 = 15.0;
const READOUT_LEAD: f32 = 4.0;

/// The most readouts there are: shields, hit points and energy.
const READOUTS: usize = 3;

/// How tall the subject's column is at its tallest, with every readout under the tile.
const SUBJECT_HEIGHT: f32 = SUBJECT_TILE + READOUT_LEAD + READOUT_ROW * READOUTS as f32;

/// Gap between the subject's column and the text beside it.
const COLUMN_GAP: f32 = 16.0;

/// Where the text column starts, and how wide it is.
const TEXT_LEFT: f32 = SUBJECT_COLUMN + COLUMN_GAP;
const TEXT_WIDTH: f32 = CONTENT_WIDTH - TEXT_LEFT;

/// Height of the line the subject's name heads the text column with.
const NAME_ROW: f32 = 22.0;

/// Size of the square of the owner's color, the gap between it and their name, and the height of
/// the line the two of them share.
const OWNER_SWATCH: f32 = 14.0;
const OWNER_GAP: f32 = 8.0;
const OWNER_ROW: f32 = 18.0;

/// Gap under the owner's line.
const OWNER_LEAD: f32 = 6.0;

/// Text size of the subject's status, which shares the owner's line.
const STATUS_SIZE: f32 = 13.0;

/// The most of the owner's line the subject's status may take. The game's own lines fit in it, so a
/// long owner's name gives way to one of those, and a longer status is cut short here instead.
const STATUS_SHARE: f32 = 0.5;

/// How much of the text column the name and the owner's line take, above whatever the reading
/// draws under them.
const HEADER_HEIGHT: f32 = NAME_ROW + OWNER_ROW + OWNER_LEAD;

/// Height of a tally at the end of the row of upgrades (a unit's kills, a building's stack), and
/// the gap between its label and its count.
const TALLY_ROW: f32 = 16.0;
const TALLY_LABEL_GAP: f32 = theme::SPACE_SM;

/// Height of the line saying what is left to mine in a resource, the side of its glyph, and the
/// gap between the two. The amount is the whole of what a resource is selected for, so it is
/// written at the size of the name above it rather than of a readout.
const RESOURCES_ROW: f32 = 22.0;
const RESOURCES_GLYPH: f32 = 18.0;
const RESOURCES_GAP: f32 = theme::SPACE_SM;

/// The shape of the grid, which is the console's own: two rows of six.
const GRID_COLUMNS: usize = 6;
const GRID_ROWS: usize = 2;

/// Side of one slot of the grid, and the gap between two of them.
const GRID_SLOT: f32 = 48.0;
const GRID_GAP: f32 = 8.0;

/// The bar under a small tile saying how much of its unit is left, and its gap from the tile.
const HEALTH_BAR: f32 = 3.0;
const HEALTH_GAP: f32 = 2.0;

/// The bar above the health bar for a unit with shields, and its gap from the tile. As thick as the
/// health bar and held apart from it by a clear gap: a stream's video keeps color at half the
/// resolution of brightness, and two bars a pixel apart blur into one striped bar there.
const SHIELD_BAR: f32 = 3.0;
const SHIELD_GAP: f32 = 2.0;

/// Gap between the two rows of a grid of small tiles.
const GRID_ROW_GAP: f32 = 6.0;

/// How tall one row of a grid of small tiles of `side` is, its bars included. Every row has room
/// for a shield bar, so a row's bars line up whichever of its units have shields.
const fn tile_row(side: f32) -> f32 {
    side + HEALTH_GAP + HEALTH_BAR + SHIELD_GAP + SHIELD_BAR
}

/// The cargo slots, which are the console's own: two rows of four.
const CARGO_COLUMNS: usize = 4;
const CARGO_ROWS: usize = 2;
const CARGO_SLOT: f32 = 31.0;
const CARGO_GAP: f32 = 6.0;

/// How tall the cargo slots are, both rows of them.
const CARGO_HEIGHT: f32 = tile_row(CARGO_SLOT) * CARGO_ROWS as f32 + GRID_ROW_GAP;

/// How tall the panel's body is: its tallest reading, which is the subject's column or a full head
/// of text over the cargo slots. Every other reading is laid out in the same height, so that the
/// panels stacked on this one stay put.
const BODY_HEIGHT: f32 = max(SUBJECT_HEIGHT, HEADER_HEIGHT + CARGO_HEIGHT);

const fn max(a: f32, b: f32) -> f32 {
    if a > b { a } else { b }
}

/// The grid is the selection: a slot fewer than the game hands out would drop units off the end of
/// a full selection with nothing to say it had. And it is drawn inside the body.
const _: () = assert!(GRID_COLUMNS * GRID_ROWS == SelectionView::MAX_UNITS);
const _: () = assert!(tile_row(GRID_SLOT) * GRID_ROWS as f32 + GRID_ROW_GAP <= BODY_HEIGHT);
const _: () = assert!(
    GRID_SLOT * GRID_COLUMNS as f32 + GRID_GAP * (GRID_COLUMNS as f32 - 1.0) <= CONTENT_WIDTH
);

/// How many slots the console's queue has, which is how many units a building can have waiting.
const QUEUE_SLOTS: usize = 5;

/// Side of one queue slot, and the gap between two of them.
const QUEUE_SLOT: f32 = 36.0;
const QUEUE_GAP: f32 = 6.0;

/// Width of the queue's row of slots.
const QUEUE_WIDTH: f32 = QUEUE_SLOT * QUEUE_SLOTS as f32 + QUEUE_GAP * (QUEUE_SLOTS as f32 - 1.0);

/// Gap between the queue and the progress line under it.
const PROGRESS_LEAD: f32 = 6.0;

/// A progress line: the name of what is being made, then the bar of how far along it is with the
/// percentage after it, and the gap between the two rows.
const PROGRESS_NAME_ROW: f32 = 16.0;
const PROGRESS_NAME_LEAD: f32 = 2.0;
const PROGRESS_ROW: f32 = 14.0;
const PROGRESS_HEIGHT: f32 = PROGRESS_NAME_ROW + PROGRESS_NAME_LEAD + PROGRESS_ROW;

/// Width of the percentage at the end of a progress bar, and the gap before it.
const PERCENT_WIDTH: f32 = 40.0;
const PERCENT_GAP: f32 = 8.0;

/// How thick a progress bar is.
const PROGRESS_TRACK: f32 = 5.0;

/// The queue and its progress line sit under the head of the text column, and a progress line with
/// no queue sits beside its one slot.
const _: () = assert!(HEADER_HEIGHT + QUEUE_SLOT + PROGRESS_LEAD + PROGRESS_HEIGHT <= BODY_HEIGHT);
const _: () = assert!(QUEUE_WIDTH + PERCENT_GAP + PERCENT_WIDTH <= TEXT_WIDTH);
const _: () = assert!(PROGRESS_HEIGHT <= QUEUE_SLOT);

/// The most carried units the panel draws, which is the most the game puts inside anything.
const MAX_CARGO: usize = CARGO_COLUMNS * CARGO_ROWS;

/// Text size of a unit's code on the subject's tile, on a small tile, and on a queue slot.
const SUBJECT_CODE_SIZE: f32 = 16.0;
const SLOT_CODE_SIZE: f32 = 12.0;
const QUEUE_CODE_SIZE: f32 = 11.0;

/// Text size of the subject's name, of the readouts under the subject, of the owner's name, of a
/// tally's count, and of the name and the percentage on a progress line.
const NAME_SIZE: f32 = 17.0;
const READOUT_SIZE: f32 = 14.0;
const OWNER_NAME_SIZE: f32 = 15.0;
const TALLY_SIZE: f32 = 15.0;
const PROGRESS_NAME_SIZE: f32 = 13.0;
const PERCENT_SIZE: f32 = 14.0;

/// How much of itself an empty queue slot is drawn at: faint, because it is the queue's shape rather
/// than anything in it.
const EMPTY_ALPHA: f32 = 0.32;

/// Size of the tile a unit selected alone is drawn at: most of the body's height, since the unit is
/// the whole of what the reading is about.
const UNIT_TILE: f32 = 112.0;

/// Text size of a unit's code on that tile.
const UNIT_CODE_SIZE: f32 = 22.0;

/// Where the text column beside that tile starts, and how wide it is.
const UNIT_TEXT_LEFT: f32 = UNIT_TILE + COLUMN_GAP;
const UNIT_TEXT_WIDTH: f32 = CONTENT_WIDTH - UNIT_TEXT_LEFT;

/// Height of one pool's line under the owner's, how thick its bar is, and the width of the numbers
/// after the bar with the gap before them: wide enough for a unit's largest pool written out.
const POOL_ROW: f32 = 16.0;
const POOL_TRACK: f32 = 6.0;
const POOL_VALUE_WIDTH: f32 = 64.0;
const POOL_VALUE_GAP: f32 = 8.0;

/// Size of one upgrade chip, and the gap between two of them: smaller than any slot, since an
/// upgrade is something the unit has rather than a unit of its own.
const UPGRADE_CHIP: f32 = 30.0;
const UPGRADE_GAP: f32 = 4.0;

/// The most upgrades a unit fights with: its armor, its shields, and one for each of its two
/// weapons.
const MAX_UPGRADES: usize = 4;

/// Text size of an upgrade's level, and how far it sits from its chip's corner, as a production
/// tile's count does.
const LEVEL_SIZE: f32 = 11.0;
const LEVEL_INSET: f32 = 3.0;

/// Text size of the number a host with no atlas writes in place of an upgrade's icon.
const UPGRADE_CODE_SIZE: f32 = 11.0;

/// How bright an upgrade's icon is drawn while nothing is pointing at it: dimmed, so the level in
/// its corner is the brightest thing on the chip.
const UPGRADE_ICON_TINT: Color32 = Color32::from_gray(176);

/// The unit's tile fits the body; its pools all fit between the owner's line and the row of
/// upgrades along the bottom; and the upgrades leave that row's other half to the kills.
const _: () = assert!(UNIT_TILE <= BODY_HEIGHT);
const _: () = assert!(
    HEADER_HEIGHT + POOL_ROW * READOUTS as f32 + theme::SPACE_XS <= BODY_HEIGHT - UPGRADE_CHIP
);
const _: () = assert!(
    UPGRADE_CHIP * MAX_UPGRADES as f32 + UPGRADE_GAP * (MAX_UPGRADES as f32 - 1.0)
        <= UNIT_TEXT_WIDTH * 0.5
);
const _: () = assert!(POOL_VALUE_WIDTH + POOL_VALUE_GAP < UNIT_TEXT_WIDTH * 0.5);

/// Under a building's header the row of upgrades sits clear of a lone slot and of the progress
/// line beside it, of the progress line a building going up has in their place, and of what is left
/// in a resource; and the row leaves half of the narrower text column a building is read out with
/// to its stack.
const _: () = assert!(
    HEADER_HEIGHT + max(max(QUEUE_SLOT, PROGRESS_HEIGHT), RESOURCES_ROW) + theme::SPACE_SM
        <= BODY_HEIGHT - UPGRADE_CHIP
);
const _: () = assert!(
    UPGRADE_CHIP * MAX_UPGRADES as f32 + UPGRADE_GAP * (MAX_UPGRADES as f32 - 1.0)
        <= TEXT_WIDTH * 0.5
);

/// How tall the panel is on screen, chrome included.
pub(crate) const PANEL_HEIGHT: f32 = BODY_HEIGHT + tiers::PANEL_MARGIN_HEIGHT;

/// What the selection panel did this frame.
pub struct SelectionOutcome {
    /// Where the panel was drawn.
    pub rect: Rect,
    /// A unit of the selection the watcher clicked.
    pub clicked: Option<SelectedUnitClick>,
}

/// A click on one of the selected units, by its place in [`SelectionView::units`].
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SelectedUnitClick {
    /// A click: select that unit alone, or for a unit already selected alone, look at it.
    Pick(usize),
    /// A right click: have the game's view follow that unit, as a right click on it in the game
    /// does in a replay.
    Follow(usize),
}

/// Draws the selection panel in `slot`, fading and sliding it in and out. Returns nothing at all
/// once it is gone, and nothing while nothing is selected or the slot has no room for it.
pub fn render_selection_view(
    view: &SelectionView,
    ctx: &Context,
    shown: bool,
    slot: StackSlot,
) -> Option<SelectionOutcome> {
    let id = Id::new("sb_selection_panel");
    let placed = slot.place(PANEL_WIDTH);
    // Pinned by its own bottom-left corner rather than by its middle: an area anchored by its
    // middle is placed from its size, which a panel coming back on screen does not know until it has
    // been laid out once, and would arrive sideways from half its width away.
    let area = Area::new(id)
        .pivot(Align2::LEFT_BOTTOM)
        .fixed_pos(pos2(placed.left, slot.screen_bottom - slot.bottom))
        .order(Order::Foreground);
    let shown = shown && view.case() != SelectionCase::Empty && fits(slot);
    let inner = motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        tiers::tier0_panel(ui, |ui| {
            // The body is placed by the sizes written here and by nothing else: this is a fixed
            // layout, and egui's own item spacing would add to every gap in it.
            ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
            ui.set_width(CONTENT_WIDTH);
            draw_body(ui, view)
        })
        .inner
    })?;
    Some(SelectionOutcome {
        rect: inner.response.rect,
        clicked: inner.inner,
    })
}

/// Whether the panel has room in `slot`.
pub(crate) fn fits(slot: StackSlot) -> bool {
    slot.room() >= PANEL_HEIGHT
}

fn draw_body(ui: &mut Ui, view: &SelectionView) -> Option<SelectedUnitClick> {
    let (body, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, BODY_HEIGHT), Sense::hover());
    let case = view.case();
    match case {
        SelectionCase::Empty => None,
        SelectionCase::Many => draw_grid(ui, body, &view.units),
        SelectionCase::Unit => view
            .units
            .first()
            .and_then(|subject| draw_unit(ui, body, subject)),
        SelectionCase::Building | SelectionCase::Producing | SelectionCase::Loaded => view
            .units
            .first()
            .and_then(|subject| draw_subject(ui, body, subject, case)),
    }
}

/// Makes `tile` the target for the unit at `index` of the selection, washing it while the pointer
/// is over it or pressing it.
fn unit_target(ui: &Ui, tile: Rect, index: usize) -> Option<SelectedUnitClick> {
    let response = ui.interact(
        tile,
        ui.id().with(("sb_selected_unit", index)),
        Sense::click(),
    );
    widgets::state_overlay(ui, &response, tile, theme::radius(theme::RADIUS_CHIP));
    if response.secondary_clicked() {
        Some(SelectedUnitClick::Follow(index))
    } else if response.clicked() {
        Some(SelectedUnitClick::Pick(index))
    } else {
        None
    }
}

/// Draws the grid of small tiles, filling each column from top to bottom in the game's order.
///
/// Centered in the body: with no column of text beside it the grid is the whole of what the panel has
/// to say.
fn draw_grid(ui: &Ui, body: Rect, units: &[SelectedUnitView]) -> Option<SelectedUnitClick> {
    let mut clicked = None;
    let size = vec2(
        GRID_SLOT * GRID_COLUMNS as f32 + GRID_GAP * (GRID_COLUMNS as f32 - 1.0),
        tile_row(GRID_SLOT) * GRID_ROWS as f32 + GRID_ROW_GAP,
    );
    let grid = Rect::from_center_size(body.center(), size);
    for (index, unit) in units.iter().take(SelectionView::MAX_UNITS).enumerate() {
        let column = (index / GRID_ROWS) as f32;
        let row = (index % GRID_ROWS) as f32;
        let tile = Rect::from_min_size(
            pos2(
                grid.left() + column * (GRID_SLOT + GRID_GAP),
                grid.top() + row * (tile_row(GRID_SLOT) + GRID_ROW_GAP),
            ),
            vec2(GRID_SLOT, GRID_SLOT),
        );
        paint_small_tile(ui, tile, unit, SLOT_CODE_SIZE);
        clicked = clicked.or(unit_target(ui, tile, index));
    }
    clicked
}

/// Draws a building, or anything making or carrying something: the subject with what it has left
/// under it, then its name and whose it is beside it, and whatever it is making or carrying under
/// that.
///
/// What a building is worth to a watcher is how much of it is left and what it is making, so it is
/// given no tally of kills: that is a unit's own reading. The upgrades it fights with run along the
/// bottom of the text column, as a unit's do, wherever the reading leaves that row free, with how
/// many of it are stacked at that row's other end.
fn draw_subject(
    ui: &Ui,
    body: Rect,
    unit: &SelectedUnitView,
    case: SelectionCase,
) -> Option<SelectedUnitClick> {
    let column = Rect::from_min_size(body.left_top(), vec2(SUBJECT_COLUMN, BODY_HEIGHT));
    let tile = Rect::from_min_size(
        pos2(column.center().x - SUBJECT_TILE * 0.5, column.top()),
        vec2(SUBJECT_TILE, SUBJECT_TILE),
    );
    let tint = health_tint(unit.health_fraction());
    paint_tile(ui, tile, unit.health_edge(), 1.0);
    paint_icon(ui, tile, unit.icon, SUBJECT_CODE_SIZE);
    let clicked = unit_target(ui, tile, 0);
    draw_readouts(ui, column, tile.bottom() + READOUT_LEAD, unit, tint);

    let text = Rect::from_min_size(
        pos2(body.left() + TEXT_LEFT, body.top()),
        vec2(TEXT_WIDTH, BODY_HEIGHT),
    );
    let below = draw_header(ui, text, unit);
    match (case, &unit.production) {
        (SelectionCase::Producing, Some(production)) => draw_production(ui, below, production),
        (SelectionCase::Loaded, _) => draw_cargo(ui, below, &unit.cargo),
        (SelectionCase::Building, _) => {
            if let Some(resources) = &unit.resources {
                draw_resources_left(ui, below, resources);
            }
        }
        _ => {}
    }
    if has_upgrade_row(unit, case) {
        let row = Rect::from_min_max(pos2(text.left(), text.bottom() - UPGRADE_CHIP), text.max);
        draw_upgrades(ui, row, &unit.upgrades);
        if let Some(stacked) = unit.stacked {
            draw_tally(
                ui,
                row,
                &tr!("observer.selectionStacked", "Stacked"),
                stacked,
            );
        }
    }
    clicked
}

/// Draws what is left to mine in a resource along the top of `rect`: its glyph, then the amount in
/// the resource's own color.
fn draw_resources_left(ui: &Ui, rect: Rect, resources: &ResourcesLeftView) {
    let line = Rect::from_min_size(rect.left_top(), vec2(rect.width(), RESOURCES_ROW));
    let glyph = Rect::from_center_size(
        pos2(line.left() + RESOURCES_GLYPH * 0.5, line.center().y),
        Vec2::splat(RESOURCES_GLYPH),
    );
    widgets::paint_resource_icon(ui.painter(), glyph, resources.glyph, resources.race, 1.0);
    paint_text(
        ui,
        Rect::from_min_max(pos2(glyph.right() + RESOURCES_GAP, line.top()), line.max),
        &text::numeral(NAME_SIZE).with_color(resources.glyph.color()),
        &resources.amount.to_string(),
        Align::LEFT,
    );
}

/// Whether the reading of a building, or of anything making or carrying something, leaves the
/// bottom of its text column free for the row of its upgrades.
///
/// A queue's progress line runs down to the floor of the body, and cargo slots fill it, so those
/// two readings have no row; the console gives up its own icons for both. Everything else here is
/// a header and at most one slot's line beside it, which leaves the row free: an egg's carapace
/// under what it is turning into, a cannon's shields and guns under the cannon going up.
fn has_upgrade_row(unit: &SelectedUnitView, case: SelectionCase) -> bool {
    match case {
        SelectionCase::Building => true,
        SelectionCase::Producing => unit
            .production
            .as_ref()
            .is_some_and(|production| production.is_subject || production.queue.is_none()),
        SelectionCase::Empty
        | SelectionCase::Many
        | SelectionCase::Unit
        | SelectionCase::Loaded => false,
    }
}

/// Draws a unit selected alone: the unit drawn large, and beside it its name and whose it is, a bar
/// for each pool it has, and the row of its upgrades with what it has killed at that row's other
/// end.
///
/// The bars are packed from the top, as many as the unit has pools, while the row of upgrades
/// keeps to the bottom of the body, so the chips stay where the eye left them as the watcher clicks
/// from a marine to a medic.
fn draw_unit(ui: &Ui, body: Rect, unit: &SelectedUnitView) -> Option<SelectedUnitClick> {
    let tile = Rect::from_center_size(
        pos2(body.left() + UNIT_TILE * 0.5, body.center().y),
        vec2(UNIT_TILE, UNIT_TILE),
    );
    paint_tile(ui, tile, unit.health_edge(), 1.0);
    paint_icon(ui, tile, unit.icon, UNIT_CODE_SIZE);
    let clicked = unit_target(ui, tile, 0);

    let text = Rect::from_min_size(
        pos2(body.left() + UNIT_TEXT_LEFT, body.top()),
        vec2(UNIT_TEXT_WIDTH, BODY_HEIGHT),
    );
    let below = draw_header(ui, text, unit);
    for (index, ((current, full), color)) in pools(unit, health_tint(hit_point_fraction(unit)))
        .into_iter()
        .enumerate()
    {
        let line = Rect::from_min_size(
            pos2(below.left(), below.top() + index as f32 * POOL_ROW),
            vec2(below.width(), POOL_ROW),
        );
        let track = centred(
            Rect::from_min_max(
                line.left_top(),
                pos2(
                    line.right() - POOL_VALUE_WIDTH - POOL_VALUE_GAP,
                    line.bottom(),
                ),
            ),
            POOL_TRACK,
        );
        let fraction = if full == 0 {
            1.0
        } else {
            current as f32 / full as f32
        };
        paint_track(ui, track, fraction, color);
        paint_text(
            ui,
            Rect::from_min_max(pos2(line.right() - POOL_VALUE_WIDTH, line.top()), line.max),
            &text::numeral(READOUT_SIZE).with_color(theme::TEXT_SECONDARY),
            &format!("{current}/{full}"),
            Align::RIGHT,
        );
    }

    let row = Rect::from_min_max(pos2(text.left(), text.bottom() - UPGRADE_CHIP), text.max);
    draw_upgrades(ui, row, &unit.upgrades);
    draw_tally(
        ui,
        row,
        &tr!("observer.selectionKills", "Kills"),
        unit.kills,
    );
    clicked
}

/// Draws the head of the text column: the subject's name, then whose it is, with its status at
/// that line's right end. Returns the room left under them.
///
/// A unit the host has no name for leaves no gap for one: the owner's line heads the column instead.
/// Nor does a unit nobody owns, a mineral field or a critter, whose line would be an empty bar,
/// unless it has a status to say.
fn draw_header(ui: &Ui, text: Rect, unit: &SelectedUnitView) -> Rect {
    let mut top = text.top();
    if let Some(name) = &unit.name {
        paint_text(
            ui,
            Rect::from_min_size(pos2(text.left(), top), vec2(text.width(), NAME_ROW)),
            &text::body(NAME_SIZE, text::BodyWeight::Semibold),
            name,
            Align::LEFT,
        );
        top += NAME_ROW;
    }
    if unit.owner.is_some() || unit.status.is_some() {
        let mut line = Rect::from_min_size(pos2(text.left(), top), vec2(text.width(), OWNER_ROW));
        if let Some(status) = &unit.status {
            // The owner is what the line is for, so a status long enough to crowd it out is the
            // one cut short, past the share of the line it may take.
            let room = if unit.owner.is_some() {
                line.width() * STATUS_SHARE
            } else {
                line.width()
            };
            let status_line = Rect::from_min_max(pos2(line.right() - room, line.top()), line.max);
            let status_width = draw_status(ui, status_line, status);
            line.max.x -= status_width + OWNER_GAP;
        }
        if unit.owner.is_some() {
            draw_owner(ui, line, unit);
        }
        top += OWNER_ROW;
    }
    Rect::from_min_max(pos2(text.left(), top + OWNER_LEAD), text.max)
}

/// Draws the subject's status against the right end of `line`. Returns how wide it is, which the
/// owner's name gives up.
fn draw_status(ui: &Ui, line: Rect, status: &UnitStatusView) -> f32 {
    let color = match status.color {
        StatusColor::Default => theme::TEXT_DIM,
        StatusColor::Green => theme::TEXT_POSITIVE,
        StatusColor::Red => theme::TEXT_NEGATIVE,
        StatusColor::Yellow => theme::TEXT_WARNING,
        StatusColor::White => theme::TEXT_PRIMARY,
    };
    let spec = text::body(STATUS_SIZE, text::BodyWeight::Semibold).with_color(color);
    let width = spec.galley(ui, &status.text).size().x.min(line.width());
    paint_text(ui, line, &spec, &status.text, Align::RIGHT);
    width
}

/// The subject's pools as the console lists them: shields for a unit that has them, then hit points
/// in `hit_point_color` for a unit that has them, then energy for a unit that has it, each in the
/// game's color for that pool.
fn pools(unit: &SelectedUnitView, hit_point_color: Color32) -> Vec<((u32, u32), Color32)> {
    let mut pools = Vec::with_capacity(READOUTS);
    if let Some(shields) = unit.shields {
        pools.push((shields, BLUE80));
    }
    if let Some(hit_points) = unit.hit_points {
        pools.push((hit_points, hit_point_color));
    }
    if let Some(energy) = unit.energy {
        pools.push((energy, PURPLE70));
    }
    pools
}

/// How much of its hit points a unit has left, from 0 to 1, shields aside: the hit point bar's own
/// reading, where the tile's tint is of everything keeping the unit alive.
fn hit_point_fraction(unit: &SelectedUnitView) -> f32 {
    let Some((current, full)) = unit.hit_points else {
        return 1.0;
    };
    if full == 0 {
        return 1.0;
    }
    (current as f32 / full as f32).clamp(0.0, 1.0)
}

/// Draws what the subject has left, one line each, the way the console writes them under its
/// wireframe: shields for a unit that has them, then hit points in the color of its health, then
/// energy for a unit that has it, each in the color the game gives that pool.
fn draw_readouts(ui: &Ui, column: Rect, top: f32, unit: &SelectedUnitView, tint: Color32) {
    for (index, ((current, full), color)) in pools(unit, tint).into_iter().enumerate() {
        let rect = Rect::from_min_size(
            pos2(column.left(), top + index as f32 * READOUT_ROW),
            vec2(column.width(), READOUT_ROW),
        );
        paint_text(
            ui,
            rect,
            &text::numeral(READOUT_SIZE).with_color(color),
            &format!("{current}/{full}"),
            Align::Center,
        );
    }
}

/// Draws whose the selection is: a square of their color, then their name.
fn draw_owner(ui: &Ui, rect: Rect, unit: &SelectedUnitView) {
    let swatch = Rect::from_min_size(
        pos2(rect.left(), rect.center().y - OWNER_SWATCH * 0.5),
        Vec2::splat(OWNER_SWATCH),
    );
    // The swatch is what says whose the selection is, and it is read against the colors on the
    // map rather than against the panel, so it is never drawn at less than its own color.
    paint_player_swatch(ui, swatch, unit.owner_color);
    paint_text(
        ui,
        Rect::from_min_max(pos2(swatch.right() + OWNER_GAP, rect.top()), rect.max),
        &text::player_name(OWNER_NAME_SIZE).with_color(theme::TEXT_SECONDARY),
        &unit.owner_name,
        Align::LEFT,
    );
}

/// Draws a count of the subject's, under `label`, against the right end of `row`, level with its
/// middle.
fn draw_tally(ui: &Ui, row: Rect, label: &str, count: u32) {
    let line = centred(row, TALLY_ROW);
    // The label is set against its number at the number's own width rather than in a column of its
    // own: a column wide enough for any count would leave a short one stranded from its label.
    let count = count.to_string();
    let count_width = text::numeral(TALLY_SIZE).galley(ui, &count).size().x;
    paint_text(ui, line, &text::numeral(TALLY_SIZE), &count, Align::RIGHT);
    paint_text(
        ui,
        Rect::from_min_max(
            line.min,
            pos2(line.right() - count_width - TALLY_LABEL_GAP, line.bottom()),
        ),
        &text::column_label(),
        label,
        Align::RIGHT,
    );
}

/// Draws the row of upgrades a unit fights with from the left end of `row`, and the card naming
/// the one under the pointer.
fn draw_upgrades(ui: &Ui, row: Rect, upgrades: &[UnitUpgradeView]) {
    let mut hovered = None;
    for (index, upgrade) in upgrades.iter().take(MAX_UPGRADES).enumerate() {
        let rect = Rect::from_min_size(
            pos2(
                row.left() + index as f32 * (UPGRADE_CHIP + UPGRADE_GAP),
                row.top(),
            ),
            Vec2::splat(UPGRADE_CHIP),
        );
        let response = ui.interact(rect, ui.id().with(("upgrade_chip", index)), Sense::hover());
        draw_upgrade_chip(ui, rect, upgrade, response.hovered());
        if let Some(pointer) = response.hover_pos() {
            hovered = Some((pointer, upgrade));
        }
    }
    if let Some((pointer, upgrade)) = hovered {
        draw_upgrade_hint(ui, pointer, upgrade);
    }
}

/// Draws one upgrade chip: the upgrade's icon, and the level it has reached in the corner.
fn draw_upgrade_chip(ui: &Ui, rect: Rect, upgrade: &UnitUpgradeView, hovered: bool) {
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    ui.painter()
        .rect_filled(rect, corner_radius, theme::alpha(GREY_BLUE20, 0.70));
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(
            theme::HAIRLINE,
            theme::alpha(BLUE80, if hovered { 0.45 } else { 0.10 }),
        ),
        StrokeKind::Inside,
    ));
    let icon_rect = rect.shrink(theme::HAIRLINE);
    match upgrade.icon.texture {
        Some(texture) => {
            upgrade.icon.paint(
                ui.painter(),
                texture,
                icon_rect,
                if hovered {
                    Color32::WHITE
                } else {
                    UPGRADE_ICON_TINT
                },
            );
        }
        None => paint_text(
            ui,
            icon_rect,
            &text::body(UPGRADE_CODE_SIZE, text::BodyWeight::Semibold).with_color(theme::TEXT_DIM),
            &unit_codes::code_or_index(upgrade.icon.index),
            Align::Center,
        ),
    }

    let galley =
        text::body(LEVEL_SIZE, text::BodyWeight::Semibold).galley(ui, &upgrade.level.to_string());
    ui.painter().galley(
        pos2(
            rect.right() - LEVEL_INSET - galley.size().x,
            rect.bottom() - LEVEL_INSET - galley.size().y,
        ),
        galley,
        theme::TEXT_PRIMARY,
    );
}

/// Names the upgrade under the pointer, the level it has reached, and what it comes to on the
/// unit: its armor, or the damage of each weapon it improves.
///
/// A weapon is named only where the upgrade improves two of them, which is the one time a damage
/// figure needs saying which weapon it is for.
fn draw_upgrade_hint(ui: &Ui, pointer: Pos2, upgrade: &UnitUpgradeView) {
    let detail = |ui: &mut Ui, line: &str| {
        ui.label(
            text::body(12.0, text::BodyWeight::Regular)
                .with_color(theme::TEXT_SECONDARY)
                .job(line),
        );
    };
    widgets::tooltip(ui.ctx(), Id::new("sb_upgrade_chip_hint"), pointer, |ui| {
        ui.spacing_mut().item_spacing = vec2(0.0, theme::SPACE_XS);
        if let Some(name) = &upgrade.name {
            ui.label(text::body(13.0, text::BodyWeight::Medium).job(name));
        }
        detail(
            ui,
            &tr!(
                "observer.researchLevel",
                "Level {{level}}",
                level = upgrade.level
            ),
        );
        match &upgrade.effect {
            UpgradeEffect::Armor { base, bonus } => detail(
                ui,
                &tr!(
                    "observer.upgradeArmor",
                    "Armor {{value}}",
                    value = upgraded_value(*base, *bonus, 1)
                ),
            ),
            UpgradeEffect::Shields => {}
            UpgradeEffect::Damage(weapons) => {
                for weapon in weapons {
                    if weapons.len() > 1
                        && let Some(name) = &weapon.name
                    {
                        ui.label(
                            text::body(12.0, text::BodyWeight::Medium)
                                .with_color(theme::TEXT_DIM)
                                .job(name),
                        );
                    }
                    detail(
                        ui,
                        &tr!(
                            "observer.upgradeDamage",
                            "Damage {{value}}",
                            value = upgraded_value(weapon.base, weapon.bonus, weapon.hits)
                        ),
                    );
                }
            }
        }
    });
}

/// Writes a figure the way the game's own tooltips write one: what the unit has of its own, then
/// what its upgrades add where they add anything, then how many hits it comes in where that is more
/// than one.
fn upgraded_value(base: u32, bonus: u32, hits: u32) -> String {
    let mut value = base.to_string();
    if bonus > 0 {
        value.push_str(&format!("+{bonus}"));
    }
    if hits > 1 {
        value.push_str(&format!(" \u{d7}{hits}"));
    }
    value
}

/// Draws what the subject is making the way the console draws its queue: a building training units
/// gets the queue's row of slots, the first being what is worked on and the rest what waits behind
/// it, with what the first one is and how far along it is under the row. Anything else is one thing
/// worked through alone, and gets its one slot with those beside it.
///
/// A subject that is itself what is being made, a building going up, is already named and drawn
/// at the head of the panel, so it gets no slot and no name a second time: only how far along it
/// is, under a label saying what that bar is.
fn draw_production(ui: &Ui, rect: Rect, production: &ProductionProgressView) {
    let progress = production.progress.clamp(0.0, 1.0);
    if production.is_subject {
        draw_progress(
            ui,
            Rect::from_min_size(
                rect.left_top(),
                vec2(QUEUE_WIDTH + PERCENT_GAP + PERCENT_WIDTH, PROGRESS_HEIGHT),
            ),
            Some(&tr!("observer.underConstruction", "Under construction")),
            progress,
        );
        return;
    }
    let first = Rect::from_min_size(rect.left_top(), vec2(QUEUE_SLOT, QUEUE_SLOT));
    paint_tile(ui, first, Some(theme::ACCENT), 1.0);
    paint_icon(ui, first, production.icon, QUEUE_CODE_SIZE);
    let block = match &production.queue {
        Some(queue) => {
            for index in 1..QUEUE_SLOTS {
                let slot = first.translate(vec2(index as f32 * (QUEUE_SLOT + QUEUE_GAP), 0.0));
                match queue.get(index - 1) {
                    Some(icon) => {
                        paint_tile(ui, slot, None, 1.0);
                        paint_icon(ui, slot, *icon, QUEUE_CODE_SIZE);
                    }
                    None => paint_tile(ui, slot, None, EMPTY_ALPHA),
                }
            }
            Rect::from_min_size(
                pos2(rect.left(), first.bottom() + PROGRESS_LEAD),
                vec2(QUEUE_WIDTH + PERCENT_GAP + PERCENT_WIDTH, PROGRESS_HEIGHT),
            )
        }
        None => Rect::from_min_size(
            pos2(
                first.right() + QUEUE_GAP,
                first.center().y - PROGRESS_HEIGHT * 0.5,
            ),
            vec2(
                QUEUE_WIDTH - QUEUE_SLOT - QUEUE_GAP + PERCENT_GAP + PERCENT_WIDTH,
                PROGRESS_HEIGHT,
            ),
        ),
    };
    draw_progress(ui, block, production.name.as_deref(), progress);
}

/// Draws a progress line in `block`: `name` saying what is on the way, then the bar of how far
/// along it is with the percentage after it.
fn draw_progress(ui: &Ui, block: Rect, name: Option<&str>, progress: f32) {
    if let Some(name) = name {
        paint_text(
            ui,
            Rect::from_min_size(block.left_top(), vec2(block.width(), PROGRESS_NAME_ROW)),
            &text::body(PROGRESS_NAME_SIZE, text::BodyWeight::Medium)
                .with_color(theme::TEXT_SECONDARY),
            name,
            Align::LEFT,
        );
    }
    let line = Rect::from_min_max(pos2(block.left(), block.bottom() - PROGRESS_ROW), block.max);
    let track = centred(
        Rect::from_min_max(
            line.left_top(),
            pos2(line.right() - PERCENT_WIDTH - PERCENT_GAP, line.bottom()),
        ),
        PROGRESS_TRACK,
    );
    paint_track(ui, track, progress, theme::ACCENT);
    paint_text(
        ui,
        Rect::from_min_max(pos2(line.right() - PERCENT_WIDTH, line.top()), line.max),
        &text::numeral(PERCENT_SIZE),
        &format!("{}%", (progress * 100.0).round() as u32),
        Align::RIGHT,
    );
}

/// Draws the units a transport or a bunker is carrying in the console's cargo slots, each with how
/// much of it is left.
///
/// Only the units that are actually in there: the game tells the panel what is loaded and not what
/// the room for it was, and slots padded out to eight would say a full bunker was half empty.
fn draw_cargo(ui: &Ui, rect: Rect, cargo: &[SelectedUnitView]) {
    for (index, unit) in cargo.iter().take(MAX_CARGO).enumerate() {
        let column = (index % CARGO_COLUMNS) as f32;
        let row = (index / CARGO_COLUMNS) as f32;
        let tile = Rect::from_min_size(
            pos2(
                rect.left() + column * (CARGO_SLOT + CARGO_GAP),
                rect.top() + row * (tile_row(CARGO_SLOT) + GRID_ROW_GAP),
            ),
            vec2(CARGO_SLOT, CARGO_SLOT),
        );
        paint_small_tile(ui, tile, unit, QUEUE_CODE_SIZE);
    }
}

/// Paints one unit as a small tile with the bar of its health under it, which is how the console
/// draws every unit that is one of several.
fn paint_small_tile(ui: &Ui, tile: Rect, unit: &SelectedUnitView, code_size: f32) {
    paint_tile(ui, tile, None, 1.0);
    paint_icon(ui, tile, unit.icon, code_size);
    let mut top = tile.bottom();
    if let Some((shields, full)) = unit.shields {
        let fraction = if full == 0 {
            1.0
        } else {
            shields as f32 / full as f32
        };
        let shield_bar = Rect::from_min_size(
            pos2(tile.left(), top + SHIELD_GAP),
            vec2(tile.width(), SHIELD_BAR),
        );
        // A deeper blue than the shields' number: the health bar's greens are as bright as that
        // number's blue, and a stream that blurs color is left only brightness to tell them by.
        paint_track(ui, shield_bar, fraction.clamp(0.0, 1.0), BLUE60);
        top = shield_bar.bottom();
    }
    if unit.hit_points.is_none() {
        return;
    }
    // Hit points alone where the shields have a bar of their own above it.
    let health = hit_point_fraction(unit);
    let bar = Rect::from_min_size(
        pos2(tile.left(), top + HEALTH_GAP),
        vec2(tile.width(), HEALTH_BAR),
    );
    paint_track(ui, bar, health, health_tint(health));
}

/// Paints a tile's chrome, outlined in `edge` where the tile has something to say through its edge
/// and in the panel's own quiet stroke where it has not.
fn paint_tile(ui: &Ui, rect: Rect, edge: Option<Color32>, alpha: f32) {
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    ui.painter().rect_filled(
        rect,
        corner_radius,
        theme::alpha(GREY_BLUE10, 0.85).gamma_multiply(alpha),
    );
    let edge = match edge {
        Some(edge) => edge.gamma_multiply(0.85),
        None => theme::alpha(BLUE80, 0.20),
    };
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, edge.gamma_multiply(alpha)),
        StrokeKind::Inside,
    ));
}

/// Paints what a tile carries: the game's own icon where the host has the atlas for it, and the
/// short code of what it is where it has not.
fn paint_icon(ui: &Ui, rect: Rect, icon: ProductionIcon, code_size: f32) {
    match icon.texture {
        Some(texture) => {
            icon.paint(
                ui.painter(),
                texture,
                rect.shrink(theme::SPACE_XS),
                Color32::WHITE,
            );
        }
        None => paint_text(
            ui,
            rect,
            &text::body(code_size, text::BodyWeight::Semibold).with_color(theme::TEXT_SECONDARY),
            &unit_codes::code_or_index(icon.index),
            Align::Center,
        ),
    }
}

/// The color the game tints a wireframe at this much health: green while the unit is barely hurt,
/// yellow once a third of it is gone, red once two thirds are.
fn health_tint(fraction: f32) -> Color32 {
    if fraction >= 2.0 / 3.0 {
        theme::TEXT_POSITIVE
    } else if fraction >= 1.0 / 3.0 {
        theme::TEXT_WARNING
    } else {
        theme::TEXT_NEGATIVE
    }
}

/// Paints a bar: its track, and however much of it is filled.
///
/// The track is drawn light enough to read against the panel, as the production panel's is: a bar
/// is read as a share of its whole, and with no whole to see, a third of a bar reads as a short
/// full one.
fn paint_track(ui: &Ui, rect: Rect, fraction: f32, color: Color32) {
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    ui.painter()
        .rect_filled(rect, corner_radius, theme::alpha(GREY_BLUE60, 0.30));
    let mut filled = rect;
    filled.set_right(rect.left() + rect.width() * fraction.clamp(0.0, 1.0));
    if filled.width() > 0.0 {
        ui.painter().rect_filled(filled, corner_radius, color);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(hit_points: (u32, u32), shields: Option<(u32, u32)>, index: u16) -> SelectedUnitView {
        SelectedUnitView {
            icon: ProductionIcon {
                texture: None,
                index,
                size: None,
                margin: 0.0,
                wireframe: None,
            },
            name: None,
            owner_color: Color32::WHITE,
            owner_name: String::new(),
            owner: None,
            hit_points: Some(hit_points),
            shields,
            energy: None,
            kills: 0,
            status: None,
            building: false,
            resources: None,
            stacked: None,
            production: None,
            cargo: Vec::new(),
            upgrades: Vec::new(),
        }
    }

    fn selection(units: Vec<SelectedUnitView>) -> SelectionView {
        SelectionView { units }
    }

    #[test]
    fn the_columns_fill_the_panels_own_width() {
        assert_eq!(
            crate::kit::tiers::panel_content_width(PANEL_WIDTH),
            CONTENT_WIDTH
        );
        assert_eq!(TEXT_LEFT + TEXT_WIDTH, CONTENT_WIDTH);
    }

    #[test]
    fn a_wireframe_turns_yellow_at_two_thirds_and_red_at_a_third() {
        assert_eq!(health_tint(1.0), theme::TEXT_POSITIVE);
        assert_eq!(health_tint(2.0 / 3.0), theme::TEXT_POSITIVE);
        assert_eq!(health_tint(0.66), theme::TEXT_WARNING);
        assert_eq!(health_tint(1.0 / 3.0), theme::TEXT_WARNING);
        assert_eq!(health_tint(0.33), theme::TEXT_NEGATIVE);
        assert_eq!(health_tint(0.0), theme::TEXT_NEGATIVE);
    }

    #[test]
    fn shields_count_towards_what_keeps_a_unit_alive() {
        // A dragoon with its shields stripped is half gone, whatever its hit points say.
        let stripped = unit((100, 100), Some((0, 100)), 0x42);
        assert_eq!(stripped.health_fraction(), 0.5);
        assert_eq!(health_tint(stripped.health_fraction()), theme::TEXT_WARNING);

        let whole = unit((100, 100), Some((100, 100)), 0x42);
        assert_eq!(whole.health_fraction(), 1.0);

        // A unit the game keeps no health for reads as whole rather than as about to die.
        assert_eq!(unit((0, 0), None, 0x42).health_fraction(), 1.0);
    }

    #[test]
    fn what_is_selected_decides_what_the_panel_reads_as() {
        assert_eq!(selection(Vec::new()).case(), SelectionCase::Empty);
        assert_eq!(
            selection(vec![unit((100, 100), None, 0x41)]).case(),
            SelectionCase::Unit
        );
        let mut barracks = unit((1000, 1000), None, 0x6F);
        barracks.building = true;
        assert_eq!(selection(vec![barracks]).case(), SelectionCase::Building);
        assert_eq!(
            selection(vec![
                unit((100, 100), None, 0x41),
                unit((100, 100), None, 0x41),
            ])
            .case(),
            SelectionCase::Many
        );

        let mut transport = unit((150, 150), None, 0x7D);
        transport.cargo = vec![unit((40, 40), None, 0x00)];
        assert_eq!(selection(vec![transport]).case(), SelectionCase::Loaded);

        let mut factory = unit((1250, 1250), None, 0x6B);
        factory.building = true;
        factory.production = Some(ProductionProgressView {
            icon: ProductionIcon {
                texture: None,
                index: 0x1E,
                size: None,
                margin: 0.0,
                wireframe: None,
            },
            name: None,
            progress: 0.5,
            queue: Some(Vec::new()),
            is_subject: false,
        });
        // What is being made is read before what is being carried, for the thing doing both.
        factory.cargo = vec![unit((40, 40), None, 0x00)];
        assert_eq!(selection(vec![factory]).case(), SelectionCase::Producing);
    }

    #[test]
    fn a_building_has_its_upgrades_wherever_its_reading_leaves_room() {
        let progress = |queue: Option<Vec<ProductionIcon>>, is_subject: bool| {
            Some(ProductionProgressView {
                icon: ProductionIcon {
                    texture: None,
                    index: 0x26,
                    size: None,
                    margin: 0.0,
                    wireframe: None,
                },
                name: None,
                progress: 0.5,
                queue,
                is_subject,
            })
        };
        let mut cannon = unit((100, 100), Some((100, 100)), 0xA2);
        cannon.building = true;
        assert!(has_upgrade_row(&cannon, SelectionCase::Building));

        // Going up, the cannon is still read out with its shields and guns under its progress.
        cannon.production = progress(None, true);
        assert!(has_upgrade_row(&cannon, SelectionCase::Producing));

        // An egg's carapace sits under what it is turning into.
        let mut egg = unit((200, 200), None, 0x24);
        egg.production = progress(None, false);
        assert!(has_upgrade_row(&egg, SelectionCase::Producing));

        // A queue runs down to the floor of the body even with nothing waiting in it.
        let mut gateway = unit((500, 500), Some((500, 500)), 0xA0);
        gateway.building = true;
        gateway.production = progress(Some(Vec::new()), false);
        assert!(!has_upgrade_row(&gateway, SelectionCase::Producing));

        let mut shuttle = unit((80, 80), Some((60, 60)), 0x45);
        shuttle.cargo = vec![unit((100, 100), Some((60, 60)), 0x41)];
        assert!(!has_upgrade_row(&shuttle, SelectionCase::Loaded));
    }

    #[test]
    fn a_figure_is_written_the_way_the_games_tooltips_write_one() {
        assert_eq!(upgraded_value(6, 0, 1), "6");
        assert_eq!(upgraded_value(6, 2, 1), "6+2");
        // A zealot's blades hit twice an attack.
        assert_eq!(upgraded_value(8, 1, 2), "8+1 \u{d7}2");
    }

    #[test]
    fn the_hit_point_bar_reads_hit_points_alone() {
        // A dragoon with its shields stripped has a full bar of hit points, and a tile that is not.
        let stripped = unit((100, 100), Some((0, 100)), 0x42);
        assert_eq!(hit_point_fraction(&stripped), 1.0);
        assert_eq!(hit_point_fraction(&unit((0, 0), None, 0x42)), 1.0);
    }

    #[test]
    fn a_resource_reads_as_what_is_left_in_it_rather_than_its_health() {
        let mut minerals = unit((0, 0), None, 0xB0);
        minerals.hit_points = None;
        minerals.resources = Some(ResourcesLeftView {
            glyph: ResourceGlyph::Minerals,
            race: None,
            amount: 1500,
        });
        assert!(pools(&minerals, theme::TEXT_POSITIVE).is_empty());
        assert_eq!(minerals.health_edge(), None);
        // Read out like a building whether or not the host calls it one.
        assert_eq!(selection(vec![minerals]).case(), SelectionCase::Building);

        // An assimilator on a geyser is worn down like any other building.
        let mut assimilator = unit((225, 450), Some((450, 450)), 0x9D);
        assimilator.building = true;
        assert_eq!(assimilator.health_edge(), Some(theme::TEXT_POSITIVE));
        assert_eq!(pools(&assimilator, theme::TEXT_POSITIVE).len(), 2);
    }

    #[test]
    fn the_panel_gives_way_where_its_slot_has_no_room() {
        let slot = |ceiling: f32| StackSlot {
            bottom: 16.0,
            span: crate::observer::layout::Span {
                left: 0.0,
                right: 1280.0,
            },
            anchor: crate::observer::StackAnchor::Middle,
            middle: 640.0,
            ceiling,
            screen_bottom: 960.0,
        };
        assert!(fits(slot(100.0)));
        assert!(!fits(slot(960.0 - 16.0 - PANEL_HEIGHT)));
    }
}
