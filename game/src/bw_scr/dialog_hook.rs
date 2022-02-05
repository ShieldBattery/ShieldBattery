use bw_dat::dialog::{Dialog, EventHandler};

use crate::bw::{self, get_bw};

static CHAT_BOX_EVENT_HANDLER: EventHandler = EventHandler::new();
static MSG_FILTER_EVENT_HANDLER: EventHandler = EventHandler::new();

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
