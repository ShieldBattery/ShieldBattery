//! The shell: which surfaces are up, which of them owns the screen, what the frame does with the
//! player's input, and what it wants the host to do to the game underneath.
//!
//! Both hosts drive this same state machine once per frame — the injected game DLL, which
//! translates Win32 messages into it and turns its intents into BW calls, and the preview, which
//! stands in for both sides. Every policy decision lives here rather than in either host: which key
//! does what, which clicks reach the game, when a native dialog is replaced and how its replacement
//! is dismissed. That keeps the two hosts from drifting and makes the rules testable without a game
//! or a window.
//!
//! A frame has three layers, drawn in this order so each covers the one before it:
//!
//! 1. **Ambient** (tier 0/1) — panels that sit over live gameplay. The observer panel set belongs to
//!    [`Mode::Observing`] and [`Mode::Replay`]; the diagnostic network-stats panel is deliberately
//!    available in every mode, since nothing puts it on screen but an explicit chat command.
//! 2. **Hero** (tier 1) — the surfaces that carry the match's identity.
//! 3. **Modal** (tier 2) — a stack, of which only the top is drawn. It dims everything behind it and
//!    takes the keyboard and the pointer.

pub mod hotkeys;
pub mod native_dialogs;

use egui::{Context, Key, Modifiers, Rect};
use serde::{Deserialize, Serialize};

use crate::chat_history::{ChatHistoryView, render_chat_history_view};
use crate::disconnect::{DisconnectView, SelfState, render_disconnect_view};
use crate::end_card::{self, EndCardChoice, EndCardView, GameResult, render_end_card};
pub use crate::game_menu::SocialDialog;
use crate::game_menu::{leave_is_held, render_game_menu, render_leave_confirm};
use crate::net_quality::{NetQualityView, render_net_quality};
use crate::netstat::{NetStatsView, render_netstat_view};
use crate::observer::{self, GraphSeries, ObserverView, SelectedUnitClick};
use crate::options::{
    OptionsLists, OptionsOutcome, OptionsSection, OptionsView, SettingChange, render_options_view,
};
use crate::transport::{self, SpeedStep, TransportView, render_transport_view};

pub use hotkeys::{Action, Chord, Hotkeys};
pub use native_dialogs::{NativeDialog, replacement_for};

/// The shortest time between two seeks reaching the game.
///
/// A dragged playhead asks for a new frame every frame it moves, and every backward one of those
/// restarts the simulation from frame zero. Coalescing to the latest target keeps a drag to a few
/// restarts instead of dozens, and costs nothing: the intermediate frames were never going to be
/// watched.
const SEEK_INTERVAL_SECS: f64 = 0.25;

/// Which vantage point the local client watches the game from.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum Mode {
    /// A participant playing their own game. The overlay replaces dialogs here and nothing else:
    /// every key and click that isn't a modal's belongs to the game.
    #[default]
    Playing,
    /// Watching a live game from an observer slot.
    Observing,
    /// Watching a replay.
    Replay,
}

impl Mode {
    /// Whether the observer panel set and its hotkeys belong on screen.
    pub fn is_spectating(self) -> bool {
        matches!(self, Mode::Observing | Mode::Replay)
    }

    /// A short name for this mode in a knob panel or a log line.
    pub fn label(self) -> &'static str {
        match self {
            Mode::Playing => "playing",
            Mode::Observing => "observing",
            Mode::Replay => "replay",
        }
    }
}

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
        // how they stand, the map, and what they click on (the selection panel shows only while
        // something is selected). The dock lists every other panel with its key, and whatever the
        // watcher turns on is remembered for their next game.
        PanelPrefs {
            matchup: true,
            map_control: false,
            economy: false,
            military: false,
            graphs: false,
            timeline: false,
            production: false,
            control_groups: false,
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
}

/// Which modal surface is on the stack.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModalId {
    /// The simulation is blocked on at least one peer, with a manual drop once the gate passes.
    WaitingForPlayers,
    /// This client's own link to the relay is down.
    ConnectionInterrupted,
    /// This client's session is over for good: disconnected beyond recovery, or desynced.
    SessionEnded,
    /// The in-game menu, standing in for SC:R's own.
    GameMenu,
    /// The chat log, standing in for SC:R's own.
    ChatHistory,
    /// The settings screen, standing in for SC:R's own options popup.
    Options,
    /// The end-of-game card for a player who has won, standing in for SC:R's victory popup.
    Victory,
    /// The end-of-game card for a player who has lost, standing in for SC:R's defeat popup.
    Defeat,
    /// The question SC:R's quit keys ask, standing in for its quit dialogs.
    LeaveGame,
}

impl ModalId {
    /// Whether the player can close this modal themselves, with `Esc` or a click on the scrim.
    ///
    /// A modal the game's own state raises is not dismissible: it is up exactly while its condition
    /// holds, and closing it would only make it reappear on the next frame.
    pub fn is_dismissible(self) -> bool {
        match self {
            ModalId::WaitingForPlayers | ModalId::ConnectionInterrupted | ModalId::SessionEnded => {
                false
            }
            // A defeated player can only leave: SC:R's defeat popup stays up until its OK.
            ModalId::Defeat => false,
            // Dismissing the victory card is choosing to keep playing, which the card's own native
            // dialog carries out when the dismissal closes it.
            ModalId::GameMenu
            | ModalId::ChatHistory
            | ModalId::Options
            | ModalId::Victory
            | ModalId::LeaveGame => true,
        }
    }

    /// Whether this modal's buttons answer to keys (see [`Shell::key_pressed`]), which is when a host
    /// hands the shell every keypress first: the keys type nothing here, and a control holding the
    /// keyboard would otherwise take a key that is meant for one of the buttons.
    pub fn buttons_answer_to_keys(self) -> bool {
        match self {
            // A roster's drop controls are one per player, so no one key could stand for them.
            ModalId::WaitingForPlayers => false,
            ModalId::ConnectionInterrupted
            | ModalId::SessionEnded
            | ModalId::GameMenu
            | ModalId::ChatHistory
            | ModalId::Options
            | ModalId::Victory
            | ModalId::Defeat
            | ModalId::LeaveGame => true,
        }
    }

    /// Whether this modal is raised and lowered by the game's own state rather than by the player.
    fn is_status_driven(self) -> bool {
        matches!(
            self,
            ModalId::WaitingForPlayers | ModalId::ConnectionInterrupted | ModalId::SessionEnded
        )
    }

    /// The native dialog this modal stands in for, which the host must dismiss along with it.
    pub fn native_dialog(self) -> Option<NativeDialog> {
        match self {
            // Nothing of the game's stands behind the options screen: SC:R's own options are a
            // web popup its menu opens, and the menu that would have opened it is ours already.
            //
            // SC:R's quit dialogs are never spawned behind the leave question: the keys that open
            // them are taken before the game sees them.
            ModalId::WaitingForPlayers
            | ModalId::ConnectionInterrupted
            | ModalId::SessionEnded
            | ModalId::Options
            | ModalId::LeaveGame => None,
            ModalId::GameMenu => Some(NativeDialog::GameMenu),
            ModalId::ChatHistory => Some(NativeDialog::ChatHistory),
            ModalId::Victory => Some(NativeDialog::Victory),
            ModalId::Defeat => Some(NativeDialog::Defeat),
        }
    }

    /// The result an end-of-game card reports, for the modals that are one.
    pub fn game_result(self) -> Option<GameResult> {
        match self {
            ModalId::Victory => Some(GameResult::Victory),
            ModalId::Defeat => Some(GameResult::Defeat),
            _ => None,
        }
    }

    /// A short name for this modal in a knob panel or a log line.
    pub fn label(self) -> &'static str {
        match self {
            ModalId::WaitingForPlayers => "waiting for players",
            ModalId::ConnectionInterrupted => "connection interrupted",
            ModalId::SessionEnded => "session ended",
            ModalId::GameMenu => "game menu",
            ModalId::ChatHistory => "chat history",
            ModalId::Options => "options",
            ModalId::Victory => "victory",
            ModalId::Defeat => "defeat",
            ModalId::LeaveGame => "leave game",
        }
    }
}

impl NativeDialog {
    /// The modal this dialog's replacement puts on the stack when the dialog spawns.
    ///
    /// `TimeOut` has none: the surface that stands in for it is the disconnect modal, which the
    /// disconnect status raises and lowers on its own schedule. BW spawns its timeout dialog on a
    /// timer of its own, so tying our surface to that spawn would show and hide it at the wrong
    /// moments.
    pub fn replacement_modal(self) -> Option<ModalId> {
        match self {
            NativeDialog::TimeOut => None,
            NativeDialog::ChatHistory => Some(ModalId::ChatHistory),
            NativeDialog::GameMenu => Some(ModalId::GameMenu),
            NativeDialog::Victory => Some(ModalId::Victory),
            NativeDialog::Defeat => Some(ModalId::Defeat),
        }
    }
}

/// What a frame wants the host to do to the game.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Intent {
    /// Dismiss a replaced native dialog through its own return control
    /// ([`NativeDialog::return_control_id`]), because the surface standing in
    /// for it has been closed.
    CloseNativeDialog(NativeDialog),
    /// Request that the player in this rally-point2 slot be dropped from the session.
    DropPlayer { slot: u8 },
    /// Leave a game whose session is already over, by ending the game loop. There is nobody left to
    /// tell and no result left to decide.
    LeaveGame,
    /// Quit a running game through SC:R's own quit path, which tells the other players this one has
    /// left and settles the result the way its menu does.
    QuitGame,
    /// End a game whose result is in, through the End Mission control of the victory or defeat
    /// dialog standing behind the card ([`NativeDialog::end_mission_control_id`]).
    EndMission(NativeDialog),
    /// Leave the game menu for one of SC:R's alliances and messaging dialogs. Nothing of ours
    /// replaces them.
    OpenSocialDialog(SocialDialog),
    /// Give up on a connection that will not come back and leave the game.
    AbandonGame,
    /// Put one setting on the value the player moved it to, in the game and wherever the host
    /// persists it.
    ChangeSetting(SettingChange),
    /// Open the game's own menu, the way its own key for the menu does, so the overlay's
    /// replacement for it comes up exactly as it would from the keyboard.
    OpenGameMenu,
    /// Show or stop showing the game through this player's eyes. What that means for their allies
    /// is the host's to decide: vision is shared, and taking half of a shared pair would leave a
    /// watcher looking at a map neither player sees.
    ToggleVision { player_id: u8 },
    /// Select whatever is making this entry of a player's production row, and on a repeated ask,
    /// move on to the next one of them.
    SelectProduction { player_id: u8, item: u32 },
    /// Select the units on one of a player's number keys, as the player would by pressing it.
    SelectControlGroup { player_id: u8, key: u8 },
    /// Select the unit at this place in the selection alone, or look at it where it already is.
    PickSelectedUnit(usize),
    /// Have the game's view follow the unit at this place in the selection.
    FollowSelectedUnit(usize),
    /// Move replay playback to this frame.
    Seek(u32),
    /// Center the game's view on this place once the seek asked for just before this lands. Sent
    /// only right behind a `Seek`, for a jump to something that happened somewhere in particular.
    LookAt(observer::MapPoint),
    /// Set how replay playback runs: where on the classic speed ladder, scaled by what, and whether
    /// it runs at all. One intent rather than three, because the game carries all three in one
    /// command and sending a partial one would reset the other two.
    SetSpeed {
        speed_index: u32,
        multiplier: u32,
        paused: bool,
    },
}

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
    /// Every key is the overlay's, bar the carve-out in [`InputCapture::blocks_game_key`].
    All,
}

