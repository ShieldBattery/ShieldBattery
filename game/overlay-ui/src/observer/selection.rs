//! The selection panel: what the watcher has selected, standing in for the game's own console.
//!
//! An observer who hides the console loses the one thing on it they still use, which is the
//! selection: the wireframes of whatever they clicked, and the numbers on a single unit. This panel
//! is that part of the console alone, at the kit's ambient tier in the band the console would have
//! taken, so the centred panels above it stack on it the way they stack on the console.
//!
//! The left of it is the console's own grid: twelve slots in two rows of six, in the game's order.
//! A wireframe is a piece of the game's own art that no host here can draw yet, so a slot carries
//! the unit's icon where the host has the game's atlas and its short code where it has not, and the
//! tint the game puts on a wireframe is put on the slot's outline instead: green, yellow and red as
//! the unit's health falls through two thirds and a third of what it started with.
//!
//! The right of it is the numbers, which the console only ever shows for a selection of one:
//! health, shields and energy against what the unit has room for, and what it has killed. A
//! selection of several is read as what it is made of instead, since twelve sets of numbers at once
//! are not numbers anybody reads.
//!
//! The panel is drawn with nothing selected as readily as with something. A watcher clicking around
//! a map selects and deselects constantly, and a panel that came and went with each click would
//! move every surface stacked above it every time.

use egui::{
    Align, Align2, Area, Color32, Context, Id, Order, Rect, Sense, Shape, Stroke, StrokeKind, Ui,
    pos2, vec2,
};

use crate::colors::{BLUE60, BLUE80, GREY_BLUE10, PURPLE70};
use crate::kit::text;
use crate::kit::widgets;
use crate::kit::{motion, theme, tiers};
use crate::observer::{
    ProductionIcon, centred, paint_player_bar, paint_text, stacked_offset, unit_codes,
};
use crate::{tr, tr_plural};

