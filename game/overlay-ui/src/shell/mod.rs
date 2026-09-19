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
use crate::game_menu::render_game_menu;
use crate::netstat::{NetStatsView, render_netstat_view};
use crate::observer::{self, GraphSeries, ObserverView};
use crate::transport::{self, SpeedStep, TransportView, render_transport_view};

pub use hotkeys::{Action, Chord, Hotkeys};
pub use native_dialogs::{NativeDialog, RETURN_CONTROL_ID, replacement_for};

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
    /// BW's own bottom console.
    Console,
    /// BW's own minimap.
    Minimap,
    /// The replay transport plate.
    Transport,
    /// The observer dock, from which every other panel here is reached without a key.
    Dock,
}

impl Panel {
    /// Every panel, in the order the dock lists them: the surfaces that report on the game, from
    /// the top of the screen down, then the game's own surfaces, then the controls.
    pub const ALL: [Panel; 13] = [
        Panel::Matchup,
        Panel::MapControl,
        Panel::Economy,
        Panel::Military,
        Panel::Graphs,
        Panel::Timeline,
        Panel::Production,
        Panel::ControlGroups,
        Panel::Selection,
        Panel::Console,
        Panel::Minimap,
        Panel::Transport,
        Panel::Dock,
    ];

    /// The action that toggles this panel, which is also where its keycap comes from.
    pub fn action(self) -> Action {
        match self {
            Panel::Matchup => Action::ToggleSidePanel,
            Panel::MapControl => Action::ToggleMapControl,
            Panel::Economy => Action::ToggleEconomy,
            Panel::Military => Action::ToggleMilitary,
            Panel::Graphs => Action::ToggleGraphs,
            Panel::Timeline => Action::ToggleTimeline,
            Panel::Production => Action::ToggleProduction,
            Panel::ControlGroups => Action::ToggleControlGroups,
            Panel::Selection => Action::ToggleSelection,
            Panel::Console => Action::ToggleConsole,
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
            Panel::Console => "console",
            Panel::Minimap => "minimap",
            Panel::Transport => "transport",
            Panel::Dock => "dock",
        }
    }
}

/// What the player wants of the overlay: which ambient panels are on screen, and whether it keeps
/// a replay's outcome to itself.
///
/// Independent booleans rather than named sets of them: the console and the minimap in particular
/// are separate surfaces in the game, and observers routinely keep one without the other.
/// Serializable so a host can persist the set per profile.
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
    pub console: bool,
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
}

impl Default for PanelPrefs {
    fn default() -> PanelPrefs {
        PanelPrefs {
            matchup: true,
            map_control: true,
            economy: true,
            military: true,
            graphs: true,
            timeline: true,
            production: true,
            control_groups: true,
            selection: true,
            console: true,
            minimap: true,
            transport: true,
            dock: true,
            dock_expanded: false,
            spoiler_free: false,
            graph_series: GraphSeries::ArmyValue,
            graph_per_player: false,
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
            Panel::Console => self.console,
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
            Panel::Console => self.console = shown,
            Panel::Minimap => self.minimap = shown,
            Panel::Transport => self.transport = shown,
            Panel::Dock => self.dock = shown,
        }
    }

    pub fn toggle(&mut self, panel: Panel) {
        self.set(panel, !self.shown(panel));
    }

    /// Whether every panel is on screen.
    pub fn all_shown(&self) -> bool {
        Panel::ALL.into_iter().all(|panel| self.shown(panel))
    }

