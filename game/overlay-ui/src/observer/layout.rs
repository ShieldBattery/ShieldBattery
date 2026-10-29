//! Where the observer's surfaces go on a screen of whatever shape the game hands the overlay.
//!
//! The design draws its panels on a 1920-point-wide screen, which every 16:9 resolution gives. A
//! 4:3 screen is 1280 points wide, and so is a 720p one, and on those the panels the design sets
//! side by side no longer fit side by side. So nothing here is placed at the design's absolute
//! coordinates: each surface is placed against the screen's edges and against the surfaces already
//! placed, and a surface with no room left gives way rather than overlapping one that has it.
//!
//! The surfaces a watcher can least do without never give way: the matchup, the minimap, the
//! selection panel and the playback controls are placed first. The rest, the bottom panels' column
//! and the stats wings, give way to one another in the order they were turned on, the last turned
//! on keeping its room, and the map-control bar has room or not by the screen's width alone. Giving
//! way means dropping rows where a panel has rows to drop, and not being drawn at all where it has
//! not. It never moves a preference: a panel hidden for lack of room comes back as soon as there is
//! room for it again, which turning off the panel in its way gives it.

use egui::{Rect, pos2, vec2};

use crate::observer::{BOTTOM_COLUMN_WIDTH, ROW_WIDTH, WING_GAP, WING_MARGIN, selection};

/// How tall the grid the game lays its console out on is, whatever the screen's shape: its dialogs'
/// coordinates run 480 down the screen, and as far across it as the screen's shape makes that.
const CONSOLE_GRID_HEIGHT: f32 = 480.0;

/// Where the console's minimap control is at its largest, on that grid: 128 square, 6 in from the
/// screen's left edge and 4 up from its bottom one. The game sizes the control to the map's shape,
/// so a map smaller than 128 a side, or one that is not square, is drawn in a control inside this
/// square.
const MINIMAP_LEFT: f32 = 6.0;
const MINIMAP_BOTTOM: f32 = 476.0;
const MINIMAP_SIDE: f32 = 128.0;

/// The square the game's console keeps for its minimap in the screen's bottom-left corner: the
/// control the map is drawn in at its largest. The console is scaled with the screen's height, so
/// the square is the same share of the height on every screen.
pub fn minimap_reserve(screen: Rect) -> Rect {
    let unit = screen.height() / CONSOLE_GRID_HEIGHT;
    let side = MINIMAP_SIDE * unit;
    Rect::from_min_size(
        pos2(
            screen.left() + MINIMAP_LEFT * unit,
            screen.top() + MINIMAP_BOTTOM * unit - side,
        ),
        vec2(side, side),
    )
}

/// The square BW's minimap takes on this screen.
///
/// Where the host has told the overlay where the minimap is, that is where it is. Where it has not,
/// the console's square for it stands in (see [`minimap_reserve`]), so that the surfaces placed
/// around it leave the same room whether or not the host can say.
pub(crate) fn minimap_square(screen: Rect, host: Option<Rect>) -> Rect {
    host.unwrap_or_else(|| minimap_reserve(screen))
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

    /// Where a surface of `width` goes in this run: centered on `middle` where it fits there,
    /// pulled in from whichever end it would run past where it does not, and cut down to the run's
    /// own width where even that is not enough. Returned as the run the surface covers.
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
/// run of the screen it may take and which end of that run it keeps to, and the line it must not
/// rise past.
#[derive(Copy, Clone, Debug)]
pub struct StackSlot {
    /// How far the panel's bottom edge is above the screen's.
    pub bottom: f32,
    /// The run of the screen the panel may take: the selection panel's end of the bottom band, or
    /// the column's run beside it or over the minimap.
    pub span: Span,
    /// Which end of the run the panel keeps to.
    pub anchor: StackAnchor,
    /// How far down the screen the surfaces above the panel reach, which it must stay under.
    pub ceiling: f32,
    /// How far down the screen its bottom edge reaches.
    pub screen_bottom: f32,
}

/// Which end of its run a bottom panel keeps to.
#[derive(Copy, Clone, PartialEq, Debug)]
pub enum StackAnchor {
    /// The run's left end, which for the column lines its panels up with each other.
    Left,
    /// The run's right end, which for the selection panel is the band's far end.
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
            StackAnchor::Left => self.span.left,
            StackAnchor::Right => self.span.right,
        };
        self.span.place(line, width)
    }
}

