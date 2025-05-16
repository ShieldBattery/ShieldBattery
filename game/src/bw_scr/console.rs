use std::sync::atomic::Ordering;

use bw_dat::dialog::Dialog;

use crate::bw;

use super::BwScr;

pub const CONSOLE_DIALOGS: &[&str] = &["StatPort", "Minimap", "Stat_F10", "StatBtn", "StatData"];

impl BwScr {
    pub fn console_hidden(&self) -> bool {
        self.console_hidden_state.load(Ordering::Relaxed)
    }

    pub unsafe fn hide_console(&self, first_dialog: Option<Dialog>) { unsafe {
        for dialog in bw::iter_dialogs(first_dialog) {
            if is_console_dialog(dialog) {
                // Note: While setting the hide flag is enough to make dialog not
                // be drawn, it'll still respond to events. To make it not do that,
                // bw_scr::dialog_hook will check hook these same dialogs and
                // check `self.console_hidden` at their event handler, which hopefully
                // is enough to remove all interactability from them.
                (*(*dialog as *mut bw::scr::Control)).flags &= !0x2;
            }
        }
        self.console_hidden_state.store(true, Ordering::Relaxed);
        self.set_game_screen_height(1.0);
    }}

    pub unsafe fn show_console(&self, first_dialog: Option<Dialog>) { unsafe {
        for dialog in bw::iter_dialogs(first_dialog) {
            if is_console_dialog(dialog) {
                (*(*dialog as *mut bw::scr::Control)).flags |= 0x2;
            }
        }
        self.console_hidden_state.store(false, Ordering::Relaxed);
        let old_ratio = f32::from_bits(
            self.original_game_screen_height_ratio
                .load(Ordering::Relaxed),
        );
        self.set_game_screen_height(old_ratio);
    }}

    unsafe fn set_game_screen_height(&self, value: f32) { unsafe {
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
    }}
}

fn is_console_dialog(dialog: Dialog) -> bool {
    let ctrl = dialog.as_control();
    let name = ctrl.string();
    CONSOLE_DIALOGS.contains(&name)
}
