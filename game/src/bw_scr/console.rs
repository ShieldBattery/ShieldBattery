use std::sync::atomic::Ordering;

use bw_dat::dialog::{Control, Dialog};

use crate::bw;

use super::BwScr;

/// The dialogs that make up BW's bottom console, including the minimap.
///
/// Hiding is split three ways: the minimap and the command panel each have a visibility of their
/// own beside the console's ([`BwScr::set_console_visible`]). The whole list still matters for event
/// handling, since every one of these dialogs has to stop responding while it is hidden.
pub const CONSOLE_DIALOGS: &[&str] = &["StatPort", "Minimap", "Stat_F10", "StatBtn", "StatData"];

/// The minimap's dialog, which has a visibility of its own: observers routinely keep the minimap
/// while the rest of the console is hidden, which is what SC:R's own observer view renders.
pub const MINIMAP_DIALOG: &str = "Minimap";

/// The command-button panel, which in a replay carries SC:R's own playback controls.
///
/// A visibility of its own as well: the overlay's replay transport stands in for those controls, so
/// this panel goes while the console stays. A player who hides our
/// transport gets SC:R's back rather than no controls at all.
pub const COMMAND_PANEL_DIALOG: &str = "StatBtn";

/// The native minimap's natural geometry and the geometry last installed by the observer overlay.
///
/// The minimap image is a child control of the `Minimap` dialog. Moving its parent keeps both the
/// image and its hit region aligned without changing native image dimensions or relying on
/// binary-specific field offsets.
#[derive(Default)]
pub(crate) struct ObserverMinimapLayout {
    cached: Option<CachedMinimapLayout>,
}

#[derive(Copy, Clone)]
struct CachedMinimapLayout {
    dialog: usize,
    original_parent: bw::Rect,
    original_map: bw::Rect,
    applied_parent: bw::Rect,
    applied_map: bw::Rect,
}

impl ObserverMinimapLayout {
    /// Returns the minimap image's original screen-space rectangle in BW dialog coordinates.
    ///
    /// The natural layout is recaptured when the dialog is replaced or when something outside this
    /// helper changes its parent or image-control geometry. Hidden dialogs are deliberately still
    /// measured so folding the minimap does not lose the layout it expands back to.
    pub(crate) unsafe fn natural_square(
        &mut self,
        first_dialog: Option<Dialog>,
    ) -> Option<bw::Rect> {
        let (dialog, map) = find_minimap_image(first_dialog)?;
        self.sync(dialog, map);
        let cached = self.cached?;
        absolute_rect(cached.original_parent, cached.original_map)
    }

    /// Moves the native minimap to a requested screen-space rectangle of its natural size, or
    /// restores its original layout when `desired_square` is `None`.
    ///
    /// Invalid requests are ignored before either control is changed. The image control always
    /// keeps its original area; only its parent dialog is translated with checked `i32` arithmetic
    /// and converted to `i16` after the whole layout is known to fit.
    pub(crate) unsafe fn apply(
        &mut self,
        first_dialog: Option<Dialog>,
        desired_square: Option<bw::Rect>,
    ) {
        let Some((dialog, map)) = find_minimap_image(first_dialog) else {
            return;
        };
        self.sync(dialog, map);
        let Some(cached) = self.cached else {
            return;
        };
        let layout = match desired_square {
            Some(desired) => {
                translated_layout(cached.original_parent, cached.original_map, desired)
            }
            None => Some((cached.original_parent, cached.original_map)),
        };
        let Some((parent, image)) = layout else {
            return;
        };
        unsafe { write_layout(dialog, map, parent, image) };
        self.cached = Some(CachedMinimapLayout {
            applied_parent: parent,
            applied_map: image,
            ..cached
        });
    }

    fn sync(&mut self, dialog: Dialog, map: Control) {
        let dialog_id = *dialog as usize;
        let parent = dialog.as_control().dialog_coords();
        let image = map.dialog_coords();
        let recapture = self.cached.is_none_or(|cached| {
            cached.dialog != dialog_id
                || cached.applied_parent != parent
                || cached.applied_map != image
        });
        if recapture {
            self.cached = Some(CachedMinimapLayout {
                dialog: dialog_id,
                original_parent: parent,
                original_map: image,
                applied_parent: parent,
                applied_map: image,
            });
        }
    }
}

/// The control ID whose native draw function renders the minimap image.
const MINIMAP_IMAGE_CONTROL: i16 = 1;

fn find_minimap_image(first_dialog: Option<Dialog>) -> Option<(Dialog, Control)> {
    let dialog = bw::iter_dialogs(first_dialog).find(|dialog| is_minimap_dialog(*dialog))?;
    let image = dialog.child_by_id(MINIMAP_IMAGE_CONTROL)?;
    Some((dialog, image))
}

