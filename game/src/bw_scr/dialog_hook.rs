use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use bw_dat::dialog::{Control, Dialog, EventHandler};
use overlay_ui::shell::PauseControl;
use overlay_ui::shell::native_dialogs::{self, NativeDialog};

use crate::bw::players::StormPlayerId;
use crate::bw::{self, Bw, get_bw};
use crate::game_thread::send_game_results;
use crate::netcode_v2;

use super::{BwScr, console};

static CHAT_BOX_EVENT_HANDLER: EventHandler = EventHandler::new();
static MSG_FILTER_EVENT_HANDLER: EventHandler = EventHandler::new();
static MINIMAP_EVENT_HANDLER: EventHandler = EventHandler::new();
static MINIMAP_BUTTON1_EVENT_HANDLER: EventHandler = EventHandler::new();
static MINIMAP_BUTTON2_EVENT_HANDLER: EventHandler = EventHandler::new();
static CONSOLE_DIALOG_EVENT_HANDLERS: [EventHandler; console::CONSOLE_DIALOGS.len()] =
    [NEW_EVENT_HANDLER; console::CONSOLE_DIALOGS.len()];
static REPLACED_DIALOG_EVENT_HANDLERS: [EventHandler; NativeDialog::ALL.len()] =
    [NEW_EVENT_HANDLER; NativeDialog::ALL.len()];

/// The spawned instance of each replaced native dialog, indexed by [`NativeDialog::index`], or 0
/// while none is. Written by the spawn hook and by the swallowing event handler's delete event, read
/// by the draw path, which turns the changes into the shell's own record.
///
/// Opening one of SC:R's in-game menus closes whichever is up first, so an instance can be deleted
/// after the next of its kind has spawned; only the delete of the instance recorded here clears it.
static REPLACED_DIALOG_LIVE: [AtomicUsize; NativeDialog::ALL.len()] =
    [const { AtomicUsize::new(0) }; NativeDialog::ALL.len()];

/// How many times each replaced native dialog has spawned, indexed by [`NativeDialog::index`]. The
/// draw path reads the spawned instances once a frame, and between two reads one instance can close
/// and another take its place: the count is what tells that apart from the first one staying up.
static REPLACED_DIALOG_SPAWNS: [AtomicU32; NativeDialog::ALL.len()] =
    [const { AtomicU32::new(0) }; NativeDialog::ALL.len()];

/// The spawned instance of each replaced native dialog that we have asked to act on one of its
/// controls, indexed by [`NativeDialog::index`], or 0. From then on that instance's event handler
/// stops swallowing: a button's activation reaches the game by way of events the button sends its
/// dialog, and those are exactly what the swallowing handler exists to drop. Nothing of the
/// player's reaches the dialog either way while its replacement is up, since the replacement's
/// capture keeps the input from the game. Any other instance of the same dialog keeps swallowing:
/// a driven dialog answers input the way SC:R's own does, taking every click and key before the
/// dialogs under it see them.
static REPLACED_DIALOG_DRIVEN: [AtomicUsize; NativeDialog::ALL.len()] =
    [const { AtomicUsize::new(0) }; NativeDialog::ALL.len()];

/// The spawned instance of each replaced native dialog that a control closing it has been pressed
/// on, indexed by [`NativeDialog::index`], or 0. A dialog outlives that press by a frame or more,
/// and SC:R's in-game menus share one selection handler that a press replaces and clears: a second
/// press on a closing menu runs whichever handler is current by then, which can be none at all.
/// Forgotten when a new instance spawns at the same address.
static REPLACED_DIALOG_CLOSING: [AtomicUsize; NativeDialog::ALL.len()] =
    [const { AtomicUsize::new(0) }; NativeDialog::ALL.len()];

/// What pressing a replaced native dialog's control does to the dialog.
#[derive(Clone, Copy, PartialEq, Eq)]
enum PressEffect {
    /// The dialog closes, or gives way to the next one, and must not be pressed again.
    Closes,
    /// The dialog stays up for more.
    KeepsOpen,
}

/// The dialog-system event that activates a control, which is what a click on a button sends it.
const ACTIVATE_EXT_EVENT: u32 = 0x2;

// Helper needed for initializing array of event handlers
#[allow(clippy::declare_interior_mutable_const)]
const NEW_EVENT_HANDLER: EventHandler = EventHandler::new();

/// Which replacement a dialog spawning under this name gets, or `None` when BW's own dialog should
/// run untouched.
fn replacement_at_spawn(name: &str) -> Option<NativeDialog> {
    let dialog = native_dialogs::replacement_for(name)?;
    match dialog {
        // BW's native waiting-for-players dialog is replaced only where the egui disconnect surface
        // that stands in for it is actually driven. Outside a netcode v2 session nothing feeds that
        // surface, so hiding the native dialog there would leave a stalled player with nothing.
        NativeDialog::TimeOut => netcode_v2::with_turn_state(|_| ())
            .is_some()
            .then_some(dialog),
        NativeDialog::ChatHistory | NativeDialog::GameMenu => Some(dialog),
        // A player's result, and a live watcher's end of the game, which the card reads as the
        // game being over. A replay ends on its own playback controls.
        NativeDialog::Victory | NativeDialog::Defeat => {
            (!crate::game_thread::is_replay()).then_some(dialog)
        }
        // A player's alliances and chat recipient are set on the overlay's alliances screen. A
        // watcher's use of the two dialogs (a replay's vision, an observer's read-only lists) has
        // nothing of ours standing in for it.
        NativeDialog::AllianceFilter | NativeDialog::MessageFilter => {
            (!get_bw().is_replay_or_obs()).then_some(dialog)
        }
    }
}