/// The part of a `run` of the bottom edge the bottom panels keep to, for a minimap in the bottom-left
/// corner: up to the mirror image of the minimap's reserve on the right edge, and in a replay short
/// of the plate's `plate_corner` too, whether or not the plate is up. The bottom-right corner is then
/// the plate's or nobody's, which is where a streamer's camera tends to go.
///
/// The far end is the reserve's mirror rather than the minimap's own: it is the end the selection
/// panel stands against, and a minimap the host reports only while it is up, smaller than its
/// reserve, would move it every time the minimap came or went. Only the plate and the screen decide
/// it.
pub(crate) fn bottom_band(screen: Rect, run: Span, plate_corner: Option<Rect>) -> Span {
    let reserve = super::minimap::footprint(screen, minimap_square(screen, None));
    let mirror = screen.right() - (reserve.right() - screen.left()) - WING_GAP;
    let plate = plate_corner.map_or(f32::INFINITY, |corner| corner.left() - WING_GAP);
    Span {
        right: run.right.min(mirror).min(plate),
        ..run
    }
}

/// The bottom edge laid out as one row, which a band of it at least [`ROW_WIDTH`] wide gets (see
/// [`bottom_band`]): a column with production stood on control groups next to the minimap, and the
/// selection panel at the band's far end, where it stands on every screen. Whatever room the band
/// has past them is left between the two.
///
/// The column is exactly as wide as control groups are drawn at their design's width, and
/// production stands lined up with their left edge however narrow it is drawn. Neither run depends
/// on what is on screen, so the selection panel appearing and going never moves the column. The
/// widest panels stand lowest, so the column's outline narrows towards the game rather than
/// overhanging it.
#[derive(Copy, Clone, PartialEq, Debug)]
pub(crate) struct BottomRow {
    /// The run the production and control-group column stands in.
    pub(crate) column: Span,
    /// The run the selection panel stands in, exactly as wide as it is.
    pub(crate) selection: Span,
}

impl BottomRow {
    /// The row along `run`, a run of the bottom edge starting from the minimap's frame, or `None`
    /// where the run is too narrow for one and the column stands on the minimap's frame instead
    /// (see [`column_over_minimap`]).
    ///
    /// Decided from the run's width and the panels' design widths alone, never from which panels
    /// are on screen, so the panels coming and going cannot switch the layout back and forth.
    pub(crate) fn along(run: Span) -> Option<BottomRow> {
        (run.width() >= ROW_WIDTH).then(|| BottomRow {
            column: Span {
                left: run.left,
                right: run.left + BOTTOM_COLUMN_WIDTH,
            },
            selection: selection_run(run),
        })
    }
}

/// The run the selection panel stands in at the far end of the bottom `band`, as wide as the panel
/// or as the band where that is narrower.
pub(crate) fn selection_run(band: Span) -> Span {
    Span {
        left: (band.right - selection::PANEL_WIDTH).max(band.left),
        right: band.right,
    }
}

