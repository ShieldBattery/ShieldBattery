//! Where the observer's surfaces go on a screen of whatever shape the game hands the overlay.
//!
//! The design draws its panels on a 1920-point-wide screen, which every 16:9 resolution gives. A
//! 4:3 screen is 1280 points wide, and so is a 720p one, and on those the panels the design sets
//! side by side no longer fit side by side. So nothing here is placed at the design's absolute
//! coordinates: each surface is placed against the screen's edges and against the surfaces already
//! placed, and a surface with no room left gives way rather than overlapping one that has it.
//!
//! What gives way to what is one order, from the surface a watcher can least do without: the
//! matchup bar, the minimap, the selection, production, control groups, economy, military, the
//! replay transport, the timeline and the graphs. Giving way means dropping rows where a panel has
//! rows to drop, and not being drawn at all where it has not. It never moves a preference: a panel
//! hidden for lack of room comes back as soon as there is room for it again.

use egui::{Rect, pos2, vec2};

use crate::observer::{MINIMAP_RESERVE_UNITS, WING_GAP, WING_MARGIN};

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
    /// The middle line is the one the design centres its bottom stack on, so a screen with room to
    /// spare draws the stack exactly where the design does.
    pub(crate) fn place(self, middle: f32, width: f32) -> Span {
        let width = width.min(self.width());
        let left = (middle - width * 0.5).clamp(self.left, self.right - width);
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

/// Where one of the centred bottom panels is drawn: how far above the screen's bottom edge it
/// stands, the run of the screen it may take, and the line it must not rise past.
#[derive(Copy, Clone, Debug)]
pub struct StackSlot {
    /// How far the panel's bottom edge is above the screen's.
    pub bottom: f32,
    /// The run of the screen the panel may take, between the minimap and whatever holds the right
    /// edge.
    pub span: Span,
    /// The screen's own middle line, which a panel with room to spare is centred on.
    pub middle: f32,
    /// How far down the screen the surfaces above the stack reach, which a panel must stay under.
    pub ceiling: f32,
    /// How far down the screen its bottom edge reaches.
    pub screen_bottom: f32,
}

impl StackSlot {
    /// How tall a panel may be in this slot before it reaches the ceiling.
    pub(crate) fn room(&self) -> f32 {
        (self.screen_bottom - self.bottom - self.ceiling - WING_GAP).max(0.0)
    }

    /// Where a panel of `width` goes in the slot's run, and how far it is moved off the screen's
    /// middle line to get there, which is what a panel anchored to the middle of the bottom edge is
    /// offset by.
    pub(crate) fn place(&self, width: f32) -> (Span, f32) {
        let placed = self.span.place(self.middle, width);
        let centre = (placed.left + placed.right) * 0.5;
        (placed, centre - self.middle)
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
