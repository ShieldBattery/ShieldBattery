//! The watcher's panel preferences: which ambient panels are on screen, which form the dock is in,
//! what the graphs plot, and whether a replay's outcome is kept quiet.

use egui::Modifiers;
use serde::{Deserialize, Serialize};

use super::hotkeys::{Action, Hotkeys};
use crate::observer::GraphSeries;

/// One ambient panel, as a hotkey names it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Panel {
    /// The matchup bar: who is playing, and what they are sitting on.
    Matchup,
    /// The map-control bar.
    MapControl,
    /// The economy panel.
    Economy,
    /// The military panel.
    Military,
    /// The graphs panel.
    Graphs,
    /// The timeline feed.
    Timeline,
    /// The production panel.
    Production,
    /// The control groups panel.
    ControlGroups,
    /// The selection panel, which stands in for the console's own.
    Selection,
    /// BW's own minimap.
    Minimap,
    /// The replay transport plate.
    Transport,
    /// The observer dock, from which every other panel here is reached without a key.
    Dock,
}

impl Panel {
    /// Every panel, in the order the dock lists them: the surfaces that report on the game, from
    /// the top of the screen down, then the game's own minimap, then the controls.
    pub const ALL: [Panel; 12] = [
        Panel::Matchup,
        Panel::MapControl,
        Panel::Economy,
        Panel::Military,
        Panel::Graphs,
        Panel::Timeline,
        Panel::Production,
        Panel::ControlGroups,
        Panel::Selection,
        Panel::Minimap,
        Panel::Transport,
        Panel::Dock,
    ];

    /// The key a panel's header names, which is the first one bound to its action.
    pub fn key_label(self) -> Option<String> {
        Hotkeys::defaults()
            .chord_for(self.action())
            .map(|chord| chord.key.symbol_or_name().to_string())
    }

    /// The action that toggles this panel, which is also where its keycap comes from.
    pub fn action(self) -> Action {
        match self {
            Panel::Matchup => Action::ToggleMatchup,
            Panel::MapControl => Action::ToggleMapControl,
            Panel::Economy => Action::ToggleEconomy,
            Panel::Military => Action::ToggleMilitary,
            Panel::Graphs => Action::ToggleGraphs,
            Panel::Timeline => Action::ToggleTimeline,
            Panel::Production => Action::ToggleProduction,
            Panel::ControlGroups => Action::ToggleControlGroups,
            Panel::Selection => Action::ToggleSelection,
            Panel::Minimap => Action::ToggleMinimap,
            Panel::Transport => Action::ToggleTransport,
            Panel::Dock => Action::ToggleDock,
        }
    }

    /// The panel `action` toggles, for the actions that toggle one.
    pub(super) fn for_action(action: Action) -> Option<Panel> {
        Panel::ALL
            .into_iter()
            .find(|panel| panel.action() == action)
    }

    pub fn label(self) -> &'static str {
        match self {
            Panel::Matchup => "matchup",
            Panel::MapControl => "map control",
            Panel::Economy => "economy",
            Panel::Military => "military",
            Panel::Graphs => "graphs",
            Panel::Timeline => "timeline",
            Panel::Production => "production",
            Panel::ControlGroups => "control groups",
            Panel::Selection => "selection",
            Panel::Minimap => "minimap",
            Panel::Transport => "transport",
            Panel::Dock => "dock",
        }
    }
}

/// What the player wants of the overlay: which ambient panels are on screen, and whether it keeps
/// a replay's outcome to itself.
///
/// Independent booleans rather than named sets of them: a watcher's screen is whatever mix of
/// surfaces they built up one key at a time. Serializable so a host can persist the set per
/// profile. A watcher never gets SC:R's own console back: the bottom panels stand where it was, and
/// the minimap they keep of it is a panel of its own.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct PanelPrefs {
    /// Where each titled window was placed, and whether it was folded away.
    pub windows: crate::observer::WindowLayouts,
    /// Keep the minimap header available while its native map is folded away.
    pub minimap_collapsed: bool,
    pub matchup: bool,
    pub map_control: bool,
    pub economy: bool,
    pub military: bool,
    pub graphs: bool,
    pub timeline: bool,
    pub production: bool,
    pub control_groups: bool,
    pub selection: bool,
    pub minimap: bool,
    pub transport: bool,
    /// Whether the observer dock is on screen.
    pub dock: bool,
    /// Whether the dock spells its rows out as the control rail. Not a panel of its own: it is one
    /// surface in two forms, and which of them a watcher left it in is worth remembering.
    pub dock_expanded: bool,
    /// Whether every surface withholds what gives a replay's outcome away — its length, and how far
    /// through it playback is. Not a panel, so hiding every panel does not quietly switch it off:
    /// a viewer who asked not to be told how long a game runs has not asked for a tidier screen.
    pub spoiler_free: bool,
    /// Which measurement the graphs panel is plotting. Not a panel either: it is what the one
    /// panel is currently about, and a watcher who left it on income expects income back.
    pub graph_series: GraphSeries,
    /// Whether the graphs panel plots a team game's players rather than the sides they are on.
    /// Sides by default: in a team game the question is which side is ahead, and four lines answer
    /// that only once the watcher has added them up themselves.
    pub graph_per_player: bool,
    /// The panels the all-panels key last hid, which it brings back next. Kept for the game rather
    /// than saved: a watcher who leaves with everything hidden comes back to a clear screen, and
    /// the key then brings back the panels everyone starts with.
    #[serde(skip)]
    pub hidden_by_all: Option<PanelSet>,
}