/// Where one replaced native dialog stands, as of one read.
#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct ReplacedDialogState {
    /// Whether an instance of the dialog is spawned.
    pub live: bool,
    /// How many instances of the dialog have spawned so far.
    pub spawns: u32,
}

/// What changed for one replaced native dialog between two reads of its state.
#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct ReplacedDialogChange {
    /// The instance up at the first read is gone.
    pub closed: bool,
    /// An instance that was not up at the first read is up now.
    pub spawned: bool,
}

impl ReplacedDialogState {
    /// What changed between `self` and the later read `now`. An instance that closed and was
    /// replaced by another between the two is both: what stands for the dialog has to go with the
    /// first and come back for the second, which is a new dialog with nothing of the first's state.
    pub fn change_to(self, now: ReplacedDialogState) -> ReplacedDialogChange {
        let respawned = now.spawns != self.spawns;
        ReplacedDialogChange {
            closed: self.live && (!now.live || respawned),
            spawned: now.live && (!self.live || respawned),
        }
    }
}

/// Where each replaced native dialog stands right now, indexed by [`NativeDialog::index`].
pub fn replaced_dialog_states() -> [ReplacedDialogState; NativeDialog::ALL.len()] {
    std::array::from_fn(|index| ReplacedDialogState {
        live: REPLACED_DIALOG_LIVE[index].load(Ordering::Relaxed) != 0,
        spawns: REPLACED_DIALOG_SPAWNS[index].load(Ordering::Relaxed),
    })
}

/// Dismisses a replaced native dialog through its own return control.
///
/// SC:R's in-game menus put the game into a modal state — single-player pause, suspended cursor
/// updates, a restricted hotkey context — before their dialog spawns, and leave it only when the
/// dialog closes through its own path. Hiding the dialog never undoes that, so closing a replacement
/// means driving the hidden dialog's return button the way a click on it would.
pub fn close_replaced_dialog(first_dialog: Option<Dialog>, dialog: NativeDialog) {
    activate_replaced_dialog_control(
        first_dialog,
        dialog,
        dialog.return_control_id(),
        PressEffect::Closes,
    );
}

/// Ends the game from a result popup through its own End Mission control, the way a click on it
/// would. Returns whether the control was there to press, or already pressed.
pub fn end_mission(first_dialog: Option<Dialog>, dialog: NativeDialog) -> bool {
    let Some(control_id) = dialog.end_mission_control_id() else {
        warn!("The {} dialog has no End Mission control", dialog.label());
        return false;
    };
    activate_replaced_dialog_control(first_dialog, dialog, control_id, PressEffect::Closes)
}

/// Logs a replaced native dialog's controls, once its spawn has finished building them, so a log
/// from a live game says which ids a dialog actually has.
pub fn log_replaced_dialog_controls(first_dialog: Option<Dialog>, dialog: NativeDialog) {
    let Some(live) = bw::iter_dialogs(first_dialog)
        .find(|candidate| dialog.is_named(candidate.as_control().string()))
    else {
        return;
    };
    let controls = live
        .children()
        .map(|child| {
            format!(
                "{} ({:#x}, {:?})",
                child.id(),
                child.control_type(),
                bw::control_text(&child)
            )
        })
        .collect::<Vec<_>>();
    debug!(
        "The {} dialog's controls are {}",
        dialog.label(),
        controls.join(", ")
    );
}

/// Activates one of a replaced native dialog's controls, the way a click on it would, returning
/// whether the control was there to press. A dialog already closing from an earlier press counts as
/// pressed, and is left alone: what that press asked for is under way.
///
/// This is how the overlay asks for anything a replaced dialog does: its buttons run the game's own
/// code for leaving a game or opening a sub-menu, and pressing them keeps every side effect that
/// code has without the overlay having to know what those are.
fn activate_replaced_dialog_control(
    first_dialog: Option<Dialog>,
    dialog: NativeDialog,
    control_id: i16,
    effect: PressEffect,
) -> bool {
    let label = dialog.label();
    let Some(live) = bw::iter_dialogs(first_dialog)
        .find(|candidate| dialog.is_named(candidate.as_control().string()))
    else {
        debug!("The {label} dialog is already gone");
        return false;
    };
    let closing = &REPLACED_DIALOG_CLOSING[dialog.index()];
    if closing.load(Ordering::Relaxed) == *live as usize {
        debug!("Not pressing control {control_id} of the {label} dialog: it is already closing");
        return true;
    }
    let Some(control) = live.child_by_id(control_id) else {
        let controls = live
            .children()
            .map(|child| format!("{} ({:#x})", child.id(), child.control_type()))
            .collect::<Vec<_>>();
        warn!(
            "The {label} dialog has no control {control_id}; its controls are {}",
            controls.join(", ")
        );
        return false;
    };
    // The dialog's own mouse dispatch addresses a control in coordinates relative to the dialog,
    // which is what a control's area is already in.
    let area = control.dialog_coords();
    let x = area.left + (area.right - area.left) / 2;
    let y = area.top + (area.bottom - area.top) / 2;
    debug!("Pressing control {control_id} of the {label} dialog");
    REPLACED_DIALOG_DRIVEN[dialog.index()].store(*live as usize, Ordering::Relaxed);
    if effect == PressEffect::Closes {
        closing.store(*live as usize, Ordering::Relaxed);
    }
    control.send_ext_event_mouse(ACTIVATE_EXT_EVENT, x, y);
    true
}

/// The game menu's Mission Objectives button.
const GAME_MENU_OBJECTIVES_CONTROL_ID: i16 = 6;

/// Shows the map's mission objectives through the game menu's own button for them. The game closes
/// its menu and opens its objectives dialog in its place, which is not one the overlay replaces;
/// closing that dialog opens the game menu again, and with it the overlay's.
pub fn open_objectives(first_dialog: Option<Dialog>) {
    activate_replaced_dialog_control(
        first_dialog,
        NativeDialog::GameMenu,
        GAME_MENU_OBJECTIVES_CONTROL_ID,
        PressEffect::Closes,
    );
}