    pub fn set_all(&mut self, shown: bool) {
        for panel in Panel::ALL {
            self.set(panel, shown);
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
    /// The in-game menu, standing in for SC:R's own.
    GameMenu,
    /// The chat log, standing in for SC:R's own.
    ChatHistory,
}

impl ModalId {
    /// Whether the player can close this modal themselves, with `Esc` or a click on the scrim.
    ///
    /// A modal the game's own state raises is not dismissible: it is up exactly while its condition
    /// holds, and closing it would only make it reappear on the next frame.
    pub fn is_dismissible(self) -> bool {
        match self {
            ModalId::WaitingForPlayers | ModalId::ConnectionInterrupted => false,
            ModalId::GameMenu | ModalId::ChatHistory => true,
        }
    }

    /// Whether this modal is raised and lowered by the game's own state rather than by the player.
    fn is_status_driven(self) -> bool {
        matches!(
            self,
            ModalId::WaitingForPlayers | ModalId::ConnectionInterrupted
        )
    }

    /// The native dialog this modal stands in for, which the host must dismiss along with it.
    pub fn native_dialog(self) -> Option<NativeDialog> {
        match self {
            ModalId::WaitingForPlayers | ModalId::ConnectionInterrupted => None,
            ModalId::GameMenu => Some(NativeDialog::GameMenu),
            ModalId::ChatHistory => Some(NativeDialog::ChatHistory),
        }
    }

    /// A short name for this modal in a knob panel or a log line.
    pub fn label(self) -> &'static str {
        match self {
            ModalId::WaitingForPlayers => "waiting for players",
            ModalId::ConnectionInterrupted => "connection interrupted",
            ModalId::GameMenu => "game menu",
            ModalId::ChatHistory => "chat history",
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
        }
    }
}

/// What a frame wants the host to do to the game.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Intent {
    /// Dismiss a replaced native dialog through its own return control
    /// ([`RETURN_CONTROL_ID`](native_dialogs::RETURN_CONTROL_ID)), because the surface standing in
    /// for it has been closed.
    CloseNativeDialog(NativeDialog),
    /// Request that the player in this rally-point2 slot be dropped from the session.
    DropPlayer { slot: u8 },
    /// Give up on a connection that will not come back and leave the game.
    AbandonGame,
    /// Show or stop showing the game through this player's eyes. What that means for their allies
    /// is the host's to decide: vision is shared, and taking half of a shared pair would leave a
    /// watcher looking at a map neither player sees.
    ToggleVision { player_id: u8 },
    /// Select whatever is making this entry of a player's production row, and on a repeated ask,
    /// move on to the next one of them.
    SelectProduction { player_id: u8, item: u32 },
    /// Move replay playback to this frame.
    Seek(u32),
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
    /// A capturing modal takes everything. The one exception is BW's chat entry box: while it is
    /// open the player is typing, and every key belongs to that box — backspace, the arrow keys and
    /// Escape to close it included — so the keyboard passes straight through however modal the
    /// screen is.
    pub fn resolve(modal_captures: bool, native_textbox_open: bool) -> InputCapture {
        InputCapture {
            pointer: if modal_captures {
                PointerCapture::All
            } else {
                PointerCapture::HitRects
            },
            keyboard: if modal_captures && !native_textbox_open {
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
    /// Return is let through even under a full capture: SC:R opens its chat box from the Enter
    /// character rather than from this virtual key, so the keypress carries no unit command and
    /// swallowing it would only cost the player their way into the chat box.
    pub fn blocks_game_key(self, key: Option<Key>) -> bool {
        match self.keyboard {
            KeyboardCapture::Selective => false,
            KeyboardCapture::All => key != Some(Key::Enter),
        }
    }
}

/// What the host knows about the game this frame.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct HostFrame {
    pub mode: Mode,
    /// Whether the game proper is running, as opposed to still loading.
    pub game_started: bool,
    /// Whether BW's own chat entry box is open for text input.
    pub native_textbox_open: bool,
    /// Whether one of BW's own dialogs — a menu, a popup — is on top of the game. While one is, the
    /// keyboard is its, so the shell claims no hotkeys.
    pub native_dialog_open: bool,
    /// How far into the game the simulation has got, in whole seconds. Read by the surfaces that
    /// report on the game as a whole rather than on one player, which is the menu and nothing else
    /// while a client is playing its own game.
    pub game_seconds: u64,
}

/// The disconnect surface the host wants drawn.
pub struct DisconnectSurface<'a> {
    pub view: &'a DisconnectView,
    /// Whether this is a real connection problem — our own link down, or a relay-confirmed peer
    /// drop — which stops the simulation and therefore takes every input. A brief stall never does:
    /// a passing jitter blip must not lock a player out of their own game.
    pub blocks_input: bool,
}

/// The screens the host wants the shell to draw this frame, each built from data only the host has.
#[derive(Default)]
pub struct Views<'a> {
    pub disconnect: Option<DisconnectSurface<'a>>,
    pub net_stats: Option<&'a NetStatsView>,
    /// The chat log, which a host only builds while [`ModalId::ChatHistory`] is on the stack — it
    /// is a copy of every line said this game, and nothing but that modal reads it.
    pub chat_history: Option<&'a ChatHistoryView>,
    /// Replay playback, which a host builds for every frame of a replay whether or not the plate is
    /// on screen: the transport keys keep working with it hidden, and only the shell knows whether
    /// the player has hidden it.
    pub transport: Option<&'a TransportView>,
    /// The observer panels, which a host builds for every frame it is watching a game rather than
    /// playing one — again whether or not any of them is on screen, since the keys that show them
    /// arrive between frames.
    pub observer: Option<&'a ObserverView>,
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
    /// The frame a seek has been asked for and not yet sent, which is the latest one asked for: a
    /// drag across the track is one seek to where the pointer ended up, not one per frame of it.
    pending_seek: Option<u32>,
    /// When the last seek went out, on the context's own clock.
    last_seek_secs: f64,
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
            pending_seek: None,
            last_seek_secs: f64::NEG_INFINITY,
            intents: Vec::new(),
        }
    }

    pub fn panel_prefs(&self) -> &PanelPrefs {
        &self.prefs
    }

    pub fn set_panel_prefs(&mut self, prefs: PanelPrefs) {
        self.prefs = prefs;
    }

    pub fn hotkeys(&self) -> &Hotkeys {
        &self.hotkeys
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
        InputCapture::resolve(self.modal_captures(), self.host.native_textbox_open)
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
        if key == Key::Escape {
            if self.top_modal().is_some_and(ModalId::is_dismissible) {
                self.dismiss_top_modal();
                return true;
            }
            return false;
        }
        if !self.hotkeys_active() {
            return false;
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

        let mut hit_rects = Vec::new();
        // The ambient layer is drawn before the modal layer so the scrim covers it. The diagnostic
        // network-stats panel is not gated on the mode: nothing puts it on screen but the chat
        // command that asks for it, and a player triaging lag needs it while they are playing.
        if let Some(net_stats) = views.net_stats {
            render_netstat_view(net_stats, ctx);
        }
        // The observer panels belong to the modes they report on: a host that kept feeding them
        // after the client stopped watching must not be able to put them over someone's own game.
        if self.host.mode.is_spectating()
            && let Some(view) = views.observer
        {
            self.frame_observer(ctx, view, &mut hit_rects);
        }
        let transport_shown = match views.transport {
            Some(view) => self.frame_transport(ctx, view, &mut hit_rects),
            None => false,
        };

        if let Some(modal) = self.modals.last().copied() {
            let outcome = draw_modal(ctx, modal.id, views, self.host.game_seconds, &mut hit_rects);
            for slot in outcome.drop_requests {
                self.intents.push(Intent::DropPlayer { slot });
            }
            if outcome.abandoned {
                self.intents.push(Intent::AbandonGame);
            }
            if outcome.dismissed && modal.id.is_dismissible() {
                self.dismiss_top_modal();
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
    fn frame_observer(&mut self, ctx: &Context, view: &ObserverView, hit_rects: &mut Vec<HitRect>) {
        self.map_control_available = view.map_control.is_some();
        if let Some(outcome) = observer::render_matchup_view(&view.matchup, ctx, self.prefs.matchup)
        {
            hit_rects.push(HitRect::new(outcome.rect));
            if let Some(player_id) = outcome.toggled_vision {
                self.intents.push(Intent::ToggleVision { player_id });
            }
        }
        // The corner cards and the wings under them are one stack: a card is as tall as the side it
        // carries, so where the wings start is measured off what the cards actually came out as
        // rather than guessed at from a player count.
        let mut tops = observer::WingTops::under_bar(view.matchup.form().height());
        if let Some(cards) = &view.team_cards {
            let outcome = observer::render_team_cards_view(cards, ctx, self.prefs.matchup);
            for rect in outcome.rects {
                hit_rects.push(HitRect::new(rect));
            }
            if let Some(bottom) = outcome.left_bottom {
                tops.left = tops.left.max(bottom + observer::WING_GAP);
            }
            if let Some(bottom) = outcome.right_bottom {
                tops.right = tops.right.max(bottom + observer::WING_GAP);
            }
        }
        // The reporting panels take no clicks of their own, but every one of them is an opaque
        // surface: a click that landed on a number and went on to select whatever unit was behind
        // it would make the panels unusable exactly where they are most worth reading.
        if let Some(map_control) = &view.map_control
            && let Some(rect) = observer::render_map_control_view(
                map_control,
                ctx,
                self.prefs.map_control,
                view.matchup.form().height() + observer::MAP_CONTROL_GAP,
            )
        {
            hit_rects.push(HitRect::new(rect));
        }
        let economy =
            observer::render_economy_view(&view.economy, ctx, self.prefs.economy, tops.left);
        if let Some(rect) = economy {
            hit_rects.push(HitRect::new(rect));
        }
        let military =
            observer::render_military_view(&view.military, ctx, self.prefs.military, tops.right);
        if let Some(rect) = military {
            hit_rects.push(HitRect::new(rect));
        }
        if let Some(outcome) = observer::render_graphs_view(
            &view.graphs,
            ctx,
            self.prefs.graphs,
            observer::WingTops::below(
                ctx,
                egui::Id::new("sb_stack_military"),
                tops.right,
                military,
            ),
        ) {
            hit_rects.push(HitRect::new(outcome.rect));
            if let Some(series) = outcome.series {
                self.prefs.graph_series = series;
            }
            if let Some(per_player) = outcome.per_player {
                self.prefs.graph_per_player = per_player;
            }
        }
        if let Some(rect) = observer::render_timeline_view(
            &view.timeline,
            ctx,
            self.prefs.timeline,
            observer::WingTops::below(ctx, egui::Id::new("sb_stack_economy"), tops.left, economy),
            observer::minimap_reserve_top(ctx.viewport_rect()) - observer::WING_GAP,
        ) {
            hit_rects.push(HitRect::new(rect));
        }
        // The three centred strips are one stack too, drawn bottom first: each is as tall as the
        // game it reports on — a production panel with a row per player of an eight-player game is
        // three times the height the design drew it at — so every one of them is placed over
        // whatever the one under it actually came out as, and drops onto the one below when a panel
        // between them is hidden.
        //
        // The stack stands on the screen's own bottom edge: an observer's screen keeps the minimap
        // and nothing else of the game's console band. At every 16:9 resolution the overlay is 1920
        // points wide, so the widest of the three — control groups at 790 — leaves its left edge at
        // 565, well clear of the 348-point square BW's minimap owns in that corner. A 4:3 screen is
        // 1440 points wide and that edge falls at 325, which is inside the minimap's column: on
        // those screens the bottom of the stack overlaps the minimap's top-right corner.
        let base = observer::WING_MARGIN;
        let selection =
            observer::render_selection_view(&view.selection, ctx, self.prefs.selection, base);
        if let Some(rect) = selection {
            hit_rects.push(HitRect::new(rect));
        }
        let over_selection =
            base + observer::eased_stack_share(ctx, egui::Id::new("sb_stack_selection"), selection);
        let production = observer::render_production_view(
            &view.production,
            ctx,
            self.prefs.production,
            over_selection,
        );
        if let Some(outcome) = &production {
            hit_rects.push(HitRect::new(outcome.rect));
            if let Some((player_id, item)) = outcome.clicked {
                self.intents.push(Intent::SelectProduction {
                    player_id,
                    item: item as u32,
                });
            }
        }
        // The row shown is the selected unit's owner, and stays theirs after the selection is
        // cleared: a watcher who clicks the ground has not asked to see somebody else's keys.
        if let Some(owner) = view.selection.units.first().and_then(|unit| unit.owner) {
            self.focused_player = Some(owner);
        }
        if let Some(rect) = observer::render_control_groups_view(
            &view.control_groups,
            ctx,
            self.prefs.control_groups,
            over_selection
                + observer::eased_stack_share(
                    ctx,
                    egui::Id::new("sb_stack_production"),
                    production.as_ref().map(|outcome| outcome.rect),
                ),
            self.focused_player,
        ) {
            hit_rects.push(HitRect::new(rect));
        }
        let dock = observer::render_obs_dock(
            &self.prefs,
            &self.hotkeys,
            self.host.mode,
            self.map_control_available,
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

    /// Draws the replay transport and turns what the player did with it into intents, returning
    /// whether the plate is on screen.
    fn frame_transport(
        &mut self,
        ctx: &Context,
        view: &TransportView,
        hit_rects: &mut Vec<HitRect>,
    ) -> bool {
        let outcome = render_transport_view(view, ctx, self.prefs.shown(Panel::Transport));
        if let Some(outcome) = &outcome {
            hit_rects.push(HitRect::new(outcome.rect));
            if let Some(frame) = outcome.seek_to {
                self.queue_seek(frame);
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

    /// Queues a jump to `frame`, replacing whatever was queued before it.
    fn queue_seek(&mut self, frame: u32) {
        self.pending_seek = Some(frame);
    }

    /// Lets the queued seek out once the game is ready for one.
    ///
    /// Held back while the game is still working through the last one: a second seek sent then is
    /// refused outright, and a refusal that swallowed the player's final drag position would leave
    /// the playhead somewhere they never asked for.
    fn send_queued_seek(&mut self, ctx: &Context, view: &TransportView) {
        let Some(frame) = self.pending_seek else {
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
                let from = self.pending_seek.unwrap_or(view.elapsed_frames);
                let delta = transport::seconds_to_frames(i64::from(step), view.game_speed);
                let frame = view.frame_at(i64::from(from) + delta);
                self.queue_seek(frame);
            }
            _ => return false,
        }
        true
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
                let show = !self.prefs.all_shown();
                self.prefs.set_all(show);
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
    /// Whether the player gave up on their own connection.
    abandoned: bool,
}

fn draw_modal(
    ctx: &Context,
    id: ModalId,
    views: &mut Views<'_>,
    game_seconds: u64,
    hit_rects: &mut Vec<HitRect>,
) -> ModalOutcome {
    match id {
        ModalId::WaitingForPlayers | ModalId::ConnectionInterrupted => {
            let Some(surface) = views.disconnect.as_ref() else {
                return ModalOutcome::default();
            };
            let dialog = render_disconnect_view(surface.view, ctx);
            // The surface only takes clicks once it has a control to take them for: a passive
            // notice must not cost the game a click.
            if surface.view.has_button() || id == ModalId::ConnectionInterrupted {
                hit_rects.push(HitRect::new(dialog.response.rect));
            }
            ModalOutcome {
                dismissed: false,
                drop_requests: dialog.inner.drop_requests,
                abandoned: dialog.inner.abandoned,
            }
        }
        ModalId::GameMenu => {
            let dialog = render_game_menu(ctx, game_seconds);
            hit_rects.push(HitRect::new(dialog.response.rect));
            ModalOutcome {
                dismissed: dialog.inner.return_to_game || dialog.scrim_clicked,
                drop_requests: Vec::new(),
                abandoned: false,
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
                drop_requests: Vec::new(),
                abandoned: false,
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
            game_seconds: 0,
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
            game_seconds: 0,
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
        let capture = InputCapture::resolve(false, false);
        assert_eq!(capture, InputCapture::PASS_THROUGH);
        assert!(!capture.blocks_game_pointer());
        assert!(!capture.blocks_game_key(Some(Key::A)));
    }

    #[test]
    fn a_capturing_modal_takes_the_pointer_and_the_keyboard() {
        let capture = InputCapture::resolve(true, false);
        assert!(capture.blocks_game_pointer());
        assert!(capture.blocks_game_key(Some(Key::A)));
        assert!(capture.blocks_game_key(None));
    }

    #[test]
    fn return_survives_a_full_capture() {
        let capture = InputCapture::resolve(true, false);
        assert!(!capture.blocks_game_key(Some(Key::Enter)));
    }

    #[test]
    fn an_open_chat_box_keeps_the_keyboard_but_not_the_pointer() {
        let capture = InputCapture::resolve(true, true);
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

    #[test]
    fn panel_hotkeys_toggle_their_panel_while_spectating() {
        let mut shell = spectating_shell();
        assert!(shell.key_pressed(Key::W, Modifiers::NONE));
        assert!(!shell.panel_prefs().console);
        assert!(shell.key_pressed(Key::Q, Modifiers::NONE));
        assert!(!shell.panel_prefs().minimap);
        assert!(shell.key_pressed(Key::R, Modifiers::NONE));
        assert!(!shell.panel_prefs().matchup);
        assert!(shell.key_pressed(Key::F, Modifiers::NONE));
        assert!(!shell.panel_prefs().production);
    }

    #[test]
    fn the_console_and_the_minimap_move_independently() {
        let mut shell = spectating_shell();
        assert!(shell.key_pressed(Key::W, Modifiers::NONE));
        assert!(!shell.panel_prefs().console);
        assert!(shell.panel_prefs().minimap);
    }

    #[test]
    fn all_panels_hides_everything_then_shows_everything() {
        let mut shell = spectating_shell();
        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert!(!shell.panel_prefs().all_shown());
        assert!(!shell.panel_prefs().console);
        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert!(shell.panel_prefs().all_shown());

        // With one panel already hidden, the key restores the set rather than hiding the rest.
        shell.key_pressed(Key::W, Modifiers::NONE);
        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert!(shell.panel_prefs().all_shown());
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
        assert!(shell.key_pressed(Key::N, Modifiers::NONE));
        assert!(!shell.panel_prefs().map_control);
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
            (Key::E, |prefs| prefs.economy),
            (Key::M, |prefs| prefs.military),
            (Key::T, |prefs| prefs.timeline),
        ];
        for (key, is_shown) in wings {
            assert!(is_shown(shell.panel_prefs()));
            assert!(shell.key_pressed(key, Modifiers::NONE));
            assert!(!is_shown(shell.panel_prefs()), "{key:?} moved nothing");
        }
    }

    #[test]
    fn the_centred_bottom_panels_answer_their_own_keys() {
        let mut shell = spectating_shell();
        type IsShown = fn(&PanelPrefs) -> bool;
        let stack: [(Key, IsShown); 3] = [
            (Key::F, |prefs| prefs.production),
            (Key::H, |prefs| prefs.control_groups),
            (Key::S, |prefs| prefs.selection),
        ];
        for (key, is_shown) in stack {
            assert!(is_shown(shell.panel_prefs()));
            assert!(shell.key_pressed(key, Modifiers::NONE));
            assert!(!is_shown(shell.panel_prefs()), "{key:?} moved nothing");
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
            game_seconds: 0,
        });
        assert!(!shell.key_pressed(Key::A, Modifiers::NONE));
        assert!(shell.panel_prefs().all_shown());
    }

    #[test]
    fn an_open_chat_box_or_game_dialog_keeps_every_hotkey() {
        for host in [
            HostFrame {
                mode: Mode::Replay,
                game_started: true,
                native_textbox_open: true,
                native_dialog_open: false,
                game_seconds: 0,
            },
            HostFrame {
                mode: Mode::Replay,
                game_started: true,
                native_textbox_open: false,
                native_dialog_open: true,
                game_seconds: 0,
            },
            HostFrame {
                mode: Mode::Replay,
                game_started: false,
                native_textbox_open: false,
                native_dialog_open: false,
                game_seconds: 0,
            },
        ] {
            let mut shell = Shell::new();
            shell.set_host(&host);
            assert!(!shell.key_pressed(Key::W, Modifiers::NONE), "{host:?}");
            assert!(shell.panel_prefs().console);
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
        assert!(!shell.panel_prefs().console);
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
        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert!(shell.panel_prefs().spoiler_free);
        assert!(!shell.panel_prefs().transport);

        let mut observing = Shell::new();
        observing.set_host(&HostFrame {
            mode: Mode::Observing,
            game_started: true,
            native_textbox_open: false,
            native_dialog_open: false,
            game_seconds: 0,
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
    fn a_modal_owns_the_keyboard_ahead_of_the_hotkeys() {
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::ChatHistory);
        assert!(!shell.key_pressed(Key::W, Modifiers::NONE));
        assert!(shell.panel_prefs().console);
    }
}