/// One selected unit.
pub struct SelectedUnitView {
    /// The game's own icon for this kind of unit, which is what names it until the host can draw
    /// the unit's wireframe.
    pub icon: ProductionIcon,
    /// The color of the player who owns it, and their name.
    pub owner_color: Color32,
    pub owner_name: String,
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

/// Size of one slot, and the gap between two of them.
const SLOT_WIDTH: f32 = 42.0;
const SLOT_HEIGHT: f32 = 42.0;
const SLOT_GAP: f32 = 6.0;

/// What the grid takes of the panel.
const GRID_WIDTH: f32 = SLOT_WIDTH * SLOT_COLUMNS as f32 + SLOT_GAP * (SLOT_COLUMNS as f32 - 1.0);
const GRID_HEIGHT: f32 = SLOT_HEIGHT * SLOT_ROWS as f32 + SLOT_GAP * (SLOT_ROWS as f32 - 1.0);

/// The grid is the selection: a slot fewer than the game hands out would drop units off the end of
/// a full selection with nothing to say it had.
const _: () = assert!(SLOT_COLUMNS * SLOT_ROWS == SelectionView::MAX_UNITS);

/// Gap between the grid and the numbers beside it.
const COLUMN_GAP: f32 = 16.0;

/// What the detail column takes of the panel.
const DETAIL_WIDTH: f32 = CONTENT_WIDTH - GRID_WIDTH - COLUMN_GAP;

/// The two columns are the panel: checked where the widths are written, because a column wider than
/// fits would be drawn outside the panel's chrome.
const _: () = assert!(GRID_WIDTH + COLUMN_GAP + DETAIL_WIDTH == CONTENT_WIDTH);

/// Size of the tile at the head of the detail column, which is the subject of the selection drawn
/// larger than its own slot in the grid.
const SUBJECT_TILE: f32 = 40.0;

/// Gap between that tile and the owner beside it.
const SUBJECT_GAP: f32 = 10.0;

/// Width of the bar of the owner's color, how tall it is drawn, and the gap to their name.
const OWNER_BAR: f32 = 4.0;
const OWNER_BAR_HEIGHT: f32 = 18.0;
const OWNER_GAP: f32 = 8.0;

/// Gap between the subject line and the rows of numbers under it.
const SUBJECT_LEAD: f32 = 8.0;

/// Height of one row of the detail column, and the gap between two of them.
const DETAIL_ROW: f32 = 14.0;
const DETAIL_ROW_GAP: f32 = 4.0;

/// How many rows of numbers the detail column holds: health, shields, energy, and what the unit has
/// killed.
const DETAIL_ROWS: usize = 4;

/// How tall the detail column is.
const DETAIL_HEIGHT: f32 = SUBJECT_TILE
    + SUBJECT_LEAD
    + DETAIL_ROW * DETAIL_ROWS as f32
    + DETAIL_ROW_GAP * (DETAIL_ROWS as f32 - 1.0);

/// How tall the panel's body is: the taller of its two columns, which is the one carrying the
/// numbers.
const BODY_HEIGHT: f32 = DETAIL_HEIGHT;
const _: () = assert!(DETAIL_HEIGHT >= GRID_HEIGHT);

/// Width of the label at the head of a row of numbers, and of the pair of numbers at its tail.
///
/// The label column is wider than the English abbreviations in it need, because those words are
/// abbreviations rather than symbols: a language whose shortest word for shields is five letters
/// long writes five letters here.
const ROW_LABEL_WIDTH: f32 = 54.0;
const ROW_VALUE_WIDTH: f32 = 74.0;

/// Gap between a row's bar and what is written on either side of it.
const ROW_INNER_GAP: f32 = 6.0;

/// Width of the bar itself, which is whatever the label and the numbers leave of the row.
const BAR_WIDTH: f32 = DETAIL_WIDTH - ROW_LABEL_WIDTH - ROW_VALUE_WIDTH - ROW_INNER_GAP * 2.0;

/// How thick a bar is. Thin, because it is the shape of a number the row already writes out: a bar
/// of any weight beside those numbers would be read first and say less.
const BAR_TRACK: f32 = 5.0;

/// Text size of the unit's code in a grid slot, and in the subject's own larger tile.
const SLOT_CODE_SIZE: f32 = 12.0;
const SUBJECT_CODE_SIZE: f32 = 14.0;

/// Text size of the owner's name, matching the other centred panels' so the stack reads as one set.
const OWNER_NAME_SIZE: f32 = 15.0;

/// Text size of the pair of numbers at the end of a row, and of the lines a selection of several is
/// summed up in.
const VALUE_SIZE: f32 = 12.5;
const SUMMARY_SIZE: f32 = 13.0;

/// How much of itself a slot with nothing in it is drawn at.
///
/// Faint, because it is the grid rather than a reading: all twelve slots are always drawn so that
/// the units in them never move, and an empty one has nothing of its own to say.
const EMPTY_ALPHA: f32 = 0.32;

/// How many kinds a selection of several is summed up as. Three lines is what the column has room
/// for, and an army is named by what most of it is rather than by a census.
const SUMMARY_KINDS: usize = 3;

/// What stands between a kind and how many of it there are.
const SUMMARY_TIMES: &str = "×";

/// Draws the selection panel `bottom` points above the screen's own bottom edge, fading and sliding
/// it in and out. Returns nothing at all once it is gone.
pub fn render_selection_view(
    view: &SelectionView,
    ctx: &Context,
    shown: bool,
    bottom: f32,
) -> Option<Rect> {
    let id = Id::new("sb_selection_panel");
    let bottom = stacked_offset(ctx, id.with("bottom"), bottom);
    let area = Area::new(id)
        .anchor(Align2::CENTER_BOTTOM, vec2(0.0, -bottom))
        .order(Order::Foreground);
    let inner = motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        tiers::tier0_panel(ui, |ui| {
            // The two columns are placed by the widths written here and by nothing else: this is a
            // fixed layout, and egui's own item spacing would add to every gap in it.
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
    // The grid is centred against the taller column beside it rather than hung from the top of the
    // body, so the panel reads as two columns of one panel rather than as a block with a gap under
    // half of it.
    draw_grid(
        ui,
        Rect::from_center_size(
            pos2(body.left() + GRID_WIDTH * 0.5, body.center().y),
            vec2(GRID_WIDTH, GRID_HEIGHT),
        ),
        view,
    );
    draw_detail(
        ui,
        Rect::from_min_size(
            pos2(body.left() + GRID_WIDTH + COLUMN_GAP, body.top()),
            vec2(DETAIL_WIDTH, DETAIL_HEIGHT),
        ),
        view,
    );
}

/// Draws the grid of slots, filled or not.
fn draw_grid(ui: &Ui, rect: Rect, view: &SelectionView) {
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
        paint_unit_tile(ui, slot, view.units.get(index), SLOT_CODE_SIZE);
    }
}

/// Paints one tile: its chrome, outlined in what the unit's health tints it, then the unit's own
/// icon where the host has one and its code where it has not.
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
    let Some(unit) = unit else {
        return;
    };
    match unit.icon.texture {
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
            &unit_codes::code_or_index(unit.icon.index),
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

/// Draws the column beside the grid: one unit's numbers, what a selection of several is made of, or
/// the line that says there is nothing selected at all.
fn draw_detail(ui: &Ui, rect: Rect, view: &SelectionView) {
    match view.units.as_slice() {
        [] => paint_text(
            ui,
            centred(rect, DETAIL_ROW),
            &text::body(SUMMARY_SIZE, text::BodyWeight::Medium).with_color(theme::TEXT_LABEL),
            &tr!("observer.selectionEmpty", "Nothing selected"),
            Align::LEFT,
        ),
        [unit] => draw_unit_detail(ui, rect, unit),
        units => draw_composition(ui, rect, units),
    }
}

/// Takes the rows of numbers in turn, each the same height in the same place whatever is written on
/// it.
///
/// Fixed rows rather than rows laid out under whatever came before them: a unit with shields and a
/// unit without would otherwise write their energy and their kills at different heights, and
/// clicking from one to the other would move every number on the panel.
fn detail_rows(rect: Rect) -> impl Iterator<Item = Rect> {
    let top = rect.top() + SUBJECT_TILE + SUBJECT_LEAD;
    (0..DETAIL_ROWS).map(move |index| {
        Rect::from_min_size(
            pos2(
                rect.left(),
                top + index as f32 * (DETAIL_ROW + DETAIL_ROW_GAP),
            ),
            vec2(rect.width(), DETAIL_ROW),
        )
    })
}

/// Draws one unit's own numbers: what it is, whose it is, what it has left and what it has killed.
fn draw_unit_detail(ui: &Ui, rect: Rect, unit: &SelectedUnitView) {
    let tile = Rect::from_min_size(rect.left_top(), vec2(SUBJECT_TILE, SUBJECT_TILE));
    paint_unit_tile(ui, tile, Some(unit), SUBJECT_CODE_SIZE);
    let bar = Rect::from_min_size(
        pos2(tile.right() + SUBJECT_GAP, tile.top()),
        vec2(OWNER_BAR, tile.height()),
    );
    paint_player_bar(
        ui,
        centred(bar, OWNER_BAR_HEIGHT),
        unit.owner_color,
        // The bar is what says whose the selection is, and it is read against the colors on the map
        // rather than against the panel, so it is never drawn at less than its own color.
        1.0,
    );
    paint_text(
        ui,
        Rect::from_min_max(
            pos2(bar.right() + OWNER_GAP, tile.top()),
            pos2(rect.right(), tile.bottom()),
        ),
        &text::player_name(OWNER_NAME_SIZE).with_color(theme::TEXT_PRIMARY),
        &unit.owner_name,
        Align::LEFT,
    );

    let mut rows = detail_rows(rect);
    if let Some(row) = rows.next() {
        paint_bar_row(
            ui,
            row,
            &tr!("observer.selectionHitPoints", "HP"),
            unit.hit_points,
            theme::TEXT_POSITIVE,
        );
    }
    // The shields and the energy row keep their places on a unit that has neither, so that the
    // kills line under them is the last line of the panel rather than wherever the unit ran out.
    if let (Some(row), Some(shields)) = (rows.next(), unit.shields) {
        paint_bar_row(
            ui,
            row,
            &tr!("observer.selectionShields", "SHL"),
            shields,
            BLUE60,
        );
    }
    if let (Some(row), Some(energy)) = (rows.next(), unit.energy) {
        paint_bar_row(
            ui,
            row,
            &tr!("observer.selectionEnergy", "NRG"),
            energy,
            PURPLE70,
        );
    }
    if let Some(row) = rows.last() {
        paint_text(
            ui,
            Rect::from_min_size(row.left_top(), vec2(ROW_LABEL_WIDTH, row.height())),
            &text::column_label(),
            &tr!("observer.selectionKills", "Kills"),
            Align::LEFT,
        );
        paint_text(
            ui,
            Rect::from_min_max(
                pos2(row.left() + ROW_LABEL_WIDTH + ROW_INNER_GAP, row.top()),
                row.max,
            ),
            &text::numeral(VALUE_SIZE),
            &unit.kills.to_string(),
            Align::LEFT,
        );
    }
}

/// Draws one labelled bar: what it measures, how full it is, and the two numbers that is.
fn paint_bar_row(ui: &Ui, rect: Rect, label: &str, value: (u32, u32), color: Color32) {
    let (current, full) = value;
    paint_text(
        ui,
        Rect::from_min_size(rect.left_top(), vec2(ROW_LABEL_WIDTH, rect.height())),
        &text::column_label(),
        label,
        Align::LEFT,
    );
    let track = centred(
        Rect::from_min_size(
            pos2(rect.left() + ROW_LABEL_WIDTH + ROW_INNER_GAP, rect.top()),
            vec2(BAR_WIDTH, rect.height()),
        ),
        BAR_TRACK,
    );
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    ui.painter()
        .rect_filled(track, corner_radius, theme::alpha(GREY_BLUE10, 0.90));
    let fraction = if full == 0 {
        0.0
    } else {
        (current as f32 / full as f32).clamp(0.0, 1.0)
    };
    let mut filled = track;
    filled.set_right(track.left() + track.width() * fraction);
    if filled.width() > 0.0 {
        ui.painter().rect_filled(filled, corner_radius, color);
    }
    paint_text(
        ui,
        Rect::from_min_max(pos2(track.right() + ROW_INNER_GAP, rect.top()), rect.max),
        &text::numeral(VALUE_SIZE),
        &format!("{current}/{full}"),
        Align::RIGHT,
    );
}

/// Draws what a selection of several is made of: how many units it is, then the kinds most of it
/// is, the most numerous first.
fn draw_composition(ui: &Ui, rect: Rect, units: &[SelectedUnitView]) {
    paint_text(
        ui,
        centred(
            Rect::from_min_size(rect.left_top(), vec2(rect.width(), SUBJECT_TILE)),
            DETAIL_ROW,
        ),
        &text::body(SUMMARY_SIZE, text::BodyWeight::Semibold).with_color(theme::TEXT_PRIMARY),
        &tr_plural!(
            "observer.selectionCount",
            units.len(),
            one = "{{count}} unit",
            other = "{{count}} units"
        ),
        Align::LEFT,
    );
    for (row, (code, count)) in detail_rows(rect).zip(composition(units)) {
        paint_text(
            ui,
            row,
            &text::body(VALUE_SIZE, text::BodyWeight::Medium).with_color(theme::TEXT_SECONDARY),
            &format!("{code} {SUMMARY_TIMES}{count}"),
            Align::LEFT,
        );
    }
}

/// What a selection is made of, as the kinds in it and how many of each, the most numerous first.
///
/// Kinds of equal size keep the order the game listed them in, so a selection whose counts are
/// level does not reshuffle itself every time one unit of it dies.
fn composition(units: &[SelectedUnitView]) -> Vec<(String, usize)> {
    let mut kinds: Vec<(String, usize)> = Vec::new();
    for unit in units {
        let code = unit_codes::code_or_index(unit.icon.index);
        match kinds.iter_mut().find(|(kind, _)| *kind == code) {
            Some((_, count)) => *count += 1,
            None => kinds.push((code, 1)),
        }
    }
    kinds.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    kinds.truncate(SUMMARY_KINDS);
    kinds
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
            hit_points,
            shields,
            energy: None,
            kills: 0,
            building: false,
        }
    }

    #[test]
    fn the_columns_fill_the_panels_own_width() {
        assert_eq!(
            crate::kit::tiers::panel_content_width(PANEL_WIDTH),
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
    fn a_selection_is_named_by_what_most_of_it_is() {
        let units: Vec<SelectedUnitView> = [0x41, 0x42, 0x41, 0x43, 0x41, 0x42, 0x44]
            .into_iter()
            .map(|index| unit((100, 100), None, index))
            .collect();
        assert_eq!(
            composition(&units),
            vec![
                ("ZEA".to_string(), 3),
                ("DRG".to_string(), 2),
                // The kinds of one apiece keep the order the game listed them in.
                ("HT".to_string(), 1),
            ]
        );
    }
}
