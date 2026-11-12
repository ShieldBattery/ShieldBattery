//! Health bars under units that are not selected, drawn by the game itself.
//!
//! SC:R draws a selected unit's health bar as one more image of the unit's sprite: an image with
//! a draw function of its own, put at the head of the sprite's image list so that it is the last
//! of them drawn. Sprites are drawn back to front, so the bar is covered by whatever stands in
//! front of its unit, and a flyer's bar is over the ground units under it. The image is taken
//! from a pool of twelve, one for each unit a selection can hold.
//!
//! The bars here are drawn the same way without the selection: once the game has drawn the last
//! image of a wanted unit's sprite, its image drawing function is called once more on an image
//! made up to be that unit's bar. The image is this module's own, on the stack, and is never
//! linked into the sprite's list or taken from the game's pool, so nothing of the game's state
//! changes: drawing a bar image reads the unit's health, shields and energy and queues draw
//! commands, and what the game keeps of a bar between frames it drops for any unit that is not
//! selected. The bar is then exactly the game's, in its place among the sprites and in how it
//! looks under every graphics setting.

use std::mem;
use std::sync::atomic::{AtomicBool, Ordering};

use bw_dat::{Unit, UnitId};
use hashbrown::HashMap;
use libc::c_void;
use parking_lot::Mutex;

use super::selection::SPRITE_SELECTED;
use crate::bw;

/// The image the game's health bars are, and the draw function that makes an image one.
const HEALTH_BAR_IMAGE: u16 = 0x230;
const HEALTH_BAR_DRAW_FUNC: u8 = 0xb;

/// Set on an image whose frame has changed since it was drawn, which the game sets on a bar image
/// it has just set up and clears as it draws it.
const IMAGE_REDRAW: u16 = 0x1;
/// Set on an image that is not drawn.
const IMAGE_HIDDEN: u16 = 0x40;
/// Set on a sprite that is not drawn.
const SPRITE_HIDDEN: u8 = 0x20;

/// How tall, in pixels, each of the selection circles the game draws is, by the index sprites.dat
/// gives a sprite's circle. Read off the circles the game draws, but for the largest, which no
/// unit has, taken at the three fifths of its width every other one is.
const SELECTION_CIRCLE_HEIGHTS: [i32; 10] = [13, 19, 29, 37, 43, 56, 66, 73, 88, 134];

/// The first sprite sprites.dat gives a health bar, a selection circle and the circle's offset: the
/// game keeps those fields for it and every sprite after it only, the first entry being its.
const FIRST_SELECTABLE_SPRITE: u16 = 130;

/// The entry sprites.dat keeps `sprite`'s health bar and selection circle in, or `None` for a
/// sprite it keeps none for.
fn selectable_sprite(sprite: bw_dat::SpriteId) -> Option<bw_dat::SpriteId> {
    Some(bw_dat::SpriteId(
        sprite.0.checked_sub(FIRST_SELECTABLE_SPRITE)?,
    ))
}

/// How far below where a unit drawn with `sprite` stands, in pixels, the bottom of its selection
/// circle is. `None` for a sprite sprites.dat gives no circle.
pub(super) fn selection_circle_bottom(sprite: bw_dat::SpriteId) -> Option<i32> {
    let fields = selectable_sprite(sprite)?;
    let circle = *SELECTION_CIRCLE_HEIGHTS.get(usize::from(fields.selection_circle()))?;
    Some(i32::from(fields.selection_y()) + circle / 2)
}

/// Whether units.dat marks this kind of unit a spellcaster, with an energy pool of its own.
/// `bw_dat` names the flags either side of this one in the same word, but not this one.
pub(super) fn is_spellcaster(unit_id: UnitId) -> bool {
    const SPELLCASTER: u32 = 0x0020_0000;
    unit_id.flags() & SPELLCASTER != 0
}

/// The box a unit's bar image fills, as the game sizes and places one: how wide and tall it is,
/// and how far below where the unit stands its middle is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BarBox {
    width: u8,
    height: u8,
    down: i8,
}

