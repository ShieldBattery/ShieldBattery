//! The shell's key bindings: one table from action to chord, and the rule for reading a keypress
//! against it.
//!
//! The bindings are SC:R's own observer keys wherever SC:R has one for the same surface, every
//! form of them included (`W`, `Ctrl+W`, `Ctrl+U` and `Alt+U` all toggle the selection panel there,
//! so they all do here), so a caster's muscle memory carries over. The gaps are filled with plain
//! letters SC:R leaves unbound. Keeping them in one table is what makes them user-customizable later
//! without touching the shell.

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
    /// Seek backward; `Shift` lengthens the step, and its `Ctrl` chord lengthens it further.
    SeekBackward,
    /// Seek forward; `Shift` lengthens the step, and its `Ctrl` chord lengthens it further.
    SeekForward,
    /// Hide every panel on screen, or bring back the ones that hid.
    ToggleAllPanels,
    /// The economy panel.
    ToggleEconomy,
    /// The production panel.
    ToggleProduction,
    /// The matchup, as the bar (or the team cards in a larger game) or as the compact scoreboard:
    /// what SC:R calls its statistics panel. `Shift` switches between those two forms.
    ToggleMatchup,
    /// BW's own minimap, which is independent of the rest of the console.
    ToggleMinimap,
    /// The replay playback controls.
    TogglePlaybackControls,
    /// The military panel.
    ToggleMilitary,
    /// The graphs panel; `Shift` steps it to the next measurement and its `Ctrl` chord to the
    /// previous one.
    ToggleGraphs,
    /// The timeline feed.
    ToggleTimeline,
    /// The control groups panel.
    ToggleControlGroups,
    /// The selection panel, which stands in for the game console's own.
    ToggleSelection,
    /// The map control bar.
    ToggleMapControl,
    /// Step the observer vision selection.
    CycleVision,
    /// The list of players whose vision the game is shown through, which SC:R's diplomacy keys open.
    ToggleVisionPicker,
    /// Spoiler-free mode, which hides everything that gives the outcome away.
    ToggleSpoilerFree,
    /// The dock holding the panel table, which SC:R calls its side panel; `Shift` changes which of
    /// its two forms it is in.
    ToggleDock,
}

impl Action {
    /// Every action, for a caller walking the table.
    pub const ALL: [Action; 21] = [
        Action::PauseResume,
        Action::SpeedUp,
        Action::SpeedDown,
        Action::SeekBackward,
        Action::SeekForward,
        Action::ToggleAllPanels,
        Action::ToggleEconomy,
        Action::ToggleProduction,
        Action::ToggleMatchup,
        Action::ToggleMinimap,
        Action::TogglePlaybackControls,
        Action::ToggleMilitary,
        Action::ToggleGraphs,
        Action::ToggleTimeline,
        Action::ToggleControlGroups,
        Action::ToggleSelection,
        Action::ToggleMapControl,
        Action::CycleVision,
        Action::ToggleVisionPicker,
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
            Action::ToggleMatchup => "matchup",
            Action::ToggleMinimap => "minimap",
            Action::TogglePlaybackControls => "playback controls",
            Action::ToggleMilitary => "military",
            Action::ToggleGraphs => "graphs",
            Action::ToggleTimeline => "timeline",
            Action::ToggleControlGroups => "control groups",
            Action::ToggleSelection => "selection",
            Action::ToggleMapControl => "map control",
            Action::CycleVision => "cycle vision",
            Action::ToggleVisionPicker => "vision list",
            Action::ToggleSpoilerFree => "spoiler-free",
            Action::ToggleDock => "dock",
        }
    }

    /// Whether a held key does this again each time it repeats. Only the steps along a replay's
    /// speed ladder and timeline do: the rest show, hide or switch something, which a held key
    /// would flip back and forth.
    pub fn repeats(self) -> bool {
        matches!(
            self,
            Action::SpeedUp | Action::SpeedDown | Action::SeekBackward | Action::SeekForward
        )
    }
}

