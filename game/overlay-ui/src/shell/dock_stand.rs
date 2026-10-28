//! Where the observer dock stands on the right edge, and which surfaces make way for it.
//!
//! Decided from this frame's surfaces alone, measured before any of them is drawn: how tall a
//! surface on the right edge is never depends on how far in it stands, so the surfaces it decides
//! the place of can be measured ahead of it. A toggle that changes the right edge is then answered
//! on the frame it happens, rather than a frame later from what the edge held before it.
//!
//! The dock takes the first of these it fits in:
//!
//! 1. Between the surfaces on the right edge, standing on whatever ends its column: the plate in
//!    the corner, the selection panel's place at the end of the bottom row, or the bottom edge.
//!    Nothing makes way.
//! 2. With no plate up, under the wings, running on down past the selection panel's place: the
//!    bottom row stands in from the dock's column and the wings keep the edge.
//! 3. Beside the wings, which stand in from its column along with the bottom row: on the plate
//!    where it fits over it, or else down to the bottom edge, with the plate standing in as well.
//!
//! What makes way is decided for the keycap strip, which is there all game. The rail it expands
//! into is something the watcher has opened to read, and like any panel it passes over the wings.

use egui::Rect;

use super::Mode;
use crate::observer::{self, DockPlacement};

/// What the dock's place is decided from.
pub(super) struct RightEdge {
    pub(super) screen: Rect,
    pub(super) mode: Mode,
    pub(super) map_control_available: bool,
    /// Whether the dock is spelled out as the control rail.
    pub(super) expanded: bool,
    /// Whether the dock is wanted on screen. A dock on its way out has nothing make way for it.
    pub(super) shown: bool,
    /// Where the dock's column starts with the surfaces on the right edge against the edge: a gap
    /// under the lowest of them, and of anything else over the column.
    pub(super) under_edge: f32,
    /// Where the column starts under the surfaces hung from the top edge alone, which is all the
    /// dock keeps clear of once the wings stand in from it.
    pub(super) under_top: f32,
    /// The plate, while it is up.
    pub(super) plate: Option<PlateCorner>,
    /// Where the selection panel's place at the end of the bottom row starts, a gap over it, where
    /// the row has one with its end against the edge.
    pub(super) row_end: Option<f32>,
}

/// The plate in the corner, as the dock stands on it.
pub(super) struct PlateCorner {
    /// A gap over the plate's top edge, which is where the dock's bottom edge goes on it.
    pub(super) top: f32,
    /// Whether the plate keeps the corner beside a bottom row reaching to the edge.
    pub(super) keeps_corner: bool,
}

/// Where the dock stands, and which surfaces stand in from its column for it.
#[derive(Copy, Clone, PartialEq, Debug)]
pub(super) struct DockStand {
    pub(super) placement: DockPlacement,
    /// Whether the wings and the team card over them stand in.
    pub(super) wings_clear: bool,
    /// Whether the bottom row stands in.
    pub(super) row_clear: bool,
    /// Whether the plate stands in, out of the corner the dock runs down past.
    pub(super) plate_clear: bool,
}

pub(super) fn stand_dock(edge: &RightEdge) -> DockStand {
    let height = observer::dock::full_height(edge.mode, edge.map_control_available);
    let fits = |top: f32, bottom: f32| bottom - top >= height;
    let bottom_edge = edge.screen.bottom() - observer::WING_MARGIN;
    let column_bottom = match &edge.plate {
        Some(plate) => plate.keeps_corner.then_some(plate.top),
        None => Some(edge.row_end.unwrap_or(bottom_edge)),
    };
    let between = column_bottom.filter(|&bottom| fits(edge.under_edge, bottom));
    let under_wings = edge.plate.is_none() && fits(edge.under_edge, bottom_edge);
    let row_clear = edge.shown && between.is_none();
    let wings_clear = row_clear && !under_wings;

    let top = if edge.expanded {
        edge.screen.top() + observer::WING_MARGIN
    } else if wings_clear {
        edge.under_top
    } else {
        edge.under_top.max(edge.under_edge)
    };
    let fit = |bottom: f32| {
        DockPlacement::fit(
            edge.mode,
            edge.map_control_available,
            edge.screen.center().y,
            top,
            bottom,
        )
    };
    let on_plate = edge.plate.as_ref().and_then(|plate| fit(plate.top));
    let plate_clear = edge.shown && edge.plate.is_some() && on_plate.is_none();
    let placement = on_plate
        .or_else(|| between.filter(|_| !edge.expanded).and_then(fit))
        .or_else(|| fit(bottom_edge))
        .unwrap_or_else(|| {
            DockPlacement::centred(edge.mode, edge.map_control_available, edge.screen.height())
        });
    DockStand {
        placement,
        wings_clear,
        row_clear,
        plate_clear,
    }
}

#[cfg(test)]
mod tests {
    use egui::{pos2, vec2};

    use super::*;

    const SCREEN_BOTTOM: f32 = 1080.0;
    const BOTTOM_EDGE: f32 = SCREEN_BOTTOM - observer::WING_MARGIN;
    /// A gap over the plate in its corner on a 1080p screen.
    const PLATE_TOP: f32 = 938.0;
    /// A gap over the selection panel's place at the end of the bottom row on a 1080p screen.
    const ROW_END: f32 = 898.0;