/// What the game is allowed to see of this frame's input.
///
/// Typed characters are deliberately not part of this. The capture is about input aimed at the game
/// — unit commands and hotkeys, which arrive as virtual keys — while SC:R opens and submits its chat
/// box from the Enter *character*. Swallowing characters while the box is closed would swallow the
/// very keystroke that opens it, so the box could never be reported open again and every following
/// character would stay swallowed too.
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
    /// A capturing modal takes everything, with two exceptions. BW's chat entry box: while it is
    /// open the player is typing, and every key belongs to that box — backspace, the arrow keys and
    /// Escape to close it included — so the keyboard passes straight through however modal the
    /// screen is. And BW's own game menu: while the player has it open, every key and click is its,
    /// so a player stuck behind a modal can always reach Quit rather than the task manager.
    pub fn resolve(
        modal_captures: bool,
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
            keyboard: if captures && !native_textbox_open {
                KeyboardCapture::All
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
    /// Two keys are let through even under a full capture. Return: SC:R opens its chat box from the
    /// Enter character rather than from this virtual key, so the keypress carries no unit command
    /// and swallowing it would only cost the player their way into the chat box. F10: it opens BW's
    /// game menu, which then lifts the capture (see [`resolve`](Self::resolve)), so the player can
    /// always leave a stuck game.
    ///
    /// Escape stays blocked: it carries no unit command, but BW's top dialog during a stall is the
    /// hidden `TimeOut`, and Escape's effect on that is not worth finding out. Alt combinations (BW's
    /// menu accelerators) stay blocked too: BW ignores them under that dialog anyway, and a lone Alt
    /// reaching the window can leave it in Windows' menu-key mode, eating every key after it.
    pub fn blocks_game_key(self, key: Option<Key>) -> bool {
        match self.keyboard {
            KeyboardCapture::Selective => false,
            KeyboardCapture::All => !matches!(key, Some(Key::Enter | Key::F10)),
        }
    }
}

/// What the host knows about the game this frame.
#[derive(Copy, Clone, PartialEq, Debug, Default)]
pub struct HostFrame {
    pub mode: Mode,
    /// Whether the game proper is running, as opposed to still loading.
    pub game_started: bool,
    /// Whether BW's own chat entry box is open for text input.
    pub native_textbox_open: bool,
    /// Whether one of BW's own dialogs — a menu, a popup — is on top of the game. While one is, the
    /// keyboard is its, so the shell claims no hotkeys.
    pub native_dialog_open: bool,
    /// Whether a BW dialog the player operates (the game menu, its sub-menus, the quit
    /// confirmation, options) is on top of the game. Narrower than
    /// [`native_dialog_open`](Self::native_dialog_open): the hidden `TimeOut` dialog BW spawns
    /// during a stall tops the stack too, but nobody operates it. While a menu is open, every input
    /// is the menu's, however modal the screen is.
    pub native_menu_open: bool,
    /// How far into the game the simulation has got, in whole seconds. Read by the surfaces that
    /// report on the game as a whole rather than on one player, which is the menu and nothing else
    /// while a client is playing its own game.
    pub game_seconds: u64,
    /// Where BW's minimap is on screen, in the overlay's points, for a host that can say. The frame
    /// a watcher gets around the minimap is drawn from this, and `None` draws no frame; the panels
    /// placed around the minimap keep clear of the corner the design reserves for it either way.
    pub minimap_rect: Option<Rect>,
}

/// The disconnect surface the host wants drawn.
pub struct DisconnectSurface<'a> {
    pub view: &'a DisconnectView,
    /// Whether the simulation is paused on a condition the surface reports — our own link down, a
    /// relay-confirmed peer drop, or a sustained stall — and the surface therefore takes every
    /// input. Unit commands issued into a frozen simulation would all land in the same turn and
    /// burst out together when turns resume.
    pub blocks_input: bool,
}

/// The screens the host wants the shell to draw this frame, each built from data only the host has.
#[derive(Default)]
pub struct Views<'a> {
    pub disconnect: Option<DisconnectSurface<'a>>,
    /// The network quality chip, in a game that rolls back.
    pub net_quality: Option<&'a NetQualityView>,
    pub net_stats: Option<&'a NetStatsView>,
    /// The chat log, which a host only builds while [`ModalId::ChatHistory`] is on the stack — it
    /// is a copy of every line said this game, and nothing but that modal reads it.
    pub chat_history: Option<&'a ChatHistoryView>,
    /// What the end-of-game card reports, which a host builds once as the card comes up rather than
    /// every frame: the card is about the game as it was decided, and the numbers under it keep
    /// moving for as long as the player keeps playing.
    pub end_card: Option<&'a EndCardView>,
    /// Replay playback, which a host builds for every frame of a replay whether or not the plate is
    /// on screen: the transport keys keep working with it hidden, and only the shell knows whether
    /// the player has hidden it.
    pub transport: Option<&'a TransportView>,
    /// The observer panels, which a host builds for every frame it is watching a game rather than
    /// playing one — again whether or not any of them is on screen, since the keys that show them
    /// arrive between frames.
    pub observer: Option<&'a ObserverView>,
    /// What the game's settings currently are. A host hands these over whenever they change under
    /// it — at startup, and after anything but the options screen itself has moved one — and the
    /// shell keeps showing what it was last told until it is told something else.
    pub options: Option<&'a OptionsView>,
    /// The lists on the options screen that are read off the machine rather than out of a setting.
    /// A host that hands over none of them leaves those rows dimmed and empty, which is what they
    /// honestly are.
    pub option_lists: Option<&'a OptionsLists>,
}

/// One screen rect the overlay owns this frame.
#[derive(Copy, Clone, PartialEq, Debug)]
pub struct HitRect {
    pub rect: Rect,
    /// Whether this rect wants the mouse wheel as well as the pointer.
    ///
    /// Asked for per rect rather than taken with the pointer, because the wheel is the game's by
    /// default — SC:R zooms the map with it — and only a surface that actually scrolls has anything
    /// to do with it. A scrolling list whose host keeps the wheel can be moved only by dragging its
    /// scrollbar.
    pub captures_scroll: bool,
}

impl HitRect {
    /// A rect that takes the pointer and leaves the wheel to the game.
    pub fn new(rect: Rect) -> HitRect {
        HitRect {
            rect,
            captures_scroll: false,
        }
    }

    /// A rect that takes the wheel too, because something inside it scrolls.
    pub fn scrolling(rect: Rect) -> HitRect {
        HitRect {
            rect,
            captures_scroll: true,
        }
    }
}

/// What a frame produced.
#[derive(Default)]
pub struct FrameOutput {
    /// What the shell wants done to the game, in the order it asked.
    pub intents: Vec<Intent>,
    /// The screen rects the overlay owns this frame. A click outside all of them is the game's,
    /// unless the capture says otherwise.
    pub hit_rects: Vec<HitRect>,
    pub capture: InputCapture,
    /// Whether the overlay's replay transport is on screen, which is exactly when the game's own
    /// replay plate must not be. Stays true through the plate's exit, so the two never overlap.
    pub transport_shown: bool,
}

/// One entry on the modal stack.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct Modal {
    id: ModalId,
    /// Whether this modal takes every input while it is up. Carried per entry rather than derived
    /// from the id, because the disconnect surface is modal at both of its tiers but only takes
    /// input once the connection problem is real.
    captures_input: bool,
}

/// The overlay's per-frame state machine. See the module docs.
pub struct Shell {
    prefs: PanelPrefs,
    hotkeys: Hotkeys,
    modals: Vec<Modal>,
    /// Which replaced native dialogs the host has reported as live, indexed by
    /// [`NativeDialog::index`]. A dismissal only asks the host to close a dialog that is still
    /// there.
    live_native_dialogs: [bool; NativeDialog::ALL.len()],
    /// The game state the last frame reported, which is what keypresses arriving between frames are
    /// decided against.
    host: HostFrame,
    /// Replay playback as of the last frame. Keypresses arrive between frames and a transport key
    /// is relative — one rung up, ten seconds back — so the state it is relative to has to be here
    /// rather than in the frame that drew it.
    transport: Option<TransportView>,
    /// Whether the last observer frame carried a map-control measurement. The bar's key is only the
    /// shell's while there is something behind it, and a keypress arrives between frames, so what
    /// the last frame was told has to be kept here.
    map_control_available: bool,
    /// The player whose control groups are shown: the owner of the last unit the watcher selected.
    /// Kept across frames because it outlives the selection that set it.
    focused_player: Option<u8>,
    /// Whether the list of players under the minimap's vision button is open.
    vision_picker_open: bool,
    /// The player whose number keys a digit recalls, and which of their keys have a group on them
    /// (one bit per digit), as the control groups row last showed them.
    number_keys: Option<(u8, u16)>,
    /// The key holding a hold-to-confirm button, and the modal the button is on, from a press made
    /// while that modal was on top until the key comes up (see [`Shell::update_held_keys`]).
    held_button_key: Option<(ModalId, Key)>,
    /// What a key pressed since the last frame chose on an end-of-game card. Carried to the card
    /// rather than acted on here, because the card only takes a choice once it has landed.
    end_card_key: Option<EndCardChoice>,
    /// Where each bottom panel was last placed while it was wanted on screen, which is where it
    /// fades out from: a panel leaving because the plate beside it left too would otherwise jump
    /// across the screen on its way out.
    held_slots: HeldSlots,
    /// Which of the stacked panels were drawn last frame, which is whether they ease toward a new
    /// place in their stack or simply take it.
    drawn: DrawnLastFrame,
    /// The minimap's square as the host last reported it, which the panels beside it keep clear of
    /// while it is hidden and the host has no square to report.
    last_minimap_rect: Option<Rect>,
    /// Where the replay plate stands this frame, which the observer panels decide: they share the
    /// bottom of the screen with it.
    transport_placement: transport::TransportPlacement,
    /// The frame a seek has been asked for and not yet sent, which is the latest one asked for: a
    /// drag across the track is one seek to where the pointer ended up, not one per frame of it.
    pending_seek: Option<(u32, Option<observer::MapPoint>)>,
    /// When the last seek went out, on the context's own clock.
    last_seek_secs: f64,
    /// What the settings screen shows. The shell's own copy rather than the host's, because a
    /// player who moves a control must see it move on the frame they moved it, well before the
    /// host has applied anything.
    options: OptionsView,
    /// The last values a host handed over, so a host that keeps feeding the same view does not
    /// take back a change the player has just made.
    host_options: Option<OptionsView>,
    /// Which page of the settings screen is on. Not persisted: it is where the player was looking
    /// a moment ago, which is worth nothing once the game is over.
    options_section: OptionsSection,
    intents: Vec<Intent>,
}

impl Default for Shell {
    fn default() -> Shell {
        Shell::new()
    }
}

impl Shell {
    pub fn new() -> Shell {
        Shell {
            prefs: PanelPrefs::default(),
            hotkeys: Hotkeys::defaults(),
            modals: Vec::new(),
            live_native_dialogs: [false; NativeDialog::ALL.len()],
            host: HostFrame::default(),
            transport: None,
            map_control_available: false,
            focused_player: None,
            vision_picker_open: false,
            number_keys: None,
            held_button_key: None,
            end_card_key: None,
            held_slots: HeldSlots::default(),
            drawn: DrawnLastFrame::default(),
            last_minimap_rect: None,
            transport_placement: transport::TransportPlacement::default(),
            pending_seek: None,
            last_seek_secs: f64::NEG_INFINITY,
            options: OptionsView::default(),
            host_options: None,
            options_section: OptionsSection::default(),
            intents: Vec::new(),
        }
    }

    pub fn panel_prefs(&self) -> &PanelPrefs {
        &self.prefs
    }

    pub fn set_panel_prefs(&mut self, prefs: PanelPrefs) {
        self.prefs = prefs;
    }

    /// Whether the list of players under the minimap's vision button is open.
    pub fn vision_picker_open(&self) -> bool {
        self.vision_picker_open
    }

    /// Opens or closes the list of players under the minimap's vision button, for a host restoring
    /// what a watcher had open.
    pub fn set_vision_picker_open(&mut self, open: bool) {
        self.vision_picker_open = open;
    }

    pub fn hotkeys(&self) -> &Hotkeys {
        &self.hotkeys
    }

    /// The settings the options screen is showing.
    pub fn options(&self) -> &OptionsView {
        &self.options
    }

    /// Which page of the options screen is on.
    pub fn options_section(&self) -> OptionsSection {
        self.options_section
    }

    /// Opens the options screen on `section`, for a host restoring where a player was.
    pub fn set_options_section(&mut self, section: OptionsSection) {
        self.options_section = section;
    }