/// The game menu's Pause and Resume buttons, which send the pause and resume commands.
const GAME_MENU_PAUSE_CONTROL_ID: i16 = 8;
const GAME_MENU_RESUME_CONTROL_ID: i16 = 9;

/// How long a pause or resume this client sent waits to show in what the game offers before
/// another press for the same thing is let through.
const PAUSE_PRESS_SETTLE: Duration = Duration::from_secs(3);

/// The last pause (`true`) or resume (`false`) pressed, and when.
static LAST_PAUSE_PRESS: Mutex<Option<(bool, Instant)>> = Mutex::new(None);

/// Pauses the game, or resumes it, through the game menu's own button for it, which stays open
/// afterwards. Pressing a button sends its command whatever the game's rules would say, so it is
/// only pressed for what `offered`, the game's own rules for this frame, allows.
///
/// The command takes a round trip of turns to run, and until it has, the game still offers what it
/// offered before. A second press for the same thing in that time would send a second command, and
/// spend another of the player's pauses, so it is left out.
pub fn set_paused(first_dialog: Option<Dialog>, paused: bool, offered: Option<PauseControl>) {
    let offers_it = matches!(
        (paused, offered),
        (true, Some(PauseControl::Pause { .. })) | (false, Some(PauseControl::Resume))
    );
    if !offers_it {
        debug!("Not pressing the game menu's pause button: the game offers {offered:?}");
        return;
    }
    let mut last_press = LAST_PAUSE_PRESS.lock();
    if let Some((last_paused, at)) = *last_press
        && last_paused == paused
        && at.elapsed() < PAUSE_PRESS_SETTLE
    {
        debug!("Not pressing the game menu's pause button: the last press has yet to land");
        return;
    }
    let control_id = match paused {
        true => GAME_MENU_PAUSE_CONTROL_ID,
        false => GAME_MENU_RESUME_CONTROL_ID,
    };
    if activate_replaced_dialog_control(
        first_dialog,
        NativeDialog::GameMenu,
        control_id,
        PressEffect::KeepsOpen,
    ) {
        *last_press = Some((paused, Instant::now()));
    }
}

/// Opens the game's menu the way its own key does, by pressing the console's menu button: the menu
/// that spawns is the one the overlay replaces, so this brings up the overlay's menu exactly as
/// `F10` would. The button is hidden with the rest of a watcher's console, which keeps the pointer
/// from it but not a press sent to it.
///
/// Where the button cannot be found, the key itself is posted to the game's window instead.
///
/// A menu already up, and not on its way out, is left as it is. SC:R's button does not check for
/// one: it closes the menu up and opens another in its place, taking the game out of its menu
/// state and straight back in, and leaving the overlay's menu to be put away and raised again.
pub fn open_game_menu(first_dialog: Option<Dialog>) {
    let index = NativeDialog::GameMenu.index();
    let live = REPLACED_DIALOG_LIVE[index].load(Ordering::Relaxed);
    if live != 0 && REPLACED_DIALOG_CLOSING[index].load(Ordering::Relaxed) != live {
        debug!("Not pressing the menu button: the game menu is already open");
        return;
    }
    let button = bw::iter_dialogs(first_dialog)
        .find(|dialog| dialog.as_control().string() == MENU_BUTTON_DIALOG)
        .and_then(|dialog| {
            let button = dialog
                .children()
                .find(|child| matches!(child.control_type(), 0x1 | 0x2));
            if button.is_none() {
                let controls = dialog
                    .children()
                    .map(|child| format!("{} ({:#x})", child.id(), child.control_type()))
                    .collect::<Vec<_>>();
                warn!(
                    "The {MENU_BUTTON_DIALOG} dialog has no button; its controls are {}",
                    controls.join(", ")
                );
            }
            button
        });
    match button {
        Some(button) => {
            let area = button.dialog_coords();
            let x = area.left + (area.right - area.left) / 2;
            let y = area.top + (area.bottom - area.top) / 2;
            debug!("Pressing the menu button to open the game menu");
            button.send_ext_event_mouse(ACTIVATE_EXT_EVENT, x, y);
        }
        None => post_menu_key(),
    }
}

/// Posts the game's menu key to its window, a press and a release, as Windows delivers `F10`.
fn post_menu_key() {
    use winapi::um::winuser::{
        MAPVK_VK_TO_VSC, MapVirtualKeyW, PostMessageW, VK_F10, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };
    let Some(window) = crate::forge::game_window_handle() else {
        warn!("No game window to post the menu key to");
        return;
    };
    debug!("Posting the menu key to open the game menu");
    unsafe {
        let scan = MapVirtualKeyW(VK_F10 as u32, MAPVK_VK_TO_VSC) & 0xff;
        let down = 1 | (scan << 16);
        let up = down | (1 << 30) | (1 << 31);
        PostMessageW(window, WM_SYSKEYDOWN, VK_F10 as usize, down as isize);
        PostMessageW(window, WM_SYSKEYUP, VK_F10 as usize, up as isize);
    }
}

/// The game menu's control that leads towards quitting the game.
const GAME_MENU_QUIT_CONTROL_ID: i16 = 7;

/// The dialogs SC:R walks a player through from the game menu to leaving, with the control in each
/// that carries on towards the exit. The game menu itself is a step for a quit asked for without it
/// open: it is opened for the quit, hidden like every other step, and pressed on through.
const QUIT_CHAIN: [(&str, i16); 4] = [
    ("GameMenu", GAME_MENU_QUIT_CONTROL_ID),
    ("AbrtMenu", 2),
    ("Quit2Mnu", -2),
    ("QuitRepl", -2),
];