impl BarBox {
    /// The box of a unit's bar, given the width sprites.dat makes it, how far below the unit the
    /// bottom of its selection circle is, whether it has a row of shields, and whether it has the
    /// third row a spellcaster's energy or a timed unit's time left is drawn in.
    ///
    /// As wide as sprites.dat says cut down to a whole number of the three-pixel boxes a bar is
    /// made of, and at least six of them. Five pixels tall, two more with shields and six more
    /// with a third row, which the box has room for whether or not the watcher is shown that row.
    /// Its middle is 8 pixels below the circle's bottom.
    fn new(dat_width: i32, circle_bottom: i32, shields: bool, third_row: bool) -> BarBox {
        let width = (dat_width - (dat_width - 1).rem_euclid(3)).clamp(19, 255);
        let height = if shields { 7 } else { 5 } + if third_row { 6 } else { 0 };
        BarBox {
            width: width as u8,
            height,
            down: (circle_bottom + 8).clamp(-128, 127) as i8,
        }
    }

    /// The top left corner of the box for a unit standing at `position`.
    fn corner(self, position: bw::Point) -> bw::Point {
        bw::Point {
            x: position.x - i16::from(self.width / 2),
            y: position.y + i16::from(self.down) - i16::from(self.height / 2),
        }
    }
}

/// The header of a GRP of one frame, which is all of a GRP the game reads for a bar image: the
/// frame's width is how wide it draws the bar.
#[repr(C)]
struct BarGrp {
    frame_count: u16,
    width: u16,
    height: u16,
    frame_x: u8,
    frame_y: u8,
    frame_width: u8,
    frame_height: u8,
    /// Where a real GRP has the offset or pointer to the frame's lines, which a bar has none of.
    frame_lines: [u8; 8],
}

/// A unit to draw a bar under, and the box its bar fills.
#[derive(Clone, Copy)]
struct Bar {
    unit: Unit,
    bar_box: BarBox,
}

/// The units the game is to draw health bars under though they are not selected.
pub(super) struct UnitHealthBars {
    /// Whether the sprites the game is drawing are to be given bars: there are units wanting
    /// them, and it is the frame's own pass over the sprites. Read for every image the game draws.
    drawing: AtomicBool,
    /// The wanted units, by the address of each one's sprite.
    wanted: Mutex<HashMap<usize, Bar>>,
}

impl UnitHealthBars {
    pub fn new() -> UnitHealthBars {
        UnitHealthBars {
            drawing: AtomicBool::new(false),
            wanted: Mutex::new(HashMap::new()),
        }
    }

    /// Sets the units to draw bars under from the next frame on, until set again. A unit
    /// sprites.dat gives no bar gets none.
    pub fn set_wanted(&self, units: impl IntoIterator<Item = Unit>) {
        let mut wanted = self.wanted.lock();
        wanted.clear();
        for unit in units {
            let Some(sprite) = unit.sprite() else {
                continue;
            };
            let Some(fields) = selectable_sprite(sprite.id()) else {
                continue;
            };
            let Some(circle_bottom) = selection_circle_bottom(sprite.id()) else {
                continue;
            };
            let id = unit.id();
            let third_row =
                unit.is_hallucination() || id == bw_dat::unit::BROODLING || is_spellcaster(id);
            let bar_box = BarBox::new(
                fields.health_bar_width() as i32,
                circle_bottom,
                id.has_shields(),
                third_row,
            );
            wanted.insert(*sprite as usize, Bar { unit, bar_box });
        }
    }

    /// Called around the game queuing a frame's draws, with whether this is the frame's own pass:
    /// the second pass the game makes while it fades between SD and HD graphics draws the sprites
    /// again, and bars queued in both would be drawn twice.
    pub fn set_drawing(&self, main_pass: bool) {
        let drawing = main_pass && !self.wanted.lock().is_empty();
        self.drawing.store(drawing, Ordering::Relaxed);
    }