    /// The modal stack, bottom first.
    pub fn open_modals(&self) -> impl Iterator<Item = ModalId> + '_ {
        self.modals.iter().map(|modal| modal.id)
    }

    /// The modal that owns the screen, if any.
    pub fn top_modal(&self) -> Option<ModalId> {
        self.modals.last().map(|modal| modal.id)
    }

    /// Whether the host has reported this native dialog as spawned and replaced.
    pub fn native_dialog_live(&self, dialog: NativeDialog) -> bool {
        self.live_native_dialogs[dialog.index()]
    }

    /// What the next frame will hand the host.
    pub fn pending_intents(&self) -> &[Intent] {
        &self.intents
    }

    /// What the game is allowed to see of the input arriving right now.
    pub fn capture(&self) -> InputCapture {
        InputCapture::resolve(
            self.modal_captures(),
            self.host.native_textbox_open,
            self.host.native_menu_open,
        )
    }

    /// Updates the game state keypresses are decided against. [`Shell::frame`] does this itself; a
    /// host only calls it directly when it learns something between frames.
    pub fn set_host(&mut self, host: &HostFrame) {
        self.host = *host;
    }

    /// Records that the host hid a spawning native dialog and put our surface in its place.
    pub fn native_dialog_spawned(&mut self, dialog: NativeDialog) {
        self.live_native_dialogs[dialog.index()] = true;
        if let Some(id) = dialog.replacement_modal()
            && !self.modals.iter().any(|modal| modal.id == id)
        {
            self.modals.push(Modal {
                id,
                captures_input: true,
            });
        }
    }

    /// Raises a dismissible modal the player asked for directly, rather than through the native
    /// dialog it stands in for.
    ///
    /// The dismissal path is the same either way: a modal raised here has no live native dialog
    /// behind it, so closing it asks the host for nothing. A modal the game's own state owns
    /// ([`ModalId::is_dismissible`] is false for those) cannot be raised this way, since the next
    /// frame's status sync would only take it straight back down.
    pub fn open_modal(&mut self, id: ModalId) {
        if !id.is_dismissible() || self.modals.iter().any(|modal| modal.id == id) {
            return;
        }
        self.modals.push(Modal {
            id,
            captures_input: true,
        });
    }

    /// Closes a dismissible modal from outside the modal itself, for a host acting on something
    /// the player did elsewhere.
    ///
    /// A modal the game's own state owns cannot be closed this way, for the same reason it cannot
    /// be opened that way: the next frame's status sync would put it straight back.
    pub fn close_modal(&mut self, id: ModalId) {
        if !id.is_dismissible() {
            return;
        }
        let Some(index) = self.modals.iter().position(|modal| modal.id == id) else {
            return;
        };
        self.modals.remove(index);
        if let Some(dialog) = id.native_dialog()
            && self.live_native_dialogs[dialog.index()]
        {
            self.intents.push(Intent::CloseNativeDialog(dialog));
        }
    }

    /// Records that a replaced native dialog is gone, so its replacement goes with it. Asks for no
    /// dismissal of its own: the dialog this would have closed has already closed.
    pub fn native_dialog_closed(&mut self, dialog: NativeDialog) {
        self.live_native_dialogs[dialog.index()] = false;
        if let Some(id) = dialog.replacement_modal() {
            self.modals.retain(|modal| modal.id != id);
        }
    }

    /// Offers a keypress to the shell before the game sees it, returning whether the shell acted on
    /// it.
    ///
    /// Only a keypress the shell can actually carry out is consumed. A binding whose surface has not
    /// been built yet leaves the key to the game rather than swallowing it into a no-op.
    pub fn key_pressed(&mut self, key: Key, modifiers: Modifiers) -> bool {
        // The keys that open the game's menu close ours, as a toggle: the menu is something the
        // player reaches for and puts away with the same hand.
        if hotkeys::is_menu_chord(key, modifiers) && self.top_modal() == Some(ModalId::GameMenu) {
            self.dismiss_top_modal();
            return true;
        }
        // A dialog's buttons answer to SC:R's keys for the buttons they stand in for, which their
        // keycaps name (see each dialog's key constants), and the leave question to both of the
        // keys SC:R's own quit questions leave on: Alt+Q then Q, and F10 then E then Q, leave the
        // way they always have.
        if modifiers.is_none() && self.dialog_key_pressed(key) {
            return true;
        }
        if hotkeys::is_quit_chord(key, modifiers) && self.quit_keys_active() {
            self.open_modal(ModalId::LeaveGame);
            return true;
        }
        if key == Key::Escape {
            if self.top_modal().is_some_and(ModalId::is_dismissible) {
                self.dismiss_top_modal();
                return true;
            }
            // A modal of the game's own state takes the screen ahead of the list under it, so the
            // list only answers the key while no modal is up.
            if self.vision_picker_open && self.top_modal().is_none() {
                self.vision_picker_open = false;
                return true;
            }
            return false;
        }
        if !self.hotkeys_active() {
            return false;
        }
        if let Some(digit) = number_key_digit(key)
            && modifiers.is_none()
        {
            return self.recall_control_group(digit);
        }
        match self.hotkeys.action_for(key, modifiers) {
            Some(action) => self.apply_action(action, modifiers),
            None => false,
        }
    }

    /// Draws the frame and reports what it wants of the host.
    pub fn frame(&mut self, ctx: &Context, host: &HostFrame, views: &mut Views<'_>) -> FrameOutput {
        self.set_host(host);
        self.sync_status_modals(views.disconnect.as_ref());

        self.transport = views.transport.copied();
        // Adopted only when the host's own copy moves: one that kept handing over the same values
        // every frame would otherwise undo the control the player is holding.
        if let Some(options) = views.options.copied()
            && self.host_options != Some(options)
        {
            self.options = options;
            self.host_options = Some(options);
        }

        let mut hit_rects = Vec::new();
        // The ambient layer is drawn before the modal layer so the scrim covers it. The diagnostic
        // network-stats panel is not gated on the mode: nothing puts it on screen but the chat
        // command that asks for it, and a player triaging lag needs it while they are playing.
        if let Some(net_quality) = views.net_quality {
            render_net_quality(net_quality, ctx);
        }
        if let Some(net_stats) = views.net_stats {
            render_netstat_view(net_stats, ctx);
        }
        // The plate keeps its corner unless the observer panels, which share the bottom of the
        // screen with it, move it this frame.
        self.transport_placement = transport::TransportPlacement::default();
        // The observer panels belong to the modes they report on: a host that kept feeding them
        // after the client stopped watching must not be able to put them over someone's own game.
        if self.host.mode.is_spectating()
            && let Some(view) = views.observer
        {
            self.frame_observer(ctx, view, views.transport.is_some(), &mut hit_rects);
        }
        let transport_shown = match views.transport {
            Some(view) => {
                // The plate's track is ticked with the timeline's events, which only the observer
                // view carries: a replay without one has a plate and no ticks.
                let events = views
                    .observer
                    .filter(|_| self.host.mode.is_spectating())
                    .map_or(&[][..], |observer| &observer.timeline.events[..]);
                self.frame_transport(ctx, view, events, &mut hit_rects)
            }
            None => false,
        };

        // Taken whether or not a card is drawn to take it: a choice made for a card that has since
        // gone is not one to carry over to the next.
        let end_card_key = self.end_card_key.take();
        if let Some(modal) = self.modals.last().copied() {
            // Stands in for a host that hands over no lists at all, so the rows built from them
            // draw as empty rather than the screen having to know whether it has any.
            let no_lists = OptionsLists::default();
            let option_lists = views.option_lists.unwrap_or(&no_lists);
            let outcome = draw_modal(
                ctx,
                modal.id,
                views,
                &self.host,
                &ModalContext {
                    options: &self.options,
                    option_lists,
                    options_section: self.options_section,
                    button_key_held: self
                        .held_button_key
                        .is_some_and(|(held, _)| held == modal.id),
                    end_card_key,
                },
                &mut hit_rects,
            );
            for slot in outcome.drop_requests {
                self.intents.push(Intent::DropPlayer { slot });
            }
            if outcome.leave {
                self.intents.push(Intent::LeaveGame);
            }
            if outcome.quit {
                self.intents.push(Intent::QuitGame);
            }
            if let Some(dialog) = outcome.end_mission {
                // Off the stack as soon as it is answered, without asking the host to close the
                // dialog: ending the mission closes it, and a card left up until then could be
                // answered a second time.
                self.modals.retain(|entry| entry.id != modal.id);
                self.intents.push(Intent::EndMission(dialog));
            }
            if let Some(dialog) = outcome.open_social {
                self.open_social_dialog(dialog);
            }
            if outcome.abandoned {
                self.intents.push(Intent::AbandonGame);
            }
            if let Some(section) = outcome.options_section {
                self.options_section = section;
            }
            // Recorded here as well as asked of the host, so the control the player moved stays
            // where they put it however long the host takes to apply it.
            for change in outcome.options_changes {
                self.options.apply(change);
                self.intents.push(Intent::ChangeSetting(change));
            }
            // Dismissed first: the modal that reported it is the one on top, and opening another
            // one here would make the dismissal close the wrong screen.
            if outcome.dismissed && modal.id.is_dismissible() {
                self.dismiss_top_modal();
            }
            if outcome.open_options {
                self.open_modal(ModalId::Options);
            }
        }

        FrameOutput {
            intents: std::mem::take(&mut self.intents),
            hit_rects,
            capture: self.capture(),
            transport_shown,
        }
    }

    /// Draws the observer panels the watcher has left on screen, turning what they did with them
    /// into intents for the host and into preferences of its own.
    ///
    /// The panels are placed against each other rather than at the design's coordinates (see
    /// [`observer::layout`]), so they are drawn in the order the screen's room is handed out: the
    /// surfaces hung from the top edge, the minimap's frame, then the stack along the bottom edge,
    /// which between them say how much of each side is left for the wings, and the dock last, which
    /// is told what found no room. `has_transport` is whether there is a replay plate to share the
    /// bottom of the screen with.
    fn frame_observer(
        &mut self,
        ctx: &Context,
        view: &ObserverView,
        has_transport: bool,
        hit_rects: &mut Vec<HitRect>,
    ) {
        use observer::layout::{self, Span};

        self.map_control_available = view.map_control.is_some();
        let screen = ctx.viewport_rect();
        let gap = observer::WING_GAP;
        // What the watcher wants on screen and the screen had no room for this frame.
        let mut displaced = Vec::new();
        // The surfaces hung from the screen's top edge, which everything below keeps under.
        let mut top_surfaces = Vec::new();

        if let Some(outcome) = observer::render_matchup_view(&view.matchup, ctx, self.prefs.matchup)
        {
            hit_rects.push(HitRect::new(outcome.rect));
            top_surfaces.push(outcome.rect);
            if let Some(player_id) = outcome.toggled_vision {
                self.intents.push(Intent::ToggleVision { player_id });
            }
        }
        // The corner cards and the wings under them are one stack: a card is as tall as the side it
        // carries, so where the wings start is measured off what the cards actually came out as
        // rather than guessed at from a player count.
        let mut tops = observer::WingTops::under_bar(view.matchup.form().height());
        let right_inset = observer::dock_inset(ctx, self.prefs.dock);
        // A wing arriving takes its place beside the dock at once, the way the left wings simply
        // appear where they stand; one already on screen follows the dock as it comes and goes.
        let settled_inset = observer::settled_dock_inset(self.prefs.dock);
        if let Some(cards) = &view.team_cards {
            let inset = self.drawn.team_cards.inset(right_inset, settled_inset);
            let outcome = observer::render_team_cards_view(cards, ctx, self.prefs.matchup, inset);
            self.drawn.team_cards.drawn(outcome.right_bottom.is_some());
            for rect in outcome.rects {
                hit_rects.push(HitRect::new(rect));
                top_surfaces.push(rect);
            }
            if let Some(bottom) = outcome.left_bottom {
                tops.left = tops.left.max(bottom + gap);
            }
            if let Some(bottom) = outcome.right_bottom {
                tops.right = tops.right.max(bottom + gap);
            }
        }
        // The reporting panels take no clicks of their own, but every one of them is an opaque
        // surface: a click that landed on a number and went on to select whatever unit was behind
        // it would make the panels unusable exactly where they are most worth reading.
        if let Some(map_control) = &view.map_control {
            if self.prefs.map_control && !observer::map_control::fits(screen.width()) {
                displaced.push(Panel::MapControl);
            }
            if let Some(rect) = observer::render_map_control_view(
                map_control,
                ctx,
                self.prefs.map_control,
                view.matchup.form().height() + observer::MAP_CONTROL_GAP,
            ) {
                hit_rects.push(HitRect::new(rect));
                top_surfaces.push(rect);
            }
        }

        // The minimap's square is the game's wherever it is, and the frame around it is kept clear
        // whether or not it is drawn: a watcher who hides the minimap has not asked for the panels
        // to move into its corner.
        if self.host.minimap_rect.is_some() {
            self.last_minimap_rect = self.host.minimap_rect;
        }
        let square = layout::minimap_square(screen, self.last_minimap_rect);
        let minimap = observer::minimap::footprint(screen, square);
        self.frame_minimap(ctx, view, hit_rects);
        let minimap_on_left = minimap.center().x < screen.center().x;

        // The run of the bottom edge the bottom panels have: from the minimap's frame to whatever
        // holds the right edge, which is the transport plate where it stands in the corner and the
        // dock's column where it does not.
        let edge_right = screen.right() - observer::WING_MARGIN - right_inset;
        let mut span = if minimap_on_left {
            Span {
                left: minimap.right() + gap,
                right: edge_right,
            }
        } else {
            Span {
                left: screen.left() + observer::WING_MARGIN,
                right: edge_right.min(minimap.left() - gap),
            }
        };
        let transport_shown = has_transport && self.prefs.transport;
        let mut transport = transport::TransportPlacement::default();
        let dock_width = observer::dock::column_width(self.prefs.dock_expanded);
        let dock_column = Span {
            left: screen.right() - dock_width,
            right: screen.right(),
        };
        // The keycap strip is there all game and keeps clear of the surfaces over its column. The
        // rail is something the watcher has just opened to read, and like every other panel it
        // passes over it may pass over those too: only the plate, a control of its own, it keeps
        // clear of.
        let dock_top = if self.prefs.dock_expanded {
            screen.top() + observer::WING_MARGIN
        } else {
            layout::lowest_bottom_over(dock_column, &top_surfaces, screen.top()) + gap
        };
        // How far the plate stands in to clear the dock's column, following the dock off the edge
        // and back the way the panels on that side do.
        let dock_clearance = right_inset / observer::dock::column_width(false) * dock_width;
        let dock_fit = |bottom: f32| {
            observer::DockPlacement::fit(
                self.host.mode,
                self.map_control_available,
                screen.center().y,
                dock_top,
                bottom,
            )
        };
        // What the plate stands on where it gives the corner up to the panels along the bottom edge.
        enum PlateStand {
            Corner,
            Stack,
        }
        // The panels are laid along the edge as one row where it is wide enough for one, beside a
        // minimap in the corner the row can start from.
        let row_along = |run: Span| {
            if minimap_on_left {
                layout::BottomRow::along(run)
            } else {
                None
            }
        };
        let mut dock = None;
        let mut plate = PlateStand::Corner;
        let row = if transport_shown {
            // The plate keeps the corner while the panels still have their row beside it, or
            // failing that their stack's narrowest width, and the dock still fits above it. Where
            // the dock does not, the plate stands in from the dock's column and the dock runs down
            // past it. Where not even the stack fits beside it, it gives the stack the bottom edge
            // and is lifted over it, standing in from the dock's column too, so the dock keeps the
            // whole edge.
            let corner = transport.rect(screen);
            if self.prefs.dock {
                dock = dock_fit(corner.top() - gap);
                if dock.is_none() {
                    transport.right_inset = dock_clearance;
                }
            }
            let beside = Span {
                right: span.right.min(transport.rect(screen).left() - gap),
                ..span
            };
            if let Some(row) = row_along(beside) {
                Some(row)
            } else {
                if beside.width() >= observer::MIN_STACK_WIDTH {
                    span = beside;
                } else {
                    transport.right_inset = dock_clearance;
                    plate = PlateStand::Stack;
                }
                None
            }
        } else {
            row_along(span)
        };
        let dock = match dock {
            Some(dock) => dock,
            None => dock_fit(screen.bottom() - observer::WING_MARGIN).unwrap_or(
                observer::DockPlacement::centred(
                    self.host.mode,
                    self.map_control_available,
                    screen.height(),
                ),
            ),
        };

        // The bottom panels are drawn bottom first: each is as tall as the game it reports on, so
        // one stood on another is placed over whatever that one actually came out as, and drops
        // onto the one below when a panel between them is hidden or has no room. Along a row the
        // selection panel stands alone at the far end, and the column by the minimap is production
        // stood on control groups. In the centered stack the selection panel stands lowest, where
        // the game's console reads a selection out, with control groups and then production on it.
        let slot = |run: Span, anchor: observer::StackAnchor, bottom: f32| observer::StackSlot {
            bottom,
            span: run,
            anchor,
            middle: screen.center().x,
            ceiling: layout::lowest_bottom_over(run, &top_surfaces, screen.top()),
            screen_bottom: screen.bottom(),
        };
        let (selection_run, selection_anchor, column_run, column_anchor) = match row {
            Some(row) => (
                row.selection,
                observer::StackAnchor::Right,
                row.column,
                observer::StackAnchor::Left,
            ),
            None => (
                span,
                observer::StackAnchor::Middle,
                span,
                observer::StackAnchor::Middle,
            ),
        };
        let base = observer::WING_MARGIN;
        let selection_slot = hold_slot(
            &mut self.held_slots.selection,
            self.prefs.selection && !view.selection.units.is_empty(),
            slot(selection_run, selection_anchor, base),
        );
        let column_slot = |bottom: f32| slot(column_run, column_anchor, bottom);
        let mut stack = Vec::new();
        if self.prefs.selection
            && !view.selection.units.is_empty()
            && !observer::selection::fits(selection_slot)
        {
            displaced.push(Panel::Selection);
        }
        let selection = observer::render_selection_view(
            &view.selection,
            ctx,
            self.prefs.selection,
            selection_slot,
        );
        if let Some(outcome) = &selection {
            hit_rects.push(HitRect::new(outcome.rect));
            stack.push(outcome.rect);
            match outcome.clicked {
                Some(SelectedUnitClick::Pick(index)) => {
                    self.intents.push(Intent::PickSelectedUnit(index));
                }
                Some(SelectedUnitClick::Follow(index)) => {
                    self.intents.push(Intent::FollowSelectedUnit(index));
                }
                None => {}
            }
        }
        let selection = selection.map(|outcome| outcome.rect);
        let over_selection = base
            + observer::eased_stack_share(
                ctx,
                egui::Id::new("sb_stack_selection"),
                selection,
                self.drawn.control_groups,
            );
        let under_groups = if row.is_some() { base } else { over_selection };
        // The row shown is the selected unit's owner, and stays theirs after the selection is
        // cleared: a watcher who clicks the ground has not asked to see somebody else's keys.
        if let Some(owner) = view.selection.units.first().and_then(|unit| unit.owner) {
            self.focused_player = Some(owner);
        }
        self.number_keys = view
            .control_groups
            .shown(self.focused_player)
            .map(|player| {
                let keys = player
                    .groups
                    .iter()
                    .fold(0u16, |keys, group| keys | 1 << group.key);
                (player.player_id, keys)
            });
        if self.prefs.control_groups
            && !view.control_groups.is_empty()
            && observer::control_groups::fitted_width(column_slot(under_groups)).is_none()
        {
            displaced.push(Panel::ControlGroups);
        }
        let control_groups_slot = hold_slot(
            &mut self.held_slots.control_groups,
            self.prefs.control_groups && !view.control_groups.is_empty(),
            column_slot(under_groups),
        );
        let control_groups = observer::render_control_groups_view(
            &view.control_groups,
            ctx,
            self.prefs.control_groups,
            control_groups_slot,
            self.focused_player,
        );
        if let Some(outcome) = &control_groups {
            hit_rects.push(HitRect::new(outcome.rect));
            stack.push(outcome.rect);
            if let Some(digit) = outcome.clicked {
                self.recall_control_group(digit);
            }
        }
        let control_groups = control_groups.map(|outcome| outcome.rect);
        self.drawn.control_groups = control_groups.is_some();
        let over_groups = under_groups
            + observer::eased_stack_share(
                ctx,
                egui::Id::new("sb_stack_control_groups"),
                control_groups,
                self.drawn.production,
            );
        if self.prefs.production
            && !view.production.is_empty()
            && observer::production::ProductionFit::of(&view.production, column_slot(over_groups))
                .is_none()
        {
            displaced.push(Panel::Production);
        }
        let production_slot = hold_slot(
            &mut self.held_slots.production,
            self.prefs.production && !view.production.is_empty(),
            column_slot(over_groups),
        );
        let production = observer::render_production_view(
            &view.production,
            ctx,
            self.prefs.production,
            production_slot,
        );
        self.drawn.production = production.is_some();
        if let Some(outcome) = &production {
            hit_rects.push(HitRect::new(outcome.rect));
            stack.push(outcome.rect);
            if let Some((player_id, item)) = outcome.clicked {
                self.intents.push(Intent::SelectProduction {
                    player_id,
                    item: item as u32,
                });
            }
        }
        match plate {
            PlateStand::Corner => {}
            PlateStand::Stack => {
                let over_stack = over_groups
                    + observer::eased_stack_share(
                        ctx,
                        egui::Id::new("sb_stack_production"),
                        production.as_ref().map(|outcome| outcome.rect),
                        self.drawn.plate,
                    );
                transport.lift = over_stack - observer::WING_MARGIN;
            }
        }
        self.transport_placement = transport;

        // The wings hang from under the top surfaces and end above whatever stands under them in
        // their own column: the stack, the minimap's frame, and the plate.
        let mut bottom_surfaces = stack;
        bottom_surfaces.push(minimap);
        if transport_shown {
            bottom_surfaces.push(transport.rect(screen));
        }
        let left_span = layout::left_wing_span(screen, observer::economy::PANEL_WIDTH);
        let right_span =
            layout::right_wing_span(screen, observer::military::PANEL_WIDTH, right_inset);
        let left_floor =
            layout::highest_top_under(left_span, &bottom_surfaces, screen.bottom()) - gap;
        let right_floor =
            layout::highest_top_under(right_span, &bottom_surfaces, screen.bottom()) - gap;
        // A screen too narrow for both wings side by side keeps the left one, which reports the
        // economy, over the right one, which reports what it bought.
        let right_room = right_span.left >= left_span.right + gap;

        let economy_fits = tops.left + observer::economy::panel_height(&view.economy) <= left_floor;
        if self.prefs.economy && !view.economy.is_empty() && !economy_fits {
            displaced.push(Panel::Economy);
        }
        let economy = observer::render_economy_view(
            &view.economy,
            ctx,
            self.prefs.economy && economy_fits,
            tops.left,
        );
        if let Some(rect) = economy {
            hit_rects.push(HitRect::new(rect));
        }
        let military_fits = right_room
            && tops.right + observer::military::panel_height(&view.military) <= right_floor;
        if self.prefs.military && !view.military.is_empty() && !military_fits {
            displaced.push(Panel::Military);
        }
        let military_inset = self.drawn.military.inset(right_inset, settled_inset);
        let military = observer::render_military_view(
            &view.military,
            ctx,
            self.prefs.military && military_fits,
            tops.right,
            military_inset,
        );
        self.drawn.military.drawn(military.is_some());
        if let Some(rect) = military {
            hit_rects.push(HitRect::new(rect));
        }
        let graphs_top = observer::WingTops::below(
            ctx,
            egui::Id::new("sb_stack_military"),
            tops.right,
            military,
            self.drawn.graphs.on_screen,
        );
        let graphs_fit = right_room && observer::graphs::fits(graphs_top, right_floor);
        if self.prefs.graphs && !view.graphs.is_empty() && !graphs_fit {
            displaced.push(Panel::Graphs);
        }
        // The panels that report on the game so far are ways back into it, where it can be moved
        // through at all: a replay, with playback to move.
        let seekable = self.seekable_replay();
        let graphs = observer::render_graphs_view(
            &view.graphs,
            ctx,
            self.prefs.graphs && right_room,
            graphs_top,
            right_floor,
            self.drawn.graphs.inset(right_inset, settled_inset),
            seekable.is_some(),
        );
        self.drawn.graphs.drawn(graphs.is_some());
        if let Some(outcome) = graphs {
            hit_rects.push(HitRect::new(outcome.rect));
            if let Some(series) = outcome.series {
                self.prefs.graph_series = series;
            }
            if let Some(per_player) = outcome.per_player {
                self.prefs.graph_per_player = per_player;
            }
            if let (Some(replay), Some(secs)) = (seekable, outcome.seek_secs) {
                self.queue_seek(replay.frame_at_secs(u64::from(secs)), None);
            }
        }
        let timeline_top = observer::WingTops::below(
            ctx,
            egui::Id::new("sb_stack_economy"),
            tops.left,
            economy,
            self.drawn.timeline,
        );
        if self.prefs.timeline && !observer::timeline::fits(timeline_top, left_floor) {
            displaced.push(Panel::Timeline);
        }
        let timeline = observer::render_timeline_view(
            &view.timeline,
            ctx,
            self.prefs.timeline,
            timeline_top,
            left_floor,
            seekable.is_some(),
        );
        self.drawn.timeline = timeline.is_some();
        if let Some(outcome) = timeline {
            hit_rects.push(HitRect::scrolling(outcome.rect));
            if let (Some(replay), Some(event)) = (seekable, outcome.clicked) {
                self.queue_seek(replay.event_seek_target(event.secs), event.position);
            }
        }

        let dock = observer::render_obs_dock(
            &self.prefs,
            &observer::DockContext {
                hotkeys: &self.hotkeys,
                mode: self.host.mode,
                map_control_available: self.map_control_available,
                placement: dock,
                displaced: &displaced,
            },
            ctx,
        );
        if let Some(outcome) = dock {
            hit_rects.push(HitRect::new(outcome.rect));
            if let Some(panel) = outcome.toggled {
                self.prefs.toggle(panel);
            }
            if let Some(spoiler_free) = outcome.spoiler_free {
                self.prefs.spoiler_free = spoiler_free;
            }
            if let Some(expanded) = outcome.expanded {
                self.prefs.dock_expanded = expanded;
            }
        }
    }

    /// Draws the frame around the game's minimap, where the host can say where the minimap is, and
    /// turns what the watcher did with its header into intents.
    fn frame_minimap(&mut self, ctx: &Context, view: &ObserverView, hit_rects: &mut Vec<HitRect>) {
        let shown = self.prefs.minimap && self.host.minimap_rect.is_some();
        if !shown {
            self.vision_picker_open = false;
        }
        let Some(square) = self.host.minimap_rect else {
            return;
        };
        let Some(outcome) = observer::render_minimap_frame(
            ctx,
            square,
            shown,
            &view.matchup.players,
            self.vision_picker_open,
        ) else {
            return;
        };
        for rect in outcome.rects {
            hit_rects.push(HitRect::new(rect));
        }
        self.vision_picker_open = shown && outcome.picker_open;
        if let Some(player_id) = outcome.toggled_vision {
            self.intents.push(Intent::ToggleVision { player_id });
        }
        if outcome.open_menu {
            self.vision_picker_open = false;
            self.intents.push(Intent::OpenGameMenu);
        }
    }

    /// The playback a click on a reporting panel moves, or `None` where nothing can be moved: a live
    /// game, watched or played, only ever runs forwards.
    fn seekable_replay(&self) -> Option<TransportView> {
        self.transport.filter(|_| self.host.mode == Mode::Replay)
    }

    /// Draws the replay transport and turns what the player did with it into intents, returning
    /// whether the plate is on screen. `events` are the timeline's, which its track is ticked with.
    fn frame_transport(
        &mut self,
        ctx: &Context,
        view: &TransportView,
        events: &[observer::TimelineEventView],
        hit_rects: &mut Vec<HitRect>,
    ) -> bool {
        let outcome = render_transport_view(
            view,
            ctx,
            self.prefs.shown(Panel::Transport),
            self.transport_placement,
            events,
        );
        self.drawn.plate = outcome.is_some();
        if let Some(outcome) = &outcome {
            hit_rects.push(HitRect::new(outcome.rect));
            if let Some(frame) = outcome.seek_to {
                self.queue_seek(frame, outcome.look_at);
            }
            if outcome.speed.is_some() || outcome.paused.is_some() {
                self.request_speed(outcome.speed, outcome.paused);
            }
            if let Some(spoiler_free) = outcome.spoiler_free {
                self.prefs.spoiler_free = spoiler_free;
            }
        }
        self.send_queued_seek(ctx, view);
        outcome.is_some()
    }

    /// Queues a jump to `frame`, and a look at `look_at` once it lands, replacing whatever was queued
    /// before it.
    fn queue_seek(&mut self, frame: u32, look_at: Option<observer::MapPoint>) {
        self.pending_seek = Some((frame, look_at));
    }

    /// Lets the queued seek out once the game is ready for one.
    ///
    /// Held back while the game is still working through the last one: a second seek sent then is
    /// refused outright, and a refusal that swallowed the player's final drag position would leave
    /// the playhead somewhere they never asked for.
    fn send_queued_seek(&mut self, ctx: &Context, view: &TransportView) {
        let Some((frame, look_at)) = self.pending_seek else {
            return;
        };
        let now = ctx.input(|input| input.time);
        if view.seek_pending || now - self.last_seek_secs < SEEK_INTERVAL_SECS {
            // Nothing else is asking for the frame that would let this out, so it asks itself.
            ctx.request_repaint();
            return;
        }
        self.pending_seek = None;
        self.last_seek_secs = now;
        self.intents.push(Intent::Seek(frame));
        if let Some(point) = look_at {
            self.intents.push(Intent::LookAt(point));
        }
    }

    /// Asks for a change to how playback runs, filling in whichever half of it the player did not
    /// touch from where playback is now.
    fn request_speed(&mut self, speed: Option<SpeedStep>, paused: Option<bool>) {
        let Some(view) = self.transport else {
            return;
        };
        let step = speed.unwrap_or_else(|| view.step());
        self.intents.push(Intent::SetSpeed {
            speed_index: step.speed_index,
            multiplier: step.multiplier,
            paused: paused.unwrap_or(view.paused),
        });
    }

    /// Carries out a transport key, or reports that there was no replay for it to act on.
    fn apply_transport_action(&mut self, action: Action, modifiers: Modifiers) -> bool {
        let Some(view) = self.transport else {
            return false;
        };
        match action {
            Action::PauseResume => self.request_speed(None, Some(!view.paused)),
            Action::SpeedUp => self.request_speed(
                Some(transport::step_speed(view.speed_index, view.multiplier, 1)),
                None,
            ),
            Action::SpeedDown => self.request_speed(
                Some(transport::step_speed(view.speed_index, view.multiplier, -1)),
                None,
            ),
            Action::SeekBackward | Action::SeekForward => {
                let step = if modifiers.shift {
                    transport::SEEK_STEP_LONG_SECS
                } else {
                    transport::SEEK_STEP_SECS
                };
                let step = match action {
                    Action::SeekBackward => -step,
                    _ => step,
                };
                // Counted from where the queued seek would put playback rather than from where it
                // is now, so two presses in a row add up instead of one eating the other.
                let from = self
                    .pending_seek
                    .map_or(view.elapsed_frames, |(frame, _)| frame);
                let delta = transport::seconds_to_frames(i64::from(step), view.game_speed);
                let frame = view.frame_at(i64::from(from) + delta);
                self.queue_seek(frame, None);
            }
            _ => return false,
        }
        true
    }

    /// Selects the group on `digit` of the player whose keys the control groups row shows, the way
    /// that player pressing it would. A digit with nothing on it does nothing, as it would for that
    /// player: left to the game, it would recall another player's group on that digit. With nobody's
    /// keys to read the digit stays the game's.
    fn recall_control_group(&mut self, digit: u8) -> bool {
        let Some((player_id, keys)) = self.number_keys else {
            return false;
        };
        if keys & 1 << digit != 0 {
            self.intents.push(Intent::SelectControlGroup {
                player_id,
                key: digit,
            });
        }
        true
    }

    /// Lets go of a held button's key once `is_down` says it is no longer down, or once the modal
    /// the button is on is no longer on top. Asked of the keyboard itself every frame rather than
    /// told by key-up messages, which a switch away from the game can swallow: a hold that outlived
    /// its key would leave the game on its own.
    pub fn update_held_keys(&mut self, is_down: impl Fn(Key) -> bool) {
        if let Some((modal, key)) = self.held_button_key
            && (!is_down(key) || self.top_modal() != Some(modal))
        {
            self.held_button_key = None;
        }
    }

    /// Carries out what `key` does to the buttons of the modal on top, the keys their keycaps name
    /// and the others each dialog's doc lists, and returns whether it did anything.
    fn dialog_key_pressed(&mut self, key: Key) -> bool {
        let playing = self.host.mode == Mode::Playing;
        let replay = self.host.mode == Mode::Replay;
        let top = self.top_modal();
        if top == Some(ModalId::Options)
            && let Some(section) = OptionsSection::ALL
                .into_iter()
                .find(|section| section.key() == key)
        {
            self.options_section = section;
            return true;
        }
        if let Some(result) = top.and_then(ModalId::game_result)
            && let Some(choice) = end_card::key_choice(key, result)
        {
            self.end_card_key = Some(choice);
            return true;
        }
        match (top, key) {
            (Some(ModalId::GameMenu), Key::O) => self.open_modal(ModalId::Options),
            // The key works the leave button as the pointer does: held where leaving is held, and
            // the hold only starts on a press made with the menu up; a tap in a replay.
            (Some(ModalId::GameMenu), Key::E) if leave_is_held(replay) => {
                self.held_button_key = Some((ModalId::GameMenu, Key::E));
            }
            (Some(ModalId::GameMenu), Key::E) => self.intents.push(Intent::QuitGame),
            (Some(ModalId::GameMenu), Key::A | Key::C) if playing => {
                self.open_social_dialog(SocialDialog::Alliances)
            }
            (Some(ModalId::GameMenu), Key::M) if playing => {
                self.open_social_dialog(SocialDialog::Messaging)
            }
            (Some(ModalId::LeaveGame), Key::Q | Key::E) => self.intents.push(Intent::QuitGame),
            // The key SC:R opens its message history with closes it again, and so does its OK
            // button's.
            (Some(ModalId::ChatHistory), Key::Equals | Key::O) => self.dismiss_top_modal(),
            // Abandoning is always held: the game goes on for everyone else in it.
            (Some(ModalId::ConnectionInterrupted), Key::E) => {
                self.held_button_key = Some((ModalId::ConnectionInterrupted, Key::E));
            }
            (Some(ModalId::SessionEnded), Key::O | Key::E) => self.intents.push(Intent::LeaveGame),
            _ => return false,
        }
        true
    }

    /// Leaves the menu for one of SC:R's own social dialogs. The host leaves the game menu itself on
    /// the way to the dialog, so the menu goes from the stack without asking the host to close it a
    /// second time.
    fn open_social_dialog(&mut self, dialog: SocialDialog) {
        self.modals.retain(|modal| modal.id != ModalId::GameMenu);
        self.intents.push(Intent::OpenSocialDialog(dialog));
    }

    /// Whether SC:R's quit keys open the leave question. They do in every mode once the game runs,
    /// as SC:R's own do, except while the chat box has the keyboard or a modal the player cannot
    /// close owns the screen: that one already says how this game ends.
    fn quit_keys_active(&self) -> bool {
        self.host.game_started
            && !self.host.native_textbox_open
            && self.top_modal().is_none_or(ModalId::is_dismissible)
    }

    /// Whether the panel hotkeys are the shell's to consume right now.
    ///
    /// Spectating only, and never while something else owns the keyboard: a capturing modal of ours,
    /// one of BW's own dialogs, or the chat box the player is typing into. A modal that takes no
    /// input takes no hotkeys either — a passing stall notice must cost an observer nothing.
    fn hotkeys_active(&self) -> bool {
        self.host.game_started
            && self.host.mode.is_spectating()
            && !self.host.native_textbox_open
            && !self.host.native_dialog_open
            && !self.modal_captures()
    }

    fn modal_captures(&self) -> bool {
        self.modals.iter().any(|modal| modal.captures_input)
    }

    fn apply_action(&mut self, action: Action, modifiers: Modifiers) -> bool {
        match action {
            Action::ToggleAllPanels => {
                self.prefs.toggle_all();
                true
            }
            Action::ToggleVisionPicker => {
                self.vision_picker_open = !self.vision_picker_open;
                // The list hangs off the minimap's frame, so asking for it brings the minimap back.
                if self.vision_picker_open {
                    self.prefs.minimap = true;
                }
                true
            }
            // A viewing preference rather than a surface, and only a replay has an outcome worth
            // keeping quiet, so anywhere else the key stays the game's.
            Action::ToggleSpoilerFree => {
                if self.host.mode != Mode::Replay {
                    return false;
                }
                self.prefs.spoiler_free = !self.prefs.spoiler_free;
                true
            }
            Action::PauseResume
            | Action::SpeedUp
            | Action::SpeedDown
            | Action::SeekBackward
            | Action::SeekForward => self.apply_transport_action(action, modifiers),
            Action::ToggleGraphs => self.apply_graphs_action(modifiers),
            Action::ToggleDock => self.apply_dock_action(modifiers),
            // The bar reports a measurement the game does not keep, so a game whose host has none
            // leaves the key alone rather than moving a preference nothing can act on.
            Action::ToggleMapControl if !self.map_control_available => false,
            _ => match action_panel(action) {
                Some(panel) => {
                    self.prefs.toggle(panel);
                    true
                }
                None => false,
            },
        }
    }

    /// Carries out the graphs key, which opens the panel, walks it through the measurements it can
    /// plot, then closes it again. `Shift` walks the same line the other way.
    ///
    /// One key rather than two, because the panel plots one series at a time: the watcher's question
    /// is "show me the next one", and a second key for the panel itself would leave them choosing
    /// between two keys that both look like the way in. The walk ends at both edges rather than
    /// wrapping, so the direction that opened the panel is the direction that closes it again.
    fn apply_graphs_action(&mut self, modifiers: Modifiers) -> bool {
        let backwards = modifiers.shift;
        if !self.prefs.graphs {
            self.prefs.graphs = true;
            // A backward walk starts at the far end of the line, which is what makes the two
            // directions mirrors: each opens the panel on the series the other one closes it from.
            self.prefs.graph_series = match backwards {
                true => GraphSeries::ALL.last().copied().unwrap_or_default(),
                false => GraphSeries::default(),
            };
            return true;
        }
        let stepped = match backwards {
            true => self.prefs.graph_series.previous(),
            false => self.prefs.graph_series.next(),
        };
        match stepped {
            Some(series) => self.prefs.graph_series = series,
            None => {
                self.prefs.graphs = false;
                self.prefs.graph_series = GraphSeries::default();
            }
        }
        true
    }

    /// Carries out the dock key: on its own it takes the dock off screen and back, and with `Shift`
    /// it changes which of the dock's two forms it comes back in.
    ///
    /// A form the watcher cannot see has not changed as far as they are concerned, so the chord
    /// shows a hidden dock rather than answering with nothing.
    fn apply_dock_action(&mut self, modifiers: Modifiers) -> bool {
        if modifiers.shift {
            self.prefs.dock_expanded = !self.prefs.dock_expanded;
            self.prefs.dock = true;
        } else {
            self.prefs.toggle(Panel::Dock);
        }
        true
    }

    fn dismiss_top_modal(&mut self) {
        let Some(modal) = self.modals.pop() else {
            return;
        };
        if let Some(dialog) = modal.id.native_dialog()
            && self.live_native_dialogs[dialog.index()]
        {
            self.intents.push(Intent::CloseNativeDialog(dialog));
        }
    }

    /// Brings the modal stack in line with the disconnect status, which raises and lowers its own
    /// surface rather than the player doing it.
    fn sync_status_modals(&mut self, disconnect: Option<&DisconnectSurface<'_>>) {
        let wanted = disconnect
            .filter(|surface| !surface.view.is_empty())
            .map(|surface| {
                let id = match surface.view.self_state {
                    SelfState::Reconnecting => ModalId::ConnectionInterrupted,
                    SelfState::Disconnected | SelfState::Desynced => ModalId::SessionEnded,
                    SelfState::Healthy => ModalId::WaitingForPlayers,
                };
                (id, surface.blocks_input)
            });
        self.modals
            .retain(|modal| !modal.id.is_status_driven() || Some(modal.id) == wanted.map(|w| w.0));
        let Some((id, captures_input)) = wanted else {
            return;
        };
        match self.modals.iter_mut().find(|modal| modal.id == id) {
            Some(modal) => modal.captures_input = captures_input,
            None => self.modals.push(Modal { id, captures_input }),
        }
    }
}

