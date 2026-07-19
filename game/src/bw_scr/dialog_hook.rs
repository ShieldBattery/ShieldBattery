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
/// 1-based team number of the dialog's "Team N" entry (the same numbering as `players[].team`),
/// and SC:R delivers the message to every player on that team *and* every player on the sender's
/// own team — teammates see a message addressed to either side. So there the result is the union
/// of both teams' rp2 slots; see [`team_shared_chat_target`].
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
/// as in `players[].team`), unioned with every rp2 slot whose BW player shares a team with the
/// local player — the sender's own team sees the message too, alongside the addressed team.
/// `players` is BW's live `players[]` array.
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
