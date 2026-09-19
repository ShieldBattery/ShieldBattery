//! The selection panel: what the watcher has selected, standing in for the game's own console.
//!
//! An observer who hides the console loses the one thing on it they still use, which is the
//! selection: the wireframes of whatever they clicked, and the numbers on a single unit. This panel
//! is that part of the console alone, at the kit's ambient tier in the band the console would have
//! taken, so the centred panels above it stack on it the way they stack on the console.
//!
//! A wireframe is a piece of the game's own art that no host here can draw yet, so a tile carries
//! the unit's icon where the host has the game's atlas and its short code where it has not, and the
//! tint the game puts on a wireframe is put on the tile's outline instead: green, yellow and red as
//! the unit's health falls through two thirds and a third of what it started with.
//!
//! The console reads a selection as one of a few things at a time, and so does this:
//!
//! - Nothing selected is the line that says so. The panel is drawn then as readily as with
//!   something, because a watcher clicking around a map selects and deselects constantly.
//! - Several units are the console's own grid alone: twelve slots in two rows of six, in the game's
//!   order. Twelve sets of numbers at once are not numbers anybody reads, so there are none.
//! - One unit is read out: the unit drawn large, whose it is, then what it has left and what it has
//!   killed, on as many rows as it has readings for. A transport or a bunker adds the units it is
//!   carrying beside those numbers.
//! - One thing making something, which is a building training or researching and an egg or a cocoon
//!   mid-morph, shows what it is making and how far along it is in place of carried units.
//!
//! The body is the same height whichever of those is drawn, and the production and control-group
//! panels are stacked directly on top of it: a body that grew and shrank with the selection would
//! move every panel above it each time the watcher clicked the ground.

use egui::{
    Align, Align2, Area, Color32, Context, Id, Order, Rect, Sense, Shape, Stroke, StrokeKind, Ui,
    pos2, vec2,
};

use crate::colors::{BLUE60, BLUE80, GREY_BLUE10, PURPLE70};
use crate::kit::text;
use crate::kit::widgets;
use crate::kit::{motion, theme, tiers};
use crate::observer::{
    ProductionIcon, centred, paint_player_bar, paint_text, paint_tile_chrome, unit_codes,
};
use crate::tr;

/// One selected unit.
pub struct SelectedUnitView {
    /// The game's own icon for this kind of unit, which is what names it until the host can draw
    /// the unit's wireframe.
    pub icon: ProductionIcon,
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
    /// How far along it is, from 0 to 1.
    pub progress: f32,
    /// How many more are queued behind it.
    pub queued: u32,
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
    /// The most units the game lets a selection hold, and the most wireframes the panel draws.
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
    /// Several units, read as the grid of wireframes alone.
    Many,
    /// One unit or building, read out as its own numbers.
    One,
    /// One unit or building with something on the way out of it.
    Producing,
    /// One unit or building with units inside it.
    Loaded,
}

/// How wide the panel is, in overlay points.
///
/// The production panel's own width rather than one of its own: the two are drawn one above the
/// other in the middle of the screen, and a centred stack of surfaces of different widths reads as
/// a pile rather than as a column.
pub const PANEL_WIDTH: f32 = crate::observer::production::PANEL_WIDTH;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = PANEL_WIDTH - 24.0;

/// The shape of the wireframe grid, which is the console's own: two rows of six.
const SLOT_COLUMNS: usize = 6;
const SLOT_ROWS: usize = 2;

/// Size of one slot of that grid, and the gap between two of them.
const SLOT_WIDTH: f32 = 42.0;
const SLOT_HEIGHT: f32 = 42.0;
const SLOT_GAP: f32 = 6.0;

/// What the grid takes of the panel.
const GRID_WIDTH: f32 = SLOT_WIDTH * SLOT_COLUMNS as f32 + SLOT_GAP * (SLOT_COLUMNS as f32 - 1.0);
const GRID_HEIGHT: f32 = SLOT_HEIGHT * SLOT_ROWS as f32 + SLOT_GAP * (SLOT_ROWS as f32 - 1.0);

/// The grid is the selection: a slot fewer than the game hands out would drop units off the end of
/// a full selection with nothing to say it had.
const _: () = assert!(SLOT_COLUMNS * SLOT_ROWS == SelectionView::MAX_UNITS);