/// Which of Ctrl and Alt a chord is pressed with.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash)]
pub enum Held {
    /// Neither.
    Bare,
    Ctrl,
    Alt,
}

/// The keystroke that triggers an action.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash)]
pub struct Chord {
    pub key: Key,
    pub held: Held,
}

impl Chord {
    pub const fn new(key: Key) -> Chord {
        Chord {
            key,
            held: Held::Bare,
        }
    }

    pub const fn ctrl(key: Key) -> Chord {
        Chord {
            key,
            held: Held::Ctrl,
        }
    }

    pub const fn alt(key: Key) -> Chord {
        Chord {
            key,
            held: Held::Alt,
        }
    }

    /// The keycaps a surface shows for this chord, in the order they are written, `shift` adding
    /// the Shift that scales an action: `[.]`, `[Shift, .]`, `[Ctrl, Shift, .]`. Modifiers keep
    /// their English names, which is how keyboards print them in every language we ship.
    pub fn keycaps(self, shift: bool) -> Vec<&'static str> {
        let mut keycaps = Vec::with_capacity(3);
        match self.held {
            Held::Bare => {}
            Held::Ctrl => keycaps.push("Ctrl"),
            Held::Alt => keycaps.push("Alt"),
        }
        if shift {
            keycaps.push("Shift");
        }
        keycaps.push(self.key.symbol_or_name());
        keycaps
    }

    /// Whether this keypress is this chord.
    ///
    /// Exactly the chord's own one of Ctrl and Alt must be down. SC:R binds nearly every modified
    /// chord in game (`Alt+M` opens its menu, `Ctrl+M` cycles music), so a bare-letter binding
    /// that also fired with those held would take keystrokes the game still owns. Shift is allowed
    /// through, because it scales an action — a longer seek, a walk the other way — rather than
    /// selecting a different one.
    pub fn matches(self, key: Key, modifiers: Modifiers) -> bool {
        let held = match (modifiers.ctrl, modifiers.alt) {
            (false, false) => Held::Bare,
            (true, false) => Held::Ctrl,
            (false, true) => Held::Alt,
            (true, true) => return false,
        };
        self.key == key && self.held == held
    }
}

/// The chords that open the game's menu, the one a surface names first.
pub const MENU_CHORDS: [Chord; 2] = [Chord::new(Key::F10), Chord::alt(Key::M)];

/// Whether this keypress is one that opens the game's menu: `F10`, or `Alt+M`.
pub fn is_menu_chord(key: Key, modifiers: Modifiers) -> bool {
    MENU_CHORDS
        .into_iter()
        .any(|chord| chord.matches(key, modifiers))
}

/// Whether this keypress is one of SC:R's quit keys: `Q` or `X` with Ctrl or Alt.
pub fn is_quit_chord(key: Key, modifiers: Modifiers) -> bool {
    [Key::Q, Key::X].into_iter().any(|quit| {
        Chord::ctrl(quit).matches(key, modifiers) || Chord::alt(quit).matches(key, modifiers)
    })
}

/// Whether this keypress is SC:R's key for its options: `Alt+O`.
pub fn is_options_chord(key: Key, modifiers: Modifiers) -> bool {
    Chord::alt(Key::O).matches(key, modifiers)
}

/// Whether this keypress is SC:R's key for saving the game: `Alt+S`. A ShieldBattery game is never
/// saved, so the key does nothing.
pub fn is_save_chord(key: Key, modifiers: Modifiers) -> bool {
    Chord::alt(Key::S).matches(key, modifiers)
}

/// Whether this keypress is one of SC:R's own menu keys, which the shell answers whatever has the
/// keyboard: the game menu, quitting, options and saving.
pub fn is_game_menu_key(key: Key, modifiers: Modifiers) -> bool {
    is_menu_chord(key, modifiers)
        || is_quit_chord(key, modifiers)
        || is_options_chord(key, modifiers)
        || is_save_chord(key, modifiers)
}

