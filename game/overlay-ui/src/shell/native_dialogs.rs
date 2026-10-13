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
    /// The popup a player gets on winning, offering to end the mission or keep playing.
    Victory,
    /// The popup a player gets on losing, with the same two choices.
    Defeat,
}

/// The `TimeOut` dialog's runtime name.
pub const TIME_OUT_DIALOG_NAME: &str = "TimeOut";

/// The chat history dialog's runtime name, built from the template `rez/chathist.ui.json`.
pub const CHAT_HISTORY_DIALOG_NAME: &str = "ChatHistory";

/// The game menu dialog's runtime name, built from the template `rez/gamemenu.ui.json`. Note that
/// `Stat_F10`, which the console owns, is the *button* that opens this menu and not the menu itself.
pub const GAME_MENU_DIALOG_NAME: &str = "GameMenu";

/// The victory popup's runtime name.
pub const VICTORY_DIALOG_NAME: &str = "WMission";

/// The defeat popup's runtime name.
pub const DEFEAT_DIALOG_NAME: &str = "LMission";

// The victory and defeat popups' two buttons. Their ids are inferred from the convention SC:R's
// other in-game dialogs follow rather than read from the templates: a button sets the dialog's
// return code to its own id, -2 is the button that carries on (the quit confirmation's "yes") and
// -3 the one that goes back to the game (the menu's "return to game"). A press that finds no such
// control logs the ids the dialog does have, which is what to correct these from.
/// The victory popup's End Mission button.
pub const VICTORY_END_MISSION_CONTROL_ID: i16 = -2;
/// The victory popup's Continue Playing button.
pub const VICTORY_CONTINUE_CONTROL_ID: i16 = -3;
/// The defeat popup's End Mission button.
pub const DEFEAT_END_MISSION_CONTROL_ID: i16 = -2;
/// The defeat popup's Continue Playing button.
pub const DEFEAT_CONTINUE_CONTROL_ID: i16 = -3;

impl NativeDialog {
    /// Every replaceable dialog, in the order a host may index by.
    pub const ALL: [NativeDialog; 5] = [
        NativeDialog::TimeOut,
        NativeDialog::ChatHistory,
        NativeDialog::GameMenu,
        NativeDialog::Victory,
        NativeDialog::Defeat,
    ];

    /// This dialog's position in [`ALL`](Self::ALL), for a host keeping one slot of state per
    /// replaceable dialog.
    pub fn index(self) -> usize {
        match self {
            NativeDialog::TimeOut => 0,
            NativeDialog::ChatHistory => 1,
            NativeDialog::GameMenu => 2,
            NativeDialog::Victory => 3,
            NativeDialog::Defeat => 4,
        }
    }

    /// The name SC:R gives this dialog at runtime.
    pub fn runtime_name(self) -> &'static str {
        match self {
            NativeDialog::TimeOut => TIME_OUT_DIALOG_NAME,
            NativeDialog::ChatHistory => CHAT_HISTORY_DIALOG_NAME,
            NativeDialog::GameMenu => GAME_MENU_DIALOG_NAME,
            NativeDialog::Victory => VICTORY_DIALOG_NAME,
            NativeDialog::Defeat => DEFEAT_DIALOG_NAME,
        }
    }

    /// The id of the control that dismisses this dialog, its return or close button.
    ///
    /// Dismissing a replaced dialog means sending this control the event a click on it would:
    /// SC:R's in-game menus enter a modal state (single-player pause, suspended cursor updates, a
    /// restricted hotkey context) before their dialog spawns and leave it only when the dialog
    /// closes through its own path, so a replacement that merely leaves the dialog hidden strands
    /// the game in that state. The menus give their return button id -3; the chat log has no such
    /// button and closes from its default button, -2. Dismissing the victory or defeat popup is
    /// choosing to keep playing, which is that popup's way back to the game.
    pub fn return_control_id(self) -> i16 {
        match self {
            NativeDialog::TimeOut | NativeDialog::GameMenu => -3,
            NativeDialog::ChatHistory => -2,
            NativeDialog::Victory => VICTORY_CONTINUE_CONTROL_ID,
            NativeDialog::Defeat => DEFEAT_CONTINUE_CONTROL_ID,
        }
    }

    /// The id of the control that ends the game from this dialog, for the dialogs that offer one:
    /// the victory and defeat popups' End Mission.
    pub fn end_mission_control_id(self) -> Option<i16> {
        match self {
            NativeDialog::Victory => Some(VICTORY_END_MISSION_CONTROL_ID),
            NativeDialog::Defeat => Some(DEFEAT_END_MISSION_CONTROL_ID),
            NativeDialog::TimeOut | NativeDialog::ChatHistory | NativeDialog::GameMenu => None,
        }
    }

    /// A short name for this dialog in a log line.
    pub fn label(self) -> &'static str {
        match self {
            NativeDialog::TimeOut => "TimeOut",
            NativeDialog::ChatHistory => "chat history",
            NativeDialog::GameMenu => "game menu",
            NativeDialog::Victory => "victory",
            NativeDialog::Defeat => "defeat",
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
    fn matches_the_victory_and_defeat_popups() {
        assert_eq!(replacement_for("WMission"), Some(NativeDialog::Victory));
        assert_eq!(replacement_for("lmission"), Some(NativeDialog::Defeat));
    }

    #[test]
    fn only_the_result_popups_can_end_the_mission() {
        for dialog in NativeDialog::ALL {
            let offers_end = matches!(dialog, NativeDialog::Victory | NativeDialog::Defeat);
            assert_eq!(dialog.end_mission_control_id().is_some(), offers_end);
            if let Some(end) = dialog.end_mission_control_id() {
                assert_ne!(
                    end,
                    dialog.return_control_id(),
                    "{dialog:?} shares its two buttons"
                );
            }
        }
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