/// Size of the tile a selection of one is drawn at, which is the unit large enough to be the
/// subject of the panel rather than one slot of a grid.
const SUBJECT_TILE: f32 = 64.0;

/// Gap between that tile and the reading beside it.
const SUBJECT_GAP: f32 = 12.0;

/// Width of the bar of the owner's color, the gap between it and their name, and the height of the
/// line the two of them share.
const OWNER_BAR: f32 = 4.0;
const OWNER_GAP: f32 = 8.0;
const OWNER_ROW: f32 = 18.0;

/// Gap between that line and the rows of numbers under it.
const OWNER_LEAD: f32 = 10.0;

/// Height of one row of numbers, and the gap between two of them.
const DETAIL_ROW: f32 = 17.0;
const DETAIL_ROW_GAP: f32 = 6.0;

/// The most rows of numbers a unit has: health, shields, energy, and what it has killed.
const DETAIL_ROWS: usize = 4;

/// How tall the panel's body is.
///
/// The tallest of the readings, which is a unit with every row of numbers it can have. The others
/// are laid out in the same box rather than in one of their own, so that the panels stacked on this
/// one stay where they are as the selection changes under them.
const BODY_HEIGHT: f32 = OWNER_ROW
    + OWNER_LEAD
    + DETAIL_ROW * DETAIL_ROWS as f32
    + DETAIL_ROW_GAP * (DETAIL_ROWS as f32 - 1.0);

/// The grid is drawn inside the body it shares with the readings that are taller than it.
const _: () = assert!(BODY_HEIGHT >= GRID_HEIGHT);

/// Width of the label at the head of a row of numbers, and of the pair of numbers at its tail.
///
/// The label column is wider than the English abbreviations in it need, because those words are
/// abbreviations rather than symbols: a language whose shortest word for shields is five letters
/// long writes five letters here.
const ROW_LABEL_WIDTH: f32 = 62.0;
const ROW_VALUE_WIDTH: f32 = 74.0;

/// Gap between a row's bar and what is written on either side of it.
const ROW_INNER_GAP: f32 = 6.0;

/// Width of the bar itself.
const BAR_WIDTH: f32 = 112.0;

/// How thick a bar is. Thin, because it is the shape of a number the row already writes out: a bar
/// of any weight beside those numbers would be read first and say less.
const BAR_TRACK: f32 = 5.0;

/// Width of the column of numbers, which the owner's line shares so that a long name ends where the
/// numbers under it do.
const NUMBERS_WIDTH: f32 =
    ROW_LABEL_WIDTH + ROW_INNER_GAP + BAR_WIDTH + ROW_INNER_GAP + ROW_VALUE_WIDTH;

/// Gap between the numbers and the column beside them.
const SIDE_GAP: f32 = 24.0;

/// Width of that column: whatever the tile, the numbers and the gaps leave of the panel.
const SIDE_WIDTH: f32 = CONTENT_WIDTH - SUBJECT_TILE - SUBJECT_GAP - NUMBERS_WIDTH - SIDE_GAP;

/// How far the numbers sit below the top of what they are read with: the owner's line, and the gap
/// under it. The column beside them starts there too, since what it carries is read against the
/// numbers rather than against the name above them.
const NUMBERS_TOP: f32 = OWNER_ROW + OWNER_LEAD;

/// The lowest the column beside the numbers can start, which is against the shortest reading there
/// is: one row of numbers, centred in a body sized for four of them.
const LOWEST_SIDE_TOP: f32 = (BODY_HEIGHT - NUMBERS_TOP - DETAIL_ROW) * 0.5 + NUMBERS_TOP;

/// The most carried units the panel draws, which is the most the game puts inside anything.
const MAX_CARGO: usize = 8;

/// Size of one carried unit's slot, and the gap between two of them.
const CARGO_SLOT: f32 = 26.0;
const CARGO_GAP: f32 = 4.0;

/// Height of the label over the carried units, and the gap between it and them.
const CARGO_LABEL_HEIGHT: f32 = 14.0;
const CARGO_LABEL_GAP: f32 = 4.0;