unsafe fn write_layout(dialog: Dialog, map: Control, parent: bw::Rect, image: bw::Rect) {
    unsafe {
        let parent_control = *dialog.as_control();
        let image_control = *map;
        (*parent_control).area = parent;
        (*image_control).area = image;
    }
}

/// Turns a child rect in dialog-local coordinates into its screen-space rect.
fn absolute_rect(parent: bw::Rect, child: bw::Rect) -> Option<bw::Rect> {
    rect_from_i32(
        i32::from(parent.left) + i32::from(child.left),
        i32::from(parent.top) + i32::from(child.top),
        i32::from(parent.left) + i32::from(child.right),
        i32::from(parent.top) + i32::from(child.bottom),
    )
}

/// Computes a parent/image pair that moves the image to `desired` while preserving both native
/// rectangles' original sizes.
fn translated_layout(
    original_parent: bw::Rect,
    original_image: bw::Rect,
    desired: bw::Rect,
) -> Option<(bw::Rect, bw::Rect)> {
    let desired_width = i32::from(desired.right) - i32::from(desired.left);
    let desired_height = i32::from(desired.bottom) - i32::from(desired.top);
    let image_width = i32::from(original_image.right) - i32::from(original_image.left);
    let image_height = i32::from(original_image.bottom) - i32::from(original_image.top);
    if image_width <= 0
        || image_height <= 0
        || desired_width != image_width
        || desired_height != image_height
    {
        return None;
    }

    let original = absolute_rect(original_parent, original_image)?;
    let delta_x = i32::from(desired.left) - i32::from(original.left);
    let delta_y = i32::from(desired.top) - i32::from(original.top);
    let parent_left = i32::from(original_parent.left).checked_add(delta_x)?;
    let parent_top = i32::from(original_parent.top).checked_add(delta_y)?;
    let parent_right = i32::from(original_parent.right).checked_add(delta_x)?;
    let parent_bottom = i32::from(original_parent.bottom).checked_add(delta_y)?;
    let parent = rect_from_i32(parent_left, parent_top, parent_right, parent_bottom)?;
    Some((parent, original_image))
}

fn rect_from_i32(left: i32, top: i32, right: i32, bottom: i32) -> Option<bw::Rect> {
    Some(bw::Rect {
        left: i16::try_from(left).ok()?,
        top: i16::try_from(top).ok()?,
        right: i16::try_from(right).ok()?,
        bottom: i16::try_from(bottom).ok()?,
    })
}

impl BwScr {
    pub fn console_hidden(&self) -> bool {
        self.console_hidden_state.load(Ordering::Relaxed)
    }

    pub fn minimap_hidden(&self) -> bool {
        self.minimap_hidden_state.load(Ordering::Relaxed)
    }

    pub fn command_panel_hidden(&self) -> bool {
        self.command_panel_hidden_state.load(Ordering::Relaxed)
    }

    /// Whether a console dialog of this name is hidden right now, which is what its event handler
    /// drops events on.
    pub fn console_dialog_hidden(&self, name: &str) -> bool {
        self.console_hidden() || (name == COMMAND_PANEL_DIALOG && self.command_panel_hidden())
    }

    /// Shows or hides the console, leaving the minimap wherever
    /// [`set_minimap_visible`](Self::set_minimap_visible) last put it.
    ///
    /// The game view takes over the console's band while the console is hidden, so hiding and
    /// showing also resizes it. Hiding a dialog stops it drawing but not responding, so
    /// `bw_scr::dialog_hook` hooks these same dialogs and drops their events while this state says
    /// they are hidden.
    pub unsafe fn set_console_visible(&self, first_dialog: Option<Dialog>, visible: bool) {
        unsafe {
            for dialog in bw::iter_dialogs(first_dialog) {
                // The command panel goes with the console band like the rest of it, but the
                // transport has a veto: showing the console again must not put SC:R's replay plate
                // back underneath ours.
                if is_command_panel_dialog(dialog) {
                    set_dialog_visible(dialog, visible && !self.command_panel_hidden());
                    continue;
                }
                if is_console_dialog(dialog) && !is_minimap_dialog(dialog) {
                    set_dialog_visible(dialog, visible);
                }
            }
            self.console_hidden_state.store(!visible, Ordering::Relaxed);
            let height = if visible {
                f32::from_bits(
                    self.original_game_screen_height_ratio
                        .load(Ordering::Relaxed),
                )
            } else {
                1.0
            };
            self.set_game_screen_height(height);
        }
    }

    /// Shows or hides the minimap on its own. The console's band and the game view's height are not
    /// this state's to move: the minimap draws over the game view at its own dialog coordinates.
    pub unsafe fn set_minimap_visible(&self, first_dialog: Option<Dialog>, visible: bool) {
        unsafe {
            for dialog in bw::iter_dialogs(first_dialog) {
                if is_minimap_dialog(dialog) {
                    set_dialog_visible(dialog, visible);
                }
            }
            self.minimap_hidden_state.store(!visible, Ordering::Relaxed);
        }
    }