/// How long a quit the overlay started keeps confirming SC:R's quit dialogs on the player's behalf.
/// Long enough for the chain to spawn one dialog after another, short enough that a quit dialog the
/// player opens themselves later is theirs to answer.
const QUIT_CHAIN_TIMEOUT: Duration = Duration::from_secs(5);

/// When the overlay asked SC:R to quit the game, while that request is still being carried through.
static QUIT_REQUESTED_AT: Mutex<Option<Instant>> = Mutex::new(None);

/// The quit dialog [`advance_quit`] last pressed on through. A dialog can outlive the press that
/// dismisses it by a frame, and pressing it twice could carry the second press into whatever opens
/// next.
static QUIT_LAST_PRESSED: AtomicUsize = AtomicUsize::new(0);

/// Quits the game through SC:R's own quit path, starting from its hidden game menu.
///
/// SC:R's quit does more than end the game loop: it sends the command that tells every other
/// player this one has left, and settles this player's result the way any quit does. Pressing the
/// hidden menu's own buttons keeps all of that, where ending the loop directly would not. The
/// confirmation dialogs the menu opens next spawn hidden while the quit is under way, and
/// [`advance_quit`] presses on through them.
///
/// From the overlay's leave question, which SC:R's quit keys open, the game menu is not open: it is
/// opened for the quit instead, and spawns as the chain's first step.
///
/// A quit already under way is left to finish: starting another would press its dialogs a second
/// time as they close.
pub fn begin_quit(first_dialog: Option<Dialog>) {
    {
        let mut requested_at = QUIT_REQUESTED_AT.lock();
        if requested_at.is_some_and(|at| at.elapsed() <= QUIT_CHAIN_TIMEOUT) {
            debug!("Not starting a quit: one is already under way");
            return;
        }
        *requested_at = Some(Instant::now());
    }
    let open_menu = bw::iter_dialogs(first_dialog)
        .find(|dialog| NativeDialog::GameMenu.is_named(dialog.as_control().string()));
    match open_menu {
        Some(menu) => {
            // Pressed here, so the chain does not press it a second time.
            QUIT_LAST_PRESSED.store(*menu as usize, Ordering::Relaxed);
            activate_replaced_dialog_control(
                first_dialog,
                NativeDialog::GameMenu,
                GAME_MENU_QUIT_CONTROL_ID,
                PressEffect::Closes,
            );
        }
        None => open_game_menu(first_dialog),
    }
}

/// The quit chain's step a dialog of this name is, while a quit the overlay started is under way.
fn quit_chain_step(name: &str) -> Option<i16> {
    let requested_at = (*QUIT_REQUESTED_AT.lock())?;
    if requested_at.elapsed() > QUIT_CHAIN_TIMEOUT {
        return None;
    }
    QUIT_CHAIN
        .iter()
        .find(|(dialog, _)| dialog.eq_ignore_ascii_case(name))
        .map(|&(_, control)| control)
}

/// Presses on through whichever of SC:R's quit dialogs is up, for a quit [`begin_quit`] started.
/// Called once per frame: each dialog of the chain spawns only after the previous one is done with,
/// and only exists to be pressed once it has finished initializing.
pub fn advance_quit(first_dialog: Option<Dialog>) {
    if QUIT_REQUESTED_AT.lock().is_none() {
        return;
    }
    for dialog in bw::iter_dialogs(first_dialog) {
        let ctrl = dialog.as_control();
        let name = ctrl.string();
        let Some(control_id) = quit_chain_step(name) else {
            continue;
        };
        if QUIT_LAST_PRESSED.swap(*dialog as usize, Ordering::Relaxed) == *dialog as usize {
            continue;
        }
        let Some(control) = dialog.child_by_id(control_id) else {
            warn!("The {name} dialog has no control {control_id}, cannot carry the quit on");
            continue;
        };
        let area = control.dialog_coords();
        let x = area.left + (area.right - area.left) / 2;
        let y = area.top + (area.bottom - area.top) / 2;
        debug!("Quitting: pressing control {control_id} of {name}");
        control.send_ext_event_mouse(ACTIVATE_EXT_EVENT, x, y);
        return;
    }
}

pub unsafe fn spawn_dialog_hook(
    raw: *mut bw::Dialog,
    unk: usize,
    event_handler: usize,
    orig: unsafe extern "C" fn(*mut bw::Dialog, usize, usize) -> usize,
) -> usize {
    unsafe {
        let dialog = Dialog::new(raw);
        let ctrl = dialog.as_control();
        let name = ctrl.string();
        // Names every dialog BW spawns by its real template name in a live run's log.
        debug!("spawn_dialog: {name:?}");
        let event_handler = if name == "TextBox" {
            let inited = CHAT_BOX_EVENT_HANDLER.init(chat_box_event_handler);
            inited.set_orig(event_handler);
            inited.func() as usize
        } else if name == "MsgFltr" && replacement_at_spawn(name).is_none() {
            let inited = MSG_FILTER_EVENT_HANDLER.init(msg_filter_event_handler);
            inited.set_orig(event_handler);
            inited.func() as usize
        } else if name == "Minimap" {
            let inited = MINIMAP_EVENT_HANDLER.init(minimap_event_handler);
            inited.set_orig(event_handler);
            inited.func() as usize
        } else if let Some(index) = console::CONSOLE_DIALOGS.iter().position(|&x| x == name) {
            // Note: Minimap which is hooked above is also a console dialog, and its
            // event handler should do same thing as this one.
            let inited = CONSOLE_DIALOG_EVENT_HANDLERS[index].init(console_dialog_event_handler);
            inited.set_orig(event_handler);
            inited.func() as usize
        } else if name == native_dialogs::VICTORY_DIALOG_NAME {
            send_game_results();
            // Victory decides the game for everyone, so the session can end and any further play is
            // local-only. Defeat is deliberately not handled the same way: a loss doesn't end the
            // game for the other players, so the defeated client stays a normal networked
            // participant until it exits, at which point its clean leave fires as the game loop ends.
            crate::netcode_v2::begin_local_only();
            match replacement_at_spawn(name) {
                Some(replaced) => replace_at_spawn(raw, replaced, event_handler),
                None => event_handler,
            }
        } else if name == native_dialogs::DEFEAT_DIALOG_NAME {
            send_game_results();
            match replacement_at_spawn(name) {
                Some(replaced) => replace_at_spawn(raw, replaced, event_handler),
                None => event_handler,
            }
        } else if quit_chain_step(name).is_some() {
            // A step of a quit the player already confirmed in the overlay: it is pressed through
            // on the next frame, and showing it for that one frame would only flash a question the
            // player has answered.
            (*(raw as *mut bw::scr::Control)).flags &= !0x2;
            event_handler
        } else if let Some(replaced) = replacement_at_spawn(name) {
            replace_at_spawn(raw, replaced, event_handler)
        } else {
            event_handler
        };
        orig(raw, unk, event_handler)
    }
}

