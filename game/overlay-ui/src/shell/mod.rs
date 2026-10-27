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
//! 1. **Ambient** (tier 0/1) — panels that sit over live gameplay: the observer panel set in
//!    [`Mode::Observing`] and [`Mode::Replay`], and the network panels in every mode.
//! 2. **Hero** (tier 1) — the surfaces that carry the match's identity.
//! 3. **Modal** (tier 2) — a stack, of which only the top is drawn. It dims everything behind it and
//!    takes the keyboard and the pointer.
//!
//! The shell's parts: `prefs` is what the watcher wants on screen, `modals` what each modal may do
//! and the stack of them, `capture` what of the input reaches the game, `replay` the playback
//! commands waiting to go out, and `observer_panels` where the observer panels stand each frame.
//! This module routes keys between them and runs the frame across them.

mod capture;
pub mod hotkeys;
mod modals;
pub mod native_dialogs;
mod observer_panels;
mod prefs;
mod replay;
#[cfg(test)]
mod test_support;

use egui::{Context, Key, Modifiers, Rect};
use serde::{Deserialize, Serialize};

use crate::alliances::{AlliancesAction, AlliancesDraft, AlliancesMenu, AlliancesView};
use crate::chat_history::ChatHistoryView;
use crate::disconnect::{DisconnectView, SelfState};
use crate::end_card::{self, EndCardChoice, EndCardView};
pub use crate::game_menu::PauseControl;
use crate::game_menu::leave_asks_first;
use crate::net_quality::{NetQualityView, render_net_quality};
use crate::netstat::{NetStatsView, render_netstat_view};
use crate::observer::{self, ObserverView};
use crate::options::{OptionsLists, OptionsSection, OptionsView, SettingChange};
use crate::setting_toast::SettingToast;
use crate::transport::{TransportPlacement, TransportView, render_transport_view};

pub use capture::{InputCapture, KeyboardCapture, PointerCapture};
pub use hotkeys::{Action, Chord, Hotkeys};
pub use modals::{ModalId, ModalPolicy};
pub use native_dialogs::{NativeDialog, replacement_for};
pub use prefs::{Panel, PanelPrefs, PanelSet};

use modals::{ModalContext, ModalOutcome, ModalStack, draw_modal};
use observer_panels::{ObserverFrame, ObserverPanels, number_key_digit};
use replay::ReplayCommands;

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
    /// Carry out something the player did on the alliances screen.
    Alliances(AlliancesAction),
    /// Pause the game (`true`) or resume it (`false`), the way the game's own menu does.
    SetPaused(bool),
    /// Give up on a connection that will not come back and leave the game.
    AbandonGame,
    /// Put one setting on the value the player moved it to, in the game and wherever the host
    /// persists it.
    ChangeSetting(SettingChange),
    /// Open the game's own menu, the way its own key for the menu does, so the overlay's
    /// replacement for it comes up exactly as it would from the keyboard.
    OpenGameMenu,
    /// Show the map's mission objectives in the game's own dialog for them, which takes the place
    /// of the game's menu and brings it back once closed.
    OpenObjectives,
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
    /// Select nothing, which the game gives a watcher no way of their own to do.
    ClearSelection,
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
    /// What the game's own menu offers for pausing, while it is up behind the overlay's: `None`
    /// where it offers nothing, as in a replay.
    pub pause_control: Option<PauseControl>,
    /// Where BW's minimap is on screen, in the overlay's points, for a host that can say. Its top
    /// marks the console's, which dialogs and notices keep above; the frame a watcher gets around
    /// the minimap is drawn from it, and `None` draws no frame. The panels placed around the
    /// minimap keep clear of the corner the design reserves for it either way.
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
    /// The alliances screen, which a host only builds while [`ModalId::Alliances`] is on the stack.
    pub alliances: Option<&'a AlliancesView>,
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