/// Some of the panels, as one bit per entry of [`Panel::ALL`].
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct PanelSet(u16);

impl PanelSet {
    fn bit(panel: Panel) -> u16 {
        let index = Panel::ALL
            .iter()
            .position(|&entry| entry == panel)
            .unwrap_or(0);
        1 << index
    }

    pub fn contains(self, panel: Panel) -> bool {
        self.0 & PanelSet::bit(panel) != 0
    }

    fn insert(&mut self, panel: Panel) {
        self.0 |= PanelSet::bit(panel);
    }

    fn is_empty(self) -> bool {
        self.0 == 0
    }
}

impl Default for PanelPrefs {
    fn default() -> PanelPrefs {
        // A first-time watcher starts on the least that still tells the game: who is playing and
        // how they stand, the map, what each player has grouped to fight with, and what the watcher
        // clicks on (the selection panel shows only while something is selected). The dock lists
        // every other panel with its key, and whatever the watcher turns on is remembered for their
        // next game.
        PanelPrefs {
            windows: crate::observer::WindowLayouts::default(),
            minimap_collapsed: false,
            matchup: true,
            map_control: false,
            economy: false,
            military: false,
            graphs: false,
            timeline: false,
            production: false,
            control_groups: true,
            selection: true,
            minimap: true,
            transport: true,
            dock: true,
            dock_expanded: false,
            spoiler_free: false,
            graph_series: GraphSeries::ArmyValue,
            graph_per_player: false,
            hidden_by_all: None,
        }
    }
}

impl PanelPrefs {
    pub fn shown(&self, panel: Panel) -> bool {
        match panel {
            Panel::Matchup => self.matchup,
            Panel::MapControl => self.map_control,
            Panel::Economy => self.economy,
            Panel::Military => self.military,
            Panel::Graphs => self.graphs,
            Panel::Timeline => self.timeline,
            Panel::Production => self.production,
            Panel::ControlGroups => self.control_groups,
            Panel::Selection => self.selection,
            Panel::Minimap => self.minimap,
            Panel::Transport => self.transport,
            Panel::Dock => self.dock,
        }
    }

    pub fn set(&mut self, panel: Panel, shown: bool) {
        match panel {
            Panel::Matchup => self.matchup = shown,
            Panel::MapControl => self.map_control = shown,
            Panel::Economy => self.economy = shown,
            Panel::Military => self.military = shown,
            Panel::Graphs => self.graphs = shown,
            Panel::Timeline => self.timeline = shown,
            Panel::Production => self.production = shown,
            Panel::ControlGroups => self.control_groups = shown,
            Panel::Selection => self.selection = shown,
            Panel::Minimap => self.minimap = shown,
            Panel::Transport => self.transport = shown,
            Panel::Dock => self.dock = shown,
        }
    }

    pub fn toggle(&mut self, panel: Panel) {
        self.set(panel, !self.shown(panel));
    }

    /// The panels on screen.
    pub fn shown_set(&self) -> PanelSet {
        let mut set = PanelSet::default();
        for panel in Panel::ALL {
            if self.shown(panel) {
                set.insert(panel);
            }
        }
        set
    }

    /// Carries out the all-panels key: a quick way to a clear screen and back.
    ///
    /// With anything on screen, it hides all of it and remembers what that was, whatever was turned
    /// on since the last time. With nothing on screen, it brings back what it last hid, or the
    /// panels everyone starts with if it hid nothing.
    pub fn toggle_all(&mut self) {
        let shown = self.shown_set();
        if shown.is_empty() {
            let restore = self
                .hidden_by_all
                .take()
                .unwrap_or_else(|| PanelPrefs::default().shown_set());
            for panel in Panel::ALL {
                self.set(panel, restore.contains(panel));
            }
        } else {
            for panel in Panel::ALL {
                self.set(panel, false);
            }
            self.hidden_by_all = Some(shown);
        }
    }