/// How tall the carried units and their label are together.
const CARGO_HEIGHT: f32 = CARGO_LABEL_HEIGHT + CARGO_LABEL_GAP + CARGO_SLOT;

/// The carried units are one row of the panel: checked where the sizes are written, because a slot
/// more than fits would be drawn outside the panel's chrome.
const _: () =
    assert!(CARGO_SLOT * MAX_CARGO as f32 + CARGO_GAP * (MAX_CARGO as f32 - 1.0) <= SIDE_WIDTH);
const _: () = assert!(LOWEST_SIDE_TOP + CARGO_HEIGHT <= BODY_HEIGHT);

/// Size of the tile carrying what is being made, and the gap between it and the progress beside it.
const ITEM_TILE: f32 = 40.0;
const ITEM_GAP: f32 = 10.0;

/// Height of the line how far along something is is written on, of the line what is behind it is
/// written on, and of the gaps around the bar between them.
const PERCENT_ROW: f32 = 16.0;
const QUEUED_ROW: f32 = 14.0;
const PROGRESS_GAP: f32 = 5.0;

/// How tall what is being made is drawn: its tile, or the lines beside it where those run longer.
const PRODUCTION_HEIGHT: f32 = {
    let lines = PERCENT_ROW + PROGRESS_GAP + BAR_TRACK + PROGRESS_GAP + QUEUED_ROW;
    if lines > ITEM_TILE { lines } else { ITEM_TILE }
};
const _: () = assert!(LOWEST_SIDE_TOP + PRODUCTION_HEIGHT <= BODY_HEIGHT);

/// Text size of the unit's code in a grid slot, in the subject's own larger tile, in a carried
/// unit's slot, and on the tile of what is being made.
const SLOT_CODE_SIZE: f32 = 12.0;
const SUBJECT_CODE_SIZE: f32 = 16.0;
const CARGO_CODE_SIZE: f32 = 11.0;
const ITEM_CODE_SIZE: f32 = 11.5;

/// Text size of the owner's name, matching the other centred panels' so the stack reads as one set.
const OWNER_NAME_SIZE: f32 = 15.0;

/// Text size of the pair of numbers at the end of a row, of how far along something being made is,
/// of what is waiting behind it, and of the line that says nothing is selected.
const VALUE_SIZE: f32 = 12.5;
const PERCENT_SIZE: f32 = 14.0;
const QUEUED_SIZE: f32 = 12.0;
const EMPTY_SIZE: f32 = 13.0;

/// How much of itself a slot with nothing in it is drawn at.
///
/// Faint, because it is the grid rather than a reading: all twelve slots are always drawn so that
/// the units in them never move, and an empty one has nothing of its own to say.
const EMPTY_ALPHA: f32 = 0.32;

/// Draws the selection panel `bottom` points above the screen's own bottom edge, fading and sliding
/// it in and out. Returns nothing at all once it is gone.
pub fn render_selection_view(
    view: &SelectionView,
    ctx: &Context,
    shown: bool,
    bottom: f32,
) -> Option<Rect> {
    let id = Id::new("sb_selection_panel");
    let area = Area::new(id)
        .anchor(Align2::CENTER_BOTTOM, vec2(0.0, -bottom))
        .order(Order::Foreground);
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

fn draw_body(ui: &mut Ui, view: &SelectionView) {
    widgets::panel_header(ui, &tr!("observer.panelSelection", "Selection"), Some("S"));
    let (body, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, BODY_HEIGHT), Sense::hover());
    let case = view.case();
    match case {
        SelectionCase::Empty => paint_text(
            ui,
            body,
            &text::body(EMPTY_SIZE, text::BodyWeight::Medium).with_color(theme::TEXT_LABEL),
            &tr!("observer.selectionEmpty", "Nothing selected"),
            Align::Center,
        ),
        // Centred in the body rather than hung from its left edge: with no numbers beside it the
        // grid is the whole of what the panel has to say, and a panel half of which is empty reads
        // as one that failed to draw the rest.
        SelectionCase::Many => draw_grid(
            ui,
            Rect::from_center_size(body.center(), vec2(GRID_WIDTH, GRID_HEIGHT)),
            &view.units,
        ),
        SelectionCase::One | SelectionCase::Producing | SelectionCase::Loaded => {
            if let Some(subject) = view.units.first() {
                draw_subject(ui, body, subject, case);
            }
        }
    }
}