/// Which of the panels whose place eases as their neighbors come and go were drawn last frame.
#[derive(Default)]
struct DrawnLastFrame {
    /// The team cards' right-hand card.
    team_cards: RightWing,
    military: RightWing,
    control_groups: bool,
    production: bool,
    plate: bool,
    graphs: RightWing,
    timeline: bool,
}

/// A wing on the right edge, which stands in from it by however much room the dock takes.
#[derive(Default)]
struct RightWing {
    /// Whether the wing was drawn last frame.
    on_screen: bool,
    /// Whether the wing follows the dock's eased inset rather than standing where the dock settles.
    ///
    /// A wing arrives where the dock settles and keeps to it until the dock's easing gets there:
    /// shown together with the dock, a wing that followed the easing from its second frame would
    /// jump to the screen's edge and slide back in beside the dock.
    follows_dock: bool,
}

impl RightWing {
    /// How far in from the right edge the wing stands this frame, given the dock's `eased` inset
    /// and the `settled` one it eases toward.
    fn inset(&mut self, eased: f32, settled: f32) -> f32 {
        if !self.on_screen {
            self.follows_dock = false;
        } else if (eased - settled).abs() < 0.5 {
            self.follows_dock = true;
        }
        if self.follows_dock { eased } else { settled }
    }