/// Hides a spawning dialog the overlay draws a replacement for, returning the event handler it must
/// spawn with.
///
/// BW's own dialog must never show: it is hidden at spawn and given an event handler that swallows
/// everything but its own init/delete, so it neither draws nor responds. The native spawn still
/// runs — only the dialog's visibility and interactivity are stripped, never its creation, because
/// dismissing the replacement has to close the real dialog through its own path.
unsafe fn replace_at_spawn(
    raw: *mut bw::Dialog,
    replaced: NativeDialog,
    event_handler: usize,
) -> usize {
    unsafe {
        (*(raw as *mut bw::scr::Control)).flags &= !0x2;
    }
    let index = replaced.index();
    REPLACED_DIALOG_LIVE[index].store(raw as usize, Ordering::Relaxed);
    REPLACED_DIALOG_SPAWNS[index].fetch_add(1, Ordering::Relaxed);
    // A dialog gone before this one spawned can have left its address behind.
    let _ = REPLACED_DIALOG_DRIVEN[index].compare_exchange(
        raw as usize,
        0,
        Ordering::Relaxed,
        Ordering::Relaxed,
    );
    let _ = REPLACED_DIALOG_CLOSING[index].compare_exchange(
        raw as usize,
        0,
        Ordering::Relaxed,
        Ordering::Relaxed,
    );
    let inited =
        REPLACED_DIALOG_EVENT_HANDLERS[replaced.index()].init(replaced_dialog_event_handler);
    inited.set_orig(event_handler);
    inited.func() as usize
}

unsafe extern "C" fn chat_box_event_handler(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    unsafe {
        let bw = get_bw();

        // keypress
        if (*event).ty == 0xf {
            if let Some(edit_box) = Control::new(ctrl).dialog().child_by_id(7) {
                // Enter/return while the chat box was open
                if !edit_box.is_hidden() && is_enter_char((*event).param) {
                    let text = edit_box.string();
                    if is_netstat_command(text) {
                        // Toggle the in-game network-stats overlay and swallow the message entirely:
                        // it's a local diagnostic command, so nothing is sent to peers and nothing is
                        // echoed as chat. Intercepted before the native cheat/slash parse and the send
                        // tap below, and the box is cleared so the native `orig` call just closes it.
                        netcode_v2::with_turn_state(|s| s.toggle_net_stats());
                        edit_box.set_string(b"");
                    } else if bw.handle_chat_command(text) {
                        // Clear the chat box text so no message gets sent
                        edit_box.set_string(b"");
                    } else if text.is_empty() {
                        // Enter on an already-empty box: natively this just closes the chat box
                        // without sending anything, so skip our send tap entirely (no chat_out
                        // submit, no local echo injection) and fall through to the native `orig`
                        // call below, which closes the box exactly as it does after a real send.
                    } else {
                        // A live netcode v2 session sends chat over the relay and injects this
                        // client's own echo, so the box is cleared to keep the native send (and its
                        // loopback echo) below from also firing.
                        let target = chat_target_scope();
                        if bw.send_chat_message(target, text) {
                            edit_box.set_string(b"");
                        }
                        // No live session: fall through unchanged to the native `orig` call below.
                    }
                }
            } else {
                debug!("Couldn't find edit box on chat box keypress event!");
            }
        }

        // This dialog checks if allies are enabled to allow/prevent ally chat;
        // as we disable allies to prevent changing them from what they originally
        // were, restore alliance state temporarily to make ally chat work.
        let game_data = bw.game_data();
        let old = (*game_data).game_template.allies_enabled;
        (*game_data).game_template.allies_enabled =
            if bw::get_had_allies_enabled() { 1 } else { 0 };
        let ret = orig(ctrl, event);
        (*game_data).game_template.allies_enabled = old;
        ret
    }
}

unsafe extern "C" fn msg_filter_event_handler(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    unsafe {
        // Same as chat box, to make the radio button for "Send to allies" enabled even when
        // alliances cannot be changed.
        let bw = get_bw();
        let game_data = bw.game_data();
        let old = (*game_data).game_template.allies_enabled;
        (*game_data).game_template.allies_enabled =
            if bw::get_had_allies_enabled() { 1 } else { 0 };
        let ret = orig(ctrl, event);
        (*game_data).game_template.allies_enabled = old;
        ret
    }
}