/// The action-to-chord table. An action may have several chords; the first is the one a surface
/// names when it says which key does what.
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
        use Key::*;
        let bindings = vec![
            (Action::PauseResume, Chord::new(P)),
            (Action::SpeedUp, Chord::new(U)),
            (Action::SpeedDown, Chord::new(D)),
            (Action::SeekBackward, Chord::new(Comma)),
            (Action::SeekBackward, Chord::ctrl(Comma)),
            (Action::SeekForward, Chord::new(Period)),
            (Action::SeekForward, Chord::ctrl(Period)),
            (Action::ToggleAllPanels, Chord::new(A)),
            (Action::ToggleAllPanels, Chord::ctrl(A)),
            (Action::ToggleAllPanels, Chord::alt(A)),
            (Action::ToggleMatchup, Chord::new(E)),
            (Action::ToggleMatchup, Chord::ctrl(E)),
            (Action::ToggleMatchup, Chord::alt(E)),
            (Action::ToggleEconomy, Chord::new(I)),
            (Action::ToggleProduction, Chord::new(F)),
            (Action::ToggleProduction, Chord::ctrl(F)),
            (Action::ToggleProduction, Chord::alt(F)),
            (Action::ToggleMinimap, Chord::new(Q)),
            (Action::ToggleMinimap, Chord::ctrl(I)),
            (Action::ToggleMinimap, Chord::alt(I)),
            (Action::ToggleSelection, Chord::new(W)),
            (Action::ToggleSelection, Chord::ctrl(W)),
            (Action::ToggleSelection, Chord::ctrl(U)),
            (Action::ToggleSelection, Chord::alt(U)),
            (Action::TogglePlaybackControls, Chord::new(Y)),
            (Action::TogglePlaybackControls, Chord::ctrl(Y)),
            (Action::TogglePlaybackControls, Chord::alt(Y)),
            (Action::ToggleVisionPicker, Chord::alt(Z)),
            (Action::ToggleVisionPicker, Chord::ctrl(Z)),
            // `Ctrl+R` is not taken: the game's own binding for it beats SC:R's side panel too.
            (Action::ToggleDock, Chord::new(R)),
            (Action::ToggleDock, Chord::alt(R)),
            (Action::ToggleDock, Chord::alt(W)),
            (Action::ToggleDock, Chord::new(Backtick)),
            (Action::ToggleMilitary, Chord::new(M)),
            (Action::ToggleGraphs, Chord::new(G)),
            (Action::ToggleGraphs, Chord::ctrl(G)),
            (Action::ToggleTimeline, Chord::new(T)),
            (Action::ToggleControlGroups, Chord::new(H)),
            (Action::ToggleMapControl, Chord::new(N)),
            (Action::CycleVision, Chord::new(V)),
            (Action::ToggleSpoilerFree, Chord::new(L)),
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

    /// The chord a surface names for this action: the first one bound to it.
    pub fn chord_for(&self, action: Action) -> Option<Chord> {
        self.bindings
            .iter()
            .find(|(bound, _)| *bound == action)
            .map(|(_, chord)| *chord)
    }

    /// The first chord bound to this action that is pressed with `held`, for a surface naming one
    /// particular form of an action, such as the longer seek its `Ctrl` chord takes.
    pub fn chord_held(&self, action: Action, held: Held) -> Option<Chord> {
        self.bindings
            .iter()
            .find(|(bound, chord)| *bound == action && chord.held == held)
            .map(|(_, chord)| *chord)
    }

    /// The key that does this action pressed on its own, for a surface with room for a single
    /// keycap. A chord with a modifier is never named this way, since its key alone does nothing.
    pub fn bare_key(&self, action: Action) -> Option<&'static str> {
        self.chord_held(action, Held::Bare)
            .map(|chord| chord.key.symbol_or_name())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain() -> Modifiers {
        Modifiers::NONE
    }

    fn alt() -> Modifiers {
        Modifiers {
            alt: true,
            ..Modifiers::NONE
        }
    }

    fn ctrl() -> Modifiers {
        Modifiers {
            ctrl: true,
            command: true,
            ..Modifiers::NONE
        }
    }

    #[test]
    fn keycaps_put_ctrl_or_alt_before_shift() {
        assert_eq!(Chord::new(Key::Period).keycaps(false), ["."]);
        assert_eq!(Chord::new(Key::Period).keycaps(true), ["Shift", "."]);
        assert_eq!(
            Chord::ctrl(Key::Comma).keycaps(true),
            ["Ctrl", "Shift", ","]
        );
        assert_eq!(Chord::alt(Key::A).keycaps(true), ["Alt", "Shift", "A"]);
    }

    #[test]
    fn every_action_is_bound() {
        let hotkeys = Hotkeys::defaults();
        for action in Action::ALL {
            assert!(
                hotkeys.chord_for(action).is_some(),
                "{action:?} has no binding"
            );
        }
    }

    #[test]
    fn no_two_bindings_share_a_chord() {
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
    fn a_surface_names_the_bare_key_where_there_is_one() {
        let hotkeys = Hotkeys::defaults();
        for action in Action::ALL {
            let has_bare = hotkeys
                .bindings()
                .iter()
                .any(|(bound, chord)| *bound == action && chord.held == Held::Bare);
            let named = hotkeys.chord_for(action).unwrap();
            assert!(
                !has_bare || named.held == Held::Bare,
                "{action:?} is named by {named:?}"
            );
        }
    }

    #[test]
    fn reads_scrs_observer_keys() {
        let hotkeys = Hotkeys::defaults();
        for (key, modifiers, action) in [
            (Key::E, plain(), Action::ToggleMatchup),
            (Key::E, alt(), Action::ToggleMatchup),
            (Key::F, ctrl(), Action::ToggleProduction),
            (Key::Q, plain(), Action::ToggleMinimap),
            (Key::I, alt(), Action::ToggleMinimap),
            (Key::W, plain(), Action::ToggleSelection),
            (Key::W, ctrl(), Action::ToggleSelection),
            (Key::U, alt(), Action::ToggleSelection),
            (Key::R, plain(), Action::ToggleDock),
            (Key::W, alt(), Action::ToggleDock),
            (Key::Z, ctrl(), Action::ToggleVisionPicker),
            (Key::Y, alt(), Action::TogglePlaybackControls),
            (Key::A, ctrl(), Action::ToggleAllPanels),
        ] {
            assert_eq!(
                hotkeys.action_for(key, modifiers),
                Some(action),
                "{key:?} with {modifiers:?}"
            );
        }
    }

    #[test]
    fn leaves_the_games_modified_chords_alone() {
        let hotkeys = Hotkeys::defaults();
        // Alt+M is SC:R's menu and Ctrl+M its music toggle; neither may reach our military panel.
        assert_eq!(hotkeys.action_for(Key::M, alt()), None);
        assert_eq!(hotkeys.action_for(Key::M, ctrl()), None);
        assert_eq!(hotkeys.action_for(Key::R, ctrl()), None);
        let both = Modifiers {
            ctrl: true,
            alt: true,
            ..Modifiers::NONE
        };
        assert_eq!(hotkeys.action_for(Key::E, both), None);
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
        assert_eq!(
            hotkeys.action_for(
                Key::G,
                Modifiers {
                    shift: true,
                    ..ctrl()
                }
            ),
            Some(Action::ToggleGraphs)
        );
    }

    #[test]
    fn the_menu_and_quit_keys_are_the_games() {
        assert!(is_menu_chord(Key::F10, plain()));
        assert!(is_menu_chord(Key::M, alt()));
        assert!(!is_menu_chord(Key::M, plain()));
        for key in [Key::Q, Key::X] {
            assert!(is_quit_chord(key, alt()));
            assert!(is_quit_chord(key, ctrl()));
            assert!(!is_quit_chord(key, plain()));
        }
    }

    #[test]
    fn an_unbound_key_is_nobodys() {
        let hotkeys = Hotkeys::defaults();
        for key in [Key::Tab, Key::Space, Key::ArrowLeft, Key::F5, Key::Escape] {
            assert_eq!(hotkeys.action_for(key, plain()), None);
        }
    }
}
