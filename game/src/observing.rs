use std::ffi::CStr;
use std::mem;

use libc::c_void;

use crate::bw;

pub unsafe fn process_commands_hook(
    data: *const u8,
    len: u32,
    replay: u32,
    orig: unsafe extern fn(*const u8, u32, u32),
) {
    if replay == 0 && *bw::current_command_player >= 8 {
        // Replace anything sent by observers with a keep alive command, I'm quite sure there will
        // be buffer overflows otherwise.
        let buf = [0x05u8];
        orig(buf.as_ptr(), 1, replay);
    } else {
        orig(data, len, replay);
    }
}

// Don't validate sync commands when observing. As the sync contains visibility info, observers
// are out of sync from everyone else, as their vision settings are not sent to other players.
pub unsafe fn sync_command_hook(
    data: *const u8,
    orig: unsafe extern fn(*const u8) -> u32,
) -> u32 {
    if is_local_player_observer() {
        1
    } else {
        orig(data)
    }
}

pub unsafe fn chat_message_hook(
    storm_player: u32,
    message: *const u8,
    length: u32,
    orig: unsafe extern fn(u32, *const u8, u32) -> u32,
) -> u32 {
    use std::io::Write;
    if bw::storm_id_to_human_id[storm_player as usize] >= 8 {
        // Observer message, we'll have to manually print text and add to replay recording.
        let message = std::slice::from_raw_parts(message, length as usize);

        // The length should include null byte
        if message.last() != Some(&0) {
            return 0;
        }
        // There's some unnecessary control information at the start of message
        let text = match message.get(2..(message.len() - 1)) {
            Some(s) => s,
            None => return 0,
        };
        let mut buf = [0; 512];
        let format = |mut pos: &mut [u8], msg_color: u8| -> Result<(), std::io::Error> {
            // Write "\x1f{player}: \x02{message}"
            // 0x1f is the neutral cyan color and 0x02 is the regular chat message one.
            write!(&mut pos, "\x1f")?;
            let name =
                CStr::from_ptr(bw::storm_players[storm_player as usize].name.as_ptr() as *const i8);
            pos.write_all(name.to_bytes())?;
            write!(&mut pos, ": ")?;
            pos.write_all(&[msg_color])?;
            pos.write_all(text)?;
            Ok(())
        };
        let _ = format(&mut buf[..], 0x02);
        let mut replay_command = [0u8; 0x52];
        replay_command[0] = 0x5c; // Replay chat
        replay_command[1] = 0x8; // Player
        let _ = (&mut replay_command[2..]).write(&buf[..]);
        replay_command[0x51] = 0;
        bw::add_to_replay_data(
            *bw::replay_data,
            replay_command.as_ptr(),
            replay_command.len() as u32,
            storm_player,
        );

        if storm_player == *bw::local_storm_id {
            // Switch the message to be green to show it's player's own message
            let _ = format(&mut buf[..], 0x07);
        }
        bw::display_message(buf.as_ptr(), 0);
        return length;
    } else {
        orig(storm_player, message, length)
    }
}

pub unsafe fn load_dialog_hook(
    dialog: *mut bw::Dialog,
    base: *mut c_void,
    event_handler: *mut c_void,
    source_file: *const u8,
    source_line: u32,
    orig: unsafe extern fn(*mut bw::Dialog, *mut c_void, *mut c_void, *const u8, u32),
) {
    orig(dialog, base, event_handler, source_file, source_line);
    if !is_local_player_observer() {
        return;
    }
    let name = CStr::from_ptr((*dialog).base.label as *const i8).to_bytes();
    if name == b"TextBox" {
        if let Some(to_allies) = find_dialog_child(dialog, 0x2) {
            (*to_allies).label = b"To Observers:\0".as_ptr();
            // Of course the control has to be resized by hand <.<
            // Possibly could also just make it left aligned.
            // This can be determined "easily" by breaking 1.16.1 in debugger at 004F2FFF when
            // opening chat entry while talking to one player, and replacing the "To player:"
            // string, and stepping over the call.
            (*to_allies).area.right = 0x55;
        } else {
            error!("Couldn't find 'To Allies:' control");
        }
    } else if name == b"MsgFltr" {
        if let Some(to_allies) = find_dialog_child(dialog, 0x3) {
            (*to_allies).label = b"Send to observers\0".as_ptr();
        } else {
            error!("Couldn't find 'Send to allies' control");
        }
    }
}

pub unsafe fn init_ui_variables_hook(orig: unsafe extern fn()) {
    orig();
    if is_local_player_observer() {
        *bw::replay_visions = 0xff;
        *bw::player_visions = 0xff;
        // To allies (=observers)
        *bw::chat_dialog_recipent = 9;
        // Could also set the race, it currently just does an overflow read to zerg.
    }
}

pub unsafe fn cmdbtn_event_handler_hook(
    control: *mut bw::Control,
    event: *mut bw::UiEvent,
    orig: unsafe extern fn(*mut bw::Control, *mut bw::UiEvent) -> u32,
) -> u32 {
    if !is_local_player_observer() {
        orig(control, event)
    } else {
        // Disable clicking on command buttons.
        // Event 4 = Left click, 6 = Double click, Extended 3 = Hotkey
        if (*event).ty == 0x4 || (*event).ty == 0x6 {
            0
        } else if (*event).ty == 0xe && (*event).extended_type == 3 {
            1
        } else {
            orig(control, event)
        }
    }
}

