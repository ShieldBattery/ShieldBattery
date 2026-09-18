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

use egui::{Context, Id, Key, Modifiers, Rect};
use serde::{Deserialize, Serialize};

use crate::disconnect::{DisconnectView, SelfState, render_disconnect_view};
use crate::kit::widgets::{self, ButtonVariant};
use crate::kit::{theme, tiers};
use crate::netstat::{NetStatsView, render_netstat_view};
use crate::tr;

pub use hotkeys::{Action, Chord, Hotkeys};
pub use native_dialogs::{NativeDialog, RETURN_CONTROL_ID, replacement_for};

/// How wide the shell's own modals are, in overlay points.
const MODAL_WIDTH: f32 = 420.0;

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
    /// The per-player statistics panel.
    Statistics,
    /// The production panel.
    Production,
    /// BW's own bottom console.
    Console,
    /// BW's own minimap.
    Minimap,
}

impl Panel {
    pub const ALL: [Panel; 4] = [
        Panel::Statistics,
        Panel::Production,
        Panel::Console,
        Panel::Minimap,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Panel::Statistics => "statistics",
            Panel::Production => "production",
            Panel::Console => "console",
            Panel::Minimap => "minimap",
        }
    }
}

/// Which ambient panels the player wants on screen.
///
/// Independent booleans rather than a preset: the console and the minimap in particular are separate
/// surfaces in the game, and observers routinely keep one without the other. Serializable so a host
/// can persist the set per profile.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct PanelPrefs {
    pub statistics: bool,
    pub production: bool,
    pub console: bool,
    pub minimap: bool,
}

impl Default for PanelPrefs {
    fn default() -> PanelPrefs {
        PanelPrefs {
            statistics: true,
            production: true,
            console: true,
            minimap: true,
        }
    }
}

impl PanelPrefs {
    pub fn shown(&self, panel: Panel) -> bool {
        match panel {
            Panel::Statistics => self.statistics,
            Panel::Production => self.production,
            Panel::Console => self.console,
            Panel::Minimap => self.minimap,
        }
    }

    pub fn set(&mut self, panel: Panel, shown: bool) {
        match panel {
            Panel::Statistics => self.statistics = shown,
            Panel::Production => self.production = shown,
            Panel::Console => self.console = shown,
            Panel::Minimap => self.minimap = shown,
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
}

/// What a frame produced.
#[derive(Default)]
pub struct FrameOutput {
    /// What the shell wants done to the game, in the order it asked.
    pub intents: Vec<Intent>,
    /// The screen rects the overlay owns this frame. A click outside all of them is the game's,
    /// unless the capture says otherwise.
    pub hit_rects: Vec<Rect>,
    pub capture: InputCapture,
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
            Some(action) => self.apply_action(action),
            None => false,
        }
    }

