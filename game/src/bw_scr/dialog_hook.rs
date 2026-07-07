use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU8, Ordering};

use bw_dat::dialog::{Control, Dialog, EventHandler};

use crate::bw::{self, Bw, get_bw};
use crate::game_thread::send_game_results;
use crate::netcode_v2;

use super::console;

static CHAT_BOX_EVENT_HANDLER: EventHandler = EventHandler::new();
static MSG_FILTER_EVENT_HANDLER: EventHandler = EventHandler::new();
static MINIMAP_EVENT_HANDLER: EventHandler = EventHandler::new();
static MINIMAP_BUTTON1_EVENT_HANDLER: EventHandler = EventHandler::new();
static MINIMAP_BUTTON2_EVENT_HANDLER: EventHandler = EventHandler::new();
static CONSOLE_DIALOG_EVENT_HANDLERS: [EventHandler; console::CONSOLE_DIALOGS.len()] =
    [NEW_EVENT_HANDLER; console::CONSOLE_DIALOGS.len()];
static PREVENT_BUTTON_HIDE_COUNT: AtomicU8 = AtomicU8::new(0);
/// The live "MsgFltr" chat-target-scope dialog's control pointer, stashed by
/// [`msg_filter_event_handler`] the first (and every) time it runs so
/// [`chat_target_scope`] can read the dialog's current selection at chat-send time. Null until
/// the dialog has been created at least once.
static MSG_FILTER_DIALOG: AtomicPtr<bw::Control> = AtomicPtr::new(null_mut());
/// Whether [`chat_target_scope`] has already dumped the `MsgFltr` dialog's children to the log.
/// The dump is a one-time diagnostic (the dialog's layout doesn't change at runtime), not
/// something worth repeating on every chat message.
static MSG_FILTER_DUMPED: AtomicBool = AtomicBool::new(false);

