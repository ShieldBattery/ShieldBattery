//! Where the observer's surfaces go on a screen of whatever shape the game hands the overlay.
//!
//! The design draws its panels on a 1920-point-wide screen, which every 16:9 resolution gives. A
//! 4:3 screen is 1280 points wide, and so is a 720p one, and on those the panels the design sets
//! side by side no longer fit side by side. So nothing here is placed at the design's absolute
//! coordinates: each surface is placed against the screen's edges and against the surfaces already
//! placed, and a surface with no room left gives way rather than overlapping one that has it.
//!
//! What gives way to what is one order, from the surface a watcher can least do without: the
//! matchup bar, the minimap, the selection, control groups, production, economy, military, the
//! playback controls, the timeline and the graphs. Giving way means dropping rows where a panel has
//! rows to drop, and not being drawn at all where it has not. It never moves a preference: a panel
//! hidden for lack of room comes back as soon as there is room for it again.

use egui::{Rect, pos2, vec2};

use crate::observer::{MINIMAP_RESERVE_UNITS, ROW_WIDTH, WING_GAP, WING_MARGIN, selection};

/// The height the design's units are drawn at one to one.
const DESIGN_HEIGHT: f32 = 1080.0;

/// The square BW's minimap takes on this screen.
///
/// Where the host has told the overlay where the minimap is, that is where it is. Where it has not,
/// the square the design reserves for it in the bottom-left corner stands in, so that the surfaces
/// placed around it leave the same room whether or not the host can say: the reserve is the
/// minimap's whether or not the minimap is on screen.
pub(crate) fn minimap_square(screen: Rect, host: Option<Rect>) -> Rect {
    host.unwrap_or_else(|| {
        let side = MINIMAP_RESERVE_UNITS * screen.height() / DESIGN_HEIGHT;
        Rect::from_min_size(
            pos2(screen.left(), screen.bottom() - side),
            vec2(side, side),
        )
    })
}

/// A run of the screen's width, from one x to another.
#[derive(Copy, Clone, PartialEq, Debug)]
pub struct Span {
    pub left: f32,
    pub right: f32,
}

impl Span {
    pub(crate) fn of(rect: Rect) -> Span {
        Span {
            left: rect.left(),
            right: rect.right(),
        }
    }

    pub(crate) fn width(self) -> f32 {
        (self.right - self.left).max(0.0)
    }

    /// Whether the two runs share any of the screen's width. Runs that only touch do not.
    pub(crate) fn overlaps(self, other: Span) -> bool {
        self.left < other.right && other.left < self.right
    }

    /// Where a surface of `width` goes in this run: on the screen's own middle line where it fits
    /// there, pulled in from whichever end it would run past where it does not, and cut down to the
    /// run's own width where even that is not enough. Returned as the run the surface covers.
    ///
    /// The middle line is the one the design centers its bottom stack on, so a screen with room to
    /// spare draws the stack exactly where the design does.
    pub(crate) fn place(self, middle: f32, width: f32) -> Span {
        let width = width.min(self.width());
        let left = crate::kit::clamp_layout(middle - width * 0.5, self.left, self.right - width);
        Span {
            left,
            right: left + width,
        }
    }
}

/// The lowest edge among `rects` that share any of `span`'s width, or `floor` where none do.
///
/// What a surface hung under the screen's top edge must start below: whatever is above it in its own
/// column, and nothing that is only above some other part of the screen.
pub(crate) fn lowest_bottom_over(span: Span, rects: &[Rect], floor: f32) -> f32 {
    rects
        .iter()
        .filter(|rect| Span::of(**rect).overlaps(span))
        .fold(floor, |lowest, rect| lowest.max(rect.bottom()))
}

/// The highest edge among `rects` that share any of `span`'s width, or `ceiling` where none do.
///
/// What a surface standing on the screen's bottom edge, or hanging towards it, must end above.
pub(crate) fn highest_top_under(span: Span, rects: &[Rect], ceiling: f32) -> f32 {
    rects
        .iter()
        .filter(|rect| Span::of(**rect).overlaps(span))
        .fold(ceiling, |highest, rect| highest.min(rect.top()))
}