/// Draws the grid of slots, filled or not.
fn draw_grid(ui: &Ui, rect: Rect, units: &[SelectedUnitView]) {
    for index in 0..SLOT_COLUMNS * SLOT_ROWS {
        let column = (index % SLOT_COLUMNS) as f32;
        let row = (index / SLOT_COLUMNS) as f32;
        let slot = Rect::from_min_size(
            pos2(
                rect.left() + column * (SLOT_WIDTH + SLOT_GAP),
                rect.top() + row * (SLOT_HEIGHT + SLOT_GAP),
            ),
            vec2(SLOT_WIDTH, SLOT_HEIGHT),
        );
        paint_unit_tile(ui, slot, units.get(index), SLOT_CODE_SIZE);
    }
}

/// Draws a selection of one: the unit itself, whose it is, the numbers it has, and whatever it is
/// making or carrying.
fn draw_subject(ui: &Ui, body: Rect, unit: &SelectedUnitView, case: SelectionCase) {
    paint_unit_tile(
        ui,
        Rect::from_center_size(
            pos2(body.left() + SUBJECT_TILE * 0.5, body.center().y),
            vec2(SUBJECT_TILE, SUBJECT_TILE),
        ),
        Some(unit),
        SUBJECT_CODE_SIZE,
    );

    // The reading is centred in a body sized for the longest one there is, so that the two or three
    // lines a bunker has are a block against the tile rather than a line hung from the ceiling of a
    // mostly empty panel.
    let rows = number_rows(unit);
    let height =
        NUMBERS_TOP + DETAIL_ROW * rows.len() as f32 + DETAIL_ROW_GAP * (rows.len() - 1) as f32;
    let top = body.top() + ((BODY_HEIGHT - height) * 0.5).max(0.0);
    let left = body.left() + SUBJECT_TILE + SUBJECT_GAP;
    draw_owner(
        ui,
        Rect::from_min_size(pos2(left, top), vec2(NUMBERS_WIDTH, OWNER_ROW)),
        unit,
    );
    for (index, row) in rows.iter().enumerate() {
        let rect = Rect::from_min_size(
            pos2(
                left,
                top + NUMBERS_TOP + index as f32 * (DETAIL_ROW + DETAIL_ROW_GAP),
            ),
            vec2(NUMBERS_WIDTH, DETAIL_ROW),
        );
        match row {
            NumberRow::Pool {
                label,
                value,
                color,
            } => paint_bar_row(ui, rect, label, *value, *color),
            NumberRow::Tally { label, value } => paint_value_row(ui, rect, label, value),
        }
    }

    let side = Rect::from_min_max(
        pos2(body.right() - SIDE_WIDTH, top + NUMBERS_TOP),
        body.right_bottom(),
    );
    match (case, &unit.production) {
        (SelectionCase::Producing, Some(production)) => draw_production(ui, side, production),
        (SelectionCase::Loaded, _) => draw_cargo(ui, side, &unit.cargo),
        _ => {}
    }
}

/// One row of what a selection of one is read out as.
enum NumberRow {
    /// How much of a pool is left, against what it holds.
    Pool {
        label: String,
        value: (u32, u32),
        color: Color32,
    },
    /// A number that stands on its own.
    Tally { label: String, value: String },
}

/// The rows this unit has, in the order they are read.
///
/// Only the ones it has a reading for, packed: a marine's two lines sit together rather than around
/// the gaps where a templar's shields and energy would be. What a building is worth to a watcher is
/// how much of it is left and what it is making, so the energy pool and the tally of kills are a
/// unit's own reading.
fn number_rows(unit: &SelectedUnitView) -> Vec<NumberRow> {
    let mut rows = vec![NumberRow::Pool {
        label: tr!("observer.selectionHitPoints", "HP"),
        value: unit.hit_points,
        color: theme::TEXT_POSITIVE,
    }];
    if let Some(shields) = unit.shields {
        rows.push(NumberRow::Pool {
            label: tr!("observer.selectionShields", "SHL"),
            value: shields,
            color: BLUE60,
        });
    }
    if !unit.building {
        if let Some(energy) = unit.energy {
            rows.push(NumberRow::Pool {
                label: tr!("observer.selectionEnergy", "NRG"),
                value: energy,
                color: PURPLE70,
            });
        }
        rows.push(NumberRow::Tally {
            label: tr!("observer.selectionKills", "Kills"),
            value: unit.kills.to_string(),
        });
    }
    rows
}