/// Whether a chat box character event's `param` is Enter: `\r`, or `\n` with Ctrl held. SC:R puts
/// the modifiers held at the time in the bits above the character (`0x3_0000` for Shift,
/// `0x4_0000` for Ctrl), so a player still holding Shift from a `?` they just typed sends with
/// `0x3_000d`. Such an Enter must still reach the send tap: the native send it would otherwise fall
/// through to reaches no one under netcode v2, while showing the message to its sender.
fn is_enter_char(param: impl Into<u64>) -> bool {
    matches!(param.into() & 0xffff, 0x0a | 0x0d)
}

/// Whether a chat-box submission is the `/netstat` overlay-toggle command. Case-insensitive, with
/// surrounding whitespace ignored, and accepting the `/netstats` spelling too.
fn is_netstat_command(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed.eq_ignore_ascii_case("/netstat") || trimmed.eq_ignore_ascii_case("/netstats")
}

/// The chat-target scope for the chat-box send tap in [`chat_box_event_handler`], read from BW's
/// `chat_box_mode` byte global (which the `MsgFltr` dialog's radio selection drives). The dialog's
/// checked-state isn't readable from its control flags, so the byte global is the source of truth.
fn chat_target_scope() -> netcode_v2::ChatTarget {
    let bw = get_bw();
    // chat_box_mode: BW's in-game chat send-scope byte, only meaningful while the chat box is open
    // — which it is at send time. 2 = everyone, 3 = allies, 4 = a specific player, 5 = observers;
    // 0/1 = box closed / single-player local.
    let Some(mode) = bw.read_chat_box_mode() else {
        return netcode_v2::ChatTarget::All;
    };
    match mode {
        3 => netcode_v2::ChatTarget::Allies,
        5 => netcode_v2::ChatTarget::Observers,
        4 => specific_player_chat_target(bw).unwrap_or(netcode_v2::ChatTarget::All),
        // 2 = everyone; box-closed / single-player-local (0/1) can't occur at send time, so any
        // other value defaults safely to everyone.
        _ => netcode_v2::ChatTarget::All,
    }
}

/// The chat target for the `MsgFltr` "send to one player" selection, read from BW's chat-target
/// field. `None` (the caller degrades to [`netcode_v2::ChatTarget::All`]) when the target can't be
/// resolved to a live session slot.
///
/// Outside a team-shared-control game the field holds a BW player id and this is exactly the one
/// rp2 slot that player maps to. In Team Melee/FFA or Top vs Bottom the field instead holds the
/// 1-based team number of the dialog's "Team N" entry; see [`team_shared_chat_target`].
fn specific_player_chat_target(bw: &BwScr) -> Option<netcode_v2::ChatTarget> {
    unsafe {
        let game = bw.game();
        if game.is_null() {
            return None;
        }
        // BW's chat-target field: 8 = everyone, 9 = allies, | 0x80 = observer target. The
        // remaining 0..7 value is a target player id outside a team-shared-control game, or a
        // 1-based team number inside one. An observer target (or the 8/9 non-player values, which
        // shouldn't reach here in mode 4) isn't addressed as a normal player slot.
        let recipient = (*game).chat_dialog_recipient;
        if recipient & 0x80 != 0 {
            return None;
        }
        let recipient_value = recipient & 0x7f;
        let players = bw.players();
        if players.is_null() {
            return None;
        }

        if (*bw.game_data()).game_type().has_team_forces() {
            return team_shared_chat_target(bw, players, recipient_value);
        }

        if recipient_value >= 8 {
            return None;
        }
        // BW player id -> storm id (its players[] entry) -> rp2 slot (storm id ≡ slot under
        // netcode v2's identity mapping).
        let storm_id = (*players.add(recipient_value as usize)).storm_id;
        let storm = StormPlayerId(u8::try_from(storm_id).ok()?);
        netcode_v2::with_turn_state(|s| s.chat_target_for_storm(storm)).flatten()
    }
}

/// The team-union chat target for a team-shared-control game (Team Melee/FFA, Top vs Bottom):
/// every rp2 slot whose BW player is on `target_team` (the `MsgFltr` dialog's chosen team, 1-based
/// as in `players[].team`), unioned with every rp2 slot on the local player's team, since SC:R
/// delivers a team-addressed message to the sender's own team too. `players` is BW's live
/// `players[]` array.
///
/// `None` if `target_team` isn't a valid team number, if it has no members, or if the union maps
/// to no live session slot at all (the caller degrades to [`netcode_v2::ChatTarget::All`]).
unsafe fn team_shared_chat_target(
    bw: &BwScr,
    players: *mut bw::Player,
    target_team: u8,
) -> Option<netcode_v2::ChatTarget> {
    unsafe {
        if !(1..=4).contains(&target_team) {
            return None;
        }

        let mut bw_ids = Vec::new();
        collect_team_members(players, target_team, &mut bw_ids);
        if bw_ids.is_empty() {
            // The addressed team has no members to resolve — degrade to All rather than
            // silently falling through to an own-team-only message.
            return None;
        }

        // The sender's own team is part of the union too, alongside the addressed team. A local
        // player that isn't a BW participant (an observer, or a replay with no live seat) has no
        // team of its own to add.
        let local_unique_player = bw.local_unique_player_id.resolve();
        if local_unique_player < 8 {
            collect_team_or_self(players, local_unique_player as u8, &mut bw_ids);
        }

        let mask = netcode_v2::with_turn_state(|s| {
            let mut mask = netcode_v2::SlotMask(0);
            for &id in &bw_ids {
                // BW player id -> storm id (its players[] entry) -> rp2 slot (storm id ≡ slot
                // under netcode v2's identity mapping). A computer with no storm presence, or any
                // other id that maps to no live slot, simply contributes no bit.
                let storm_id = (*players.add(id as usize)).storm_id;
                let Ok(storm) = u8::try_from(storm_id) else {
                    continue;
                };
                if let Some(slot) = s.slot_for_storm(StormPlayerId(storm)) {
                    mask.insert(slot);
                }
            }
            mask
        })
        .unwrap_or(netcode_v2::SlotMask(0));

        let mask_bits = mask.0;
        debug!(
            "team chat target: recipient {target_team:#04x} -> team {target_team}, slot mask {mask_bits:#x}"
        );

        if mask.is_empty() {
            None
        } else {
            Some(netcode_v2::ChatTarget::Players(mask))
        }
    }
}