    /// Called once the game has drawn `image`, with the game's own function for drawing one.
    /// Draws the bar of the unit whose sprite `image` was the last image of, if it is wanted.
    ///
    /// # Safety
    ///
    /// `image` must be an image the game is drawing, on the thread it draws from, and
    /// `draw_image` the game's function for drawing an image.
    pub unsafe fn image_drawn(
        &self,
        image: *mut bw::Image,
        draw_image: impl FnOnce(*mut bw::Image),
    ) {
        if !self.drawing.load(Ordering::Relaxed) {
            return;
        }
        unsafe {
            let sprite = (*image).parent;
            // A sprite's images are drawn from the last in its list to the first.
            if sprite.is_null() || (*sprite).version_specific.scr.first_image != image {
                return;
            }
            let Some(bar) = self.wanted.lock().get(&(sprite as usize)).copied() else {
                return;
            };
            let unit = bar.unit;
            // The unit can have died since it was wanted, and its sprite gone to something else.
            // One that is selected has the game's own bar already.
            if (**unit).flingy.sprite != sprite
                || (*sprite).flags & (SPRITE_SELECTED | SPRITE_HIDDEN) != 0
            {
                return;
            }
            let main_image = (*sprite).version_specific.scr.main_image;
            if !main_image.is_null() && (*main_image).flags & IMAGE_HIDDEN != 0 {
                return;
            }
            let BarBox {
                width,
                height,
                down,
            } = bar.bar_box;
            let mut grp = BarGrp {
                frame_count: 1,
                width: u16::from(width),
                height: u16::from(height),
                frame_x: 0,
                frame_y: 0,
                frame_width: width,
                frame_height: height,
                frame_lines: [0; 8],
            };
            // What the game leaves in a bar image it has set up for a unit and placed for
            // drawing, all of it on screen: the game clips what it draws of it.
            let mut bar_image: bw::Image = mem::zeroed();
            bar_image.image_id = HEALTH_BAR_IMAGE;
            bar_image.drawfunc = HEALTH_BAR_DRAW_FUNC;
            bar_image.flags = IMAGE_REDRAW;
            bar_image.y_offset = down;
            bar_image.map_position = bar.bar_box.corner(unit.position());
            bar_image.grp_bounds = bw::Rect {
                left: 0,
                top: 0,
                right: i16::from(width),
                bottom: i16::from(height),
            };
            bar_image.grp = (&raw mut grp).cast::<c_void>();
            bar_image.drawfunc_param = (*unit).cast::<c_void>();
            bar_image.parent = sprite;
            draw_image(&raw mut bar_image);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bar_goes_where_the_game_draws_its_own() {
        let point = |x, y| bw::Point { x, y };
        // Read off the bars the game drew under selected units in a replay: an SCV with the
        // smallest circle, a mutalisk, a command center with a large one, and a pylon's shields.
        let scv = BarBox::new(22, 11 + 13 / 2, false, false);
        assert_eq!((scv.width, scv.height), (22, 5));
        let corner = scv.corner(point(437, 107));
        assert_eq!((corner.x, corner.y), (426, 130));

        let mutalisk = BarBox::new(40, 5 + 29 / 2, false, false);
        assert_eq!((mutalisk.width, mutalisk.height), (40, 5));
        let corner = mutalisk.corner(point(3761, 367));
        assert_eq!((corner.x, corner.y), (3741, 392));

        let command_center = BarBox::new(110, 6 + 88 / 2, false, false);
        assert_eq!((command_center.width, command_center.height), (109, 5));
        let corner = command_center.corner(point(384, 240));
        assert_eq!((corner.x, corner.y), (330, 296));

        let pylon = BarBox::new(54, 11 + 43 / 2, true, false);
        assert_eq!((pylon.width, pylon.height), (52, 7));
        // However narrow sprites.dat makes one, it is six boxes wide.
        assert_eq!(BarBox::new(0, 0, false, false).width, 19);
    }

    #[test]
    fn a_bar_with_a_third_row_is_taller_and_starts_higher() {
        // A high templar's: shields, and energy under them.
        let templar = BarBox::new(22, 20, true, true);
        assert_eq!(templar.height, 13);
        let plain = BarBox::new(22, 20, true, false);
        let at = bw::Point { x: 100, y: 100 };
        assert_eq!(templar.corner(at).y, plain.corner(at).y - 3);
        // A science vessel's: energy under its health.
        assert_eq!(BarBox::new(22, 20, false, true).height, 11);
    }

    #[test]
    fn the_made_up_grp_has_its_frame_s_width_where_the_game_reads_it() {
        use std::mem::offset_of;

        // The game reads the width of frame 0 two bytes into the first frame entry, which
        // follows a six-byte header.
        assert_eq!(offset_of!(BarGrp, frame_x), 6);
        assert_eq!(offset_of!(BarGrp, frame_width), 8);
        assert_eq!(offset_of!(BarGrp, frame_height), 9);
    }
}