/// Draws whose the selection is: the bar of their color, then their name.
fn draw_owner(ui: &Ui, rect: Rect, unit: &SelectedUnitView) {
    let bar = Rect::from_min_size(rect.left_top(), vec2(OWNER_BAR, rect.height()));
    paint_player_bar(
        ui,
        bar,
        unit.owner_color,
        // The bar is what says whose the selection is, and it is read against the colors on the map
        // rather than against the panel, so it is never drawn at less than its own color.
        1.0,
    );
    paint_text(
        ui,
        Rect::from_min_max(pos2(bar.right() + OWNER_GAP, rect.top()), rect.max),
        &text::player_name(OWNER_NAME_SIZE).with_color(theme::TEXT_PRIMARY),
        &unit.owner_name,
        Align::LEFT,
    );
}

/// Draws the units a transport or a bunker is carrying, each tinted by its own health.
///
/// Only the units that are actually in there: the game tells the panel what is loaded and not what
/// the room for it was, and a row padded out to eight would say a full bunker was half empty.
fn draw_cargo(ui: &Ui, rect: Rect, cargo: &[SelectedUnitView]) {
    paint_text(
        ui,
        Rect::from_min_size(rect.left_top(), vec2(rect.width(), CARGO_LABEL_HEIGHT)),
        &text::column_label(),
        &tr!("observer.selectionCargo", "Cargo"),
        Align::LEFT,
    );
    let top = rect.top() + CARGO_LABEL_HEIGHT + CARGO_LABEL_GAP;
    for (index, unit) in cargo.iter().take(MAX_CARGO).enumerate() {
        let slot = Rect::from_min_size(
            pos2(rect.left() + index as f32 * (CARGO_SLOT + CARGO_GAP), top),
            vec2(CARGO_SLOT, CARGO_SLOT),
        );
        paint_unit_tile(ui, slot, Some(unit), CARGO_CODE_SIZE);
    }
}

/// Draws what the selection is making: the thing itself, how far along it is, and how much is
/// waiting behind it.
fn draw_production(ui: &Ui, rect: Rect, production: &ProductionProgressView) {
    let tile = Rect::from_min_size(rect.left_top(), vec2(ITEM_TILE, ITEM_TILE));
    paint_tile_chrome(ui, tile, false);
    paint_icon(ui, tile, production.icon, ITEM_CODE_SIZE);

    let left = tile.right() + ITEM_GAP;
    let width = rect.right() - left;
    let progress = production.progress.clamp(0.0, 1.0);
    paint_text(
        ui,
        Rect::from_min_size(pos2(left, rect.top()), vec2(width, PERCENT_ROW)),
        &text::numeral(PERCENT_SIZE),
        &format!("{}%", (progress * 100.0).round() as u32),
        Align::LEFT,
    );
    let track = Rect::from_min_size(
        pos2(left, rect.top() + PERCENT_ROW + PROGRESS_GAP),
        vec2(width, BAR_TRACK),
    );
    paint_track(ui, track, progress, BLUE60);
    // An empty queue writes nothing at all: what the line is read for is that more is on the way,
    // and one saying that none is would have to be read before it could be dismissed.
    if production.queued > 0 {
        paint_text(
            ui,
            Rect::from_min_size(
                pos2(left, track.bottom() + PROGRESS_GAP),
                vec2(width, QUEUED_ROW),
            ),
            &text::body(QUEUED_SIZE, text::BodyWeight::Medium).with_color(theme::TEXT_SECONDARY),
            &tr!(
                "observer.selectionQueued",
                "+{{count}} queued",
                count = production.queued
            ),
            Align::LEFT,
        );
    }
}