/// Appends every in-game participant (BW player type computer/human, matching
/// `setup_team_alliances`'s notion of a participant) on `team` to `out`, skipping ids already
/// present so callers can build a union of multiple team/self collections without duplicates.
unsafe fn collect_team_members(players: *mut bw::Player, team: u8, out: &mut Vec<u8>) {
    unsafe {
        for i in 0..8u8 {
            let candidate = *players.add(i as usize);
            if matches!(candidate.player_type, 1 | 2) && candidate.team == team && !out.contains(&i)
            {
                out.push(i);
            }
        }
    }
}

/// Appends `player_id` to `out`, then — if `player_id`'s team is nonzero — every other in-game
/// participant sharing that team (via [`collect_team_members`]). A team of `0` means "no team" and
/// is never expanded: `out` then gains only `player_id` itself. Skips ids already present in `out`.
unsafe fn collect_team_or_self(players: *mut bw::Player, player_id: u8, out: &mut Vec<u8>) {
    unsafe {
        if !out.contains(&player_id) {
            out.push(player_id);
        }
        let team = (*players.add(player_id as usize)).team;
        if team == 0 {
            return;
        }
        collect_team_members(players, team, out);
    }
}

unsafe extern "C" fn minimap_event_handler(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    unsafe {
        let bw = get_bw();
        if bw.minimap_hidden() && !allow_event_on_hidden_dialog(event) {
            return 0;
        }
        let ret = orig(ctrl, event);
        // Init event
        if (*event).ty == 0xe && (*event).ext_type == 0x0 {
            // Apply the user's saved minimap color/terrain toggles now that the minimap (and its
            // associated globals) are initialized. Done after `orig` so it wins over any reset the
            // game's own init does.
            bw.restore_minimap_settings();
            bw.hide_new_minimap_if_hidden(Control::new(ctrl).dialog());
            if bw.is_live_observer() {
                hide_player_camera_outlines(Control::new(ctrl).dialog());
            }
            // A watcher's minimap gets the overlay's own header in place of the two buttons SC:R
            // keeps above it, so those stay hidden for a watcher. The game shows and hides them on
            // timers of its own, so hiding them once is not enough: their handlers are hooked to
            // refuse every show from here on. Everything else still reaches them, so the overlay
            // can still press one through the game's own code.
            if bw.is_replay_or_obs() {
                let ctrl = Control::new(ctrl);
                for child in ctrl.dialog().children() {
                    if matches!(child.id(), 3 | 4) {
                        let handler_hook = match child.id() {
                            3 => &MINIMAP_BUTTON1_EVENT_HANDLER,
                            _ => &MINIMAP_BUTTON2_EVENT_HANDLER,
                        };
                        if let Some(handler) = (*(*child)).event_handler {
                            let inited = handler_hook.init(keep_button_hidden);
                            inited.set_orig(handler as usize);
                            child.set_event_handler(inited);
                        }
                        child.hide();
                    }
                }
            }
        }
        ret
    }
}

/// The minimap image control's own draw function, which [`draw_minimap_without_camera_outlines`]
/// calls through. Zero until a live observer's minimap is initialized.
static MINIMAP_IMAGE_DRAW: AtomicUsize = AtomicUsize::new(0);

type ControlDrawFn =
    unsafe extern "C" fn(*mut bw::Control, i32, i32, *const bw::Rect, *const bw::Rect);

/// Keeps a live observer's minimap from outlining the players' cameras.
///
/// SC:R outlines the camera of every player an observer has vision of, in that player's color,
/// using viewport reports each human player sends the observers as Storm messages rather than in a
/// game turn. Netcode v2 doesn't carry Storm messages, so no report ever arrives: each human
/// player's outline is drawn from its zeroed initial viewport, a dot in the minimap's top-left
/// corner. The minimap image control's draw function is wrapped to leave the outlines out.
unsafe fn hide_player_camera_outlines(minimap: Dialog) {
    unsafe {
        // Control 1 is the minimap image, which sets its draw function in its own init event.
        let Some(image) = minimap.child_by_id(1) else {
            warn!("Minimap has no image control; observer camera outlines stay drawn");
            return;
        };
        let image = *image;
        let wrapper: ControlDrawFn = draw_minimap_without_camera_outlines;
        match (*image).draw {
            Some(draw) if draw as usize != wrapper as usize => {
                MINIMAP_IMAGE_DRAW.store(draw as usize, Ordering::Relaxed);
                (*image).draw = Some(wrapper);
            }
            Some(_) => (),
            None => {
                warn!("Minimap image has no draw function; observer camera outlines stay drawn")
            }
        }
    }
}

/// Draws the minimap image with no player in `replay_visions`, the set of players SC:R outlines
/// the cameras of. Nothing else the draw function does reads it: the units and fog it shows were
/// rendered into the minimap's texture beforehand, and its pings and the local screen's outline
/// don't depend on vision.
unsafe extern "C" fn draw_minimap_without_camera_outlines(
    ctrl: *mut bw::Control,
    x: i32,
    y: i32,
    clip: *const bw::Rect,
    area: *const bw::Rect,
) {
    unsafe {
        let draw = MINIMAP_IMAGE_DRAW.load(Ordering::Relaxed);
        if draw == 0 {
            return;
        }
        let draw: ControlDrawFn = std::mem::transmute(draw);
        let bw = get_bw();
        let visions = bw.replay_visions.resolve();
        bw.replay_visions.write(0);
        draw(ctrl, x, y, clip, area);
        bw.replay_visions.write(visions);
    }
}