/// The overlay's per-frame state machine. See the module docs.
pub struct Shell {
    prefs: PanelPrefs,
    hotkeys: Hotkeys,
    modals: ModalStack,
    /// The game state the last frame reported, which is what keypresses arriving between frames are
    /// decided against.
    host: HostFrame,
    /// The replay commands waiting to go out, and the playback a transport key is relative to.
    replay: ReplayCommands,
    /// Where the observer panels stood and what the watcher had open on them.
    observer: ObserverPanels,
    /// The key holding a hold-to-confirm button, and the modal the button is on, from a press made
    /// while that modal was on top until the key comes up (see [`Shell::update_held_keys`]).
    held_button_key: Option<(ModalId, Key)>,
    /// What a key pressed since the last frame chose on an end-of-game card. Carried to the card
    /// rather than acted on here, because the card only takes a choice once it has landed.
    end_card_key: Option<EndCardChoice>,
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
    /// The menu open on the alliances screen. Held here rather than by the screen so `Esc` can close
    /// it ahead of the screen under it.
    alliances_menu: Option<AlliancesMenu>,
    /// The alliance changes made on the alliances screen and not yet applied.
    alliances_draft: AlliancesDraft,
    /// The notice of a setting the game changed on its own keys, while one is on screen.
    setting_toast: Option<SettingToast>,
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
            modals: ModalStack::default(),
            host: HostFrame::default(),
            replay: ReplayCommands::default(),
            observer: ObserverPanels::default(),
            held_button_key: None,
            end_card_key: None,
            options: OptionsView::default(),
            host_options: None,
            options_section: OptionsSection::default(),
            alliances_menu: None,
            alliances_draft: AlliancesDraft::default(),
            setting_toast: None,
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
        self.observer.vision_picker_open()
    }

    /// Opens or closes the list of players under the minimap's vision button, for a host restoring
    /// what a watcher had open.
    pub fn set_vision_picker_open(&mut self, open: bool) {
        self.observer.set_vision_picker_open(open);
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

    /// Opens or closes a menu on the alliances screen, for a host restoring what a player had open.
    pub fn set_alliances_menu(&mut self, menu: Option<AlliancesMenu>) {
        self.alliances_menu = menu;
    }

    /// Does what the player's own click on the alliances screen would, for a host restoring what a
    /// player had set: an alliance change waits to be applied, and anything else is carried out.
    pub fn alliances_action(&mut self, action: AlliancesAction) {
        if let Some(action) = self.alliances_draft.stage(action) {
            self.intents.push(Intent::Alliances(action));
        }
    }

    /// Opens the options screen on `section`, for a host restoring where a player was.
    /// Records a setting the game changed on one of its own keys, so the frame says so.
    ///
    /// A notice already on screen takes the new text and holds again from where it stands rather
    /// than making its entrance again, so a key pressed a few times in a row reads as one notice
    /// changing.
    pub fn setting_changed_in_game(&mut self, change: SettingChange) {
        if let Some(toast) = SettingToast::for_change(change) {
            self.setting_toast = Some(toast);
        }
    }

    pub fn set_options_section(&mut self, section: OptionsSection) {
        self.options_section = section;
    }

    /// The modal stack, bottom first.
    pub fn open_modals(&self) -> impl Iterator<Item = ModalId> + '_ {
        self.modals.ids()
    }

    /// The modal that owns the screen, if any.
    pub fn top_modal(&self) -> Option<ModalId> {
        self.modals.top()
    }

    /// Whether the host has reported this native dialog as spawned and replaced.
    pub fn native_dialog_live(&self, dialog: NativeDialog) -> bool {
        self.modals.native_dialog_live(dialog)
    }

    /// What the next frame will hand the host.
    pub fn pending_intents(&self) -> &[Intent] {
        &self.intents
    }

    /// What the game is allowed to see of the input arriving right now.
    pub fn capture(&self) -> InputCapture {
        InputCapture::resolve(
            self.modals.captures_input(),
            self.modals.chat_allowed(),
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
        self.modals.native_dialog_spawned(dialog);
    }

    /// Raises a dismissible modal the player asked for directly, rather than through the native
    /// dialog it stands in for.
    ///
    /// The dismissal path is the same either way: a modal raised here has no live native dialog
    /// behind it, so closing it asks the host for nothing. A modal the game's own state owns
    /// (whose [`ModalPolicy::dismissible`] is false) cannot be raised this way, since the next
    /// frame's status sync would only take it straight back down.
    pub fn open_modal(&mut self, id: ModalId) {
        if id.policy().dismissible {
            self.modals.raise(id);
        }
    }

    /// Closes a dismissible modal from outside the modal itself, for a host acting on something
    /// the player did elsewhere.
    ///
    /// A modal the game's own state owns cannot be closed this way, for the same reason it cannot
    /// be opened that way: the next frame's status sync would put it straight back.
    pub fn close_modal(&mut self, id: ModalId) {
        if !id.policy().dismissible || !self.modals.contains(id) {
            return;
        }
        self.modals.remove(id);
        self.close_native_dialogs(id);
    }

    /// Answers a request to close the game's window (its close button, or Alt+F4) by asking whether
    /// to leave, as SC:R's quit keys do, returning whether the shell took the request. Once the
    /// game runs, every close is the shell's: a modal the player cannot close already says how the
    /// game ends and offers the way out, so the request is taken with nothing more to show. Before
    /// the game runs there is nothing to leave, and the request is left to the host.
    pub fn window_close_requested(&mut self) -> bool {
        if !self.host.game_started {
            return false;
        }
        if self.top_modal().is_none_or(|id| id.policy().dismissible) {
            self.open_modal(ModalId::LeaveGame);
        }
        true
    }

    /// Records that a replaced native dialog is gone, so its replacement goes with it. Asks for no
    /// dismissal of its own: the dialog this would have closed has already closed.
    pub fn native_dialog_closed(&mut self, dialog: NativeDialog) {
        let replaced = dialog
            .replacement_modal()
            .filter(|&id| self.modals.contains(id));
        self.modals.native_dialog_closed(dialog);
        if let Some(id) = replaced {
            self.forget_modal_state(id);
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
        // keys SC:R's own quit questions leave on: Alt+Q then Q, and F10 then E then Q, leave a
        // game the way they always have. Whatever modifiers are held, as SC:R's own dialogs take
        // their keys: the chord that opened a dialog is often still down when its next key comes.
        if !self.chat_box_has_keyboard() && self.dialog_key_pressed(key) {
            return true;
        }
        if hotkeys::is_quit_chord(key, modifiers) && self.quit_keys_active() {
            self.open_modal(ModalId::LeaveGame);
            return true;
        }
        // SC:R's options key brings up the overlay's options screen, as its own key brings up its
        // own; the same key puts it away again.
        if hotkeys::is_options_chord(key, modifiers) && self.quit_keys_active() {
            match self.top_modal() == Some(ModalId::Options) {
                true => self.dismiss_top_modal(),
                false => self.open_modal(ModalId::Options),
            }
            return true;
        }
        // A ShieldBattery game is never saved, so the key is taken and does nothing: what it would
        // open is a dialog for something the game cannot do.
        if hotkeys::is_save_chord(key, modifiers) && self.host.game_started {
            return true;
        }
        // Escape closes the chat box while it is open, ahead of anything of ours.
        if key == Key::Escape && !self.chat_box_has_keyboard() {
            // A menu open on the screen closes ahead of the screen itself.
            if self.top_modal() == Some(ModalId::Alliances) && self.alliances_menu.is_some() {
                self.alliances_menu = None;
                return true;
            }
            if self.top_modal().is_some_and(|id| id.policy().dismissible) {
                self.dismiss_top_modal();
                return true;
            }
            // A modal of the game's own state takes the screen ahead of the list under it, so the
            // list only answers the key while no modal is up.
            if self.observer.vision_picker_open() && self.top_modal().is_none() {
                self.observer.set_vision_picker_open(false);
                return true;
            }
            // With nothing else to close, a watcher's Escape lets go of what they have selected.
            // It stays the game's while there is nothing selected.
            if self.host.mode.is_spectating()
                && self.host.game_started
                && self.top_modal().is_none()
            {
                return self.observer.clear_selection(&mut self.intents);
            }
            return false;
        }
        if !self.hotkeys_active() {
            return false;
        }
        if let Some(digit) = number_key_digit(key)
            && modifiers.is_none()
        {
            return self.observer.recall_control_group(digit, &mut self.intents);
        }
        match self.hotkeys.action_for(key, modifiers) {
            Some(action) => self.apply_action(action, modifiers),
            None => false,
        }
    }

    /// Offers the repeats of a held key whose press the shell took. A repeat only carries on an
    /// action that steps (see [`Action::repeats`]): it opens, closes and answers nothing, so a key
    /// held a moment past the dialog it opened cannot go on to answer that dialog as well.
    pub fn key_repeated(&mut self, key: Key, modifiers: Modifiers) {
        if self.hotkeys_active()
            && let Some(action) = self.hotkeys.action_for(key, modifiers)
            && action.repeats()
        {
            self.apply_action(action, modifiers);
        }
    }

    /// Draws the frame and reports what it wants of the host.
    pub fn frame(&mut self, ctx: &Context, host: &HostFrame, views: &mut Views<'_>) -> FrameOutput {
        self.set_host(host);
        crate::kit::tiers::set_console_top(ctx, host.minimap_rect.map(|minimap| minimap.top()));
        self.sync_status_modals(views.disconnect.as_ref());

        self.replay.set_playback(views.transport.copied());
        // A change switched back, or one the game has since made itself, is nothing to apply.
        if let Some(view) = views.alliances {
            self.alliances_draft.settle(view);
        }
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
        // The observer panels belong to the modes they report on: a host that kept feeding them
        // after the client stopped watching must not be able to put them over someone's own game.
        // They share the bottom of the screen with the replay plate, so they decide where it
        // stands; without them it keeps its corner.
        let placement = match views.observer {
            Some(view) if self.host.mode.is_spectating() => self.observer.frame(
                ctx,
                view,
                views.transport.is_some(),
                ObserverFrame {
                    host: &self.host,
                    hotkeys: &self.hotkeys,
                    prefs: &mut self.prefs,
                    replay: &mut self.replay,
                    intents: &mut self.intents,
                    hit_rects: &mut hit_rects,
                },
            ),
            _ => TransportPlacement::default(),
        };
        let transport_shown = match views.transport {
            Some(view) => {
                // The plate's track is ticked with the timeline's events, which only the observer
                // view carries: a replay without one has a plate and no ticks.
                let events = views
                    .observer
                    .filter(|_| self.host.mode.is_spectating())
                    .map_or(&[][..], |observer| &observer.timeline.events[..]);
                self.frame_transport(ctx, view, events, placement, &mut hit_rects)
            }
            None => false,
        };

        // Taken whether or not a card is drawn to take it: a choice made for a card that has since
        // gone is not one to carry over to the next.
        let end_card_key = self.end_card_key.take();
        if let Some(id) = self.top_modal() {
            // Stands in for a host that hands over no lists at all, so the rows built from them
            // draw as empty rather than the screen having to know whether it has any.
            let no_lists = OptionsLists::default();
            let option_lists = views.option_lists.unwrap_or(&no_lists);
            crate::kit::tiers::set_dialog_takes_keyboard(ctx, self.dialog_takes_keyboard());
            let outcome = draw_modal(
                ctx,
                id,
                views,
                &self.host,
                &ModalContext {
                    options: &self.options,
                    option_lists,
                    options_section: self.options_section,
                    button_key_held: self.held_button_key.is_some_and(|(held, _)| held == id),
                    end_card_key,
                    alliances_menu: self.alliances_menu,
                    alliances_draft: &self.alliances_draft,
                },
                &mut hit_rects,
            );
            self.apply_modal_outcome(id, outcome);
        }
        // Over everything else, and taking nothing: it registers no hit rect.
        if let Some(toast) = &mut self.setting_toast
            && !toast.draw(ctx, self.host.minimap_rect)
        {
            self.setting_toast = None;
        }

        FrameOutput {
            intents: std::mem::take(&mut self.intents),
            hit_rects,
            capture: self.capture(),
            transport_shown,
        }
    }

    /// Turns what the player did on the modal `id` into intents and into the shell's own state.
    fn apply_modal_outcome(&mut self, id: ModalId, outcome: ModalOutcome) {
        for slot in outcome.drop_requests {
            self.intents.push(Intent::DropPlayer { slot });
        }
        if outcome.leave {
            self.intents.push(Intent::LeaveGame);
        }
        if outcome.quit {
            self.quit_from(id);
        }
        if outcome.ask_to_leave {
            self.open_modal(ModalId::LeaveGame);
        }
        if let Some(dialog) = outcome.end_mission {
            // Off the stack as soon as it is answered, without asking the host to close the
            // dialog: ending the mission closes it, and a card left up until then could be
            // answered a second time.
            self.modals.remove(id);
            self.intents.push(Intent::EndMission(dialog));
        }
        for action in outcome.alliances_actions {
            if let Some(action) = self.alliances_draft.stage(action) {
                self.intents.push(Intent::Alliances(action));
            }
        }
        if outcome.apply_alliances {
            self.apply_alliances_draft();
        }
        if let Some(menu) = outcome.alliances_menu {
            self.alliances_menu = menu;
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
        if outcome.dismissed && id.policy().dismissible {
            self.dismiss_top_modal();
        }
        if outcome.open_options {
            self.open_from_menu(ModalId::Options);
        }
        if outcome.open_alliances {
            self.open_from_menu(ModalId::Alliances);
        }
        if outcome.open_objectives {
            self.intents.push(Intent::OpenObjectives);
        }
        if let Some(paused) = outcome.set_paused {
            self.intents.push(Intent::SetPaused(paused));
        }
    }

    /// Draws the replay transport where `placement` stands it and turns what the player did with it
    /// into intents, returning whether the plate is on screen. `events` are the timeline's, which
    /// its track is ticked with.
    fn frame_transport(
        &mut self,
        ctx: &Context,
        view: &TransportView,
        events: &[observer::TimelineEventView],
        placement: TransportPlacement,
        hit_rects: &mut Vec<HitRect>,
    ) -> bool {
        let outcome = render_transport_view(
            view,
            ctx,
            self.prefs.shown(Panel::Transport),
            placement,
            events,
            &self.hotkeys,
        );
        self.observer.plate_drawn(outcome.is_some());
        if let Some(outcome) = &outcome {
            hit_rects.push(HitRect::new(outcome.rect));
            if let Some(frame) = outcome.seek_to {
                self.replay.queue_seek(frame, outcome.look_at);
            }
            if outcome.speed.is_some() || outcome.paused.is_some() {
                self.replay
                    .request_speed(outcome.speed, outcome.paused, &mut self.intents);
            }
            if let Some(spoiler_free) = outcome.spoiler_free {
                self.prefs.spoiler_free = spoiler_free;
            }
        }
        self.replay.send_queued_seek(ctx, view, &mut self.intents);
        outcome.is_some()
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
        if let Some(result) = top.and_then(|top| top.end_card_result(self.host.mode))
            && let Some(choice) = end_card::key_choice(key, result)
        {
            self.end_card_key = Some(choice);
            return true;
        }
        match (top, key) {
            (Some(ModalId::GameMenu), Key::O) => self.open_from_menu(ModalId::Options),
            // The key works the leave button as the pointer does: it asks first where leaving is
            // asked about, and the question takes SC:R's own next key.
            (Some(ModalId::GameMenu), Key::E) if leave_asks_first(replay) => {
                self.open_modal(ModalId::LeaveGame)
            }
            (Some(ModalId::GameMenu), Key::E) => self.quit_from(ModalId::GameMenu),
            (Some(ModalId::GameMenu), Key::A | Key::C) if playing => {
                self.open_from_menu(ModalId::Alliances)
            }
            (Some(ModalId::GameMenu), Key::M) if playing => {
                self.intents.push(Intent::OpenObjectives)
            }
            (Some(ModalId::Alliances), Key::Enter) if !self.alliances_draft.is_empty() => {
                self.apply_alliances_draft();
                self.dismiss_top_modal();
            }
            (Some(ModalId::GameMenu), Key::P) if self.host.pause_control.is_some() => {
                let pausing = matches!(self.host.pause_control, Some(PauseControl::Pause { .. }));
                self.intents.push(Intent::SetPaused(pausing));
            }
            (Some(ModalId::LeaveGame), Key::Q | Key::E) => self.quit_from(ModalId::LeaveGame),
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

    /// Opens `id` in place of the game menu on top, as SC:R's menu gives way to the screens it
    /// opens: putting one away goes back to the game rather than back to the menu.
    fn open_from_menu(&mut self, id: ModalId) {
        if self.top_modal() == Some(ModalId::GameMenu) {
            self.dismiss_top_modal();
        }
        self.open_modal(id);
    }

    /// Quits the game as the modal `id` was answered. The modal goes off the stack with the answer,
    /// without asking the host to close a dialog: the quit closes SC:R's own, and a modal left up
    /// while it does could be answered again, quitting a second time into dialogs already closing.
    fn quit_from(&mut self, id: ModalId) {
        self.modals.remove(id);
        self.intents.push(Intent::QuitGame);
    }

    /// Whether SC:R's quit keys open the leave question. They do in every mode once the game runs,
    /// as SC:R's own do, except while the chat box has the keyboard or a modal the player cannot
    /// close owns the screen: that one already says how this game ends.
    fn quit_keys_active(&self) -> bool {
        self.host.game_started
            && !self.chat_box_has_keyboard()
            && self.top_modal().is_none_or(|id| id.policy().dismissible)
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
            && !self.modals.captures_input()
    }

    /// Whether the modal on screen owns the keyboard (see
    /// [`set_dialog_takes_keyboard`](crate::kit::tiers::set_dialog_takes_keyboard)): it takes every
    /// input, and the player cannot chat from under it.
    fn dialog_takes_keyboard(&self) -> bool {
        self.modals.captures_input() && !self.modals.chat_allowed()
    }

    /// Whether the keys pressed now are going into BW's chat box: it is open, and nothing of ours
    /// that keeps it shut is up. A box left open under a modal that does is frozen, and the keys
    /// are the modal's.
    fn chat_box_has_keyboard(&self) -> bool {
        self.host.native_textbox_open && self.modals.chat_allowed()
    }

    fn apply_action(&mut self, action: Action, modifiers: Modifiers) -> bool {
        match action {
            Action::ToggleAllPanels => {
                self.prefs.toggle_all();
                true
            }
            Action::ToggleVisionPicker => {
                let open = !self.observer.vision_picker_open();
                self.observer.set_vision_picker_open(open);
                // The list hangs off the minimap's frame, so asking for it brings the minimap back.
                if open {
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
            | Action::SeekForward => self.replay.key_action(action, modifiers, &mut self.intents),
            Action::ToggleGraphs => {
                self.prefs.graphs_key(modifiers);
                true
            }
            Action::ToggleDock => {
                self.prefs.dock_key(modifiers);
                true
            }
            // The bar reports a measurement the game does not keep, so a game whose host has none
            // leaves the key alone rather than moving a preference nothing can act on.
            Action::ToggleMapControl if !self.observer.map_control_available() => false,
            _ => match Panel::for_action(action) {
                Some(panel) => {
                    self.prefs.toggle(panel);
                    true
                }
                None => false,
            },
        }
    }

    /// Sends the alliance changes made on the alliances screen to the game.
    fn apply_alliances_draft(&mut self) {
        for action in self.alliances_draft.take_actions() {
            self.intents.push(Intent::Alliances(action));
        }
    }

    /// Drops what the shell keeps for a modal that has left the stack, however it left, so the
    /// modal opens afresh the next time.
    fn forget_modal_state(&mut self, id: ModalId) {
        if id == ModalId::Alliances {
            self.alliances_menu = None;
            self.alliances_draft = AlliancesDraft::default();
        }
    }

    fn dismiss_top_modal(&mut self) {
        let Some(id) = self.modals.pop() else {
            return;
        };
        self.close_native_dialogs(id);
    }

    /// Asks the host to dismiss whichever of the native dialogs behind `id` are still up.
    fn close_native_dialogs(&mut self, id: ModalId) {
        self.forget_modal_state(id);
        self.intents.extend(
            self.modals
                .live_dialogs_behind(id)
                .map(Intent::CloseNativeDialog),
        );
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
        self.modals.sync_status(wanted);
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;

    /// SC:R quits on `Q` and `X` with either Ctrl or Alt, and every one of them asks the same
    /// question here.
    #[test]
    fn every_quit_chord_asks_whether_to_leave() {
        let ctrl = Modifiers {
            ctrl: true,
            command: true,
            ..Modifiers::NONE
        };
        for key in [Key::Q, Key::X] {
            for modifiers in [Modifiers::ALT, ctrl] {
                let mut shell = playing_shell();
                assert!(shell.key_pressed(key, modifiers), "{key:?} {modifiers:?}");
                assert_eq!(shell.top_modal(), Some(ModalId::LeaveGame));
            }
        }
    }

    /// SC:R's options key opens the overlay's options screen, and puts it away again.
    #[test]
    fn the_options_key_opens_and_closes_options() {
        let mut shell = playing_shell();
        assert!(shell.key_pressed(Key::O, Modifiers::ALT));
        assert_eq!(shell.top_modal(), Some(ModalId::Options));
        assert!(shell.key_pressed(Key::O, Modifiers::ALT));
        assert_eq!(shell.top_modal(), None);
    }

    /// The save key is taken and does nothing: a ShieldBattery game is never saved.
    #[test]
    fn the_save_key_does_nothing() {
        let mut shell = playing_shell();
        assert!(shell.key_pressed(Key::S, Modifiers::ALT));
        assert_eq!(shell.top_modal(), None);
        assert!(shell.pending_intents().is_empty());
    }

    /// `P` on the menu does what the game offers: pauses a running game for a player with pauses
    /// left, resumes a paused one, and is left alone where the game offers neither.
    #[test]
    fn the_pause_key_does_what_the_game_offers() {
        let mut shell = Shell::new();
        let mut host = HostFrame {
            mode: Mode::Playing,
            game_started: true,
            ..HostFrame::default()
        };
        shell.set_host(&host);
        shell.native_dialog_spawned(NativeDialog::GameMenu);
        assert!(!shell.key_pressed(Key::P, Modifiers::NONE));
        host.pause_control = Some(PauseControl::Pause { left: Some(2) });
        shell.set_host(&host);
        assert!(shell.key_pressed(Key::P, Modifiers::NONE));
        host.pause_control = Some(PauseControl::Resume);
        shell.set_host(&host);
        assert!(shell.key_pressed(Key::P, Modifiers::NONE));
        assert_eq!(
            shell.pending_intents(),
            [Intent::SetPaused(true), Intent::SetPaused(false)]
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
    fn normal_play_consumes_no_hotkey() {
        let mut shell = Shell::new();
        shell.set_host(&HostFrame {
            mode: Mode::Playing,
            game_started: true,
            native_textbox_open: false,
            native_dialog_open: false,
            native_menu_open: false,
            game_seconds: 0,
            pause_control: None,
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
                pause_control: None,
                minimap_rect: None,
            },
            HostFrame {
                mode: Mode::Replay,
                game_started: true,
                native_textbox_open: false,
                native_dialog_open: true,
                native_menu_open: false,
                game_seconds: 0,
                pause_control: None,
                minimap_rect: None,
            },
            HostFrame {
                mode: Mode::Replay,
                game_started: false,
                native_textbox_open: false,
                native_dialog_open: false,
                native_menu_open: false,
                game_seconds: 0,
                pause_control: None,
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
        let disconnect = disconnect_view(SelfState::Healthy);
        shell.sync_status_modals(Some(&DisconnectSurface {
            view: &disconnect,
            blocks_input: false,
        }));
        assert!(shell.key_pressed(Key::W, Modifiers::NONE));
        assert!(!shell.panel_prefs().selection);
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

    /// A dialog's keys work with modifiers still held from the chord that opened it, as SC:R's own
    /// do: Alt+Q, Q leaves without letting go of Alt.
    #[test]
    fn dialog_keys_answer_with_modifiers_held() {
        let ctrl = Modifiers {
            ctrl: true,
            command: true,
            ..Modifiers::NONE
        };
        let mut observing = Shell::new();
        observing.set_host(&HostFrame {
            mode: Mode::Observing,
            game_started: true,
            ..HostFrame::default()
        });
        for mut shell in [playing_shell(), observing, spectating_shell()] {
            assert!(shell.key_pressed(Key::Q, Modifiers::ALT));
            assert_eq!(shell.top_modal(), Some(ModalId::LeaveGame));
            assert!(shell.key_pressed(Key::Q, Modifiers::ALT));
            assert!(shell.pending_intents().contains(&Intent::QuitGame));
            assert_ne!(shell.top_modal(), Some(ModalId::LeaveGame));
        }
        for modifiers in [Modifiers::ALT, ctrl, Modifiers::SHIFT] {
            let mut shell = playing_shell();
            shell.open_modal(ModalId::GameMenu);
            assert!(shell.key_pressed(Key::O, modifiers), "{modifiers:?}");
            assert_eq!(shell.top_modal(), Some(ModalId::Options), "{modifiers:?}");
            assert!(shell.key_pressed(Key::S, modifiers), "{modifiers:?}");
            assert_eq!(
                shell.options_section,
                OptionsSection::Sound,
                "{modifiers:?}"
            );
        }
    }

    /// The key that opened a dialog, held a moment too long, answers nothing on it.
    #[test]
    fn a_held_key_answers_no_dialog() {
        let mut shell = playing_shell();
        assert!(shell.key_pressed(Key::Q, Modifiers::ALT));
        // The Alt+Q that opened the question repeating, and then with Alt let go of first.
        shell.key_repeated(Key::Q, Modifiers::ALT);
        shell.key_repeated(Key::Q, Modifiers::NONE);
        assert_eq!(shell.top_modal(), Some(ModalId::LeaveGame));
        assert!(!shell.pending_intents().contains(&Intent::QuitGame));
        assert!(shell.key_pressed(Key::Q, Modifiers::ALT));
        assert!(shell.pending_intents().contains(&Intent::QuitGame));

        // F10, E opens the question too, and holding the E must not answer it either.
        let mut shell = playing_shell();
        shell.open_modal(ModalId::GameMenu);
        assert!(shell.key_pressed(Key::E, Modifiers::NONE));
        shell.key_repeated(Key::E, Modifiers::NONE);
        assert_eq!(shell.top_modal(), Some(ModalId::LeaveGame));
        assert!(!shell.pending_intents().contains(&Intent::QuitGame));

        // A held toggle stays where its press put it rather than flickering.
        let mut shell = playing_shell();
        assert!(shell.key_pressed(Key::O, Modifiers::ALT));
        shell.key_repeated(Key::O, Modifiers::ALT);
        assert_eq!(shell.top_modal(), Some(ModalId::Options));
    }

    #[test]
    fn closing_the_window_asks_to_leave_once_the_game_runs() {
        let mut loading = Shell::new();
        assert!(!loading.window_close_requested());
        assert_eq!(loading.top_modal(), None);

        let mut shell = spectating_shell();
        assert!(shell.window_close_requested());
        assert_eq!(shell.top_modal(), Some(ModalId::LeaveGame));
        // Asked again, the same question stays up.
        assert!(shell.window_close_requested());
        assert_eq!(shell.top_modal(), Some(ModalId::LeaveGame));
        assert!(shell.pending_intents().is_empty());

        // A modal that already says how the game ends is left showing.
        let mut ended = spectating_shell();
        raise_status_modal(&mut ended, ModalId::SessionEnded);
        assert!(ended.window_close_requested());
        assert_eq!(ended.top_modal(), Some(ModalId::SessionEnded));
    }

    #[test]
    fn a_quick_second_q_does_not_quit_again() {
        let mut shell = spectating_shell();
        let alt = Modifiers {
            alt: true,
            ..Modifiers::NONE
        };
        assert!(shell.key_pressed(Key::Q, alt));
        assert!(shell.key_pressed(Key::Q, Modifiers::NONE));
        // The question is answered and gone, so the next Q is nobody's.
        assert_ne!(shell.top_modal(), Some(ModalId::LeaveGame));
        shell.key_pressed(Key::Q, Modifiers::NONE);
        let quits = shell
            .pending_intents()
            .iter()
            .filter(|&intent| *intent == Intent::QuitGame)
            .count();
        assert_eq!(quits, 1);
    }

    #[test]
    fn the_menu_answers_to_scrs_keys_for_its_buttons() {
        let mut shell = spectating_shell();
        shell.open_modal(ModalId::GameMenu);
        assert!(shell.key_pressed(Key::O, Modifiers::NONE));
        assert_eq!(shell.top_modal(), Some(ModalId::Options));
        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), None);
        shell.open_modal(ModalId::GameMenu);
        // A watcher has no alliances to set, so the key is not the menu's.
        assert!(!shell.key_pressed(Key::A, Modifiers::NONE));
        // A replay is left with a tap, watched alone as it is.
        assert!(shell.key_pressed(Key::E, Modifiers::NONE));
        assert!(shell.pending_intents().contains(&Intent::QuitGame));
    }

    #[test]
    fn a_players_menu_key_asks_before_leaving() {
        let mut shell = Shell::new();
        shell.set_host(&HostFrame {
            mode: Mode::Playing,
            game_started: true,
            native_textbox_open: false,
            native_dialog_open: false,
            native_menu_open: false,
            game_seconds: 0,
            pause_control: None,
            minimap_rect: None,
        });
        shell.open_modal(ModalId::GameMenu);
        assert!(shell.key_pressed(Key::E, Modifiers::NONE));
        assert_eq!(shell.top_modal(), Some(ModalId::LeaveGame));
        assert!(!shell.pending_intents().contains(&Intent::QuitGame));
        // Backing out of the question goes back to the menu.
        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), Some(ModalId::GameMenu));
        // F10, E, Q leaves, as it does in SC:R.
        assert!(shell.key_pressed(Key::E, Modifiers::NONE));
        assert!(shell.key_pressed(Key::Q, Modifiers::NONE));
        assert!(shell.pending_intents().contains(&Intent::QuitGame));
    }

    #[test]
    fn alliance_changes_wait_for_enter_and_escape_drops_them() {
        let ally = AlliancesAction::SetAllied {
            player_id: 1,
            allied: true,
        };
        let mut shell = playing_shell();
        shell.open_modal(ModalId::Alliances);
        assert_eq!(shell.alliances_draft.stage(ally), None);
        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), None);
        assert!(shell.alliances_draft.is_empty());
        assert!(!shell.pending_intents().contains(&Intent::Alliances(ally)));

        shell.open_modal(ModalId::Alliances);
        // Enter has nothing to apply until something is staged.
        assert!(!shell.key_pressed(Key::Enter, Modifiers::NONE));
        shell.alliances_draft.stage(ally);
        assert!(shell.key_pressed(Key::Enter, Modifiers::NONE));
        assert_eq!(shell.top_modal(), None);
        assert!(shell.pending_intents().contains(&Intent::Alliances(ally)));
    }

    /// One other player, not yet an ally, on a screen that lets alliances change.
    fn one_enemy_view() -> AlliancesView {
        AlliancesView {
            players: vec![crate::alliances::AlliancePlayerView {
                team: 0,
                user_id: Some(1),
                name: "pachi".to_string(),
                color: egui::Color32::WHITE,
                race: crate::observer::RaceView::Random,
                standing: crate::alliances::PlayerStanding::Allyable(
                    crate::alliances::AllianceState {
                        player_id: 1,
                        allied: false,
                        vision: false,
                    },
                ),
                muted: false,
                blocked: false,
                report: crate::alliances::ReportState::None,
            }],
            alliances_open: true,
            allied_victory: false,
            chat_target: crate::alliances::ChatTargetChoice::All,
            chat_targets: Vec::new(),
        }
    }

    #[test]
    fn an_alliance_switched_back_leaves_nothing_to_apply() {
        let ctx = fresh_ctx();
        let view = one_enemy_view();
        let mut shell = playing_shell();
        shell.open_modal(ModalId::Alliances);
        for allied in [true, false] {
            shell.alliances_action(AlliancesAction::SetAllied {
                player_id: 1,
                allied,
            });
        }
        ctx.begin_pass(egui::RawInput {
            screen_rect: Some(Rect::from_min_size(
                egui::pos2(0.0, 0.0),
                egui::vec2(1280.0, 720.0),
            )),
            ..Default::default()
        });
        let mut views = Views {
            alliances: Some(&view),
            ..Views::default()
        };
        shell.frame(&ctx, &HostFrame::default(), &mut views);
        let mut out = ctx.end_pass();
        let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
        out.textures_delta.clear();
        assert!(shell.alliances_draft.is_empty());
        assert!(!shell.key_pressed(Key::Enter, Modifiers::NONE));
    }

    #[test]
    fn a_native_close_drops_the_alliance_draft() {
        let mut shell = playing_shell();
        shell.native_dialog_spawned(NativeDialog::AllianceFilter);
        assert_eq!(shell.top_modal(), Some(ModalId::Alliances));
        shell.alliances_action(AlliancesAction::SetAlliedVictory(true));
        shell.native_dialog_closed(NativeDialog::AllianceFilter);
        assert_eq!(shell.top_modal(), None);
        assert!(shell.alliances_draft.is_empty());
    }

    #[test]
    fn the_objectives_key_is_a_players_alone() {
        let mut playing = playing_shell();
        playing.native_dialog_spawned(NativeDialog::GameMenu);
        assert!(playing.key_pressed(Key::M, Modifiers::NONE));
        assert!(playing.pending_intents().contains(&Intent::OpenObjectives));

        let mut watching = spectating_shell();
        watching.native_dialog_spawned(NativeDialog::GameMenu);
        assert!(!watching.key_pressed(Key::M, Modifiers::NONE));
        assert!(!watching.pending_intents().contains(&Intent::OpenObjectives));
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
        let mut shell = playing_shell();
        shell.native_dialog_spawned(NativeDialog::Victory);
        run_frame_at(&mut shell, &ctx, None, 0.0);
        // Pressed while the card is still arriving: the key is the card's, but chooses nothing.
        assert!(shell.key_pressed(Key::E, Modifiers::NONE));
        let arriving = run_frame_at(&mut shell, &ctx, None, 0.05).intents;
        assert!(!arriving.contains(&Intent::EndMission(NativeDialog::Victory)));
        assert_eq!(shell.top_modal(), Some(ModalId::Victory));
        run_frame_at(&mut shell, &ctx, None, 3.0);
        assert!(shell.key_pressed(Key::E, Modifiers::NONE));
        let landed = run_frame_at(&mut shell, &ctx, None, 3.05).intents;
        assert!(landed.contains(&Intent::EndMission(NativeDialog::Victory)));
        assert_eq!(shell.top_modal(), None);

        // The defeat card has no carrying on, and leaves on the same key.
        let mut lost = playing_shell();
        lost.native_dialog_spawned(NativeDialog::Defeat);
        run_frame_at(&mut lost, &ctx, None, 4.0);
        run_frame_at(&mut lost, &ctx, None, 7.0);
        assert!(!lost.key_pressed(Key::B, Modifiers::NONE));
        assert!(lost.key_pressed(Key::E, Modifiers::NONE));
        let left = run_frame_at(&mut lost, &ctx, None, 7.05).intents;
        assert!(left.contains(&Intent::EndMission(NativeDialog::Defeat)));
        assert_eq!(lost.top_modal(), None);
    }

    /// SC:R's menu opens with its way back to the game lit, and `Enter` or `Space` presses what is
    /// lit.
    #[test]
    fn the_menu_opens_with_its_way_back_lit() {
        for key in [Key::Enter, Key::Space] {
            let ctx = fresh_ctx();
            let mut shell = spectating_shell();
            shell.native_dialog_spawned(NativeDialog::GameMenu);
            run_frame_with_keys(&mut shell, &ctx, &[]);
            let output = run_frame_with_keys(&mut shell, &ctx, &[key]);
            assert_eq!(shell.top_modal(), None, "{key:?}");
            assert_eq!(
                output.intents,
                [Intent::CloseNativeDialog(NativeDialog::GameMenu)]
            );
        }
    }

    /// The arrows move what is lit between the menu's buttons, as they do in SC:R's.
    #[test]
    fn the_arrows_move_between_the_menus_buttons() {
        let ctx = fresh_ctx();
        let mut shell = playing_shell();
        shell.native_dialog_spawned(NativeDialog::GameMenu);
        run_frame_with_keys(&mut shell, &ctx, &[]);
        // Up from the way back is the leave button, which asks first in a game with players in it.
        run_frame_with_keys(&mut shell, &ctx, &[Key::ArrowUp]);
        run_frame_with_keys(&mut shell, &ctx, &[Key::Enter]);
        assert_eq!(shell.top_modal(), Some(ModalId::LeaveGame));
        // The question opens with its own way back lit, and down from leaving is that.
        run_frame_with_keys(&mut shell, &ctx, &[]);
        run_frame_with_keys(&mut shell, &ctx, &[Key::ArrowUp]);
        run_frame_with_keys(&mut shell, &ctx, &[Key::ArrowDown]);
        run_frame_with_keys(&mut shell, &ctx, &[Key::Space]);
        assert_eq!(shell.top_modal(), Some(ModalId::GameMenu));
    }

    /// A screen the menu opens comes up with its own button lit, the menu's having gone with it.
    #[test]
    fn a_screen_from_the_menu_opens_with_its_own_button_lit() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::GameMenu);
        run_frame_with_keys(&mut shell, &ctx, &[]);
        // Up from the way back, past leaving, to Options.
        run_frame_with_keys(&mut shell, &ctx, &[Key::ArrowUp]);
        run_frame_with_keys(&mut shell, &ctx, &[Key::ArrowUp]);
        run_frame_with_keys(&mut shell, &ctx, &[Key::Enter]);
        assert_eq!(shell.open_modals().collect::<Vec<_>>(), [ModalId::Options]);
        // The frame the menu's lit button stops being drawn lets go of it, and the next one lights
        // the screen's Done.
        run_frame_with_keys(&mut shell, &ctx, &[]);
        run_frame_with_keys(&mut shell, &ctx, &[]);
        run_frame_with_keys(&mut shell, &ctx, &[Key::Enter]);
        assert_eq!(shell.top_modal(), None);
    }

    /// The keyboard is the game's again once the modal holding it is gone.
    #[test]
    fn a_closed_modal_leaves_nothing_focused() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::GameMenu);
        run_frame_with_keys(&mut shell, &ctx, &[]);
        assert!(ctx.egui_wants_keyboard_input());
        run_frame_with_keys(&mut shell, &ctx, &[Key::Escape]);
        assert!(!ctx.egui_wants_keyboard_input());
    }

    #[test]
    fn a_modal_owns_the_keyboard_ahead_of_the_hotkeys() {
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::ChatHistory);
        assert!(!shell.key_pressed(Key::W, Modifiers::NONE));
        assert!(shell.panel_prefs().selection);
    }
}