pub unsafe fn get_gluall_string_hook(
    string_id: u32,
    orig: unsafe extern fn(u32) -> *const u8,
) -> *const u8 {
    // Replace "Replay players" text in the alliance dialog when observing
    if string_id == 0xb6 && is_local_player_observer() {
        "Players\0".as_ptr()
    } else {
        orig(string_id)
    }
}

pub unsafe fn update_net_timeout_players(orig: unsafe extern fn()) {
    unsafe fn find_timeout_dialog_player_label(bw_player: u8) -> Option<*mut bw::Control> {
        if (*bw::timeout_bin).is_null() {
            return None;
        }
        let mut label = find_dialog_child(*bw::timeout_bin, -10)?;
        let mut label_count = 0;
        while !label.is_null() && label_count < 8 {
            // Flag 0x8 == Shown
            if (*label).flags & 0x8 != 0 && (*label).custom_value as usize == bw_player as usize {
                return Some(label);
            }
            label = (*label).next;
            label_count += 1;
        }
        None
    }
    // To make observers appear in network timeout dialog, we temporarily write their info to
    // ingame player structure, and revert the change after this function has been called.

    let bw_players: &mut [bw::Player] = &mut bw::players[..8];
    let actual_players: [bw::Player; 8] = {
        let mut players: [bw::Player; 8] = mem::zeroed();
        for i in 0..players.len() {
            players[i] = bw_players[i].clone();
        }
        players
    };
    let mut overwritten_player_id_to_storm = [None; 8];
    for storm_id in 0..8 {
        let is_obs = !actual_players.iter().any(|x| x.storm_id == storm_id);
        if is_obs {
            match bw_players
                .iter()
                .position(|x| x.player_type != bw::PLAYER_TYPE_HUMAN)
            {
                Some(pos) => {
                    overwritten_player_id_to_storm[pos] = Some(storm_id);
                    bw_players[pos].storm_id = storm_id;
                    bw_players[pos].player_type = bw::PLAYER_TYPE_HUMAN;
                }
                None => {
                    error!(
                        "Net timeout dialog: Out of player slots for observer, storm id {}",
                        storm_id
                    );
                }
            }
        }
    }

    orig();

    for bw_player in 0..8 {
        if let Some(storm_id) = overwritten_player_id_to_storm[bw_player] {
            if let Some(ctrl) = find_timeout_dialog_player_label(bw_player as u8) {
                // We need to redirect the name string to the storm player string, and replace the
                // player value to unused player 10, whose color will be set to neutral resource
                // color. (The neutral player 11 actually can have a different color for neutral
                // buildings)
                //
                // Technically player 10 can actually have units in some odd UMS maps, but we
                // aren't allowing observing UMS games anyways, so whatever. Even if the someone
                // noticed the color changing, I doubt they would care.
                (*ctrl).label = bw::storm_players[storm_id as usize].name.as_ptr();
                (*ctrl).custom_value = 10usize as *mut c_void;
                bw::player_minimap_color[10] = *bw::resource_minimap_color;
            }
        }
    }
    for (i, player) in actual_players.iter().enumerate() {
        bw::players[i] = player.clone();
    }
}

pub unsafe fn update_command_card_hook(orig: unsafe extern fn()) {
    if is_local_player_observer() && !(*bw::primary_selected).is_null() {
        *bw::local_nation_id = (**bw::primary_selected).player as u32;
        orig();
        *bw::local_nation_id = !0;
    } else {
        orig();
    }
}

pub unsafe fn draw_command_button_hook(
    control: *mut bw::Control,
    x: i32,
    y: i32,
    area: *mut c_void,
    orig: unsafe extern fn(*mut bw::Control, i32, i32, *mut c_void),
) {
    // Need to disable replay flag being set from DrawScreenHook if observing
    let was_replay = *bw::is_replay;
    if is_local_player_observer() {
        *bw::is_replay = 0;
    }
    orig(control, x, y, area);
    *bw::is_replay = was_replay;
}

pub unsafe fn center_screen_on_start_location(
    unit: *mut bw::PreplacedUnit,
    other: *mut c_void,
    orig: unsafe extern fn(*mut bw::PreplacedUnit, *mut c_void) -> u32,
) -> u32 {
    let was_replay = *bw::is_replay;
    if is_local_player_observer() && bw::players[(*unit).player as usize].player_type != 0 {
        // Center the screen once we get the first active player so observers don't randomly
        // end up staring at unused start location.
        *bw::is_replay = 1;
    }
    let result = orig(unit, other);
    *bw::is_replay = was_replay;
    result
}

unsafe fn find_dialog_child(dialog: *mut bw::Dialog, child_id: i16) -> Option<*mut bw::Control> {
    let mut control = (*dialog).first_child;
    while !control.is_null() {
        if (*control).id == child_id {
            return Some(control);
        }
        control = (*control).next;
    }
    None
}

unsafe fn is_local_player_observer() -> bool {
    // Should probs use shieldbattery's data instead of checking BW variables,
    // but we don't have anything that's readily accessible by game thread.
    *bw::local_nation_id == !0
}

pub unsafe fn with_replay_flag_if_obs<F: FnOnce() -> R, R>(func: F) -> R {
    let was_replay = *bw::is_replay;
    if is_local_player_observer() {
        *bw::is_replay = 1;
    }
    let ret = func();
    *bw::is_replay = was_replay;
    ret
}
