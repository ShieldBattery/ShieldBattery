//! Draws units that need detection the way the players whose vision is shown see them.
//!
//! SC:R draws such a unit detected when any player in `local_visions` detects it and cloaked
//! otherwise, by the draw functions of its sprite's images. The simulation picks them again only
//! when the unit's detection changes for a player in `local_visions`, so a unit that was already
//! cloaked when `local_visions` changes stays drawn the way the previous visions saw it. Restoring
//! a snapshot does the same, since its images carry the draw functions picked when it was taken.
//!
//! SC:R's own vision toggles pick again for every such unit through the function the simulation
//! uses, which also recomputes the unit's `detection_status` and, for each player who no longer
//! detects it, clears every order, target and rally point that player's units have on it. All of
//! that is synced, so it must not run outside a game step. Picking again here reads the
//! `detection_status` the simulation last computed and writes only what each client already
//! decides for itself, from its own `local_visions`: image draw functions and hidden flags, and
//! the local selection.

use crate::bw::{self, Bw};

use super::BwScr;

/// An image drawn as it is.
const DRAW_NORMAL: u8 = 0;
/// The draw functions of a unit fading into cloak, cloaked, and fading out of it, as a player who
/// doesn't detect it sees them, in that order.
const DRAW_CLOAKING: u8 = 2;
const DRAW_CLOAKED: u8 = 3;
const DRAW_DECLOAKING: u8 = 4;
/// The detected forms of the three cloak draw functions follow them in the same order.
const DETECTED_DRAW_OFFSET: u8 = 3;
const DRAW_DETECTED_CLOAKING: u8 = DRAW_CLOAKING + DETECTED_DRAW_OFFSET;
const DRAW_DETECTED_CLOAKED: u8 = DRAW_CLOAKED + DETECTED_DRAW_OFFSET;
const DRAW_DETECTED_DECLOAKING: u8 = DRAW_DECLOAKING + DETECTED_DRAW_OFFSET;

/// The sprite flag of a burrowed unit, whose images that images.dat doesn't draw while cloaked
/// stay hidden until it unburrows.
const SPRITE_BURROWED: u8 = 0x40;
/// The image flag that has an image drawn again.
const IMAGE_REDRAW: u16 = 0x1;
/// The image flag that keeps an image from being drawn.
const IMAGE_HIDDEN: u16 = 0x40;
/// The images.dat field saying whether an image is drawn while its unit is cloaked.
const IMAGES_DAT_DRAW_IF_CLOAKED: u32 = 4;

/// The `detection_status` of a unit that started needing detection and hasn't had it computed by
/// a game step yet. The next step picks its drawing anyway.
const DETECTION_NOT_COMPUTED: u32 = 0x8000_0000;

/// The draw function an image of a unit gets when a player whose vision is shown detects it.
fn detected_draw_function(drawfunc: u8, burrowed: bool) -> u8 {
    match (burrowed, drawfunc) {
        (true, DRAW_CLOAKING..=DRAW_DETECTED_DECLOAKING) => DRAW_NORMAL,
        (false, DRAW_CLOAKING..=DRAW_DECLOAKING) => drawfunc + DETECTED_DRAW_OFFSET,
        (false, DRAW_NORMAL) => DRAW_DETECTED_CLOAKED,
        _ => drawfunc,
    }
}

/// The draw function an image of a unit gets when no player whose vision is shown detects it.
fn undetected_draw_function(drawfunc: u8, burrowed: bool) -> u8 {
    match (burrowed, drawfunc) {
        (true, DRAW_NORMAL | DRAW_CLOAKING | DRAW_DECLOAKING) => DRAW_CLOAKED,
        (false, DRAW_DETECTED_CLOAKING..=DRAW_DETECTED_DECLOAKING) => {
            drawfunc - DETECTED_DRAW_OFFSET
        }
        _ => drawfunc,
    }
}

/// The part of an image that picking its unit's drawing reads and writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ImageDrawing {
    drawfunc: u8,
    flags: u16,
}

