//! The selection panel: what the watcher has selected, laid out the way the game's own console lays
//! out the middle of itself.
//!
//! An observer who hides the console loses the one thing on it they still use, which is the
//! selection. This panel is that part of the console alone, at the kit's ambient tier and about the
//! console's own footprint, with everything where the console puts it, so a watcher who has read
//! SC:R's console for twenty years finds every number where their eye already goes: the unit on the
//! left with what it has left under it, and whose it is to the right.
//!
//! A wireframe is a piece of the game's own art that no host here can draw yet, so the unit is drawn
//! as its icon where the host has the game's atlas and its short code where it has not, and the tint
//! the game puts on a wireframe goes on the tile's outline and on the bar under each small tile:
//! green, yellow and red as the unit's health falls through two thirds and a third of what it
//! started with.
//!
//! The console reads a selection as one of a few things at a time, and so does this:
//!
//! - Nothing selected is nothing drawn. A box that only says it is empty is a box in the way.
//! - Several units are the console's own grid: twelve slots in two rows of six, in the game's order,
//!   each with a thin bar of how much of the unit is left.
//! - One unit is read out: the unit drawn large, its hit points under it in the color of its health
//!   and its shields and energy under those, and to the right its name, as the console heads its
//!   readout with it, then whose it is and what it has killed.
//! - One thing making something shows what it is making in the console's queue: the slots of the
//!   queue in a row, the first being worked on, and what that one is and how far along it is under
//!   them.
//! - One transport or bunker with units inside shows them in the console's cargo slots, two rows of
//!   four.
//!
//! The body is the same height whichever of those is drawn, so the production and control-group
//! panels stacked on it stay where they are as the watcher clicks from one unit to the next.

use egui::{
    Align, Align2, Area, Color32, Context, Id, Order, Rect, Sense, Shape, Stroke, StrokeKind, Ui,
    pos2, vec2,
};

use crate::colors::{BLUE60, BLUE80, GREY_BLUE10, PURPLE70};
use crate::kit::text;
use crate::kit::{motion, theme, tiers};
use crate::observer::{
    ProductionIcon, StackSlot, centred, fit_icon, paint_player_bar, paint_text, unit_codes,
};
use crate::tr;

/// One selected unit.
pub struct SelectedUnitView {
    /// The game's own icon for this kind of unit, which is what names it until the host can draw
    /// the unit's wireframe.
    pub icon: ProductionIcon,
    /// What the game calls this kind of unit, in the game's language, or `None` where the host has
    /// no name for it.
    pub name: Option<String>,
    /// The color of the player who owns it, and their name.
    pub owner_color: Color32,
    pub owner_name: String,
    /// The game's own slot of the player who owns it, or `None` for a unit nobody owns.
    pub owner: Option<u8>,
    /// Hit points, current and full.
    pub hit_points: (u32, u32),
    /// Shields, current and full, for a unit that has any.
    pub shields: Option<(u32, u32)>,
    /// Energy, current and full, for a unit that has any.
    pub energy: Option<(u32, u32)>,
    /// How many units it has killed.
    pub kills: u32,
    /// Whether it is a building rather than a unit.
    pub building: bool,
    /// What it is making, for a building training a unit, researching, or upgrading, and for a
    /// morphing egg or cocoon. `None` while it is idle or is not the kind of thing that makes
    /// anything.
    pub production: Option<ProductionProgressView>,
    /// The units inside it, for a transport or a bunker. Empty for anything else, and for a
    /// transport that is empty.
    pub cargo: Vec<SelectedUnitView>,
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
        let (mut current, mut full) = (self.hit_points.0 as f32, self.hit_points.1 as f32);
        if let Some((shields, shields_full)) = self.shields {
            current += shields as f32;
            full += shields_full as f32;
        }
        if full <= 0.0 {
            return 1.0;
        }
        (current / full).clamp(0.0, 1.0)
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
            [_] => SelectionCase::One,
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
    /// One unit or building, read out as its own numbers.
    One,
    /// One unit or building with something on the way out of it.
    Producing,
    /// One unit or building with units inside it.
    Loaded,
}