    fn drawn(&mut self, on_screen: bool) {
        self.on_screen = on_screen;
    }
}

/// The slots the bottom panels were last placed in while they were wanted on screen.
#[derive(Default)]
struct HeldSlots {
    selection: Option<observer::StackSlot>,
    control_groups: Option<observer::StackSlot>,
    production: Option<observer::StackSlot>,
}

/// The slot a bottom panel is drawn in: `slot` while it is `wanted` on screen, kept as `held`, and
/// `held` while it is not, so a panel fading out does so where it was.
fn hold_slot(
    held: &mut Option<observer::StackSlot>,
    wanted: bool,
    slot: observer::StackSlot,
) -> observer::StackSlot {
    if wanted {
        *held = Some(slot);
        slot
    } else {
        held.unwrap_or(slot)
    }
}

/// The digit a number key stands for.
fn number_key_digit(key: Key) -> Option<u8> {
    [
        Key::Num0,
        Key::Num1,
        Key::Num2,
        Key::Num3,
        Key::Num4,
        Key::Num5,
        Key::Num6,
        Key::Num7,
        Key::Num8,
        Key::Num9,
    ]
    .iter()
    .position(|&digit| digit == key)
    .map(|digit| digit as u8)
}

/// Which panel an action toggles, for the actions whose panel exists.
fn action_panel(action: Action) -> Option<Panel> {
    Panel::ALL
        .into_iter()
        .find(|panel| panel.action() == action)
}