/// How an image of a unit that needs detection is drawn when a player whose vision is shown
/// detects the unit or not.
///
/// A burrowed unit's images that images.dat doesn't draw while cloaked are hidden when no such
/// player detects it, and detection doesn't show them again: SC:R hides them as the unit burrows
/// and shows them only as it unburrows, so a burrowed unit has them hidden whichever players
/// detect it. Those images are the unit's shadow, which copies the frame of the unit's own image,
/// and several shadows (zergling, lurker, infested terran) have no frames for burrowing at all.
fn pick_image_drawing(
    image: ImageDrawing,
    draw_if_cloaked: bool,
    burrowed: bool,
    detected: bool,
) -> ImageDrawing {
    let mut flags = image.flags;
    if burrowed && !detected && !draw_if_cloaked {
        flags |= IMAGE_HIDDEN;
    }
    let drawfunc = match detected {
        true => detected_draw_function(image.drawfunc, burrowed),
        false => undetected_draw_function(image.drawfunc, burrowed),
    };
    if drawfunc != image.drawfunc {
        flags |= IMAGE_REDRAW;
    }
    ImageDrawing { drawfunc, flags }
}

/// Picks the drawing of `sprite`'s images for its unit being `detected` or not.
unsafe fn redraw_sprite(sprite: *mut bw::Sprite, detected: bool) {
    unsafe {
        if sprite.is_null() {
            return;
        }
        let burrowed = (*sprite).flags & SPRITE_BURROWED != 0;
        let mut image = (*sprite).version_specific.scr.first_image;
        while !image.is_null() {
            let draw_if_cloaked =
                bw_dat::ImageId((*image).image_id).get(IMAGES_DAT_DRAW_IF_CLOAKED) != 0;
            let picked = pick_image_drawing(
                ImageDrawing {
                    drawfunc: (*image).drawfunc,
                    flags: (*image).flags,
                },
                draw_if_cloaked,
                burrowed,
                detected,
            );
            (*image).drawfunc = picked.drawfunc;
            (*image).flags = picked.flags;
            image = (*image).next;
        }
    }
}

impl BwScr {
    /// Draws every unit that needs detection as the players in `local_visions` see it, and takes
    /// the ones none of them detect out of the local selection, as SC:R's own vision toggles do.
    /// Call after anything outside a game step writes `local_visions` or restores the units'
    /// images.
    pub(super) unsafe fn redraw_units_needing_detection(&self) {
        unsafe {
            let local_visions = u32::from(self.local_visions.resolve());
            let mut undetected = Vec::new();
            for unit in self.active_units() {
                if !unit.is_invisible() {
                    continue;
                }
                let detection_status = (**unit).detection_status;
                if detection_status == DETECTION_NOT_COMPUTED {
                    continue;
                }
                let detected = detection_status & local_visions != 0;
                redraw_sprite((**unit).flingy.sprite, detected);
                let subunit = (**unit).subunit;
                if !subunit.is_null() {
                    redraw_sprite((*subunit).flingy.sprite, detected);
                }
                if !detected {
                    undetected.push(*unit);
                }
            }
            if !undetected.is_empty() {
                self.deselect_local(&undetected);
            }
        }
    }

