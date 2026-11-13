//! Lighting up the units of a group the watcher points at.
//!
//! Every image of a sprite the game draws becomes draw commands, and the shaders most of them are
//! drawn with multiply the image's colors by a constant the command carries. The units to light up
//! have that constant raised on the commands of their sprites' images as the game queues them.
//! Only the queued commands are changed, and they are made afresh every frame.
//!
//! Not every sprite shader takes the whole constant. The ones for HD sprites under real-time
//! lighting read only its alpha, so with that setting on a unit is drawn as it always is, and it
//! is the overlay's veil over everything else that sets it apart.

use std::sync::atomic::{AtomicBool, Ordering};

use bw_dat::Unit;
use hashbrown::HashMap;
use parking_lot::Mutex;

use super::scr;
use crate::bw;

/// The shaders that multiply what they draw by the whole of a command's solid color: SD sprites,
/// HD sprites, and HD sprites lit by the forward renderer.
const LIT_SHADERS: [u32; 3] = [0x09, 0x0c, 0x0d];

/// How units are lit up: what the colors of the ones pointed at are multiplied by, 1 leaving them
/// as they are.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct HighlightLook {
    pub lit: f32,
}

impl HighlightLook {
    pub const DEFAULT: HighlightLook = HighlightLook { lit: 1.25 };
}

/// How units are lit up, which the debug window can change while a game runs.
static LOOK: Mutex<HighlightLook> = Mutex::new(HighlightLook::DEFAULT);

pub(super) fn look() -> HighlightLook {
    *LOOK.lock()
}

pub(super) fn set_look(look: HighlightLook) {
    *LOOK.lock() = look;
}

/// The units to light up as the game draws them.
pub(super) struct UnitHighlights {
    /// Whether there are units to light up and the sprites the game is drawing are the frame's own
    /// pass over them. Read for every image the game draws.
    drawing: AtomicBool,
    /// The units to light up, by the address of each sprite that is one's: its own, and its
    /// turret's where it has one.
    lit: Mutex<HashMap<usize, Unit>>,
}

impl UnitHighlights {
    pub fn new() -> UnitHighlights {
        UnitHighlights {
            drawing: AtomicBool::new(false),
            lit: Mutex::new(HashMap::new()),
        }
    }

    /// Sets the units to light up from the next frame on, until set again.
    pub fn set_units(&self, units: impl IntoIterator<Item = Unit>) {
        let mut lit = self.lit.lock();
        lit.clear();
        for unit in units {
            for part in [Some(unit), unit.subunit_linked()].into_iter().flatten() {
                if let Some(sprite) = part.sprite() {
                    lit.insert(*sprite as usize, part);
                }
            }
        }
    }

    /// Called around the game queuing a frame's draws, with whether this is the frame's own pass
    /// rather than the second one it makes while fading between SD and HD graphics.
    pub fn set_drawing(&self, main_pass: bool) {
        let drawing = main_pass && !self.lit.lock().is_empty();
        self.drawing.store(drawing, Ordering::Relaxed);
    }

    /// What the colors of `image`, which the game is about to draw, are to be multiplied by, or
    /// `None` where they are left as they are.
    ///
    /// # Safety
    ///
    /// `image` must be an image the game is drawing, on the thread it draws from.
    pub unsafe fn gain_for(&self, image: *mut bw::Image) -> Option<f32> {
        if !self.drawing.load(Ordering::Relaxed) {
            return None;
        }
        let sprite = unsafe { (*image).parent };
        let look = look();
        // A unit can have died since it was pointed at, and its sprite gone to something else.
        let lit = self
            .lit
            .lock()
            .get(&(sprite as usize))
            .is_some_and(|unit| unsafe { (***unit).flingy.sprite == sprite });
        (lit && look.lit != 1.0).then_some(look.lit)
    }
}

/// Multiplies by `gain` the colors of what the draw commands from `first` on draw, of those drawn
/// with a shader that takes its colors' multiple from the command.
///
/// # Safety
///
/// `commands` must be the game's draw commands, with every one from `first` to its count queued.
pub(super) unsafe fn multiply_colors(commands: *mut scr::DrawCommands, first: u16, gain: f32) {
    unsafe {
        let count = (*commands).draw_command_count;
        for index in first..count {
            let Some(command) = (*commands).commands.get_mut(usize::from(index)) else {
                return;
            };
            if LIT_SHADERS.contains(&command.shader_id) {
                for channel in &mut command.shader_constants[..3] {
                    *channel *= gain;
                }
            }
        }
    }
}