/// Paints one tile: its chrome, outlined in what the unit's health tints it, then the unit itself.
fn paint_unit_tile(ui: &Ui, rect: Rect, unit: Option<&SelectedUnitView>, code_size: f32) {
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    let alpha = if unit.is_some() { 1.0 } else { EMPTY_ALPHA };
    ui.painter().rect_filled(
        rect,
        corner_radius,
        theme::alpha(GREY_BLUE10, 0.85).gamma_multiply(alpha),
    );
    let edge = match unit {
        Some(unit) => health_tint(unit.health_fraction()).gamma_multiply(0.85),
        None => theme::alpha(BLUE80, 0.20).gamma_multiply(alpha),
    };
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, edge),
        StrokeKind::Inside,
    ));
    if let Some(unit) = unit {
        paint_icon(ui, rect, unit.icon, code_size);
    }
}

/// Paints what a tile carries: the game's own icon where the host has the atlas for it, and the
/// short code of what it is where it has not.
fn paint_icon(ui: &Ui, rect: Rect, icon: ProductionIcon, code_size: f32) {
    match icon.texture {
        Some(texture) => {
            ui.painter().image(
                texture,
                rect.shrink(theme::SPACE_XS),
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

/// Draws one labelled bar: what it measures, how full it is, and the two numbers that is.
fn paint_bar_row(ui: &Ui, rect: Rect, label: &str, value: (u32, u32), color: Color32) {
    let (current, full) = value;
    paint_row_label(ui, rect, label);
    let track = centred(
        Rect::from_min_size(
            pos2(rect.left() + ROW_LABEL_WIDTH + ROW_INNER_GAP, rect.top()),
            vec2(BAR_WIDTH, rect.height()),
        ),
        BAR_TRACK,
    );
    let fraction = if full == 0 {
        0.0
    } else {
        current as f32 / full as f32
    };
    paint_track(ui, track, fraction, color);
    paint_text(
        ui,
        Rect::from_min_max(pos2(track.right() + ROW_INNER_GAP, rect.top()), rect.max),
        &text::numeral(VALUE_SIZE),
        &format!("{current}/{full}"),
        Align::RIGHT,
    );
}

/// Draws one row that is a single number rather than a reading against a pool.
fn paint_value_row(ui: &Ui, rect: Rect, label: &str, value: &str) {
    paint_row_label(ui, rect, label);
    paint_text(
        ui,
        Rect::from_min_max(
            pos2(rect.left() + ROW_LABEL_WIDTH + ROW_INNER_GAP, rect.top()),
            rect.max,
        ),
        &text::numeral(VALUE_SIZE),
        value,
        Align::LEFT,
    );
}

/// Paints what a row of numbers measures, at the head of the row.
fn paint_row_label(ui: &Ui, rect: Rect, label: &str) {
    paint_text(
        ui,
        Rect::from_min_size(rect.left_top(), vec2(ROW_LABEL_WIDTH, rect.height())),
        &text::column_label(),
        label,
        Align::LEFT,
    );
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
            },
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
        assert_eq!(
            SUBJECT_TILE + SUBJECT_GAP + NUMBERS_WIDTH + SIDE_GAP + SIDE_WIDTH,
            CONTENT_WIDTH
        );
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
    fn a_thing_is_read_out_on_the_rows_it_has_a_reading_for() {
        // The body is sized for the longest reading there is, which is a unit with every pool.
        let mut templar = unit((40, 40), Some((40, 40)), 0x43);
        templar.energy = Some((200, 200));
        assert_eq!(number_rows(&templar).len(), DETAIL_ROWS);

        // A marine has its health and its kills and nothing else.
        assert_eq!(number_rows(&unit((40, 40), None, 0x00)).len(), 2);

        let mut bunker = unit((350, 350), None, 0x7D);
        bunker.building = true;
        assert_eq!(number_rows(&bunker).len(), 1);
        let mut pylon = unit((300, 300), Some((300, 300)), 0x9C);
        pylon.building = true;
        assert_eq!(number_rows(&pylon).len(), 2);
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
            },
            progress: 0.5,
            queued: 2,
        });
        // What is being made is read before what is being carried, for the thing doing both.
        factory.cargo = vec![unit((40, 40), None, 0x00)];
        assert_eq!(selection(vec![factory]).case(), SelectionCase::Producing);
    }
}