    /// Takes `units` out of the local selection, without a selection command.
    unsafe fn deselect_local(&self, units: &[*mut bw::Unit]) {
        unsafe {
            let Some(local_selection) = &self.selection.local_selection else {
                return;
            };
            let selection = local_selection.resolve();
            let mut kept = Vec::with_capacity(12);
            let mut changed = false;
            for i in 0..12 {
                let unit = *selection.add(i);
                if unit.is_null() {
                    break;
                }
                match units.contains(&unit) {
                    true => changed = true,
                    false => kept.push(unit),
                }
            }
            if changed {
                self.engine_select(&kept);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_DRAW_FUNCTIONS: std::ops::RangeInclusive<u8> = 0..=0x11;

    #[test]
    fn detection_swaps_each_cloak_draw_function_for_its_detected_form() {
        for (cloaked, detected) in [(2, 5), (3, 6), (4, 7)] {
            assert_eq!(detected_draw_function(cloaked, false), detected);
            assert_eq!(undetected_draw_function(detected, false), cloaked);
        }
    }

    #[test]
    fn a_detected_burrowed_unit_draws_normally_and_an_undetected_one_cloaked() {
        for drawfunc in 2..=7 {
            assert_eq!(detected_draw_function(drawfunc, true), DRAW_NORMAL);
        }
        for drawfunc in [0, 2, 4] {
            assert_eq!(undetected_draw_function(drawfunc, true), DRAW_CLOAKED);
        }
        assert_eq!(undetected_draw_function(6, true), 6);
    }

    #[test]
    fn picking_again_changes_nothing() {
        for burrowed in [false, true] {
            for drawfunc in ALL_DRAW_FUNCTIONS {
                let detected = detected_draw_function(drawfunc, burrowed);
                assert_eq!(detected_draw_function(detected, burrowed), detected);
                let undetected = undetected_draw_function(drawfunc, burrowed);
                assert_eq!(undetected_draw_function(undetected, burrowed), undetected);
            }
        }
    }

    /// The images of a unit as cloaking or burrowing leaves them for players who don't detect it:
    /// hidden when burrowed and not drawn while cloaked, and drawn with a cloak draw function.
    fn undetected_images() -> Vec<(ImageDrawing, bool, bool)> {
        let mut out = Vec::new();
        for draw_if_cloaked in [false, true] {
            for (burrowed, drawfuncs) in [(false, &[2, 3, 4][..]), (true, &[3][..])] {
                for &drawfunc in drawfuncs {
                    let flags = match burrowed && !draw_if_cloaked {
                        true => IMAGE_HIDDEN,
                        false => 0,
                    };
                    out.push((ImageDrawing { drawfunc, flags }, draw_if_cloaked, burrowed));
                }
            }
        }
        out
    }

    fn without_redraw(image: ImageDrawing) -> ImageDrawing {
        ImageDrawing {
            flags: image.flags & !IMAGE_REDRAW,
            ..image
        }
    }

    #[test]
    fn detection_turned_on_and_off_again_gives_back_the_same_drawing() {
        for (image, draw_if_cloaked, burrowed) in undetected_images() {
            let detected = pick_image_drawing(image, draw_if_cloaked, burrowed, true);
            assert_ne!(
                detected.drawfunc, image.drawfunc,
                "{image:?} burrowed {burrowed}"
            );
            assert_ne!(detected.flags & IMAGE_REDRAW, 0);
            let undetected = pick_image_drawing(detected, draw_if_cloaked, burrowed, false);
            assert_eq!(without_redraw(undetected), image, "burrowed {burrowed}");
            let detected_again = pick_image_drawing(undetected, draw_if_cloaked, burrowed, true);
            assert_eq!(without_redraw(detected_again), without_redraw(detected));
        }
    }

    #[test]
    fn detection_leaves_a_burrowed_units_hidden_images_hidden() {
        let hidden = ImageDrawing {
            drawfunc: DRAW_CLOAKED,
            flags: IMAGE_HIDDEN,
        };
        let detected = pick_image_drawing(hidden, false, true, true);
        assert_eq!(detected.drawfunc, DRAW_NORMAL);
        assert_ne!(detected.flags & IMAGE_HIDDEN, 0);
        let shown = ImageDrawing {
            drawfunc: DRAW_NORMAL,
            flags: 0,
        };
        assert_ne!(
            pick_image_drawing(shown, false, true, false).flags & IMAGE_HIDDEN,
            0
        );
        assert_eq!(
            pick_image_drawing(shown, true, true, false).flags & IMAGE_HIDDEN,
            0
        );
        assert_eq!(
            pick_image_drawing(shown, false, false, false).flags & IMAGE_HIDDEN,
            0
        );
    }

    #[test]
    fn other_draw_functions_are_left_alone() {
        for burrowed in [false, true] {
            for drawfunc in [1, 8, 9, 0x10, 0x11] {
                assert_eq!(detected_draw_function(drawfunc, burrowed), drawfunc);
                assert_eq!(undetected_draw_function(drawfunc, burrowed), drawfunc);
            }
        }
    }
}