    /// Draws the frame and reports what it wants of the host.
    pub fn frame(&mut self, ctx: &Context, host: &HostFrame, views: &mut Views<'_>) -> FrameOutput {
        self.set_host(host);
        self.sync_status_modals(views.disconnect.as_ref());

        let mut hit_rects = Vec::new();
        // The ambient layer is drawn before the modal layer so the scrim covers it. The diagnostic
        // network-stats panel is not gated on the mode: nothing puts it on screen but the chat
        // command that asks for it, and a player triaging lag needs it while they are playing.
        if let Some(net_stats) = views.net_stats {
            render_netstat_view(net_stats, ctx);
        }

        if let Some(modal) = self.modals.last().copied() {
            let outcome = draw_modal(ctx, modal.id, views, &mut hit_rects);
            for slot in outcome.drop_requests {
                self.intents.push(Intent::DropPlayer { slot });
            }
            if outcome.dismissed && modal.id.is_dismissible() {
                self.dismiss_top_modal();
            }
        }

        FrameOutput {
            intents: std::mem::take(&mut self.intents),
            hit_rects,
            capture: self.capture(),
        }
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

    fn apply_action(&mut self, action: Action) -> bool {
        match action {
            Action::ToggleAllPanels => {
                let show = !self.prefs.all_shown();
                self.prefs.set_all(show);
                true
            }
            _ => match action_panel(action) {
                Some(panel) => {
                    self.prefs.toggle(panel);
                    true
                }
                None => false,
            },
        }
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
    match action {
        Action::ToggleEconomy => Some(Panel::Statistics),
        Action::ToggleProduction => Some(Panel::Production),
        Action::ToggleConsole => Some(Panel::Console),
        Action::ToggleMinimap => Some(Panel::Minimap),
        _ => None,
    }
}

/// What drawing a modal reported back.
#[derive(Default)]
struct ModalOutcome {
    /// Whether the player asked for the modal to close.
    dismissed: bool,
    /// Slots whose Drop button was clicked.
    drop_requests: Vec<u8>,
}

fn draw_modal(
    ctx: &Context,
    id: ModalId,
    views: &mut Views<'_>,
    hit_rects: &mut Vec<Rect>,
) -> ModalOutcome {
    match id {
        ModalId::WaitingForPlayers | ModalId::ConnectionInterrupted => {
            let Some(surface) = views.disconnect.as_ref() else {
                return ModalOutcome::default();
            };
            let dialog = render_disconnect_view(surface.view, ctx);
            // The surface only takes clicks once it has a Drop button to take them for: a passive
            // notice must not cost the game a click.
            if surface.view.has_button() {
                hit_rects.push(dialog.response.rect);
            }
            ModalOutcome {
                dismissed: false,
                drop_requests: dialog.inner,
            }
        }
        ModalId::GameMenu => {
            let dialog = tiers::tier2_dialog(
                ctx,
                Id::new("sb_game_menu"),
                &tr!("gameMenu.title", "Game menu"),
                MODAL_WIDTH,
                |ui| {
                    ui.add_space(theme::SPACE_SM);
                    ui.vertical_centered(|ui| {
                        widgets::button(
                            ui,
                            &tr!("gameMenu.returnToGame", "Return to game"),
                            ButtonVariant::Tier2Primary,
                        )
                        .clicked()
                    })
                    .inner
                },
            );
            hit_rects.push(dialog.response.rect);
            ModalOutcome {
                dismissed: dialog.inner || dialog.scrim_clicked,
                drop_requests: Vec::new(),
            }
        }
        ModalId::ChatHistory => {
            let dialog = tiers::tier2_dialog(
                ctx,
                Id::new("sb_chat_history"),
                &tr!("chatHistory.title", "Chat history"),
                MODAL_WIDTH,
                |ui| {
                    ui.add_space(theme::SPACE_SM);
                    ui.vertical_centered(|ui| {
                        widgets::button(ui, &tr!("common.close", "Close"), ButtonVariant::Tier2)
                            .clicked()
                    })
                    .inner
                },
            );
            hit_rects.push(dialog.response.rect);
            ModalOutcome {
                dismissed: dialog.inner || dialog.scrim_clicked,
                drop_requests: Vec::new(),
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
        });
        shell
    }

    /// A disconnect view with something on it: an empty one draws nothing and raises no modal.
    fn view(self_state: SelfState) -> DisconnectView {
        use crate::disconnect::{DisconnectRowView, DisconnectTier};
        DisconnectView {
            rows: vec![DisconnectRowView {
                slot: 3,
                name: "Rhynso".to_string(),
                seconds: 12,
                tier: DisconnectTier::Confirmed,
                drop_unlocked: false,
                drop_requested: false,
            }],
            self_state,
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
        assert!(shell.key_pressed(Key::E, Modifiers::NONE));
        assert!(!shell.panel_prefs().statistics);
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
        for key in [Key::P, Key::U, Key::G, Key::V, Key::Backtick] {
            assert!(
                !shell.key_pressed(key, Modifiers::NONE),
                "{key:?} was consumed with nothing to consume it for"
            );
        }
    }

    #[test]
    fn normal_play_consumes_no_hotkey() {
        let mut shell = Shell::new();
        shell.set_host(&HostFrame {
            mode: Mode::Playing,
            game_started: true,
            native_textbox_open: false,
            native_dialog_open: false,
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
            },
            HostFrame {
                mode: Mode::Replay,
                game_started: true,
                native_textbox_open: false,
                native_dialog_open: true,
            },
            HostFrame {
                mode: Mode::Replay,
                game_started: false,
                native_textbox_open: false,
                native_dialog_open: false,
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
    fn a_modal_owns_the_keyboard_ahead_of_the_hotkeys() {
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::ChatHistory);
        assert!(!shell.key_pressed(Key::W, Modifiers::NONE));
        assert!(shell.panel_prefs().console);
    }
}
