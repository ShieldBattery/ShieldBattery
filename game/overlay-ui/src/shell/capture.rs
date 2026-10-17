//! What the game is allowed to see of a frame's input: how much of the pointer and the keyboard the
//! overlay takes, and which keys still get through a full capture.

use egui::Key;

/// How much of the pointer the overlay is taking this frame.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PointerCapture {
    /// Mouse events reach the game unless they land inside one of the frame's hit rects.
    HitRects,
    /// Every mouse event is the overlay's. Unit selection, drag-select and move/attack commands all
    /// ride the same messages, so taking them all is what makes a modal behave like a pause.
    All,
}

/// How much of the keyboard the overlay is taking this frame.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum KeyboardCapture {
    /// Only what a focused egui widget or a bound hotkey claims; every other key reaches the game.
    Selective,
    /// Every key is the overlay's, bar the carve-outs in [`InputCapture::blocks_game_key`].
    /// `chat` is whether the player can still open BW's chat box from under the modal.
    All { chat: bool },
}

/// What the game is allowed to see of this frame's input.
///
/// SC:R opens and submits its chat box from the Enter *character* rather than the key, so whether
/// the player can chat under a modal is a matter of whether typed characters reach the game: a
/// modal that keeps the player out of the chat box swallows them along with every key (see
/// [`blocks_game_char`](Self::blocks_game_char)), whether or not the box was already open when it
/// came up. That is how SC:R's own dialogs treat it: a message half typed when one comes up waits
/// in the box, untouched, until the dialog is gone.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct InputCapture {
    pub pointer: PointerCapture,
    pub keyboard: KeyboardCapture,
}

impl Default for InputCapture {
    fn default() -> InputCapture {
        InputCapture::PASS_THROUGH
    }
}

impl InputCapture {
    /// The policy with nothing of ours on screen: the game sees everything it would without us.
    pub const PASS_THROUGH: InputCapture = InputCapture {
        pointer: PointerCapture::HitRects,
        keyboard: KeyboardCapture::Selective,
    };

    /// The frame's policy.
    ///
    /// A capturing modal takes everything, the chat box included, unless `chat_allowed` says every
    /// capturing modal up lets the player talk from under it. Under one that does, BW's chat entry
    /// box keeps the keyboard while it is open: the player is typing, and every key belongs to that
    /// box — backspace, the arrow keys and Escape to close it included. And whatever is up, BW's
    /// own game menu gets every key and click while the player has it open, so a player stuck
    /// behind a modal can always reach Quit rather than the task manager.
    pub fn resolve(
        modal_captures: bool,
        chat_allowed: bool,
        native_textbox_open: bool,
        native_menu_open: bool,
    ) -> InputCapture {
        let captures = modal_captures && !native_menu_open;
        InputCapture {
            pointer: if captures {
                PointerCapture::All
            } else {
                PointerCapture::HitRects
            },
            keyboard: if captures && !(chat_allowed && native_textbox_open) {
                KeyboardCapture::All { chat: chat_allowed }
            } else {
                KeyboardCapture::Selective
            },
        }
    }

    /// Whether a mouse event that missed every hit rect should be kept from the game.
    pub fn blocks_game_pointer(self) -> bool {
        matches!(self.pointer, PointerCapture::All)
    }

    /// Whether a key aimed at the game should be kept from it.
    ///
    /// `key` is the keypress in the shell's own terms, or `None` for a key the host could not name.
    /// Two keys can get through a full capture. Return, under a modal the player may chat from:
    /// SC:R opens its chat box from the Enter character rather than from this virtual key, so the
    /// keypress carries no unit command and swallowing it would only cost the player their way into
    /// the chat box. F10, always: it opens BW's game menu, which then lifts the capture (see
    /// [`resolve`](Self::resolve)), so the player can always leave a stuck game.
    ///
    /// Escape stays blocked: it carries no unit command, but BW's top dialog during a stall is the
    /// hidden `TimeOut`, and Escape's effect on that is not worth finding out. Alt combinations (BW's
    /// menu accelerators) stay blocked too: BW ignores them under that dialog anyway, and a lone Alt
    /// reaching the window can leave it in Windows' menu-key mode, eating every key after it.
    pub fn blocks_game_key(self, key: Option<Key>) -> bool {
        match self.keyboard {
            KeyboardCapture::Selective => false,
            KeyboardCapture::All { chat } => match key {
                Some(Key::F10) => false,
                Some(Key::Enter) => !chat,
                _ => true,
            },
        }
    }

    /// Whether a typed character aimed at the game should be kept from it, which is what keeps the
    /// chat box from opening under a modal the player may not chat from.
    pub fn blocks_game_char(self) -> bool {
        matches!(self.keyboard, KeyboardCapture::All { chat: false })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_on_screen_leaves_every_input_to_the_game() {
        let capture = InputCapture::resolve(false, false, false, false);
        assert_eq!(capture, InputCapture::PASS_THROUGH);
        assert!(!capture.blocks_game_pointer());
        assert!(!capture.blocks_game_key(Some(Key::A)));
    }

    #[test]
    fn a_capturing_modal_takes_the_pointer_and_the_keyboard() {
        let capture = InputCapture::resolve(true, false, false, false);
        assert!(capture.blocks_game_pointer());
        assert!(capture.blocks_game_key(Some(Key::A)));
        assert!(capture.blocks_game_key(None));
    }

    #[test]
    fn f10_survives_a_full_capture() {
        let capture = InputCapture::resolve(true, false, false, false);
        assert!(!capture.blocks_game_key(Some(Key::F10)));
        assert!(capture.blocks_game_key(Some(Key::Escape)));
    }

    #[test]
    fn a_modal_that_keeps_chat_shut_takes_return_and_every_character() {
        let capture = InputCapture::resolve(true, false, false, false);
        assert!(capture.blocks_game_key(Some(Key::Enter)));
        assert!(capture.blocks_game_char());
    }

    #[test]
    fn a_modal_the_player_may_chat_from_leaves_return_and_characters_to_the_game() {
        let capture = InputCapture::resolve(true, true, false, false);
        assert!(!capture.blocks_game_key(Some(Key::Enter)));
        assert!(!capture.blocks_game_char());
        assert!(capture.blocks_game_key(Some(Key::A)));
    }

    #[test]
    fn an_open_game_menu_gets_every_input() {
        let capture = InputCapture::resolve(true, false, false, true);
        assert_eq!(capture, InputCapture::PASS_THROUGH);
    }

    #[test]
    fn an_open_chat_box_keeps_the_keyboard_under_a_modal_the_player_may_chat_from() {
        let capture = InputCapture::resolve(true, true, true, false);
        assert!(capture.blocks_game_pointer());
        assert!(!capture.blocks_game_key(Some(Key::Backspace)));
        assert!(!capture.blocks_game_key(Some(Key::Escape)));
        assert!(!capture.blocks_game_char());
    }

    #[test]
    fn an_open_chat_box_is_frozen_under_a_modal_that_keeps_chat_shut() {
        let capture = InputCapture::resolve(true, false, true, false);
        assert!(capture.blocks_game_key(Some(Key::Backspace)));
        assert!(capture.blocks_game_key(Some(Key::Enter)));
        assert!(capture.blocks_game_char());
    }
}
