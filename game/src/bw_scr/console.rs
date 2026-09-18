use std::sync::atomic::Ordering;

use bw_dat::dialog::Dialog;

use crate::bw;

use super::BwScr;

/// The dialogs that make up BW's bottom console, including the minimap.
///
/// Hiding is split in two: [`BwScr::set_console_visible`] moves everything here except the minimap,
/// and [`BwScr::set_minimap_visible`] moves the minimap alone. The whole list still matters for
/// event handling, since every one of these dialogs has to stop responding while it is hidden.
pub const CONSOLE_DIALOGS: &[&str] = &["StatPort", "Minimap", "Stat_F10", "StatBtn", "StatData"];

/// The minimap's dialog, which has a visibility of its own: observers routinely keep the minimap
/// while the rest of the console is hidden, which is what SC:R's own observer view renders.
pub const MINIMAP_DIALOG: &str = "Minimap";

/// The console's menu button. Not the menu it opens, which is a dialog of its own built from
/// `rez/gamemenu.ui.json`.
pub const MENU_BUTTON_DIALOG: &str = "Stat_F10";

impl BwScr {
    pub fn console_hidden(&self) -> bool {
        self.console_hidden_state.load(Ordering::Relaxed)
    }

    pub fn minimap_hidden(&self) -> bool {
        self.minimap_hidden_state.load(Ordering::Relaxed)
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

    unsafe fn set_game_screen_height(&self, value: f32) {
        unsafe {
            if let Some(ratio) = self.game_screen_height_ratio {
                ratio.write(value);
                let old_y = self.screen_y.resolve();
                (self.update_game_screen_size)(self.zoom.resolve());

                // Keep screen Y same as it was so that extra space is added/removed at bottom
                // where the console is.
                let new_height = self.game_screen_height_bwpx.resolve();
                let max_y = self.map_height_pixels.resolve().saturating_sub(new_height);
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