/// How wide the panel is, in overlay points: about what the console's own middle section takes at
/// the design's scale, which is narrower than the panels stacked on it.
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

/// The most readouts there are: hit points, shields and energy.
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

/// Width of the bar of the owner's color, the gap between it and their name, and the height of the
/// line the two of them share.
const OWNER_BAR: f32 = 4.0;
const OWNER_GAP: f32 = 8.0;
const OWNER_ROW: f32 = 18.0;

/// Gap under the owner's line, and the height of the line of kills under it.
const OWNER_LEAD: f32 = 6.0;
const KILLS_ROW: f32 = 16.0;

/// How much of the text column the name and the owner's line take, above whatever the reading
/// draws under them.
const HEADER_HEIGHT: f32 = NAME_ROW + OWNER_ROW + OWNER_LEAD;

/// Gap between the label at the head of the kills line and the count after it.
const KILLS_LABEL_GAP: f32 = theme::SPACE_SM;

/// The shape of the grid, which is the console's own: two rows of six.
const GRID_COLUMNS: usize = 6;
const GRID_ROWS: usize = 2;

/// Side of one slot of the grid, and the gap between two of them.
const GRID_SLOT: f32 = 48.0;
const GRID_GAP: f32 = 8.0;

/// The bar under a small tile saying how much of its unit is left, and its gap from the tile.
const HEALTH_BAR: f32 = 3.0;
const HEALTH_GAP: f32 = 2.0;

/// Gap between the two rows of a grid of small tiles.
const GRID_ROW_GAP: f32 = 6.0;

/// How tall one row of a grid of small tiles of `side` is, its health bar included.
const fn tile_row(side: f32) -> f32 {
    side + HEALTH_GAP + HEALTH_BAR
}

/// The cargo slots, which are the console's own: two rows of four.
const CARGO_COLUMNS: usize = 4;
const CARGO_ROWS: usize = 2;
const CARGO_SLOT: f32 = 34.0;
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

/// Text size of the subject's name, of the readouts under the subject, of the owner's name, of the
/// kills count, and of the name and the percentage on a progress line.
const NAME_SIZE: f32 = 17.0;
const READOUT_SIZE: f32 = 14.0;
const OWNER_NAME_SIZE: f32 = 15.0;
const KILLS_SIZE: f32 = 15.0;
const PROGRESS_NAME_SIZE: f32 = 13.0;
const PERCENT_SIZE: f32 = 14.0;

/// How much of itself an empty queue slot is drawn at: faint, because it is the queue's shape rather
/// than anything in it.
const EMPTY_ALPHA: f32 = 0.32;

/// How tall the panel is on screen, chrome included.
pub(crate) const PANEL_HEIGHT: f32 = BODY_HEIGHT + tiers::PANEL_MARGIN_HEIGHT;

/// Draws the selection panel in `slot`, fading and sliding it in and out. Returns nothing at all
/// once it is gone, and nothing while nothing is selected or the slot has no room for it.
pub fn render_selection_view(
    view: &SelectionView,
    ctx: &Context,
    shown: bool,
    slot: StackSlot,
) -> Option<Rect> {
    let id = Id::new("sb_selection_panel");
    let (_, offset_x) = slot.place(PANEL_WIDTH);
    let area = Area::new(id)
        .anchor(Align2::CENTER_BOTTOM, vec2(offset_x, -slot.bottom))
        .order(Order::Foreground);
    let shown = shown && view.case() != SelectionCase::Empty && fits(slot);
    let inner = motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        tiers::tier0_panel(ui, |ui| {
            // The body is placed by the sizes written here and by nothing else: this is a fixed
            // layout, and egui's own item spacing would add to every gap in it.
            ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
            ui.set_width(CONTENT_WIDTH);
            draw_body(ui, view);
        })
        .inner
    })?;
    Some(inner.response.rect)
}

/// Whether the panel has room in `slot`.
pub(crate) fn fits(slot: StackSlot) -> bool {
    slot.room() >= PANEL_HEIGHT
}

