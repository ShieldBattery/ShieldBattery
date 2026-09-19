//! The shell's key bindings: one table from action to chord, and the rule for reading a keypress
//! against it.
//!
//! The bindings reuse SC:R's own replay-viewer key wherever the concept matches, so a caster's
//! muscle memory carries over, and fill the gaps with plain letters SC:R leaves unbound. Keeping
//! them in one table is what makes them user-customizable later without touching the shell.

use egui::{Key, Modifiers};

/// Something a key can ask the shell for.
///
/// An action exists here as soon as its binding is decided, which is earlier than the surface it
/// drives exists. The shell consumes a keypress only for an action it can actually carry out, so a
/// binding whose surface has not been built yet leaves the key to the game.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash)]
pub enum Action {
    /// Pause or resume replay playback.
    PauseResume,
    /// One step up the replay speed ladder.
    SpeedUp,
    /// One step down the replay speed ladder.
    SpeedDown,
    /// Seek backward; `Shift` lengthens the step.
    SeekBackward,
    /// Seek forward; `Shift` lengthens the step.
    SeekForward,
    /// Show every panel, or hide every panel when they are all already shown.
    ToggleAllPanels,
    /// The economy panel.
    ToggleEconomy,
    /// The production panel.
    ToggleProduction,
    /// BW's own bottom console.
    ToggleConsole,
    /// The side panel: the matchup bar, or the team cards in a larger game.
    ToggleSidePanel,
    /// BW's own minimap, which is independent of the rest of the console.
    ToggleMinimap,
    /// The replay transport plate.
    ToggleTransport,
    /// The military panel.
    ToggleMilitary,
    /// The graphs panel; repeated presses walk its measurements, `Shift` walks them backwards.
    ToggleGraphs,
    /// The timeline feed.
    ToggleTimeline,
    /// The control groups panel.
    ToggleControlGroups,
    /// The map control bar.
    ToggleMapControl,
    /// Step the observer vision selection.
    CycleVision,
    /// Spoiler-free mode, which hides everything that gives the outcome away.
    ToggleSpoilerFree,
    /// The edge dock holding the panel rail; `Shift` changes which of its two forms it is in.
    ToggleDock,
}

impl Action {
    /// Every action, for a caller walking the table.
    pub const ALL: [Action; 20] = [
        Action::PauseResume,
        Action::SpeedUp,
        Action::SpeedDown,
        Action::SeekBackward,
        Action::SeekForward,
        Action::ToggleAllPanels,
        Action::ToggleEconomy,
        Action::ToggleProduction,
        Action::ToggleConsole,
        Action::ToggleSidePanel,
        Action::ToggleMinimap,
        Action::ToggleTransport,
        Action::ToggleMilitary,
        Action::ToggleGraphs,
        Action::ToggleTimeline,
        Action::ToggleControlGroups,
        Action::ToggleMapControl,
        Action::CycleVision,
        Action::ToggleSpoilerFree,
        Action::ToggleDock,
    ];

    /// A short name for this action in a knob panel or a log line.
    pub fn label(self) -> &'static str {
        match self {
            Action::PauseResume => "pause / resume",
            Action::SpeedUp => "speed up",
            Action::SpeedDown => "speed down",
            Action::SeekBackward => "seek back",
            Action::SeekForward => "seek forward",
            Action::ToggleAllPanels => "all panels",
            Action::ToggleEconomy => "economy",
            Action::ToggleProduction => "production",
            Action::ToggleConsole => "console",
            Action::ToggleSidePanel => "side panel",
            Action::ToggleMinimap => "minimap",
            Action::ToggleTransport => "transport",
            Action::ToggleMilitary => "military",
            Action::ToggleGraphs => "graphs",
            Action::ToggleTimeline => "timeline",
            Action::ToggleControlGroups => "control groups",
            Action::ToggleMapControl => "map control",
            Action::CycleVision => "cycle vision",
            Action::ToggleSpoilerFree => "spoiler-free",
            Action::ToggleDock => "dock",
        }
    }
}

/// The keystroke that triggers an action.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash)]
pub struct Chord {
    pub key: Key,
}

impl Chord {
    pub const fn new(key: Key) -> Chord {
        Chord { key }
    }

    /// Whether this keypress is this chord.
    ///
    /// Ctrl and Alt must be up. SC:R binds nearly every modified chord in game (`Alt+M` opens its
    /// menu, `Ctrl+M` cycles music, `Ctrl+Q` quits), so a bare-letter binding that also fired with
    /// those held would take keystrokes the game still owns. Shift is allowed through, because it
    /// scales an action — a longer seek, a walk the other way — rather than selecting a different one.
    pub fn matches(self, key: Key, modifiers: Modifiers) -> bool {
        self.key == key && !modifiers.ctrl && !modifiers.alt
    }
}

/// The action-to-chord table.
#[derive(Clone, Debug)]
pub struct Hotkeys {
    bindings: Vec<(Action, Chord)>,
}

impl Default for Hotkeys {
    fn default() -> Hotkeys {
        Hotkeys::defaults()
    }
}