// Helper needed for initializing array of event handlers
#[allow(clippy::declare_interior_mutable_const)]
const NEW_EVENT_HANDLER: EventHandler = EventHandler::new();

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
        let event_handler = if name == "TextBox" {
            let inited = CHAT_BOX_EVENT_HANDLER.init(chat_box_event_handler);
            inited.set_orig(event_handler);
            inited.func() as usize
        } else if name == "MsgFltr" {
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
        } else if name == "WMission" {
            send_game_results();
            // Victory decides the game for everyone, so the session can end and any further play is
            // local-only. Defeat is deliberately not handled the same way: a loss doesn't end the
            // game for the other players, so the defeated client stays a normal networked
            // participant until it exits, at which point its clean leave fires as the game loop ends.
            crate::netcode_v2::begin_local_only();
            event_handler
        } else if name == "LMission" {
            send_game_results();
            event_handler
        } else {
            event_handler
        };
        orig(raw, unk, event_handler)
    }
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
                let key = (*event).param;
                // Enter/return while the chat box was open
                if !edit_box.is_hidden() && (key == 0xa || key == 0xd) {
                    let text = edit_box.string();
                    if bw.handle_chat_command(text) {
                        // Clear the chat box text so no message gets sent
                        edit_box.set_string(b"");
                    } else {
                        // A live netcode v2 session carries chat over its own relay channel — the
                        // native battlenet-gateway send is dead under it, and this client's own
                        // copy renders only via `send_chat_message`'s injected local echo (see its
                        // doc comment). Clear the box the same way a handled slash command does so
                        // the dead native send below (and its local ClientSdk loopback echo) never
                        // fires and never doubles up our own already-injected echo.
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
        // Stash the live dialog pointer so `chat_target_scope` can read this dialog's current
        // selection later, at chat-send time (from `chat_box_event_handler`, a different control's
        // handler entirely).
        MSG_FILTER_DIALOG.store(ctrl, Ordering::Relaxed);

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

/// The chat-target scope the `MsgFltr` dialog's current selection names, for the chat-box send
/// tap in [`chat_box_event_handler`].
///
/// The first time this runs (once the dialog has been observed at all — see
/// [`msg_filter_event_handler`]), it dumps every child control's id, label, and raw flags at
/// `debug!` level. The ids and labels this dialog uses aren't known yet, and
/// `bw_dat::dialog::Control` exposes no "checked"/"selected" accessor for a radio-style control —
/// only `flags()`'s raw bits, `id()`, `string()`, `is_hidden()`, and `is_disabled()` — so this dump
/// is how a live run pins down which child is which and whether any bit in `flags()` tracks the
/// active selection. Until that mapping exists, this always resolves to `ChatTarget::All`.
fn chat_target_scope() -> netcode_v2::ChatTarget {
    let ptr = MSG_FILTER_DIALOG.load(Ordering::Relaxed);
    let Some(ptr) = (!ptr.is_null()).then_some(ptr) else {
        debug!("netcode v2: no MsgFltr dialog observed yet; defaulting chat target to All");
        return netcode_v2::ChatTarget::All;
    };
    if !MSG_FILTER_DUMPED.swap(true, Ordering::Relaxed) {
        // Safety: `ptr` came from a live event handler call on this same dialog, so it's a valid
        // control at this point (event handlers only fire on controls that still exist).
        let dialog = unsafe { Control::new(ptr) }.dialog();
        for child in dialog.children() {
            debug!(
                "netcode v2: MsgFltr child id={} string={:?} flags={:#x} hidden={} disabled={}",
                child.id(),
                child.string(),
                child.flags(),
                child.is_hidden(),
                child.is_disabled(),
            );
        }
    }
    netcode_v2::ChatTarget::All
}

unsafe extern "C" fn minimap_event_handler(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    unsafe {
        let bw = get_bw();
        if bw.console_hidden() && !allow_event_on_hidden_console(event) {
            return 0;
        }
        let ret = orig(ctrl, event);
        // Init event
        if (*event).ty == 0xe && (*event).ext_type == 0x0 {
            // Apply the user's saved minimap color/terrain toggles now that the minimap (and its
            // associated globals) are initialized. Done after `orig` so it wins over any reset the
            // game's own init does.
            bw.restore_minimap_settings();
            // Replay / obs UI won't have the alliance / chat buttons show above
            // minimap unless explicitly shown.
            // But annoyingly they are not immediately hidden by the init event, but
            // a timer is queued to hide them after a bit, so knowing when to show them
            // again is kind of annoying.. Have to hook the relevant control's event handlers
            // and have them ignore the hide event.
            if bw.is_replay_or_obs() {
                let ctrl = Control::new(ctrl);
                for child in ctrl.dialog().children() {
                    if matches!(child.id(), 3 | 4) {
                        let handler_hook = match child.id() {
                            3 => &MINIMAP_BUTTON1_EVENT_HANDLER,
                            _ => &MINIMAP_BUTTON2_EVENT_HANDLER,
                        };
                        if let Some(handler) = (*(*child)).event_handler {
                            let inited = handler_hook.init(prevent_button_hide);
                            inited.set_orig(handler as usize);
                            child.set_event_handler(inited);
                            PREVENT_BUTTON_HIDE_COUNT.fetch_add(1, Ordering::Relaxed);
                        }
                        child.show();
                    }
                }
            }
        }
        ret
    }
}

unsafe fn allow_event_on_hidden_console(event: *mut bw::ControlEvent) -> bool {
    if (*event).ty == 0xe {
        match (*event).ext_type {
            // 0xa and 0x0 are init events, 0x1 is delete event, so those have to
            // be allowed in order for the dialog not exploding due to unfinished
            // initialization / undone cleanup.
            // (We probably don't have these dialogs ever be deleted though)
            0xa | 0x0 | 0x1 => true,
            _ => false,
        }
    } else {
        false
    }
}

unsafe extern "C" fn console_dialog_event_handler(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    unsafe {
        let bw = get_bw();
        if bw.console_hidden() && !allow_event_on_hidden_console(event) {
            return 0;
        }
        orig(ctrl, event)
    }
}

unsafe extern "C" fn prevent_button_hide(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    unsafe {
        if (*event).ty == 0xe && (*event).ext_type == 0xe {
            // Hide
            let hide_skip_count = PREVENT_BUTTON_HIDE_COUNT.load(Ordering::Relaxed);
            if hide_skip_count != 0 {
                debug!("Skipping minimap button hide");
                PREVENT_BUTTON_HIDE_COUNT.store(hide_skip_count - 1, Ordering::Relaxed);
                return 0;
            }
        }
        orig(ctrl, event as _)
    }
}
