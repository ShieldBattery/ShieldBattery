//! The registry of SC:R dialogs the overlay replaces with a surface of its own.
//!
//! Taking a native dialog over is cheap: SC:R's dialog system is Win32-shaped, so a host can clear
//! the dialog's visible flag at spawn, swap in an event handler that swallows everything the dialog
//! would react to, and draw our own surface in its place. What the host cannot do is guess *which*
//! dialogs get that treatment, so the list lives here, next to the shell that owns the replacement
//! surfaces.
//!
//! Matching is by the name SC:R gives a dialog at runtime, which is what the spawn hook sees.

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
pub const CHAT_HISTORY_DIALOG_NAME: &str = "ChatHistory";

/// The game menu dialog's runtime name, built from the template `rez/gamemenu.ui.json`. Note that
/// `Stat_F10`, which the console owns, is the *button* that opens this menu and not the menu itself.
pub const GAME_MENU_DIALOG_NAME: &str = "GameMenu";

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

    /// The name SC:R gives this dialog at runtime.
    pub fn runtime_name(self) -> &'static str {
        match self {
            NativeDialog::TimeOut => TIME_OUT_DIALOG_NAME,
            NativeDialog::ChatHistory => CHAT_HISTORY_DIALOG_NAME,
            NativeDialog::GameMenu => GAME_MENU_DIALOG_NAME,
        }
    }

    /// The id of the control that dismisses this dialog, its return or close button.
    ///
    /// Dismissing a replaced dialog means sending this control the event a click on it would:
    /// SC:R's in-game menus enter a modal state (single-player pause, suspended cursor updates, a
    /// restricted hotkey context) before their dialog spawns and leave it only when the dialog
    /// closes through its own path, so a replacement that merely leaves the dialog hidden strands
    /// the game in that state. The menus give their return button id -3; the chat log has no such
    /// button and closes from its default button, -2.
    pub fn return_control_id(self) -> i16 {
        match self {
            NativeDialog::TimeOut | NativeDialog::GameMenu => -3,
            NativeDialog::ChatHistory => -2,
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
    NativeDialog::ALL
        .into_iter()
        .find(|dialog| dialog.runtime_name().eq_ignore_ascii_case(runtime_name))
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
    fn matches_the_game_menu_but_not_its_console_button() {
        assert_eq!(replacement_for("GameMenu"), Some(NativeDialog::GameMenu));
        assert_eq!(
            replacement_for("chathistory"),
            Some(NativeDialog::ChatHistory)
        );
        assert_eq!(replacement_for("Stat_F10"), None);
    }

    #[test]
    fn leaves_every_other_dialog_to_the_game() {
        for name in ["StatBtn", "Minimap", "TextBox", "Stat_F10", ""] {
            assert_eq!(replacement_for(name), None, "{name} must not be replaced");
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