impl Hotkeys {
    /// The shipped bindings.
    pub fn defaults() -> Hotkeys {
        let bindings = vec![
            (Action::PauseResume, Chord::new(Key::P)),
            (Action::SpeedUp, Chord::new(Key::U)),
            (Action::SpeedDown, Chord::new(Key::D)),
            (Action::SeekBackward, Chord::new(Key::Comma)),
            (Action::SeekForward, Chord::new(Key::Period)),
            (Action::ToggleAllPanels, Chord::new(Key::A)),
            (Action::ToggleEconomy, Chord::new(Key::E)),
            (Action::ToggleProduction, Chord::new(Key::F)),
            (Action::ToggleConsole, Chord::new(Key::W)),
            (Action::ToggleSidePanel, Chord::new(Key::R)),
            (Action::ToggleMinimap, Chord::new(Key::Q)),
            (Action::ToggleTransport, Chord::new(Key::Y)),
            (Action::ToggleMilitary, Chord::new(Key::M)),
            (Action::ToggleGraphs, Chord::new(Key::G)),
            (Action::ToggleTimeline, Chord::new(Key::T)),
            (Action::ToggleControlGroups, Chord::new(Key::H)),
            (Action::ToggleMapControl, Chord::new(Key::N)),
            (Action::CycleVision, Chord::new(Key::V)),
            (Action::ToggleSpoilerFree, Chord::new(Key::L)),
            (Action::ToggleDock, Chord::new(Key::Backtick)),
        ];
        Hotkeys { bindings }
    }

    /// Every binding, in table order.
    pub fn bindings(&self) -> &[(Action, Chord)] {
        &self.bindings
    }

    /// Which action this keypress asks for, if any.
    pub fn action_for(&self, key: Key, modifiers: Modifiers) -> Option<Action> {
        self.bindings
            .iter()
            .find(|(_, chord)| chord.matches(key, modifiers))
            .map(|(action, _)| *action)
    }

    /// Which chord triggers this action.
    pub fn chord_for(&self, action: Action) -> Option<Chord> {
        self.bindings
            .iter()
            .find(|(bound, _)| *bound == action)
            .map(|(_, chord)| *chord)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain() -> Modifiers {
        Modifiers::NONE
    }

    #[test]
    fn every_action_is_bound_exactly_once() {
        let hotkeys = Hotkeys::defaults();
        for action in Action::ALL {
            assert!(
                hotkeys.chord_for(action).is_some(),
                "{action:?} has no binding"
            );
        }
        assert_eq!(hotkeys.bindings().len(), Action::ALL.len());
    }

    #[test]
    fn no_two_actions_share_a_key() {
        let hotkeys = Hotkeys::defaults();
        for (index, (action, chord)) in hotkeys.bindings().iter().enumerate() {
            for (other_action, other_chord) in &hotkeys.bindings()[index + 1..] {
                assert_ne!(
                    chord, other_chord,
                    "{action:?} and {other_action:?} share {chord:?}"
                );
            }
        }
    }

    #[test]
    fn reads_the_documented_defaults() {
        let hotkeys = Hotkeys::defaults();
        for (key, action) in [
            (Key::P, Action::PauseResume),
            (Key::A, Action::ToggleAllPanels),
            (Key::E, Action::ToggleEconomy),
            (Key::F, Action::ToggleProduction),
            (Key::W, Action::ToggleConsole),
            (Key::Q, Action::ToggleMinimap),
            (Key::M, Action::ToggleMilitary),
            (Key::Backtick, Action::ToggleDock),
        ] {
            assert_eq!(hotkeys.action_for(key, plain()), Some(action));
        }
    }

    #[test]
    fn leaves_the_games_modified_chords_alone() {
        let hotkeys = Hotkeys::defaults();
        let alt = Modifiers {
            alt: true,
            ..Modifiers::NONE
        };
        let ctrl = Modifiers {
            ctrl: true,
            command: true,
            ..Modifiers::NONE
        };
        // Alt+M is SC:R's menu and Ctrl+M its music toggle; neither may reach our military panel.
        assert_eq!(hotkeys.action_for(Key::M, alt), None);
        assert_eq!(hotkeys.action_for(Key::M, ctrl), None);
    }

    #[test]
    fn shift_scales_an_action_rather_than_changing_it() {
        let hotkeys = Hotkeys::defaults();
        let shift = Modifiers {
            shift: true,
            ..Modifiers::NONE
        };
        assert_eq!(
            hotkeys.action_for(Key::Period, shift),
            Some(Action::SeekForward)
        );
        assert_eq!(
            hotkeys.action_for(Key::G, shift),
            Some(Action::ToggleGraphs)
        );
    }

    #[test]
    fn an_unbound_key_is_nobodys() {
        let hotkeys = Hotkeys::defaults();
        for key in [Key::Tab, Key::Space, Key::ArrowLeft, Key::F5, Key::Escape] {
            assert_eq!(hotkeys.action_for(key, plain()), None);
        }
    }
}