    /// Hides a minimap dialog the game has just made, where the minimap is meant to be hidden. The
    /// hidden state outlives the dialogs it was applied to: the minimap can be put away before the
    /// game has made its dialog, and the game makes the console's dialogs again when it handles a
    /// replay seek itself.
    pub unsafe fn hide_new_minimap_if_hidden(&self, dialog: Dialog) {
        unsafe {
            if self.minimap_hidden() {
                set_dialog_visible(dialog, false);
            }
        }
    }

    /// Shows or hides SC:R's own replay controls, which live in the console's command panel.
    ///
    /// Part of the console band, so it can only be on screen while the console is: asking for it
    /// while the console is hidden records the wish and leaves the screen alone, and showing the
    /// console again is what carries it out.
    pub unsafe fn set_command_panel_visible(&self, first_dialog: Option<Dialog>, visible: bool) {
        unsafe {
            self.command_panel_hidden_state
                .store(!visible, Ordering::Relaxed);
            let visible = visible && !self.console_hidden();
            for dialog in bw::iter_dialogs(first_dialog) {
                if is_command_panel_dialog(dialog) {
                    set_dialog_visible(dialog, visible);
                }
            }
        }
    }

    /// Whether the game has given the console's band back to the console while it is hidden.
    ///
    /// Every map load sets the game view's height ratio to the map's own, and a replay seek SC:R
    /// handles itself reloads the map and makes the console dialogs anew, so a hidden console has to
    /// be hidden again after either: otherwise the view stops where the console was, over a black
    /// band.
    pub fn console_space_returned(&self) -> bool {
        self.console_hidden()
            && self
                .game_screen_height_ratio
                .as_ref()
                .is_some_and(|ratio| unsafe { ratio.resolve() } != 1.0)
    }

    unsafe fn set_game_screen_height(&self, value: f32) {
        unsafe {
            if let Some(ratio) = self.game_screen_height_ratio {
                ratio.write(value);
                let old_y = self.screen_y.resolve();
                (self.update_game_screen_size)(self.zoom.resolve());

                // Keep screen Y same as it was so that extra space is added/removed at bottom
                // where the console is.
                let max_y = self.screen_max_y().unwrap_or(0);
                let y = old_y.min(max_y);
                let x = self.screen_x.resolve();
                (self.move_screen)(x, y);
            }
        }
    }
}

unsafe fn set_dialog_visible(dialog: Dialog, visible: bool) {
    unsafe {
        let control = *dialog as *mut bw::scr::Control;
        if visible {
            (*control).flags |= 0x2;
        } else {
            (*control).flags &= !0x2;
        }
    }
}

fn is_console_dialog(dialog: Dialog) -> bool {
    CONSOLE_DIALOGS.contains(&dialog.as_control().string())
}

fn is_minimap_dialog(dialog: Dialog) -> bool {
    dialog.as_control().string() == MINIMAP_DIALOG
}

fn is_command_panel_dialog(dialog: Dialog) -> bool {
    dialog.as_control().string() == COMMAND_PANEL_DIALOG
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i16, top: i16, right: i16, bottom: i16) -> bw::Rect {
        bw::Rect {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn translating_the_map_moves_its_parent_and_keeps_the_image_local() {
        let parent = rect(10, 20, 300, 400);
        let image = rect(5, 8, 105, 108);
        let desired = rect(200, 300, 300, 400);

        let (moved_parent, moved_image) = translated_layout(parent, image, desired).unwrap();
        assert_eq!(moved_parent, rect(195, 292, 485, 672));
        assert_eq!(moved_image, image);
        assert_eq!(absolute_rect(moved_parent, moved_image), Some(desired));
    }

    #[test]
    fn requesting_the_natural_rect_restores_the_original_layout() {
        let parent = rect(10, 20, 150, 180);
        let image = rect(5, 8, 105, 108);
        let natural = absolute_rect(parent, image).unwrap();

        assert_eq!(
            translated_layout(parent, image, natural),
            Some((parent, image))
        );
    }

    #[test]
    fn invalid_or_overflowing_requests_leave_no_layout_to_apply() {
        let parent = rect(10, 20, 150, 180);
        let image = rect(5, 8, 105, 108);

        assert_eq!(translated_layout(parent, image, rect(1, 2, 11, 13)), None);
        assert_eq!(translated_layout(parent, image, rect(1, 2, 1, 2)), None);
        assert_eq!(
            translated_layout(parent, image, rect(i16::MIN, 0, i16::MIN + 100, 100)),
            None,
        );
    }
}