    /// Carries out the graphs key: on its own it toggles the panel like any other panel key, with
    /// `Shift` it steps the panel to the next measurement, and with `Ctrl` to the previous one.
    ///
    /// A step shows a hidden panel as well, because a measurement the watcher cannot see has not
    /// changed as far as they are concerned.
    pub(super) fn graphs_key(&mut self, modifiers: Modifiers) {
        if modifiers.ctrl {
            self.graph_series = self.graph_series.previous();
            self.graphs = true;
        } else if modifiers.shift {
            self.graph_series = self.graph_series.next();
            self.graphs = true;
        } else {
            self.toggle(Panel::Graphs);
        }
    }

    /// Carries out the dock key: on its own it takes the dock off screen and back, and with `Shift`
    /// it changes which of the dock's two forms it comes back in.
    ///
    /// A form the watcher cannot see has not changed as far as they are concerned, so the chord
    /// shows a hidden dock rather than answering with nothing.
    pub(super) fn dock_key(&mut self, modifiers: Modifiers) {
        if modifiers.shift {
            self.dock_expanded = !self.dock_expanded;
            self.dock = true;
        } else {
            self.toggle(Panel::Dock);
        }
    }
}

#[cfg(test)]
mod tests {
    use egui::{Key, Modifiers};

    use super::*;
    use crate::shell::test_support::*;
    use crate::shell::{HostFrame, Mode, Shell};

    #[test]
    fn panel_hotkeys_toggle_their_panel_while_spectating() {
        let mut shell = spectating_shell();
        type IsShown = fn(&PanelPrefs) -> bool;
        let panels: [(Key, IsShown); 5] = [
            (Key::W, |prefs| prefs.selection),
            (Key::Q, |prefs| prefs.minimap),
            (Key::E, |prefs| prefs.matchup),
            (Key::R, |prefs| prefs.dock),
            (Key::F, |prefs| prefs.production),
        ];
        for (key, is_shown) in panels {
            let was_shown = is_shown(shell.panel_prefs());
            assert!(shell.key_pressed(key, Modifiers::NONE));
            assert_ne!(
                is_shown(shell.panel_prefs()),
                was_shown,
                "{key:?} moved nothing"
            );
        }
    }

    #[test]
    fn all_panels_hides_whatever_is_shown_and_brings_back_just_that() {
        let mut shell = spectating_shell();
        shell.set_panel_prefs(PanelPrefs {
            economy: true,
            graphs: true,
            ..PanelPrefs::default()
        });
        let before = shell.panel_prefs().shown_set();
        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert_eq!(shell.panel_prefs().shown_set(), PanelSet::default());
        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert_eq!(shell.panel_prefs().shown_set(), before);

        // Whatever came on since the last press is what the next one hides, and all it brings
        // back: a panel shown on a clear screen becomes the set.
        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert!(shell.key_pressed(Key::T, Modifiers::NONE));
        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert!(shell.panel_prefs().timeline);
        assert!(!shell.panel_prefs().economy);
    }

    #[test]
    fn all_panels_on_a_clear_screen_with_nothing_hidden_brings_back_the_defaults() {
        let mut shell = spectating_shell();
        let mut cleared = PanelPrefs::default();
        for panel in Panel::ALL {
            cleared.set(panel, false);
        }
        shell.set_panel_prefs(cleared);
        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert_eq!(
            shell.panel_prefs().shown_set(),
            PanelPrefs::default().shown_set()
        );
    }

    #[test]
    fn the_graphs_key_toggles_the_panel_and_keeps_its_measurement() {
        let mut shell = spectating_shell();
        shell.set_panel_prefs(PanelPrefs {
            graphs: false,
            graph_series: GraphSeries::Supply,
            ..PanelPrefs::default()
        });

        assert!(shell.key_pressed(Key::G, Modifiers::NONE));
        assert!(shell.panel_prefs().graphs);
        assert!(shell.key_pressed(Key::G, Modifiers::NONE));
        assert!(!shell.panel_prefs().graphs);
        assert_eq!(shell.panel_prefs().graph_series, GraphSeries::Supply);
    }

