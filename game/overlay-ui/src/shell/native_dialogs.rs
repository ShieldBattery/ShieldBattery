//! The registry of SC:R dialogs the overlay replaces with a surface of its own.
//!
//! Taking a native dialog over is cheap: SC:R's dialog system is Win32-shaped, so a host can clear
//! the dialog's visible flag at spawn, swap in an event handler that swallows everything the dialog
//! would react to, and draw our own surface in its place. What the host cannot do is guess *which*
//! dialogs get that treatment, so the list lives here, next to the shell that owns the replacement
//! surfaces.
//!
//! Matching is by the name SC:R gives a dialog at runtime, which is not the same as the template
//! file it is built from: the name is what the spawn hook sees. For a dialog whose runtime name has
//! not been captured from a live session yet, the constant below is `None` and the registry simply
//! never matches it, so nothing is hidden that has no replacement.

/// A native SC:R dialog the overlay stands in for.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash)]
pub enum NativeDialog {
    /// The waiting-for-players dialog BW raises when the simulation stalls on a peer.
    TimeOut,
    /// The chat log, opened with `=` in game.
    ChatHistory,
    /// The in-game menu, opened with `F10` or `Alt+M`.
    GameMenu,
}

/// The `TimeOut` dialog's runtime name.
pub const TIME_OUT_DIALOG_NAME: &str = "TimeOut";

/// The chat history dialog's runtime name, built from the template `rez/chathist.ui.json`.
///
/// `None` until it is captured: open the chat log in a live game and read the name off that
/// session's `spawn_dialog:` log line. The template name is not it — SC:R names the dialog from
/// inside the `.ui.json`, and only the spawn hook sees what that name is.
pub const CHAT_HISTORY_DIALOG_NAME: Option<&str> = None;

/// The game menu dialog's runtime name, built from the template `rez/gamemenu.ui.json`.
///
/// `None` until it is captured: open the menu in a live game and read the name off that session's
/// `spawn_dialog:` log line. Note that `Stat_F10`, which the console owns, is the *button* that
/// opens this menu and not the menu itself.
pub const GAME_MENU_DIALOG_NAME: Option<&str> = None;

/// The id of the control every in-game menu template gives its return/cancel button.
///
/// Dismissing a replaced menu means sending this control the event a click on it would: SC:R's
/// in-game menus enter a modal state (single-player pause, suspended cursor updates, a restricted
/// hotkey context) before their dialog spawns and leave it only when the dialog closes through its
/// own path, so a replacement that merely leaves the dialog hidden strands the game in that state.
pub const RETURN_CONTROL_ID: i16 = -3;

impl NativeDialog {
    /// Every replaceable dialog, in the order a host may index by.
    pub const ALL: [NativeDialog; 3] = [
        NativeDialog::TimeOut,
        NativeDialog::ChatHistory,
        NativeDialog::GameMenu,
    ];

    /// This dialog's position in [`ALL`](Self::ALL), for a host keeping one slot of state per
    /// replaceable dialog.
    pub fn index(self) -> usize {
        match self {
            NativeDialog::TimeOut => 0,
            NativeDialog::ChatHistory => 1,
            NativeDialog::GameMenu => 2,
        }
    }

    /// The name SC:R gives this dialog at runtime, or `None` while that name is still uncaptured.
    pub fn runtime_name(self) -> Option<&'static str> {
        match self {
            NativeDialog::TimeOut => Some(TIME_OUT_DIALOG_NAME),
            NativeDialog::ChatHistory => CHAT_HISTORY_DIALOG_NAME,
            NativeDialog::GameMenu => GAME_MENU_DIALOG_NAME,
        }
    }

    /// A short name for this dialog in a log line.
    pub fn label(self) -> &'static str {
        match self {
            NativeDialog::TimeOut => "TimeOut",
            NativeDialog::ChatHistory => "chat history",
            NativeDialog::GameMenu => "game menu",
        }
    }
}

/// Which replacement, if any, a dialog spawning under this name gets.
///
/// Case-insensitive: the name comes from the dialog template's own spelling, and nothing guarantees
/// which case that is.
pub fn replacement_for(runtime_name: &str) -> Option<NativeDialog> {
    NativeDialog::ALL.into_iter().find(|dialog| {
        dialog
            .runtime_name()
            .is_some_and(|name| name.eq_ignore_ascii_case(runtime_name))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_timeout_dialog_in_any_case() {
        assert_eq!(replacement_for("TimeOut"), Some(NativeDialog::TimeOut));
        assert_eq!(replacement_for("timeout"), Some(NativeDialog::TimeOut));
        assert_eq!(replacement_for("TIMEOUT"), Some(NativeDialog::TimeOut));
    }

    #[test]
    fn leaves_every_other_dialog_to_the_game() {
        for name in ["StatBtn", "Minimap", "TextBox", "Stat_F10", ""] {
            assert_eq!(replacement_for(name), None, "{name} must not be replaced");
        }
    }

    #[test]
    fn an_uncaptured_name_never_matches() {
        // A dialog whose runtime name is still unknown must stay inert rather than matching on an
        // empty or guessed name, which would hide a dialog nothing replaces.
        assert_eq!(NativeDialog::ChatHistory.runtime_name(), None);
        assert_eq!(NativeDialog::GameMenu.runtime_name(), None);
        for dialog in NativeDialog::ALL {
            if let Some(name) = dialog.runtime_name() {
                assert_eq!(replacement_for(name), Some(dialog));
            }
        }
    }

    #[test]
    fn indices_cover_every_dialog_exactly_once() {
        let mut seen = [false; NativeDialog::ALL.len()];
        for dialog in NativeDialog::ALL {
            assert!(!seen[dialog.index()], "{dialog:?} shares an index");
            seen[dialog.index()] = true;
        }
        assert!(seen.into_iter().all(|x| x));
    }
}