/// Where one of the bottom panels is drawn: how far above the screen's bottom edge it stands, the
/// run of the screen it may take and which part of that run it keeps to, and the line it must not
/// rise past.
#[derive(Copy, Clone, Debug)]
pub struct StackSlot {
    /// How far the panel's bottom edge is above the screen's.
    pub bottom: f32,
    /// The run of the screen the panel may take, between the minimap and whatever holds the right
    /// edge, or the part of that run the panel's column of the bottom row has.
    pub span: Span,
    /// Which part of the run the panel keeps to.
    pub anchor: StackAnchor,
    /// The screen's own middle line, which a panel is offset from wherever it is placed, and which
    /// a centered panel with room to spare stands on.
    pub middle: f32,
    /// How far down the screen the surfaces above the panel reach, which it must stay under.
    pub ceiling: f32,
    /// How far down the screen its bottom edge reaches.
    pub screen_bottom: f32,
}

/// Which part of its run a bottom panel keeps to.
#[derive(Copy, Clone, PartialEq, Debug)]
pub enum StackAnchor {
    /// The screen's own middle line, as far as the run allows: the centered stack.
    Middle,
    /// The run's left end, which for the bottom row's column is the minimap's frame.
    Left,
    /// The run's right end, which for the bottom row's selection is the replay plate or whatever
    /// holds the right edge.
    Right,
}

impl StackSlot {
    /// How tall a panel may be in this slot before it reaches the ceiling.
    pub(crate) fn room(&self) -> f32 {
        (self.screen_bottom - self.bottom - self.ceiling - WING_GAP).max(0.0)
    }

    /// Where a panel of `width` goes in the slot's run.
    pub(crate) fn place(&self, width: f32) -> Span {
        // A line past either end of the run pulls the panel in against that end.
        let line = match self.anchor {
            StackAnchor::Middle => self.middle,
            StackAnchor::Left => self.span.left,
            StackAnchor::Right => self.span.right,
        };
        self.span.place(line, width)
    }
}

/// The bottom edge laid out as one row, which a run of it at least [`ROW_WIDTH`] wide gets: a
/// column against the minimap with production stood on control groups, and the selection panel
/// against the far end, beside the replay plate.
///
/// The panels a watcher keeps on screen all game stand together by the minimap, and the one that
/// comes and goes with every click stands apart from them: the column is as wide whether or not
/// anything is selected, so the selection panel appearing and going never moves it. The widest
/// panels stand lowest, so the row's outline narrows towards the game rather than overhanging it.
#[derive(Copy, Clone, PartialEq, Debug)]
pub(crate) struct BottomRow {
    /// The run the production and control-group column stands in.
    pub(crate) column: Span,
    /// The run the selection panel stands in, exactly as wide as it is.
    pub(crate) selection: Span,
}

impl BottomRow {
    /// The row along `run`, a run of the bottom edge starting from the minimap's frame, or `None`
    /// where the run is too narrow for one and the panels stand in the centered stack instead.
    ///
    /// Decided from the run's width and the panels' design widths alone, never from which panels
    /// are on screen, so the panels coming and going cannot switch the layout back and forth.
    pub(crate) fn along(run: Span) -> Option<BottomRow> {
        (run.width() >= ROW_WIDTH).then(|| {
            let selection_left = run.right - selection::PANEL_WIDTH;
            BottomRow {
                column: Span {
                    left: run.left,
                    right: selection_left - WING_GAP,
                },
                selection: Span {
                    left: selection_left,
                    right: run.right,
                },
            }
        })
    }
}

/// The run of the screen's width a wing hung off the left edge takes.
pub(crate) fn left_wing_span(screen: Rect, width: f32) -> Span {
    let left = screen.left() + WING_MARGIN;
    Span {
        left,
        right: left + width,
    }
}