/// Whether a hidden dialog must still see this event: the init and delete events, without which the
/// dialog would explode on unfinished initialization or undone cleanup.
unsafe fn allow_event_on_hidden_dialog(event: *mut bw::ControlEvent) -> bool {
    if (*event).ty == 0xe {
        match (*event).ext_type {
            // 0xa and 0x0 are init events, 0x1 is the delete event.
            0xa | 0x0 | 0x1 => true,
            _ => false,
        }
    } else {
        false
    }
}

/// The event handler a replaced dialog runs under.
///
/// Hiding a dialog stops it drawing but not responding, so this swallows every event but the
/// init/delete it needs to construct and tear down cleanly. Everything the dialog would have done on
/// its own goes with them: `TimeOut`'s countdown and its unwired Drop button, a menu's buttons.
unsafe extern "C" fn replaced_dialog_event_handler(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    unsafe {
        // Delete: the dialog is going away, so its replacement must not outlive it. Another
        // instance spawned since stays live.
        let replaced = native_dialogs::replacement_for(Control::new(ctrl).string());
        if (*event).ty == 0xe
            && (*event).ext_type == 0x1
            && let Some(replaced) = replaced
        {
            let _ = REPLACED_DIALOG_LIVE[replaced.index()].compare_exchange(
                ctrl as usize,
                0,
                Ordering::Relaxed,
                Ordering::Relaxed,
            );
        }
        let driven = replaced.is_some_and(|replaced| {
            REPLACED_DIALOG_DRIVEN[replaced.index()].load(Ordering::Relaxed) == ctrl as usize
        });
        if !driven && !allow_event_on_hidden_dialog(event) {
            return 0;
        }
        orig(ctrl, event)
    }
}

unsafe extern "C" fn console_dialog_event_handler(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    unsafe {
        let bw = get_bw();
        let control = Control::new(ctrl);
        let name = control.string();
        if bw.console_dialog_hidden(name)
            && !allow_event_on_hidden_dialog(event)
            && !(name == MENU_BUTTON_DIALOG && !is_pointer_event(event))
        {
            return 0;
        }
        orig(ctrl, event)
    }
}

/// The console's menu button, which also carries the keys that open the game menu (`F10`,
/// `Alt+M`). Hidden with the rest of the console, it still has to answer them, or a watcher with the
/// console hidden could not open the menu at all; only the pointer is kept from it.
const MENU_BUTTON_DIALOG: &str = "Stat_F10";

/// Whether a dialog event comes from the mouse: a move, a button, or the wheel.
unsafe fn is_pointer_event(event: *mut bw::ControlEvent) -> bool {
    unsafe { matches!((*event).ty, 0x3..=0xc | 0x11 | 0x12) }
}

/// The event handler of a button above a watcher's minimap, which refuses to be shown.
unsafe extern "C" fn keep_button_hidden(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    unsafe {
        // 0xd is the dialog system's show event.
        if (*event).ty == 0xe && (*event).ext_type == 0xd {
            return 0;
        }
        orig(ctrl, event as _)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(live: bool, spawns: u32) -> ReplacedDialogState {
        ReplacedDialogState { live, spawns }
    }

    fn change(closed: bool, spawned: bool) -> ReplacedDialogChange {
        ReplacedDialogChange { closed, spawned }
    }

    #[test]
    fn enter_is_recognized_with_modifiers_held() {
        assert!(is_enter_char(0x0d_u32));
        assert!(is_enter_char(0x0a_u32));
        // Shift, Ctrl and both held, as SC:R reports them
        assert!(is_enter_char(0x3_000d_u32));
        assert!(is_enter_char(0x4_000a_u32));
        assert!(is_enter_char(0x7_000d_u64));
    }

    #[test]
    fn other_characters_are_not_enter() {
        assert!(!is_enter_char(0x68_u32));
        assert!(!is_enter_char(0x3_003f_u32));
        assert!(!is_enter_char(0x0d00_u32));
        assert!(!is_enter_char(0x1b_u64));
    }

    #[test]
    fn nothing_moving_is_no_change() {
        assert_eq!(
            state(false, 3).change_to(state(false, 3)),
            change(false, false)
        );
        assert_eq!(
            state(true, 3).change_to(state(true, 3)),
            change(false, false)
        );
    }

    #[test]
    fn a_spawn_and_a_close_are_told_apart() {
        assert_eq!(
            state(false, 3).change_to(state(true, 4)),
            change(false, true)
        );
        assert_eq!(
            state(true, 4).change_to(state(false, 4)),
            change(true, false)
        );
    }

    #[test]
    fn a_dialog_replaced_between_reads_closes_and_spawns() {
        // SC:R closes its menu up when the menu is opened again, and the new one spawns before
        // the next read: the dialog stays live, but it is a different one.
        assert_eq!(state(true, 4).change_to(state(true, 5)), change(true, true));
    }

    #[test]
    fn a_dialog_that_came_and_went_between_reads_is_no_spawn() {
        assert_eq!(
            state(false, 4).change_to(state(false, 5)),
            change(false, false)
        );
    }

    #[test]
    fn a_replacement_already_gone_still_closes_the_first() {
        assert_eq!(
            state(true, 4).change_to(state(false, 6)),
            change(true, false)
        );
    }

    #[test]
    fn several_spawns_since_the_last_read_are_one_spawn() {
        assert_eq!(
            state(false, 4).change_to(state(true, 6)),
            change(false, true)
        );
    }
}
