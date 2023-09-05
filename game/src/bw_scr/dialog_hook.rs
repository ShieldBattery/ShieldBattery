use std::sync::atomic::{AtomicU8, Ordering};

use bw_dat::dialog::{Control, Dialog, EventHandler};

use crate::bw::{self, get_bw, Bw};
use crate::game_thread::send_game_results;

use super::console;

static CHAT_BOX_EVENT_HANDLER: EventHandler = EventHandler::new();
static MSG_FILTER_EVENT_HANDLER: EventHandler = EventHandler::new();
static MINIMAP_EVENT_HANDLER: EventHandler = EventHandler::new();
static MINIMAP_BUTTON1_EVENT_HANDLER: EventHandler = EventHandler::new();
static MINIMAP_BUTTON2_EVENT_HANDLER: EventHandler = EventHandler::new();
static CONSOLE_DIALOG_EVENT_HANDLERS: [EventHandler; console::CONSOLE_DIALOGS.len()] =
    [NEW_EVENT_HANDLER; console::CONSOLE_DIALOGS.len()];
static PREVENT_BUTTON_HIDE_COUNT: AtomicU8 = AtomicU8::new(0);

// Helper needed for initializing array of event handlers
#[allow(clippy::declare_interior_mutable_const)]
const NEW_EVENT_HANDLER: EventHandler = EventHandler::new();

pub unsafe fn spawn_dialog_hook(
    raw: *mut bw::Dialog,
    unk: usize,
    event_handler: usize,
    orig: unsafe extern "C" fn(*mut bw::Dialog, usize, usize) -> usize,
) -> usize {
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
    } else if name == "WMission" || name == "LMission" {
        send_game_results();
        event_handler
    } else {
        event_handler
    };
    orig(raw, unk, event_handler)
}

unsafe extern "C" fn chat_box_event_handler(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    // This dialog checks if allies are enabled to allow/prevent ally chat;
    // as we disable allies to prevent changing them from what they originally
    // were, restore alliance state temporarely to make ally chat work.
    let bw = get_bw();
    let game_data = bw.game_data();
    let old = (*game_data).game_template.allies_enabled;
    (*game_data).game_template.allies_enabled = if bw::get_had_allies_enabled() { 1 } else { 0 };
    let ret = orig(ctrl, event);
    (*game_data).game_template.allies_enabled = old;
    ret
}

unsafe extern "C" fn msg_filter_event_handler(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    // Same as chat box, to make the radio button for "Send to allies" enabled even when
    // alliances cannot be changed.
    let bw = get_bw();
    let game_data = bw.game_data();
    let old = (*game_data).game_template.allies_enabled;
    (*game_data).game_template.allies_enabled = if bw::get_had_allies_enabled() { 1 } else { 0 };
    let ret = orig(ctrl, event);
    (*game_data).game_template.allies_enabled = old;
    ret
}

unsafe extern "C" fn minimap_event_handler(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    let bw = get_bw();
    if bw.console_hidden() {
        return 0;
    }
    let ret = orig(ctrl, event);
    let event = event as *mut bw::scr::ControlEvent;
    // Init event
    if (*event).ty == 0xe && (*event).ext_type == 0x0 {
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
                    if let Some(handler) = (*(*child as *mut bw::scr::Control)).event_handler {
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

unsafe extern "C" fn console_dialog_event_handler(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    let bw = get_bw();
    if bw.console_hidden() {
        return 0;
    }
    orig(ctrl, event)
}

unsafe extern "C" fn prevent_button_hide(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    let event = event as *mut bw::scr::ControlEvent;
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