fn draw_body(ui: &mut Ui, view: &SelectionView) {
    let (body, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, BODY_HEIGHT), Sense::hover());
    let case = view.case();
    match case {
        SelectionCase::Empty => {}
        SelectionCase::Many => draw_grid(ui, body, &view.units),
        SelectionCase::One | SelectionCase::Producing | SelectionCase::Loaded => {
            if let Some(subject) = view.units.first() {
                draw_subject(ui, body, subject, case);
            }
        }
    }
}

/// Draws the grid of small tiles, filling it in the game's order from the top left.
///
/// Centred in the body: with no column of text beside it the grid is the whole of what the panel has
/// to say.
fn draw_grid(ui: &Ui, body: Rect, units: &[SelectedUnitView]) {
    let size = vec2(
        GRID_SLOT * GRID_COLUMNS as f32 + GRID_GAP * (GRID_COLUMNS as f32 - 1.0),
        tile_row(GRID_SLOT) * GRID_ROWS as f32 + GRID_ROW_GAP,
    );
    let grid = Rect::from_center_size(body.center(), size);
    for (index, unit) in units.iter().take(SelectionView::MAX_UNITS).enumerate() {
        let column = (index % GRID_COLUMNS) as f32;
        let row = (index / GRID_COLUMNS) as f32;
        let tile = Rect::from_min_size(
            pos2(
                grid.left() + column * (GRID_SLOT + GRID_GAP),
                grid.top() + row * (tile_row(GRID_SLOT) + GRID_ROW_GAP),
            ),
            vec2(GRID_SLOT, GRID_SLOT),
        );
        paint_small_tile(ui, tile, unit, SLOT_CODE_SIZE);
    }
}

/// Draws a selection of one: the unit with what it has left under it, then its name and whose it is
/// beside it, and whatever it is making or carrying under that.
///
/// A unit the host has no name for leaves no gap for one: the owner's line heads the column instead.
fn draw_subject(ui: &Ui, body: Rect, unit: &SelectedUnitView, case: SelectionCase) {
    let column = Rect::from_min_size(body.left_top(), vec2(SUBJECT_COLUMN, BODY_HEIGHT));
    let tile = Rect::from_min_size(
        pos2(column.center().x - SUBJECT_TILE * 0.5, column.top()),
        vec2(SUBJECT_TILE, SUBJECT_TILE),
    );
    let tint = health_tint(unit.health_fraction());
    paint_tile(ui, tile, Some(tint), 1.0);
    paint_icon(ui, tile, unit.icon, SUBJECT_CODE_SIZE);
    draw_readouts(ui, column, tile.bottom() + READOUT_LEAD, unit, tint);

    let text = Rect::from_min_size(
        pos2(body.left() + TEXT_LEFT, body.top()),
        vec2(TEXT_WIDTH, BODY_HEIGHT),
    );
    let mut top = text.top();
    if let Some(name) = &unit.name {
        paint_text(
            ui,
            Rect::from_min_size(pos2(text.left(), top), vec2(TEXT_WIDTH, NAME_ROW)),
            &text::body(NAME_SIZE, text::BodyWeight::Semibold),
            name,
            Align::LEFT,
        );
        top += NAME_ROW;
    }
    draw_owner(
        ui,
        Rect::from_min_size(pos2(text.left(), top), vec2(TEXT_WIDTH, OWNER_ROW)),
        unit,
    );
    let below = Rect::from_min_max(pos2(text.left(), top + OWNER_ROW + OWNER_LEAD), text.max);
    match (case, &unit.production) {
        (SelectionCase::Producing, Some(production)) => draw_production(ui, below, production),
        (SelectionCase::Loaded, _) => draw_cargo(ui, below, &unit.cargo),
        // What a building is worth to a watcher is how much of it is left and what it is making, so
        // a tally of kills is a unit's own reading.
        _ if !unit.building => draw_kills(ui, below, unit.kills),
        _ => {}
    }
}