/// The run of the screen's width a wing hung off the right edge takes, standing `inset` in from it.
pub(crate) fn right_wing_span(screen: Rect, width: f32, inset: f32) -> Span {
    let right = screen.right() - WING_MARGIN - inset;
    Span {
        left: right - width,
        right,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span(left: f32, right: f32) -> Span {
        Span { left, right }
    }

    #[test]
    fn a_surface_with_room_to_spare_stays_on_the_middle_line() {
        let placed = span(364.0, 1568.0).place(960.0, 651.0);
        assert_eq!(placed.left, 960.0 - 325.5);
        assert_eq!(placed.width(), 651.0);
    }

    #[test]
    fn a_surface_that_would_run_past_one_end_is_pulled_in_from_it() {
        // The minimap's column on a 4:3 screen, which the middle line would put the stack into.
        let placed = span(329.0, 928.0).place(640.0, 580.0);
        assert_eq!(placed.right, 928.0);
        let placed = span(329.0, 900.0).place(640.0, 560.0);
        assert_eq!(placed.left, 340.0);
        let placed = span(400.0, 1000.0).place(640.0, 560.0);
        assert_eq!(placed.left, 400.0);
    }

    #[test]
    fn a_surface_wider_than_its_run_is_cut_down_to_it() {
        let placed = span(329.0, 928.0).place(640.0, 651.0);
        assert_eq!(placed, span(329.0, 928.0));
    }

    #[test]
    fn only_the_surfaces_in_a_column_count_against_it() {
        let rects = [
            Rect::from_min_max(pos2(0.0, 0.0), pos2(100.0, 50.0)),
            Rect::from_min_max(pos2(200.0, 0.0), pos2(300.0, 80.0)),
        ];
        assert_eq!(lowest_bottom_over(span(0.0, 150.0), &rects, 10.0), 50.0);
        assert_eq!(lowest_bottom_over(span(50.0, 250.0), &rects, 10.0), 80.0);
        assert_eq!(lowest_bottom_over(span(100.0, 200.0), &rects, 10.0), 10.0);
        assert_eq!(highest_top_under(span(0.0, 150.0), &rects, 900.0), 0.0);
        assert_eq!(highest_top_under(span(120.0, 180.0), &rects, 900.0), 900.0);
    }

    /// The run of the bottom edge a `width` x `height` screen's panels have, from the frame of the
    /// minimap's reserve to the replay plate in the corner, or to the dock's column where there is
    /// no plate.
    fn bottom_run(width: f32, height: f32, plate: bool) -> Span {
        use crate::observer::{DOCK_RESERVE, minimap};
        let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(width, height));
        let frame = minimap::footprint(screen, minimap_square(screen, None));
        let right = if plate {
            crate::playback_controls::PlaybackControlsPlacement::default()
                .rect(screen)
                .left()
                - WING_GAP
        } else {
            width - WING_MARGIN - DOCK_RESERVE
        };
        span(frame.right() + WING_GAP, right)
    }

    #[test]
    fn a_wide_screen_lays_the_bottom_panels_along_one_row() {
        for plate in [true, false] {
            let run = bottom_run(1920.0, 1080.0, plate);
            let row = BottomRow::along(run).expect("a 1080p screen has room for the row");
            assert_eq!(row.column.left, run.left);
            assert_eq!(row.selection.right, run.right);
            assert_eq!(row.selection.width(), selection::PANEL_WIDTH);
            assert_eq!(row.selection.left - row.column.right, WING_GAP);
        }
    }

    #[test]
    fn the_rows_column_draws_its_panels_whole() {
        use crate::observer::{control_groups, production};
        let row = BottomRow::along(bottom_run(1920.0, 1080.0, true)).unwrap();
        let slot = StackSlot {
            bottom: WING_MARGIN,
            span: row.column,
            anchor: StackAnchor::Left,
            middle: 960.0,
            ceiling: 0.0,
            screen_bottom: 1080.0,
        };
        assert_eq!(
            control_groups::fitted_width(slot),
            Some(control_groups::PANEL_WIDTH)
        );
        let placed = slot.place(production::PANEL_WIDTH);
        assert_eq!(placed.width(), production::PANEL_WIDTH);
        // Both stand against the minimap, which nothing the selection does can move.
        assert_eq!(placed.left, row.column.left);
        assert_eq!(
            slot.place(control_groups::PANEL_WIDTH).left,
            row.column.left
        );
    }

    #[test]
    fn a_1600_screen_has_the_row_only_along_its_whole_edge() {
        // Beside the plate in the corner the row is too narrow, so the plate stands on the
        // selection panel at the row's end instead; a live game has no plate to make room for.
        assert_eq!(BottomRow::along(bottom_run(1600.0, 900.0, true)), None);
        assert!(BottomRow::along(bottom_run(1600.0, 900.0, false)).is_some());
    }

    /// The size in points of a render target `width` x `height` pixels.
    fn points(width: f32, height: f32) -> (f32, f32) {
        let scale = crate::kit::pixels::pixels_per_point(width, height);
        (width / scale, height / scale)
    }

    /// The render targets narrower than 16:10 a game is played on: 4:3 at SD's and HD's sizes and
    /// at the smallest one, and 5:4.
    const NARROW_TARGETS: [(f32, f32); 4] = [
        (1024.0, 768.0),
        (1280.0, 960.0),
        (1440.0, 1080.0),
        (1280.0, 1024.0),
    ];

    #[test]
    fn a_narrow_screen_keeps_the_centered_stack() {
        for (width, height) in NARROW_TARGETS.into_iter().chain([(1280.0, 720.0)]) {
            let (width, height) = points(width, height);
            for plate in [true, false] {
                assert_eq!(
                    BottomRow::along(bottom_run(width, height, plate)),
                    None,
                    "{width}x{height}"
                );
            }
        }
    }

    /// A screen narrower than 16:10 is scaled down until the plate keeps the bottom-right corner
    /// with the whole centered stack beside it, so the minimap, the selection panel and the plate
    /// share the bottom edge and nothing is lifted over the game. That holds even with the dock's
    /// rail open beside the plate, which stands it in by the rail's whole column.
    #[test]
    fn a_narrow_screen_keeps_the_plate_in_the_corner_beside_the_stack() {
        use crate::observer::{MIN_STACK_WIDTH, dock, minimap};
        use crate::playback_controls::PlaybackControlsPlacement;
        for (pixel_width, pixel_height) in NARROW_TARGETS {
            let (width, height) = points(pixel_width, pixel_height);
            let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(width, height));
            let frame = minimap::footprint(screen, minimap_square(screen, None));
            let plate = PlaybackControlsPlacement {
                right_inset: dock::column_width(true),
                lift: 0.0,
            }
            .rect(screen);
            let beside = span(frame.right() + WING_GAP, plate.left() - WING_GAP);
            assert!(
                beside.width() >= MIN_STACK_WIDTH,
                "{pixel_width}x{pixel_height} leaves {} beside the plate",
                beside.width()
            );
            assert!(plate.bottom() <= height - WING_MARGIN);
        }
    }

    #[test]
    fn a_slot_keeps_its_panel_to_the_part_of_the_run_it_names() {
        let slot = |anchor| StackSlot {
            bottom: WING_MARGIN,
            span: span(364.0, 1568.0),
            anchor,
            middle: 960.0,
            ceiling: 0.0,
            screen_bottom: 1080.0,
        };
        assert_eq!(slot(StackAnchor::Middle).place(460.0), span(730.0, 1190.0));
        assert_eq!(slot(StackAnchor::Left).place(460.0), span(364.0, 824.0));
        assert_eq!(slot(StackAnchor::Right).place(460.0), span(1108.0, 1568.0));
    }

    #[test]
    fn the_reserve_stands_in_for_a_minimap_the_host_cannot_place() {
        let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(1280.0, 960.0));
        let square = minimap_square(screen, None);
        assert_eq!(square.bottom(), 960.0);
        assert_eq!(square.left(), 0.0);
        assert!((square.width() - 348.0 * 960.0 / 1080.0).abs() < 0.01);
        let placed = Rect::from_min_size(pos2(8.0, 700.0), vec2(250.0, 250.0));
        assert_eq!(minimap_square(screen, Some(placed)), placed);
    }
}