/// What drawing a modal reported back.
#[derive(Default)]
struct ModalOutcome {
    /// Whether the player asked for the modal to close.
    dismissed: bool,
    /// Slots whose Drop button was clicked.
    drop_requests: Vec<u8>,
    /// Whether the player asked to leave the game, on a surface whose session is already over.
    leave: bool,
    /// Whether the player asked to quit a game that is still running.
    quit: bool,
    /// The result dialog whose End Mission the player asked for.
    end_mission: Option<NativeDialog>,
    /// Whether the player asked for the alliances and chat settings.
    open_social: Option<SocialDialog>,
    /// Whether the player gave up on their own connection.
    abandoned: bool,
    /// Whether the player asked for the options screen.
    open_options: bool,
    /// The page of the options screen they moved to.
    options_section: Option<OptionsSection>,
    /// Settings they moved, in the order they moved them.
    options_changes: Vec<SettingChange>,
}

/// The shell's own state a modal is drawn from, as against the view-models its host built.
struct ModalContext<'a> {
    options: &'a OptionsView,
    option_lists: &'a OptionsLists,
    options_section: OptionsSection,
    /// Whether a key is holding the drawn modal's hold-to-confirm button.
    button_key_held: bool,
    /// What a key pressed since the last frame chose on an end-of-game card.
    end_card_key: Option<EndCardChoice>,
}