    fn dock_height() -> f32 {
        observer::dock::full_height(Mode::Replay, true)
    }

    /// A 1080p replay with the right edge's surfaces reaching down to `under_edge`, with the plate
    /// up in its corner.
    fn edge(under_edge: f32) -> RightEdge {
        RightEdge {
            screen: Rect::from_min_size(pos2(0.0, 0.0), vec2(1920.0, SCREEN_BOTTOM)),
            mode: Mode::Replay,
            map_control_available: true,
            expanded: false,
            shown: true,
            under_edge,
            under_top: 16.0,
            plate: Some(PlateCorner {
                top: PLATE_TOP,
                keeps_corner: true,
            }),
            row_end: Some(ROW_END),
        }
    }

    fn without_plate(edge: RightEdge) -> RightEdge {
        RightEdge {
            plate: None,
            ..edge
        }
    }

    #[test]
    fn with_room_between_the_edges_surfaces_nothing_makes_way() {
        let stand = stand_dock(&edge(PLATE_TOP - dock_height()));
        assert!(!stand.wings_clear && !stand.row_clear && !stand.plate_clear);
        assert_eq!(stand.placement.bottom, PLATE_TOP);

        let stand = stand_dock(&without_plate(edge(ROW_END - dock_height())));
        assert!(!stand.wings_clear && !stand.row_clear);
        assert_eq!(stand.placement.bottom, ROW_END);
    }

    #[test]
    fn short_of_room_over_the_plate_everything_but_the_plate_makes_way() {
        let stand = stand_dock(&edge(PLATE_TOP - dock_height() + 1.0));
        assert!(stand.wings_clear && stand.row_clear && !stand.plate_clear);
        assert_eq!(stand.placement.bottom, PLATE_TOP);
        assert_eq!(stand.placement.row_height, observer::dock::ROW_HEIGHT);
    }

    #[test]
    fn a_plate_giving_up_the_corner_leaves_no_room_between() {
        let mut edge = edge(100.0);
        edge.plate = Some(PlateCorner {
            top: PLATE_TOP,
            keeps_corner: false,
        });
        let stand = stand_dock(&edge);
        assert!(stand.wings_clear && stand.row_clear && !stand.plate_clear);
    }

    #[test]
    fn with_no_room_even_over_the_plate_it_stands_in_too() {
        // A surface over the dock's column low enough that the dock fits over the plate with not
        // even its shortest rows, but still fits down to the bottom edge.
        let fit = |top, bottom| DockPlacement::fit(Mode::Replay, true, 540.0, top, bottom);
        let under_top = (0..SCREEN_BOTTOM as u32)
            .map(|top| top as f32)
            .find(|&top| fit(top, PLATE_TOP).is_none() && fit(top, BOTTOM_EDGE).is_some())
            .expect("a screen with room for the dock under the plate's corner");
        let mut edge = edge(500.0);
        edge.under_top = under_top;
        let stand = stand_dock(&edge);
        assert!(stand.wings_clear && stand.row_clear && stand.plate_clear);
        assert_eq!(stand.placement.bottom, BOTTOM_EDGE);
    }

    #[test]
    fn short_of_room_over_the_row_it_runs_down_under_the_wings() {
        let under_edge = ROW_END - dock_height() + 1.0;
        let stand = stand_dock(&without_plate(edge(under_edge)));
        assert!(!stand.wings_clear && stand.row_clear);
        assert_eq!(stand.placement.bottom, BOTTOM_EDGE);
        assert!(stand.placement.top >= under_edge);
    }

    #[test]
    fn short_of_room_even_down_to_the_bottom_edge_the_wings_make_way() {
        let under_edge = BOTTOM_EDGE - dock_height() + 1.0;
        let stand = stand_dock(&without_plate(edge(under_edge)));
        assert!(stand.wings_clear && stand.row_clear);
        assert_eq!(stand.placement.bottom, BOTTOM_EDGE);
    }

    #[test]
    fn a_hidden_dock_has_nothing_make_way() {
        let mut edge = edge(900.0);
        edge.shown = false;
        let stand = stand_dock(&edge);
        assert!(!stand.wings_clear && !stand.row_clear && !stand.plate_clear);
    }

    #[test]
    fn expanding_the_dock_moves_nothing_else() {
        for under_edge in [
            ROW_END - dock_height(),
            ROW_END - dock_height() + 1.0,
            BOTTOM_EDGE - dock_height() + 1.0,
        ] {
            let strip = stand_dock(&without_plate(edge(under_edge)));
            let mut rail_edge = without_plate(edge(under_edge));
            rail_edge.expanded = true;
            let rail = stand_dock(&rail_edge);
            assert_eq!(
                (rail.wings_clear, rail.row_clear),
                (strip.wings_clear, strip.row_clear),
                "{under_edge}"
            );
            // The rail hangs from the top edge, passing over the wings.
            assert_eq!(rail.placement.bottom, BOTTOM_EDGE);
        }
    }
}
