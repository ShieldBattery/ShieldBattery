use std::sync::atomic::{AtomicU8, Ordering};

use bw_dat::dialog::{Control, Dialog, EventHandler};

use crate::bw::players::StormPlayerId;
use crate::bw::{self, Bw, get_bw};
use crate::game_thread::send_game_results;
use crate::netcode_v2;

use super::{BwScr, console};

static CHAT_BOX_EVENT_HANDLER: EventHandler = EventHandler::new();
static MSG_FILTER_EVENT_HANDLER: EventHandler = EventHandler::new();
static TIMEOUT_EVENT_HANDLER: EventHandler = EventHandler::new();
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
    unsafe {
        let dialog = Dialog::new(raw);
        let ctrl = dialog.as_control();
        let name = ctrl.string();
        // A permanent, cheap record of every dialog BW spawns — the safety net for identifying a
        // dialog by its real template name from a live run.
        debug!("spawn_dialog: {name:?}");
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
        } else if name.eq_ignore_ascii_case("timeout")
            && netcode_v2::with_turn_state(|_| ()).is_some()
        {
            // Under a netcode-v2 session the egui disconnect overlay is the sole disconnect surface;
            // BW's native waiting-for-players dialog (empty name list, unwired Drop button, its own
            // countdown) must never show. Hide it at spawn and swap in an event handler that swallows
            // everything but its own init/delete, so it neither draws nor responds. The native spawn
            // still runs below — only the dialog's visibility and interactivity are stripped, never
            // its creation.
            (*(raw as *mut bw::scr::Control)).flags &= !0x2;
            let inited = TIMEOUT_EVENT_HANDLER.init(timeout_event_handler);
            inited.set_orig(event_handler);
            inited.func() as usize
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
                    } else if text.is_empty() {
                        // Enter on an already-empty box: natively this just closes the chat box
                        // without sending anything, so skip our send tap entirely (no chat_out
                        // submit, no local echo injection) and fall through to the native `orig`
                        // call below, which closes the box exactly as it does after a real send.
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
fn specific_player_chat_target(bw: &BwScr) -> Option<netcode_v2::ChatTarget> {
    unsafe {
        let game = bw.game();
        if game.is_null() {
            return None;
        }
        // BW's chat-target field: 8 = everyone, 9 = allies, 0..7 = target player id,
        // | 0x80 = observer target. An observer target (or the 8/9 non-player values, which
        // shouldn't reach here in mode 4) isn't addressed as a normal player slot.
        let recipient = (*game).chat_dialog_recipient;
        if recipient & 0x80 != 0 {
            return None;
        }
        let player_id = recipient & 0x7f;
        if player_id >= 8 {
            return None;
        }
        let players = bw.players();
        if players.is_null() {
            return None;
        }
        // BW player id -> storm id (its players[] entry) -> rp2 slot (storm id ≡ slot under
        // netcode v2's identity mapping).
        let storm_id = (*players.add(player_id as usize)).storm_id;
        let storm = StormPlayerId(u8::try_from(storm_id).ok()?);
        netcode_v2::with_turn_state(|s| s.chat_target_for_storm(storm)).flatten()
    }
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

unsafe extern "C" fn timeout_event_handler(
    ctrl: *mut bw::Control,
    event: *mut bw::ControlEvent,
    orig: unsafe extern "C" fn(*mut bw::Control, *mut bw::ControlEvent) -> u32,
) -> u32 {
    unsafe {
        // Hiding the dialog stops it drawing but not responding, so swallow every event but the
        // init/delete it needs to construct and tear down cleanly. This kills its own
        // waiting-for-players countdown and its unwired Drop button along with the rest.
        if !allow_event_on_hidden_console(event) {
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