/// Draws what the subject has left, one line each, the way the console writes them under its
/// wireframe: hit points in the color of its health, then shields and energy for a unit that has
/// them, each in the color the game gives that pool.
fn draw_readouts(ui: &Ui, column: Rect, top: f32, unit: &SelectedUnitView, tint: Color32) {
    let mut readouts = vec![(unit.hit_points, tint)];
    if let Some(shields) = unit.shields {
        readouts.push((shields, BLUE80));
    }
    if let Some(energy) = unit.energy {
        readouts.push((energy, PURPLE70));
    }
    for (index, ((current, full), color)) in readouts.into_iter().enumerate() {
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

/// Draws whose the selection is: the bar of their color, then their name.
fn draw_owner(ui: &Ui, rect: Rect, unit: &SelectedUnitView) {
    let bar = centred(
        Rect::from_min_size(rect.left_top(), vec2(OWNER_BAR, rect.height())),
        rect.height() - theme::SPACE_XS,
    );
    // The bar is what says whose the selection is, and it is read against the colors on the map
    // rather than against the panel, so it is never drawn at less than its own color.
    paint_player_bar(ui, bar, unit.owner_color, 1.0);
    paint_text(
        ui,
        Rect::from_min_max(pos2(bar.right() + OWNER_GAP, rect.top()), rect.max),
        &text::player_name(OWNER_NAME_SIZE).with_color(theme::TEXT_SECONDARY),
        &unit.owner_name,
        Align::LEFT,
    );
}

/// Draws the line of what the subject has killed.
fn draw_kills(ui: &Ui, rect: Rect, kills: u32) {
    let line = Rect::from_min_size(
        pos2(rect.left() + OWNER_BAR + OWNER_GAP, rect.top()),
        vec2(rect.width() - OWNER_BAR - OWNER_GAP, KILLS_ROW),
    );
    // The number follows its label at the label's own length rather than in a column of its own:
    // a column wide enough for the longest translation of the word would leave English's count
    // stranded from it.
    let label = tr!("observer.selectionKills", "Kills");
    let label_width = text::column_label().galley(ui, &label).size().x;
    paint_text(ui, line, &text::column_label(), &label, Align::LEFT);
    paint_text(
        ui,
        Rect::from_min_max(
            pos2(line.left() + label_width + KILLS_LABEL_GAP, line.top()),
            line.max,
        ),
        &text::numeral(KILLS_SIZE),
        &kills.to_string(),
        Align::LEFT,
    );
}

/// Draws what the subject is making the way the console draws its queue: a building training units
/// gets the queue's row of slots, the first being what is worked on and the rest what waits behind
/// it, with what the first one is and how far along it is under the row. Anything else is one thing
/// worked through alone, and gets its one slot with those beside it.
fn draw_production(ui: &Ui, rect: Rect, production: &ProductionProgressView) {
    let progress = production.progress.clamp(0.0, 1.0);
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
    if let Some(name) = &production.name {
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
    paint_track(ui, track, progress, BLUE60);
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
    let health = unit.health_fraction();
    let bar = Rect::from_min_size(
        pos2(tile.left(), tile.bottom() + HEALTH_GAP),
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
            ui.painter().image(
                texture,
                fit_icon(rect.shrink(theme::SPACE_XS), icon.size),
                Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
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
fn paint_track(ui: &Ui, rect: Rect, fraction: f32, color: Color32) {
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    ui.painter()
        .rect_filled(rect, corner_radius, theme::alpha(GREY_BLUE10, 0.90));
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
            },
            name: None,
            owner_color: Color32::WHITE,
            owner_name: String::new(),
            owner: None,
            hit_points,
            shields,
            energy: None,
            kills: 0,
            building: false,
            production: None,
            cargo: Vec::new(),
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
            SelectionCase::One
        );
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
            },
            name: None,
            progress: 0.5,
            queue: Some(Vec::new()),
        });
        // What is being made is read before what is being carried, for the thing doing both.
        factory.cargo = vec![unit((40, 40), None, 0x00)];
        assert_eq!(selection(vec![factory]).case(), SelectionCase::Producing);
    }

    #[test]
    fn the_panel_gives_way_where_its_slot_has_no_room() {
        let slot = |ceiling: f32| StackSlot {
            bottom: 16.0,
            span: crate::observer::layout::Span {
                left: 0.0,
                right: 1280.0,
            },
            middle: 640.0,
            ceiling,
            screen_bottom: 960.0,
        };
        assert!(fits(slot(100.0)));
        assert!(!fits(slot(960.0 - 16.0 - PANEL_HEIGHT)));
    }
}