    #[test]
    fn the_graphs_chords_step_the_measurement_both_ways() {
        let mut shell = spectating_shell();
        let shift = Modifiers {
            shift: true,
            ..Modifiers::NONE
        };
        let ctrl = Modifiers {
            ctrl: true,
            command: true,
            ..Modifiers::NONE
        };
        shell.set_panel_prefs(PanelPrefs {
            graphs: false,
            graph_series: GraphSeries::Income,
            ..PanelPrefs::default()
        });

        // A step from a hidden panel shows it on the measurement it stepped to.
        assert!(shell.key_pressed(Key::G, shift));
        assert!(shell.panel_prefs().graphs);
        assert_eq!(shell.panel_prefs().graph_series, GraphSeries::Income.next());

        assert!(shell.key_pressed(Key::G, ctrl));
        assert!(shell.key_pressed(Key::G, ctrl));
        assert!(shell.panel_prefs().graphs);
        assert_eq!(
            shell.panel_prefs().graph_series,
            GraphSeries::Income.previous()
        );
    }

    #[test]
    fn the_stats_wings_answer_their_own_keys() {
        let mut shell = spectating_shell();
        type IsShown = fn(&PanelPrefs) -> bool;
        let wings: [(Key, IsShown); 3] = [
            (Key::I, |prefs| prefs.economy),
            (Key::M, |prefs| prefs.military),
            (Key::T, |prefs| prefs.timeline),
        ];
        for (key, is_shown) in wings {
            let was_shown = is_shown(shell.panel_prefs());
            assert!(shell.key_pressed(key, Modifiers::NONE));
            assert_ne!(
                is_shown(shell.panel_prefs()),
                was_shown,
                "{key:?} moved nothing"
            );
        }
    }

    #[test]
    fn the_centred_bottom_panels_answer_their_own_keys() {
        let mut shell = spectating_shell();
        type IsShown = fn(&PanelPrefs) -> bool;
        let stack: [(Key, IsShown); 3] = [
            (Key::F, |prefs| prefs.production),
            (Key::H, |prefs| prefs.control_groups),
            (Key::W, |prefs| prefs.selection),
        ];
        for (key, is_shown) in stack {
            let was_shown = is_shown(shell.panel_prefs());
            assert!(shell.key_pressed(key, Modifiers::NONE));
            assert_ne!(
                is_shown(shell.panel_prefs()),
                was_shown,
                "{key:?} moved nothing"
            );
        }
    }

    #[test]
    fn every_panel_is_reached_by_the_action_that_names_it() {
        for panel in Panel::ALL {
            assert_eq!(
                Panel::for_action(panel.action()),
                Some(panel),
                "{panel:?} and its action disagree"
            );
        }
    }

    #[test]
    fn the_dock_key_moves_the_dock_and_nothing_else() {
        let mut shell = spectating_shell();
        assert!(shell.key_pressed(Key::Backtick, Modifiers::NONE));
        assert!(!shell.panel_prefs().dock);
        assert!(shell.panel_prefs().matchup);
        assert!(shell.key_pressed(Key::Backtick, Modifiers::NONE));
        assert!(shell.panel_prefs().dock);
    }

    #[test]
    fn the_dock_chord_changes_its_form_and_brings_it_back_to_be_seen() {
        let mut shell = spectating_shell();
        let shift = Modifiers {
            shift: true,
            ..Modifiers::NONE
        };
        assert!(!shell.panel_prefs().dock_expanded);
        assert!(shell.key_pressed(Key::Backtick, shift));
        assert!(shell.panel_prefs().dock_expanded);
        assert!(shell.panel_prefs().dock);

        // Changing the form of a dock nobody can see would read as a key that did nothing, so it
        // comes back on screen with the change.
        shell.set_panel_prefs(PanelPrefs {
            dock: false,
            dock_expanded: true,
            ..PanelPrefs::default()
        });
        assert!(shell.key_pressed(Key::Backtick, shift));
        assert!(!shell.panel_prefs().dock_expanded);
        assert!(shell.panel_prefs().dock);
    }

    #[test]
    fn spoiler_free_belongs_to_replays_and_survives_hiding_every_panel() {
        let mut shell = spectating_shell();
        assert!(shell.key_pressed(Key::L, Modifiers::NONE));
        assert!(shell.panel_prefs().spoiler_free);
        // Hiding every panel is a request for a clear screen, not for the outcome to be given away.
        let mut every_panel = *shell.panel_prefs();
        for panel in Panel::ALL {
            every_panel.set(panel, true);
        }
        shell.set_panel_prefs(every_panel);
        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert!(shell.panel_prefs().spoiler_free);
        assert!(!shell.panel_prefs().transport);

        let mut observing = Shell::new();
        observing.set_host(&HostFrame {
            mode: Mode::Observing,
            game_started: true,
            native_textbox_open: false,
            native_dialog_open: false,
            native_menu_open: false,
            game_seconds: 0,
            pause_control: None,
            minimap_rect: None,
        });
        assert!(!observing.key_pressed(Key::L, Modifiers::NONE));
        assert!(!observing.panel_prefs().spoiler_free);
    }
}