/// The run the production and control-group column takes standing on the minimap's frame, where
/// the bottom `band` has no room for it beside the selection panel: from the screen's left margin,
/// lined up with the wing hung over it, as wide as the column is laid out in the row and short of
/// the band's far end, so it never reaches over the plate's corner.
pub(crate) fn column_over_minimap(screen: Rect, band: Span) -> Span {
    let left = screen.left() + WING_MARGIN;
    Span {
        left,
        right: (left + BOTTOM_COLUMN_WIDTH).min(band.right),
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

/// The run of the screen's width a wing hung off the right edge takes.
pub(crate) fn right_wing_span(screen: Rect, width: f32) -> Span {
    let right = screen.right() - WING_MARGIN;
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

    /// The band of the bottom edge a `width` x `height` screen's panels keep to, from the frame of
    /// the minimap's reserve to its mirror image, and short of the replay plate's corner in a
    /// replay.
    fn bottom_run(width: f32, height: f32, replay: bool) -> Span {
        use crate::observer::minimap;
        let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(width, height));
        let frame = minimap::footprint(screen, minimap_square(screen, None));
        let run = span(frame.right() + WING_GAP, width - WING_MARGIN);
        let corner = replay
            .then(|| crate::playback_controls::PlaybackControlsPlacement::default().rect(screen));
        bottom_band(screen, run, corner)
    }

    #[test]
    fn a_wide_screen_lays_the_bottom_panels_along_one_row() {
        for plate in [true, false] {
            let run = bottom_run(1920.0, 1080.0, plate);
            let row = BottomRow::along(run).expect("a 1080p screen has room for the row");
            assert_eq!(row.column.left, run.left);
            assert_eq!(row.column.width(), BOTTOM_COLUMN_WIDTH);
            assert_eq!(row.selection.right, run.right);
            assert_eq!(row.selection.width(), selection::PANEL_WIDTH);
            assert!(row.selection.left - row.column.right >= WING_GAP);
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
            ceiling: 0.0,
            screen_bottom: 1080.0,
        };
        assert_eq!(
            control_groups::fitted_width(slot),
            Some(control_groups::PANEL_WIDTH)
        );
        // Control groups fill the column, short of the selection panel, and production lines up
        // with their left edge.
        let groups = slot.place(control_groups::PANEL_WIDTH);
        assert_eq!(groups, row.column);
        assert!(groups.right + WING_GAP <= row.selection.left);
        let placed = slot.place(production::PANEL_WIDTH);
        assert_eq!(placed.width(), production::PANEL_WIDTH);
        assert_eq!(placed.left, groups.left);
    }

    #[test]
    fn the_rows_column_keeps_to_the_minimap_and_its_selection_to_the_far_end() {
        let wide = bottom_run(1920.0, 1080.0, true);
        // A minimap smaller than its reserve leaves the band more room at the minimap's end, which
        // the column moves into and the selection panel does not.
        let roomier = span(wide.left - 40.0, wide.right);
        let row = BottomRow::along(wide).unwrap();
        let closer = BottomRow::along(roomier).unwrap();
        assert_eq!(closer.selection, row.selection);
        assert_eq!(closer.column.left, roomier.left);
    }

    #[test]
    fn a_1600_screen_has_no_room_for_the_row() {
        // The band short of the plate's corner, or of the minimap's mirror image in a live game, is
        // too narrow for the row at the design's widths.
        assert_eq!(BottomRow::along(bottom_run(1600.0, 900.0, true)), None);
        assert_eq!(BottomRow::along(bottom_run(1600.0, 900.0, false)), None);
    }

    #[test]
    fn a_column_over_the_minimap_lines_up_with_the_wing_over_it() {
        for (width, height) in [(1600.0, 900.0), (1280.0, 720.0)] {
            let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(width, height));
            let band = bottom_run(width, height, true);
            let column = column_over_minimap(screen, band);
            assert_eq!(column, left_wing_span(screen, BOTTOM_COLUMN_WIDTH));
            assert!(column.right <= band.right, "{width}x{height}");
        }
        // Where the band ends sooner than the column would, the column ends with it.
        let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(1024.0, 768.0));
        let band = span(300.0, 600.0);
        assert_eq!(column_over_minimap(screen, band).right, 600.0);
    }

    #[test]
    fn the_band_keeps_the_bottom_right_corner_as_large_as_the_minimaps() {
        use crate::observer::minimap;
        for (width, height) in [(1920.0, 1080.0), (2560.0, 1080.0), (2560.0, 1440.0)] {
            let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(width, height));
            let frame = minimap::footprint(screen, minimap_square(screen, None));
            let band = bottom_run(width, height, false);
            assert_eq!(
                width - band.right,
                frame.right() + WING_GAP,
                "{width}x{height}"
            );
            // And a replay's band never reaches the plate's corner, up or not.
            let corner =
                crate::playback_controls::PlaybackControlsPlacement::default().rect(screen);
            assert!(bottom_run(width, height, true).right <= corner.left() - WING_GAP);
        }
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
    fn a_narrow_screen_has_no_room_for_the_row() {
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

    /// A screen narrower than 16:10 is scaled down until the selection panel fits between the
    /// minimap and the plate in the bottom-right corner, so the three share the bottom edge.
    #[test]
    fn a_narrow_screen_keeps_the_selection_panel_between_the_minimap_and_the_plate() {
        use crate::observer::minimap;
        use crate::playback_controls::PlaybackControlsPlacement;
        for (pixel_width, pixel_height) in NARROW_TARGETS.into_iter().chain([(1280.0, 720.0)]) {
            let (width, height) = points(pixel_width, pixel_height);
            let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(width, height));
            let frame = minimap::footprint(screen, minimap_square(screen, None));
            let plate = PlaybackControlsPlacement::default().rect(screen);
            let beside = span(frame.right() + WING_GAP, plate.left() - WING_GAP);
            assert!(
                beside.width() >= selection::PANEL_WIDTH,
                "{pixel_width}x{pixel_height} leaves {} beside the plate",
                beside.width()
            );
            assert_eq!(
                selection_run(bottom_run(width, height, true)).width(),
                selection::PANEL_WIDTH
            );
        }
    }

    #[test]
    fn a_slot_keeps_its_panel_to_the_part_of_the_run_it_names() {
        let slot = |anchor| StackSlot {
            bottom: WING_MARGIN,
            span: span(364.0, 1568.0),
            anchor,
            ceiling: 0.0,
            screen_bottom: 1080.0,
        };
        assert_eq!(slot(StackAnchor::Left).place(460.0), span(364.0, 824.0));
        assert_eq!(slot(StackAnchor::Right).place(460.0), span(1108.0, 1568.0));
    }

    #[test]
    fn the_reserve_stands_in_for_a_minimap_the_host_cannot_place() {
        let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(1280.0, 960.0));
        let square = minimap_square(screen, None);
        assert_eq!(square, minimap_reserve(screen));
        // The console's grid is 480 tall, so on a 960-point screen a unit of it is two points.
        assert_eq!(
            square,
            Rect::from_min_size(pos2(12.0, 696.0), vec2(256.0, 256.0))
        );
        let placed = Rect::from_min_size(pos2(8.0, 700.0), vec2(250.0, 250.0));
        assert_eq!(minimap_square(screen, Some(placed)), placed);
    }
}