fn draw_modal(
    ctx: &Context,
    id: ModalId,
    views: &mut Views<'_>,
    host: &HostFrame,
    shell: &ModalContext<'_>,
    hit_rects: &mut Vec<HitRect>,
) -> ModalOutcome {
    match id {
        ModalId::WaitingForPlayers | ModalId::ConnectionInterrupted | ModalId::SessionEnded => {
            let Some(surface) = views.disconnect.as_ref() else {
                return ModalOutcome::default();
            };
            let dialog = render_disconnect_view(surface.view, ctx, shell.button_key_held);
            // The surface only takes clicks once it has a control to take them for: a passive
            // notice must not cost the game a click.
            if surface.view.has_button() || id == ModalId::ConnectionInterrupted {
                hit_rects.push(HitRect::new(dialog.response.rect));
            }
            ModalOutcome {
                drop_requests: dialog.inner.drop_requests,
                abandoned: dialog.inner.abandoned,
                leave: dialog.inner.leave,
                ..ModalOutcome::default()
            }
        }
        ModalId::GameMenu => {
            let dialog = render_game_menu(
                ctx,
                host.game_seconds,
                host.mode == Mode::Playing,
                host.mode == Mode::Replay,
                shell.button_key_held,
            );
            hit_rects.push(HitRect::new(dialog.response.rect));
            ModalOutcome {
                dismissed: dialog.inner.return_to_game || dialog.scrim_clicked,
                open_options: dialog.inner.open_options,
                open_social: dialog.inner.open_social,
                quit: dialog.inner.leave,
                ..ModalOutcome::default()
            }
        }
        ModalId::LeaveGame => {
            let dialog = render_leave_confirm(ctx, host.mode == Mode::Replay);
            hit_rects.push(HitRect::new(dialog.response.rect));
            ModalOutcome {
                dismissed: dialog.inner.return_to_game || dialog.scrim_clicked,
                quit: dialog.inner.leave,
                ..ModalOutcome::default()
            }
        }
        ModalId::ChatHistory => {
            // A host that has not built the log yet still gets a dialog it can close: an empty one
            // says "no messages", which is the truth as far as this frame knows, and leaving the
            // screen blank would strand the player behind a scrim with nothing to click.
            let empty = ChatHistoryView::default();
            let view = views.chat_history.unwrap_or(&empty);
            let dialog = render_chat_history_view(view, ctx);
            hit_rects.push(HitRect::scrolling(dialog.response.rect));
            ModalOutcome {
                dismissed: dialog.inner || dialog.scrim_clicked,
                ..ModalOutcome::default()
            }
        }
        ModalId::Victory | ModalId::Defeat => {
            // A host that could not build the card's view still gets a card the player can act on:
            // the result is the modal's own, and the clock is the frame's.
            let result = id.game_result().unwrap_or(GameResult::Defeat);
            let fallback = EndCardView {
                result,
                game_seconds: host.game_seconds,
                stats: None,
            };
            let view = views
                .end_card
                .filter(|view| view.result == result)
                .unwrap_or(&fallback);
            let card = render_end_card(ctx, view, shell.end_card_key);
            hit_rects.push(HitRect::new(card.response.rect));
            ModalOutcome {
                dismissed: card.inner == Some(EndCardChoice::KeepPlaying),
                end_mission: (card.inner == Some(EndCardChoice::Leave))
                    .then(|| id.native_dialog())
                    .flatten(),
                ..ModalOutcome::default()
            }
        }
        ModalId::Options => {
            let dialog = render_options_view(
                shell.options,
                shell.option_lists,
                ctx,
                shell.options_section,
            );
            hit_rects.push(HitRect::scrolling(dialog.response.rect));
            let OptionsOutcome {
                section,
                changes,
                done,
            } = dialog.inner;
            ModalOutcome {
                dismissed: done || dialog.scrim_clicked,
                options_section: section,
                options_changes: changes,
                ..ModalOutcome::default()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spectating_shell() -> Shell {
        let mut shell = Shell::new();
        shell.set_host(&HostFrame {
            mode: Mode::Replay,
            game_started: true,
            native_textbox_open: false,
            native_dialog_open: false,
            native_menu_open: false,
            game_seconds: 0,
            minimap_rect: None,
        });
        shell
    }

    /// A replay a few minutes in, running at the speed it was recorded at.
    fn replay() -> TransportView {
        TransportView {
            elapsed_frames: 20_000,
            end_frames: 60_000,
            game_speed: 6,
            paused: false,
            speed_index: 6,
            multiplier: 1,
            spoiler_free: false,
            seek_pending: false,
        }
    }

    /// A context with the overlay's own fonts, which is what a screen lays its text out with.
    fn fresh_ctx() -> Context {
        let ctx = Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        ctx
    }

    /// Runs one shell frame the way a host does, at `time` on the context's clock.
    fn run_frame_at(
        shell: &mut Shell,
        ctx: &Context,
        transport: Option<&TransportView>,
        time: f64,
    ) -> FrameOutput {
        let host = HostFrame {
            mode: Mode::Replay,
            game_started: true,
            native_textbox_open: false,
            native_dialog_open: false,
            native_menu_open: false,
            game_seconds: 0,
            minimap_rect: None,
        };
        let raw = egui::RawInput {
            screen_rect: Some(Rect::from_min_size(
                egui::pos2(0.0, 0.0),
                egui::vec2(1280.0, 720.0),
            )),
            time: Some(time),
            ..Default::default()
        };
        ctx.begin_pass(raw);
        let mut views = Views {
            transport,
            ..Views::default()
        };
        let output = shell.frame(ctx, &host, &mut views);
        let mut out = ctx.end_pass();
        let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
        out.textures_delta.clear();
        output
    }

    /// One frame at a time far enough apart that the seek rate limit never decides a test.
    fn run_frame(
        shell: &mut Shell,
        ctx: &Context,
        transport: Option<&TransportView>,
    ) -> Vec<Intent> {
        let time = ctx.input(|input| input.time) + 1.0;
        run_frame_at(shell, ctx, transport, time).intents
    }

    /// A disconnect view with something on it: an empty one draws nothing and raises no modal.
    fn view(self_state: SelfState) -> DisconnectView {
        use crate::disconnect::{DisconnectRowView, PeerState};
        DisconnectView {
            rows: vec![DisconnectRowView {
                slot: 3,
                name: "Rhynso".to_string(),
                color: crate::kit::theme::player_color(0),
                teammate: false,
                seconds: 12,
                state: PeerState::Reconnecting,
                drop_unlocked: false,
                drop_requested: false,
            }],
            self_state,
            self_seconds: 12,
        }
    }

    #[test]
    fn nothing_on_screen_leaves_every_input_to_the_game() {
        let capture = InputCapture::resolve(false, false, false);
        assert_eq!(capture, InputCapture::PASS_THROUGH);
        assert!(!capture.blocks_game_pointer());
        assert!(!capture.blocks_game_key(Some(Key::A)));
    }

    #[test]
    fn a_capturing_modal_takes_the_pointer_and_the_keyboard() {
        let capture = InputCapture::resolve(true, false, false);
        assert!(capture.blocks_game_pointer());
        assert!(capture.blocks_game_key(Some(Key::A)));
        assert!(capture.blocks_game_key(None));
    }

    #[test]
    fn return_and_f10_survive_a_full_capture() {
        let capture = InputCapture::resolve(true, false, false);
        assert!(!capture.blocks_game_key(Some(Key::Enter)));
        assert!(!capture.blocks_game_key(Some(Key::F10)));
        assert!(capture.blocks_game_key(Some(Key::Escape)));
    }

    #[test]
    fn an_open_game_menu_gets_every_input() {
        let capture = InputCapture::resolve(true, false, true);
        assert_eq!(capture, InputCapture::PASS_THROUGH);
    }

    #[test]
    fn an_open_chat_box_keeps_the_keyboard_but_not_the_pointer() {
        let capture = InputCapture::resolve(true, true, false);
        assert!(capture.blocks_game_pointer());
        assert!(!capture.blocks_game_key(Some(Key::Backspace)));
        assert!(!capture.blocks_game_key(Some(Key::Escape)));
    }

    #[test]
    fn a_stall_notice_is_modal_without_taking_input() {
        let mut shell = spectating_shell();
        let disconnect = view(SelfState::Healthy);
        shell.sync_status_modals(Some(&DisconnectSurface {
            view: &disconnect,
            blocks_input: false,
        }));
        assert_eq!(shell.top_modal(), Some(ModalId::WaitingForPlayers));
        assert_eq!(shell.capture(), InputCapture::PASS_THROUGH);
    }

    #[test]
    fn a_confirmed_disconnect_takes_every_input() {
        let mut shell = spectating_shell();
        let disconnect = view(SelfState::Reconnecting);
        shell.sync_status_modals(Some(&DisconnectSurface {
            view: &disconnect,
            blocks_input: true,
        }));
        assert_eq!(shell.top_modal(), Some(ModalId::ConnectionInterrupted));
        assert!(shell.capture().blocks_game_pointer());
    }

    #[test]
    fn a_session_that_is_over_raises_its_own_modal() {
        for self_state in [SelfState::Disconnected, SelfState::Desynced] {
            let mut shell = spectating_shell();
            let disconnect = view(self_state);
            shell.sync_status_modals(Some(&DisconnectSurface {
                view: &disconnect,
                blocks_input: true,
            }));
            assert_eq!(shell.top_modal(), Some(ModalId::SessionEnded));
            assert!(!shell.key_pressed(Key::Escape, Modifiers::NONE));
        }
    }

    #[test]
    fn a_status_modal_swaps_rather_than_stacking() {
        let mut shell = spectating_shell();
        let waiting = view(SelfState::Healthy);
        shell.sync_status_modals(Some(&DisconnectSurface {
            view: &waiting,
            blocks_input: true,
        }));
        let interrupted = view(SelfState::Reconnecting);
        shell.sync_status_modals(Some(&DisconnectSurface {
            view: &interrupted,
            blocks_input: true,
        }));
        assert_eq!(
            shell.open_modals().collect::<Vec<_>>(),
            vec![ModalId::ConnectionInterrupted]
        );
        shell.sync_status_modals(None);
        assert_eq!(shell.top_modal(), None);
    }

    #[test]
    fn escape_never_closes_a_status_modal() {
        let mut shell = spectating_shell();
        let disconnect = view(SelfState::Healthy);
        shell.sync_status_modals(Some(&DisconnectSurface {
            view: &disconnect,
            blocks_input: true,
        }));
        assert!(!shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), Some(ModalId::WaitingForPlayers));
    }

    #[test]
    fn a_replaced_dialog_opens_its_modal_and_escape_closes_both() {
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::GameMenu);
        assert_eq!(shell.top_modal(), Some(ModalId::GameMenu));
        assert!(shell.capture().blocks_game_pointer());

        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), None);
        assert_eq!(
            shell.pending_intents(),
            [Intent::CloseNativeDialog(NativeDialog::GameMenu)]
        );
    }

    #[test]
    fn escape_on_a_victory_card_keeps_playing_through_its_dialog() {
        let mut shell = Shell::new();
        shell.native_dialog_spawned(NativeDialog::Victory);
        assert_eq!(shell.top_modal(), Some(ModalId::Victory));
        assert!(shell.capture().blocks_game_pointer());

        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), None);
        assert_eq!(
            shell.pending_intents(),
            [Intent::CloseNativeDialog(NativeDialog::Victory)]
        );
        assert_eq!(
            NativeDialog::Victory.return_control_id(),
            native_dialogs::VICTORY_CONTINUE_CONTROL_ID
        );
    }

    #[test]
    fn a_defeat_card_can_only_be_left() {
        let mut shell = Shell::new();
        shell.native_dialog_spawned(NativeDialog::Defeat);
        shell.key_pressed(Key::Escape, Modifiers::NONE);
        assert_eq!(shell.top_modal(), Some(ModalId::Defeat));
        assert!(shell.pending_intents().is_empty());
    }

    #[test]
    fn a_modal_opened_directly_captures_input_and_closes_without_touching_the_game() {
        let mut shell = spectating_shell();
        shell.open_modal(ModalId::ChatHistory);
        assert_eq!(shell.top_modal(), Some(ModalId::ChatHistory));
        assert!(shell.capture().blocks_game_pointer());
        // Opening the same modal twice must not stack two of it, or one Escape would leave the
        // other behind.
        shell.open_modal(ModalId::ChatHistory);
        assert_eq!(shell.open_modals().count(), 1);

        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), None);
        // No native dialog was ever spawned behind it, so there is nothing to ask the host to close.
        assert!(shell.pending_intents().is_empty());
    }

    #[test]
    fn a_modal_the_game_state_owns_cannot_be_opened_by_hand() {
        let mut shell = spectating_shell();
        shell.open_modal(ModalId::WaitingForPlayers);
        assert_eq!(shell.top_modal(), None);
    }

    #[test]
    fn a_dialog_closing_on_its_own_asks_for_no_dismissal() {
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::ChatHistory);
        shell.native_dialog_closed(NativeDialog::ChatHistory);
        assert_eq!(shell.top_modal(), None);
        assert!(!shell.native_dialog_live(NativeDialog::ChatHistory));
        assert!(shell.pending_intents().is_empty());
    }

    #[test]
    fn the_timeout_dialog_raises_no_modal_of_its_own() {
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::TimeOut);
        assert!(shell.native_dialog_live(NativeDialog::TimeOut));
        assert_eq!(shell.top_modal(), None);
    }

    /// The options screen stacks over the menu that opens it, so closing it leaves the player back
    /// in that menu rather than back in the game.
    #[test]
    fn closing_the_options_screen_returns_to_the_menu_it_opened_from() {
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::GameMenu);
        shell.open_modal(ModalId::Options);
        assert_eq!(shell.top_modal(), Some(ModalId::Options));
        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), Some(ModalId::GameMenu));
        // Nothing of the game's stands behind the options screen, so closing it asks the host for
        // nothing; the menu it returned to still has its own dialog hidden behind it.
        assert!(shell.pending_intents().is_empty());
        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), None);
        assert_eq!(
            shell.pending_intents(),
            [Intent::CloseNativeDialog(NativeDialog::GameMenu)]
        );
    }

    /// A host that keeps handing over the same settings must not take back a change the player has
    /// just made, and one that hands over different settings must be believed.
    #[test]
    fn host_settings_are_adopted_only_when_the_host_moves_them() {
        let mut shell = Shell::new();
        let host = HostFrame::default();
        let mut given = OptionsView {
            music_volume: 20,
            ..OptionsView::default()
        };
        let ctx = egui::Context::default();
        let run = |shell: &mut Shell, options: &OptionsView| {
            let mut views = Views {
                options: Some(options),
                ..Views::default()
            };
            ctx.begin_pass(egui::RawInput::default());
            shell.frame(&ctx, &host, &mut views);
            // A layout check has no GPU texture store to hand the atlas to.
            ctx.end_pass().textures_delta.clear();
        };
        run(&mut shell, &given);
        assert_eq!(shell.options().music_volume, 20);
        // Something the player did, which the same host view must not undo.
        shell.options.apply(SettingChange::MusicVolume(75));
        run(&mut shell, &given);
        assert_eq!(shell.options().music_volume, 75);
        given.music_volume = 35;
        run(&mut shell, &given);
        assert_eq!(shell.options().music_volume, 35);
    }

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
    fn an_action_with_no_surface_leaves_its_key_to_the_game() {
        let mut shell = spectating_shell();
        // The transport keys have no replay fed to them here, the vision cycle has no surface at
        // all, and the map-control bar has been told of no measurement to draw.
        for key in [Key::P, Key::U, Key::V, Key::N] {
            assert!(
                !shell.key_pressed(key, Modifiers::NONE),
                "{key:?} was consumed with nothing to consume it for"
            );
        }
    }

    #[test]
    fn the_map_control_key_waits_for_a_measurement_to_draw() {
        let mut shell = spectating_shell();
        assert!(!shell.key_pressed(Key::N, Modifiers::NONE));
        shell.map_control_available = true;
        let was_shown = shell.panel_prefs().map_control;
        assert!(shell.key_pressed(Key::N, Modifiers::NONE));
        assert_ne!(shell.panel_prefs().map_control, was_shown);
    }

    #[test]
    fn the_graphs_key_walks_the_series_and_then_closes_the_panel() {
        let mut shell = spectating_shell();
        shell.set_panel_prefs(PanelPrefs {
            graphs: false,
            graph_series: GraphSeries::Kills,
            ..PanelPrefs::default()
        });

        // Opening the panel starts the walk over rather than resuming where it was left: the key
        // that opens it is the key that moves it, so a watcher pressing it twice expects the second
        // measurement rather than the last one they happened to stop on.
        assert!(shell.key_pressed(Key::G, Modifiers::NONE));
        assert!(shell.panel_prefs().graphs);
        assert_eq!(shell.panel_prefs().graph_series, GraphSeries::default());

        for expected in GraphSeries::ALL.into_iter().skip(1) {
            assert!(shell.key_pressed(Key::G, Modifiers::NONE));
            assert_eq!(shell.panel_prefs().graph_series, expected);
            assert!(shell.panel_prefs().graphs);
        }
        assert!(shell.key_pressed(Key::G, Modifiers::NONE));
        assert!(!shell.panel_prefs().graphs);
    }

    #[test]
    fn the_graphs_chord_walks_the_series_backwards_and_then_closes_the_panel() {
        let mut shell = spectating_shell();
        let shift = Modifiers {
            shift: true,
            ..Modifiers::NONE
        };
        shell.set_panel_prefs(PanelPrefs {
            graphs: false,
            graph_series: GraphSeries::Income,
            ..PanelPrefs::default()
        });

        // Backwards from a hidden panel opens it on the last measurement, which is where walking
        // forwards would have closed it.
        assert!(shell.key_pressed(Key::G, shift));
        assert!(shell.panel_prefs().graphs);
        assert_eq!(
            shell.panel_prefs().graph_series,
            *GraphSeries::ALL.last().unwrap()
        );

        for expected in GraphSeries::ALL.into_iter().rev().skip(1) {
            assert!(shell.key_pressed(Key::G, shift));
            assert_eq!(shell.panel_prefs().graph_series, expected);
            assert!(shell.panel_prefs().graphs);
        }
        assert!(shell.key_pressed(Key::G, shift));
        assert!(!shell.panel_prefs().graphs);
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
                action_panel(panel.action()),
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
    fn normal_play_consumes_no_hotkey() {
        let mut shell = Shell::new();
        shell.set_host(&HostFrame {
            mode: Mode::Playing,
            game_started: true,
            native_textbox_open: false,
            native_dialog_open: false,
            native_menu_open: false,
            game_seconds: 0,
            minimap_rect: None,
        });
        assert!(!shell.key_pressed(Key::A, Modifiers::NONE));
        assert_eq!(*shell.panel_prefs(), PanelPrefs::default());
    }

    #[test]
    fn an_open_chat_box_or_game_dialog_keeps_every_hotkey() {
        for host in [
            HostFrame {
                mode: Mode::Replay,
                game_started: true,
                native_textbox_open: true,
                native_dialog_open: false,
                native_menu_open: false,
                game_seconds: 0,
                minimap_rect: None,
            },
            HostFrame {
                mode: Mode::Replay,
                game_started: true,
                native_textbox_open: false,
                native_dialog_open: true,
                native_menu_open: false,
                game_seconds: 0,
                minimap_rect: None,
            },
            HostFrame {
                mode: Mode::Replay,
                game_started: false,
                native_textbox_open: false,
                native_dialog_open: false,
                native_menu_open: false,
                game_seconds: 0,
                minimap_rect: None,
            },
        ] {
            let mut shell = Shell::new();
            shell.set_host(&host);
            assert!(!shell.key_pressed(Key::W, Modifiers::NONE), "{host:?}");
            assert!(shell.panel_prefs().selection);
        }
    }

    #[test]
    fn a_notice_that_takes_no_input_takes_no_hotkeys_either() {
        let mut shell = spectating_shell();
        let disconnect = view(SelfState::Healthy);
        shell.sync_status_modals(Some(&DisconnectSurface {
            view: &disconnect,
            blocks_input: false,
        }));
        assert!(shell.key_pressed(Key::W, Modifiers::NONE));
        assert!(!shell.panel_prefs().selection);
    }

    #[test]
    fn the_pause_key_flips_only_the_pause_of_the_speed_command() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let view = replay();
        run_frame(&mut shell, &ctx, Some(&view));
        assert!(shell.key_pressed(Key::P, Modifiers::NONE));
        assert_eq!(
            run_frame(&mut shell, &ctx, Some(&view)),
            [Intent::SetSpeed {
                speed_index: view.speed_index,
                multiplier: view.multiplier,
                paused: true,
            }]
        );
    }

    #[test]
    fn the_speed_keys_walk_the_ladder_and_leave_playback_stopped_if_it_was() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let view = TransportView {
            paused: true,
            ..replay()
        };
        run_frame(&mut shell, &ctx, Some(&view));
        assert!(shell.key_pressed(Key::U, Modifiers::NONE));
        assert!(shell.key_pressed(Key::D, Modifiers::NONE));
        assert_eq!(
            run_frame(&mut shell, &ctx, Some(&view)),
            [
                Intent::SetSpeed {
                    speed_index: 6,
                    multiplier: 2,
                    paused: true,
                },
                // Half speed is the classic "fast" rung (83 ms frames against the fastest 42 ms),
                // not a fractional multiplier.
                Intent::SetSpeed {
                    speed_index: 2,
                    multiplier: 1,
                    paused: true,
                },
            ]
        );
    }

    #[test]
    fn seek_keys_add_up_into_one_jump_and_shift_lengthens_the_step() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let view = replay();
        run_frame(&mut shell, &ctx, Some(&view));
        let shift = Modifiers {
            shift: true,
            ..Modifiers::NONE
        };
        assert!(shell.key_pressed(Key::Period, Modifiers::NONE));
        assert!(shell.key_pressed(Key::Period, shift));
        // Ten seconds and then a minute, counted from where playback is: one seek, not two.
        let expected = view
            .seek_target(crate::transport::SEEK_STEP_SECS + crate::transport::SEEK_STEP_LONG_SECS);
        assert_eq!(
            run_frame(&mut shell, &ctx, Some(&view)),
            [Intent::Seek(expected)]
        );
    }

    #[test]
    fn a_seek_waits_while_the_game_is_still_working_through_the_last_one() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let pending = TransportView {
            seek_pending: true,
            ..replay()
        };
        run_frame(&mut shell, &ctx, Some(&pending));
        assert!(shell.key_pressed(Key::Comma, Modifiers::NONE));
        assert!(run_frame(&mut shell, &ctx, Some(&pending)).is_empty());
        // Still queued, so it goes out as soon as the game is ready rather than being lost.
        let ready = replay();
        assert_eq!(
            run_frame(&mut shell, &ctx, Some(&ready)),
            [Intent::Seek(
                ready.seek_target(-crate::transport::SEEK_STEP_SECS)
            )]
        );
    }

    #[test]
    fn only_a_replay_makes_the_reporting_panels_ways_back_into_the_game() {
        let mut shell = spectating_shell();
        assert_eq!(shell.seekable_replay(), None);
        shell.transport = Some(replay());
        assert_eq!(shell.seekable_replay(), Some(replay()));
        // A live game being watched has no playback to move, whatever a host hands over.
        shell.host.mode = Mode::Observing;
        assert_eq!(shell.seekable_replay(), None);
    }

    #[test]
    fn transport_keys_are_the_games_until_a_replay_is_being_watched() {
        let mut shell = spectating_shell();
        for key in [Key::P, Key::U, Key::D, Key::Comma, Key::Period] {
            assert!(
                !shell.key_pressed(key, Modifiers::NONE),
                "{key:?} was consumed with no replay to act on"
            );
        }
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
            minimap_rect: None,
        });
        assert!(!observing.key_pressed(Key::L, Modifiers::NONE));
        assert!(!observing.panel_prefs().spoiler_free);
    }

    #[test]
    fn the_games_own_plate_is_left_alone_until_ours_is_actually_on_screen() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let view = replay();
        assert!(run_frame_at(&mut shell, &ctx, Some(&view), 0.0).transport_shown);

        // A plate the player has hidden keeps the corner until its exit has finished playing.
        assert!(shell.key_pressed(Key::Y, Modifiers::NONE));
        assert!(run_frame_at(&mut shell, &ctx, Some(&view), 0.05).transport_shown);
        assert!(!run_frame_at(&mut shell, &ctx, Some(&view), 0.5).transport_shown);

        // And there is nothing to stand in for outside a replay.
        let mut elsewhere = spectating_shell();
        let ctx = fresh_ctx();
        assert!(!run_frame_at(&mut elsewhere, &ctx, None, 0.0).transport_shown);
    }

    #[test]
    fn escape_closes_the_vision_list_and_nothing_else() {
        let mut shell = spectating_shell();
        shell.set_vision_picker_open(true);
        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert!(!shell.vision_picker_open());
        assert!(shell.panel_prefs().minimap);
        // With the list closed the key is the game's again.
        assert!(!shell.key_pressed(Key::Escape, Modifiers::NONE));
    }

    #[test]
    fn q_answers_the_leave_question_scrs_quit_keys_open() {
        let mut shell = spectating_shell();
        let alt = Modifiers {
            alt: true,
            ..Modifiers::NONE
        };
        assert!(shell.key_pressed(Key::Q, alt));
        assert_eq!(shell.top_modal(), Some(ModalId::LeaveGame));
        assert!(shell.key_pressed(Key::Q, Modifiers::NONE));
        assert!(shell.pending_intents().contains(&Intent::QuitGame));
    }

    #[test]
    fn the_menu_answers_to_scrs_keys_for_its_buttons() {
        let mut shell = spectating_shell();
        shell.open_modal(ModalId::GameMenu);
        assert!(shell.key_pressed(Key::O, Modifiers::NONE));
        assert_eq!(shell.top_modal(), Some(ModalId::Options));
        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), Some(ModalId::GameMenu));
        // A watcher has no alliances to set, so the key is not the menu's.
        assert!(!shell.key_pressed(Key::A, Modifiers::NONE));
        // A replay is left with a tap, watched alone as it is.
        assert!(shell.key_pressed(Key::E, Modifiers::NONE));
        assert!(shell.pending_intents().contains(&Intent::QuitGame));
    }

    #[test]
    fn a_players_menu_key_holds_leave_rather_than_asking() {
        let mut shell = Shell::new();
        shell.set_host(&HostFrame {
            mode: Mode::Playing,
            game_started: true,
            native_textbox_open: false,
            native_dialog_open: false,
            native_menu_open: false,
            game_seconds: 0,
            minimap_rect: None,
        });
        shell.open_modal(ModalId::GameMenu);
        assert!(shell.key_pressed(Key::E, Modifiers::NONE));
        assert_eq!(shell.top_modal(), Some(ModalId::GameMenu));
        assert_eq!(shell.held_button_key, Some((ModalId::GameMenu, Key::E)));
        // Held for as long as the key is down, and not a frame longer.
        shell.update_held_keys(|_| true);
        assert_eq!(shell.held_button_key, Some((ModalId::GameMenu, Key::E)));
        shell.update_held_keys(|_| false);
        assert_eq!(shell.held_button_key, None);
        assert!(!shell.pending_intents().contains(&Intent::QuitGame));
    }

    /// Puts one of the disconnect surface's modals on top, the way a frame's status sync does.
    fn raise_status_modal(shell: &mut Shell, id: ModalId) {
        shell.modals.push(Modal {
            id,
            captures_input: true,
        });
    }

    #[test]
    fn the_dialogs_answer_to_scrs_keys_for_their_buttons() {
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::ChatHistory);
        assert!(shell.key_pressed(Key::O, Modifiers::NONE));
        assert_eq!(shell.top_modal(), None);
        assert_eq!(
            shell.pending_intents(),
            [Intent::CloseNativeDialog(NativeDialog::ChatHistory)]
        );

        shell.open_modal(ModalId::Options);
        for section in OptionsSection::ALL {
            assert!(shell.key_pressed(section.key(), Modifiers::NONE));
            assert_eq!(shell.options_section(), section);
        }
        // A key no page is on is left to whatever has the keyboard, which may be a slider.
        assert!(!shell.key_pressed(Key::ArrowLeft, Modifiers::NONE));
        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), None);

        let mut ended = spectating_shell();
        raise_status_modal(&mut ended, ModalId::SessionEnded);
        assert!(ended.key_pressed(Key::O, Modifiers::NONE));
        assert!(ended.pending_intents().contains(&Intent::LeaveGame));
    }

    #[test]
    fn abandoning_by_key_takes_a_hold() {
        let mut shell = spectating_shell();
        raise_status_modal(&mut shell, ModalId::ConnectionInterrupted);
        assert!(shell.key_pressed(Key::E, Modifiers::NONE));
        assert_eq!(
            shell.held_button_key,
            Some((ModalId::ConnectionInterrupted, Key::E))
        );
        assert!(!shell.pending_intents().contains(&Intent::AbandonGame));
        shell.update_held_keys(|_| false);
        assert_eq!(shell.held_button_key, None);
    }

    #[test]
    fn an_end_card_takes_its_keys_once_it_has_landed() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::Victory);
        run_frame_at(&mut shell, &ctx, None, 0.0);
        // Pressed while the card is still arriving: the key is the card's, but chooses nothing.
        assert!(shell.key_pressed(Key::E, Modifiers::NONE));
        let arriving = run_frame_at(&mut shell, &ctx, None, 0.05).intents;
        assert!(!arriving.contains(&Intent::EndMission(NativeDialog::Victory)));
        assert_eq!(shell.top_modal(), Some(ModalId::Victory));
        run_frame_at(&mut shell, &ctx, None, 1.0);
        assert!(shell.key_pressed(Key::E, Modifiers::NONE));
        let landed = run_frame_at(&mut shell, &ctx, None, 1.05).intents;
        assert!(landed.contains(&Intent::EndMission(NativeDialog::Victory)));
        assert_eq!(shell.top_modal(), None);

        // The defeat card has no carrying on, and leaves on the same key.
        let mut lost = spectating_shell();
        lost.native_dialog_spawned(NativeDialog::Defeat);
        run_frame_at(&mut lost, &ctx, None, 2.0);
        run_frame_at(&mut lost, &ctx, None, 3.0);
        assert!(!lost.key_pressed(Key::B, Modifiers::NONE));
        assert!(lost.key_pressed(Key::E, Modifiers::NONE));
        let left = run_frame_at(&mut lost, &ctx, None, 3.05).intents;
        assert!(left.contains(&Intent::EndMission(NativeDialog::Defeat)));
        assert_eq!(lost.top_modal(), None);
    }

    #[test]
    fn number_keys_are_the_shown_players_even_where_they_have_no_group() {
        let mut shell = spectating_shell();
        // Nobody's keys are shown: the game recalls the watcher's own groups.
        assert!(!shell.key_pressed(Key::Num1, Modifiers::NONE));
        shell.number_keys = Some((3, 1 << 1));
        assert!(shell.key_pressed(Key::Num1, Modifiers::NONE));
        assert!(
            shell
                .pending_intents()
                .contains(&Intent::SelectControlGroup {
                    player_id: 3,
                    key: 1,
                })
        );
        // Taken but empty, rather than left to recall somebody else's group on the same digit.
        assert!(shell.key_pressed(Key::Num6, Modifiers::NONE));
        assert!(
            !shell
                .pending_intents()
                .contains(&Intent::SelectControlGroup {
                    player_id: 3,
                    key: 6,
                })
        );
    }

    #[test]
    fn a_modal_owns_the_keyboard_ahead_of_the_hotkeys() {
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::ChatHistory);
        assert!(!shell.key_pressed(Key::W, Modifiers::NONE));
        assert!(shell.panel_prefs().selection);
    }
}
