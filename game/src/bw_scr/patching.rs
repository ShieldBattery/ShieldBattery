//! Installation of gameplay and platform hooks.

use std::borrow::Cow;
use std::ffi::CStr;
use std::ptr::null;
use std::sync::atomic::Ordering;
use std::time::Instant;

use byteorder::{ByteOrder, LittleEndian};
use libc::c_void;
use winapi::um::libloaderapi::GetModuleHandleW;

#[cfg(debug_assertions)]
use super::SelectedUnit;
use super::network::{TurnReceiveOutcome, TurnSendOutcome};
use super::selection::flash_target_sprite;

use crate::GameThreadMessage;
use crate::bw::commands;
use crate::bw::unit::Unit;
use crate::bw::{self, Bw};
use crate::game_thread::{self, send_game_msg_to_async};
use crate::netcode_v2;
use crate::windows;

use super::{
    BwScr, ChatInjection, SNP_INITIALIZED, check_documents_starcraft_path_accessibility,
    connect_hook, copy_file_hook, create_event_hook, create_file_hook, dialog_hook, file_hook,
    game, get_file_attributes_hook, get_system_time_precise_as_file_time_hook, load_snp_list_hook,
    log_time, native_sync_disabled, rollback_resimulating, rollback_step, scr, sdf_cache,
    sh_get_folder_path_w_hook, shell_execute_hook, step_game_logic_hook, tick_gates,
};

impl BwScr {
    pub unsafe fn patch_game(&'static self, image: *mut u8) {
        unsafe {
            use super::hooks::*;
            debug!("Patching SCR");
            let base = GetModuleHandleW(null()) as *mut _;
            let mut active_patcher = crate::PATCHER.lock();
            let mut exe = active_patcher.patch_memory(image as *mut _, base, 0);
            let base = base as usize;
            #[cfg(debug_assertions)]
            {
                crate::rollback_probe::set_writable_image(image);
                crate::rollback_probe::install_at_init(self, "patch_game");
            }

            if let Some(sc_main) = self.sc_main {
                // This is a hook at early point during program startup, some initial
                // settings have been done already though.
                // Just used for checking if documents path is somehow unaccessible,
                // as this is right after BW does it's own checks for it.
                // mainmenu_entry_hook is further into this same function.
                //
                // Update: Now that we hook SHGetFolderPathW anyway maybe this hook
                // is pretty redundant, probably should be deleted once we're sure it
                // won't give any extra information.
                let address = sc_main.0 as usize - base;
                exe.hook_closure_address(
                    ScMain,
                    move |orig| {
                        check_documents_starcraft_path_accessibility();
                        orig();
                    },
                    address,
                );
            }

            let address = self.mainmenu_entry_hook.0 as usize - base;
            exe.call_hook_closure_address(
                GameInit,
                move |_| {
                    debug!("SCR game init hook");
                    #[cfg(debug_assertions)]
                    crate::rollback_probe::install_at_init(self, "game_init");
                    crate::process_init_hook();
                },
                address,
            );

            let address = self.load_snp_list.0 as usize - base;
            exe.hook_closure_address(LoadSnpList, load_snp_list_hook, address);
            #[cfg(debug_assertions)]
            if crate::input_latency_probe::enabled() || crate::hotkey_order_probe::enabled() {
                let address = self.send_command as usize - base;
                exe.hook_closure_address(
                    SendCommand,
                    move |data, len, orig| {
                        let game = self.game();
                        if !game.is_null() && !data.is_null() {
                            let command = std::slice::from_raw_parts(data, len);
                            crate::input_latency_probe::on_send_command(
                                command,
                                (*game).frame_count,
                            );
                            crate::hotkey_order_probe::on_send_command(command);
                        }
                        orig(data, len)
                    },
                    address,
                );
            }
            // The UDP server seems to be just Bonjour stuff, which we don't use.
            let address = self.start_udp_server.0 as usize - base;
            exe.hook_closure_address(StartUdpServer, |_, _| 1, address);

            let address = self.process_game_commands as usize - base;
            exe.hook_closure_address(
                ProcessGameCommands,
                move |data, len, are_recorded_replay_commands, orig| {
                    let command_user = self.command_user.resolve();
                    let unique_command_user = self.unique_command_user.resolve();
                    let is_replay = game_thread::is_replay();
                    let is_observer = command_user >= 128;
                    let slice = std::slice::from_raw_parts(data, len);
                    let slice = commands::filter_invalid_commands(
                        slice,
                        are_recorded_replay_commands != 0,
                        is_observer,
                        &self.game_command_lengths,
                    );
                    let strip_sync = native_sync_disabled() && !is_replay;
                    let slice: Cow<'_, [u8]> = match strip_sync {
                        true => Cow::Owned(
                            commands::strip_sync_commands(&slice, &self.game_command_lengths)
                                .into_owned(),
                        ),
                        false => slice,
                    };
                    // The replay UI's seeks go to keyframe seeking when it handles them.
                    let slice: Cow<'_, [u8]> = match is_replay && are_recorded_replay_commands == 0
                    {
                        true => match commands::replay_seek_target(&slice, &self.game_command_lengths)
                        {
                            Some(target) if crate::replay_seek::take_seek_request(self, target) => {
                                // Playback tracking reads the commands below, after this strip, so
                                // without this it would hold back every later seek until its
                                // timeout.
                                self.note_replay_seek_taken();
                                Cow::Owned(
                                    commands::strip_replay_seeks(&slice, &self.game_command_lengths)
                                        .into_owned(),
                                )
                            }
                            _ => slice,
                        },
                        false => slice,
                    };
                    let strip_notice = are_recorded_replay_commands != 0
                        && game_thread::sbat_replay_data().is_some();
                    let slice: Cow<'_, [u8]> = match strip_notice {
                        true => Cow::Owned(
                            commands::strip_replay_notice(&slice, &self.game_command_lengths)
                                .into_owned(),
                        ),
                        false => slice,
                    };
                    #[cfg(debug_assertions)]
                    if !is_replay
                        && unique_command_user == self.local_unique_player_id.resolve()
                        && !rollback_resimulating()
                    {
                        let game = self.game();
                        if !game.is_null() {
                            crate::input_latency_probe::on_local_commands(
                                &slice,
                                (*game).frame_count,
                                &self.game_command_lengths,
                            );
                        }
                    }
                    let mut sync_seen = false;
                    let mut alliance_or_vision_seen = false;
                    // New scope for mutex locks (Not necessarily needed but avoiding calling back to
                    // BW with mutexes locked is generally a good pattern to follow IMO)
                    {
                        let mut apm_state = self.apm_state.lock();
                        let apm_player = unique_command_user as u8;
                        let rollback_step = rollback_step().map(|(frame, _)| frame);
                        let count_apm = (!is_replay || are_recorded_replay_commands != 0)
                            && apm_state.as_ref().is_some_and(|apm| {
                                rollback_step.is_none_or(|step| apm.counts_turn(apm_player, step))
                            });
                        let mut counted_actions = false;
                        for command in commands::iter_commands(&slice, &self.game_command_lengths) {
                            if let Some(ref mut apm) = apm_state
                                && count_apm
                            {
                                counted_actions |= apm.action(apm_player, command);
                            }
                            // Live commands of a replay only; see `ReplayPlayback::note_command`.
                            if is_replay && are_recorded_replay_commands == 0 {
                                self.note_replay_playback_command(command);
                            }
                            match command {
                                [commands::id::REPLAY_SEEK, rest @ ..] if rest.len() == 4
                                    && are_recorded_replay_commands == 0 => {
                                        let frame = LittleEndian::read_u32(rest);
                                        let game = self.game();
                                        if (*game).frame_count > frame {
                                            self.is_replay_seeking.store(true, Ordering::Relaxed);
                                            self.note_replay_restart();
                                            self.note_replay_vision_restart();
                                        }
                                    }
                                [commands::id::SYNC, ..] | [commands::id::NOP, ..]
                                    if are_recorded_replay_commands == 0 => {
                                        sync_seen = true;
                                    }
                                // Vision/alliance toggles are rare, and whether the native
                                // handlers accept them depends on guards that differ between
                                // live games and replay playback (a rejected toggle still gets
                                // recorded). Log each one plus the state it leaves behind so
                                // that difference is visible in the logs of both.
                                [commands::id::VISION, ..] | [commands::id::ALLIANCE, ..] => {
                                    alliance_or_vision_seen = true;
                                    debug!(
                                        "Alliance/vision command from game player \
                                        {command_user} (unique {unique_command_user}, \
                                        already-recorded {are_recorded_replay_commands}, \
                                        replay {is_replay}): {command:02x?}"
                                    );
                                }
                                _ => (),
                            }
                        }
                        if counted_actions
                            && let Some(ref mut apm) = apm_state
                            && let Some(step) = rollback_step
                        {
                            apm.counted_turn(apm_player, step);
                        }
                    }

                    if !is_replay
                        && !rollback_resimulating()
                        && let Some(players) = self.check_player_drops() {
                            let frame = (*self.game()).frame_count;
                            let turn_seq = self.snet_next_turn_sequence_number().wrapping_sub(1);
                            info!(
                                "Dropped players {:?} at some point between last check and before \
                            handling commands for game player {} net {}. Game frame 0x{:x}, \
                            turn seq {}",
                                players,
                                command_user,
                                self.storm_command_user.resolve(),
                                frame,
                                turn_seq,
                            );
                        }
                    // There should be no way this is called recursively, but even still
                    // handle that case by keeping track of was_processing.
                    let was_processing = self.is_processing_game_commands.load(Ordering::Relaxed);
                    self.is_processing_game_commands
                        .store(true, Ordering::Relaxed);
                    orig(slice.as_ptr(), slice.len(), are_recorded_replay_commands);
                    self.is_processing_game_commands
                        .store(was_processing, Ordering::Relaxed);
                    if alliance_or_vision_seen && (command_user as usize) < 12 {
                        let game = self.game();
                        debug!(
                            "Post-command alliances for player {command_user}: {:?}, \
                            visions {:#x}",
                            (*game).alliances[command_user as usize],
                            (*game).visions[command_user as usize],
                        );
                    }
                    if !is_replay {
                        if !sync_seen {
                            // With native sync off, no turn carries a sync command, and a no-op
                            // stands in for it the same way it does for an observer.
                            if is_observer || strip_sync {
                                // Observers don't send sync commands correctly.
                                // Send no-op command 0x05 which counts as a correct sync to
                                // prevent them from dropping.
                                //
                                // SC:R's setup has observers with storm id >= 128,
                                // for which process_game_commands is not called at all.
                                // Our setup uses "normal" storm ids for observers, as that
                                // makes allocating storm ids during launch simpler, but will
                                // require doing this (As well as filtering out almost all
                                // commands the observer sends)
                                orig(&5u8, 1, 0);
                            } else {
                                let storm_user = self.storm_command_user.resolve();
                                // The mask has one bit per storm player; an out-of-range id here
                                // means sender identity is corrupt, which shifting by it would
                                // turn into an overflow panic on top of the actual problem.
                                if storm_user < bw::MAX_STORM_PLAYERS as u32 {
                                    self.dropped_players.store(
                                        self.dropped_players.load(Ordering::Relaxed)
                                            | (1 << storm_user),
                                        Ordering::Relaxed,
                                    );
                                }
                                info!(
                                    "Didn't see sync command for game player {command_user} net {storm_user}, {slice:02x?}, \
                                they will be dropped",
                                );
                            }
                        }
                        if let Some(players) = self.check_player_drops() {
                            let frame = (*self.game()).frame_count;
                            let turn_seq = self.snet_next_turn_sequence_number().wrapping_sub(1);
                            info!(
                                "Dropped players {:?} while handling commands for game player {} \
                            net {}, {:02x?}. Game frame 0x{:x}, turn seq {}",
                                players,
                                command_user,
                                self.storm_command_user.resolve(),
                                slice,
                                frame,
                                turn_seq,
                            );
                        }
                    }
                },
                address,
            );
            let address = self.step_io.0 as usize - base;
            exe.hook_closure_address(
                StepIo,
                move |scheduler, orig| {
                    orig(scheduler);
                    // BW actually only calls these in a case which would be equivalent with our SNP
                    // code calling receive_callback() (Which is nop in SCR for now), but these
                    // are cheap enough to always call. It may also be slightly better on
                    // unreliable networks as this sends packets every frame instead of every
                    // time a packets are received in a frame.
                    //
                    // Still need to check that the SNP is ready BW side.
                    //
                    // The native-lobby seam (and the sessionless solo path) still create a real
                    // Storm session, so the chosen SNP provider initializes and Storm's own lobby
                    // tick keeps running: this pump drives that tick's flush + receive, and the
                    // OUT/IN hooks intercept the sends/receives it produces to carry them over the
                    // rally-point2 relay instead of a real network. All actual transport rides the
                    // relay; the SNP provider itself only ever moves bytes into the inert stubs.
                    if SNP_INITIALIZED.load(Ordering::Relaxed) {
                        (self.snet_recv_packets)();
                        (self.snet_send_packets)();
                    }
                },
                address,
            );
            let address = self.process_lobby_commands as usize - base;
            exe.hook_closure_address(
                ProcessLobbyCommands,
                move |data, len, player, orig| {
                    let slice = std::slice::from_raw_parts(data, len);
                    // Anything other than a bare 1-byte 0x05 keep-alive is rare during lobby, so
                    // log it: the command byte, sender, and the lobby_state it arrives into (a
                    // 0x69 slot-setup resets lobby_state to 4, stomping a hand-written 8).
                    if slice.len() > 1 || slice.first() != Some(&5) {
                        debug!(
                            "Lobby command {:02x?} from player {} at lobby_state {}",
                            &slice[..slice.len().min(16)],
                            player,
                            self.lobby_state.resolve(),
                        );
                    }
                    if let Some(&byte) = slice.first()
                        && byte == bw::LOBBY_GAME_INIT_COMMAND
                        && player == 0
                    {
                        let seq = self.snet_next_turn_sequence_number();
                        // I think that the sequence number for next turn gets incremented
                        // before reaching this point, so subtract one to get current
                        // turn.
                        debug!(
                            "Lobby game init command seen at turn seq {}",
                            seq.wrapping_sub(1),
                        );
                        self.lobby_game_init_command_seen
                            .store(true, Ordering::Relaxed);
                        orig(data, len, player);
                        // The native handler only takes the record (copying it into the replay
                        // header and setting the game's seed) in the lobby state it expects, but
                        // the game starts once the record is seen either way.
                        let header = self.replay_header.resolve();
                        let record = &slice[..slice.len().min(0xd)];
                        if !header.is_null() && !(*header).save_data_command.starts_with(record) {
                            warn!(
                                "Lobby game init command {record:02x?} wasn't applied: replay \
                                 header holds {:02x?}, rng seed {:#x}, lobby_state {}",
                                (*header).save_data_command,
                                self.rng_seed(),
                                self.lobby_state.resolve(),
                            );
                        }
                        return;
                    }
                    orig(data, len, player);
                },
                address,
            );
            let address = self.step_game.0 as usize - base;
            exe.hook_closure_address(
                StepGame,
                move |orig| {
                    if !rollback_resimulating()
                        && let Some(mut apm) = self.apm_state.lock()
                    {
                        apm.new_frame();
                    }
                    #[cfg(debug_assertions)]
                    let local_ids = crate::rollback_harness::local_stand_in().map(|player| {
                        let ids = (
                            self.local_unique_player_id.resolve(),
                            self.unique_command_user.resolve(),
                        );
                        self.local_unique_player_id.write(player.into());
                        self.unique_command_user.write(player.into());
                        ids
                    });
                    // A replay's chat history records each frame once, and a frame's lines are
                    // all printed by the end of its step: its commands run ahead of it, and BW may
                    // advance the frame count partway through it.
                    let replay = game_thread::is_replay();
                    if replay {
                        let frame = self.current_game_frame();
                        self.chat_history.lock().begin_replay_step(frame);
                    }
                    orig();
                    if replay {
                        self.chat_history.lock().finish_replay_step();
                    }
                    #[cfg(debug_assertions)]
                    if let Some((local, command_user)) = local_ids {
                        self.local_unique_player_id.write(local);
                        self.unique_command_user.write(command_user);
                    }
                    self.sample_game_stats();
                    game_thread::after_step_game();
                    self.update_team_colors_from_alliances();
                    #[cfg(debug_assertions)]
                    self.bwapi_step();
                },
                address,
            );
            let address = self.step_network_addr.0 as usize - base;
            exe.hook_closure_address(
                StepNetwork,
                move |orig| {
                    let ret = orig();

                    let in_stall = !self.is_network_ready();
                    let was_in_stall = self.in_network_stall.swap(in_stall, Ordering::Relaxed);
                    if in_stall && !was_in_stall {
                        let now = Instant::now();
                        let mut stall_start = self.network_stall_start.write();
                        *stall_start = Some(now);
                    } else if !in_stall && was_in_stall {
                        let mut stall_start = self.network_stall_start.write();
                        let stall_duration = stall_start.unwrap_or_else(Instant::now).elapsed();
                        *stall_start = None;

                        send_game_msg_to_async(GameThreadMessage::NetworkStall(stall_duration));
                    }

                    ret
                },
                address,
            );

            // Netcode v2 turn hooks. Symbol resolution is required, so these always install; each
            // body falls through to `orig` (BW's original turn handling) when there is no turn state
            // (a replay), so installing them changes nothing for a replay.
            {
                let nc = &self.netcode_v2;
                let address = nc.send_turn_message.0 as usize - base;
                exe.hook_closure_address(
                    SendTurnMessage,
                    move |buffer, len, orig| match self.netcode_v2_send_turn(buffer, len) {
                        TurnSendOutcome::Submitted => 1,
                        TurnSendOutcome::Failed => {
                            error!("Netcode v2: local turn could not be submitted to the turn transport");
                            1
                        }
                        TurnSendOutcome::Native => orig(buffer, len),
                    },
                    address,
                );

                let address = nc.receive_storm_turns.0 as usize - base;
                exe.hook_closure_address(
                    ReceiveStormTurns,
                    move |a1, a2, a3, a4, a5, orig| {
                        if game_thread::replay_harness_stalls_step() {
                            return 0;
                        }
                        match self.netcode_v2_receive_turns() {
                            TurnReceiveOutcome::Ready => 1,
                            TurnReceiveOutcome::Stall => 0,
                            TurnReceiveOutcome::Native => orig(a1, a2, a3, a4, a5),
                        }
                    },
                    address,
                );

                let address = nc.flush_local_turns.0 as usize - base;
                exe.hook_closure_address(
                    FlushLocalTurns,
                    move |a1, a2, orig| {
                        if self.netcode_v2_flush_pipe() {
                            0
                        } else {
                            orig(a1, a2)
                        }
                    },
                    address,
                );

                let address = nc.get_outstanding_turn_count.0 as usize - base;
                exe.hook_closure_address(
                    GetOutstandingTurnCount,
                    move |out, orig| match self.netcode_v2_outstanding_turns() {
                        Some(count) if !out.is_null() => {
                            *out = count;
                            1
                        }
                        _ => orig(out),
                    },
                    address,
                );

                let address = nc.record_turn_sync_slot.0 as usize - base;
                exe.hook_closure_address(
                    RecordTurnSyncSlot,
                    move |orig| {
                        // The pre-game pipe seed precedes native sync initialization. Only
                        // observe the active ring, and never hold the turn-state lock over BW.
                        let before = if self.game_started.load(Ordering::Acquire)
                            && nc.sync_active.resolve() != 0
                            && !rollback_resimulating()
                        {
                            Some(nc.sync_slot_index.resolve())
                        } else {
                            None
                        };
                        orig();
                        if let Some(before) = before {
                            let after = nc.sync_slot_index.resolve();
                            netcode_v2::with_turn_state(|s| s.record_sync_slot(before, after));
                        }
                    },
                    address,
                );

                // Full replacement for Storm's network join handshake, active only when a lobby
                // session seed is staged (the native-lobby join seam). With no seed staged — always,
                // for now — it falls through to the original, so installing it is a no-op for every
                // existing path.
                let address = nc.storm_join_game.0 as usize - base;
                exe.hook_closure_address(
                    StormJoinGame,
                    move |a1, a2, a3, out, a5, a6, a7, a8, a9, orig| {
                        match netcode_v2::with_lobby_session_seed(|seed| {
                            self.v2_run_join_replacement(seed, out)
                        }) {
                            Some(ret) => ret,
                            None => orig(a1, a2, a3, out, a5, a6, a7, a8, a9),
                        }
                    },
                    address,
                );
                debug!("Netcode v2 turn hooks installed");
            }

            let address = self.net_format_turn_rate.0 as usize - base;
            exe.hook_closure_address(
                NetFormatTurnRate,
                move |result: *mut scr::NetFormatTurnRateResult, dtr_scan_in_progress, orig| {
                    // NOTE(tec27): We don't use the original value at all but it's a convenient way to
                    // get them to allocate a real string for us.
                    orig(result, dtr_scan_in_progress);

                    // A live game (anything with a turn state, solo games included) draws the network
                    // quality chip in place of this text, whenever the game would have drawn the
                    // text. Without a turn state (a replay) the native latency still applies.
                    let live = self.game_started.load(Ordering::Acquire)
                        && netcode_v2::with_turn_state(|_| ()).is_some();
                    let value = if live {
                        *self.turn_rate_readout_at.lock() = Some(Instant::now());
                        String::new()
                    } else {
                        let turn_rate = match (*self.game_data()).turn_rate {
                            0 => 24, // This only happens with DTR, and is temporary anyway
                            val => val,
                        };
                        let cur_user_latency = self.net_user_latency.resolve();
                        let user_delay = 2 /* proto_latency */ + cur_user_latency;
                        let effective_latency =
                            ((1000f32 * user_delay as f32 + 500f32) / turn_rate as f32).round();
                        format!("Lat: {effective_latency:.0}ms")
                    };
                    (*result).text.replace_all(value.as_str());
                    result
                },
                address,
            );

            let address = self.update_game_screen_size as usize - base;
            exe.hook_closure_address(
                UpdateGameScreenSize,
                move |zoom, orig| {
                    // When using f5 to switch between sd-hd, 4:3 - 16:9 the game moves screen x
                    // to `x - 0.5 * (new_width - old_width)`, to keep the screen centered
                    // on what it used to be.
                    // However, if the screen happens to be near right edge of map, its x coordinate
                    // is clamped to (map_width_pixels - new_width) before centering move is done,
                    // causing the aspect-ratio correcting screen move be wrong.
                    //
                    // So we just implement the same algorithm but do aspect ratio fix first and
                    // right edge limiting second.
                    //
                    // Worth noting that update_game_screen_size is called for other cases than
                    // sd-hd switch, but I *think* that if we limit our changes to trigger only
                    // when game_screen_width_bwpx has changed, it won't break the other use cases.
                    // (Not sure what the other use cases are)
                    //
                    // If the above doesn't work, reading a global value that selects the screen
                    // size mode can be used to properly have these changes trigger only on
                    // sd-hd switch. But there isn't analysis for it right now, so hoping that it
                    // isn't needed.
                    let old_width = self.game_screen_width_bwpx.resolve();
                    let old_x = self.screen_x.resolve();
                    orig(zoom);
                    let new_width = self.game_screen_width_bwpx.resolve();
                    if old_width != new_width {
                        let new_x = (|| {
                            let diff = (new_width as i32).checked_sub(old_width as i32)?;
                            (old_x as i32).checked_sub(diff / 2)
                        })();
                        if let Some(new_x) = new_x {
                            let max_x =
                                self.map_width_pixels.resolve().saturating_sub(new_width) as i32;
                            let new_x = new_x.clamp(0, max_x) as u32;
                            let y = self.screen_y.resolve();
                            (self.move_screen)(new_x, y);
                        }
                    }
                },
                address,
            );

            if let Some(ref grab_pan) = self.grab_pan {
                let address = grab_pan.middle_down_handler.0 as usize - base;
                exe.hook_closure_address(
                    UiDefaultMiddleDownHandler,
                    move |event, orig| {
                        // The original hides the cursor and installs the built-in pan callback into
                        // the active-drag slot; letting it run first keeps the cursor hide and
                        // leaves only the slot swap to us.
                        let ret = orig(event);
                        self.grab_pan_middle_down();
                        ret
                    },
                    address,
                );

                let address = grab_pan.middle_up_handler.0 as usize - base;
                exe.hook_closure_address(
                    UiDefaultMiddleUpHandler,
                    move |event, orig| {
                        // Restore the cursor to where the drag began before the original reveals it
                        // again (and clears the active-drag slot).
                        self.grab_pan_middle_up();
                        orig(event)
                    },
                    address,
                );
            }

            let address = self.init_game_data.0 as usize - base;
            exe.hook_closure_address(
                InitGameData,
                move |orig| {
                    let ok = log_time("init_game_data", || orig());
                    if ok == 0 {
                        error!("init_game_data failed");
                        return 0;
                    }
                    if let Some(anti_troll) = self.anti_troll {
                        (*anti_troll.resolve()).active = 0;
                    }
                    self.restore_observer_id_mappings();
                    game_thread::after_init_game_data();
                    // Not in replays: they show no loading screen to hold up, and a replay seek
                    // re-runs init mid-replay. Their first steps wait on no other player either.
                    if !game_thread::is_replay() {
                        log_time("settle_init_uploads", || self.settle_init_uploads());
                    }
                    1
                },
                address,
            );
            let address = self.init_obs_ui.0 as usize - base;
            exe.hook_closure_address(
                InitObsUi,
                move |orig| {
                    // Make bw think that it doesn't need to create obs ui,
                    // and load default ingame consoles instead
                    // ('is_dummy_ui' function in obs ui vtable would have to be patched
                    // if consoles aren't loaded)
                    let is_replay = self.is_replay.resolve();
                    let local_id = self.local_unique_player_id.resolve();
                    if is_replay != 0 || local_id >= 0x80 {
                        self.is_replay.write(0);
                        self.local_unique_player_id.write(0);
                        let ui_consoles = (self.get_ui_consoles)();
                        let game = self.game();
                        let race_char = match (*game).player_race {
                            0 => b'z',
                            1 => b't',
                            _ => b'p',
                        };
                        self.load_consoles.call1(ui_consoles);
                        self.init_consoles.call2(ui_consoles, race_char as u32);
                        self.obs_ui_init_as_player.store(true, Ordering::Relaxed);
                        orig();
                        self.obs_ui_init_as_player.store(false, Ordering::Relaxed);
                        self.is_replay.write(is_replay);
                        self.local_unique_player_id.write(local_id);
                    } else {
                        orig();
                    }
                    if let Some(ratio) = self.game_screen_height_ratio {
                        self.original_game_screen_height_ratio
                            .store(ratio.resolve().to_bits(), Ordering::Relaxed);
                    }
                },
                address,
            );
            let address = self.init_unit_data.0 as usize - base;
            exe.hook_closure_address(
                InitUnitData,
                move |orig| {
                    game_thread::before_init_unit_data(self);
                    log_time("init_unit_data", || orig());
                },
                address,
            );
            let address = self.step_replay_commands.0 as usize - base;
            exe.hook_closure_address(
                StepReplayCommands,
                |orig| {
                    game_thread::step_replay_commands(orig);
                },
                address,
            );
            // Every replay save funnels through this function: SC:R's own LastReplay autosave (via
            // the wrapper that builds the full path) and `BwScr::save_replay`. The team-color
            // feature may have a local-only palette in `rgb_colors`, which SC:R would otherwise
            // serialize into the replay, so the real colors are put back for the span of the save.
            let address = self.save_replay as usize - base;
            exe.hook_closure_address(
                SaveReplay,
                move |path, orig| {
                    if crate::is_background_game() {
                        debug!("Suppressing replay write for background game");
                        return 1;
                    }
                    let _colors = self.begin_replay_save_colors();
                    if let Some(setup) = game_thread::setup_info()
                        .filter(|setup| setup.local_session.is_some() && !setup.is_replay())
                    {
                        return super::replay_save::with_replay_player_names(
                            self.replay_header(),
                            &setup.slots,
                            game_thread::player_id_mapping(),
                            || orig(path),
                        );
                    }
                    orig(path)
                },
                address,
            );
            let address = self.order_harvest_gas.0 as usize - base;
            exe.hook_closure_address(
                OrderFn,
                |unit, orig| {
                    game_thread::order_harvest_gas(self, unit, orig);
                },
                address,
            );
            let address = self.order_reset_collision_harvester.0 as usize - base;
            exe.hook_closure_address(
                OrderFn,
                |unit, orig| {
                    game_thread::order_reset_collision_harvester(unit, orig);
                },
                address,
            );
            let address = self.do_next_queued_order.0 as usize - base;
            exe.hook_closure_address(
                OrderFn,
                |unit, orig| {
                    game_thread::do_next_queued_order(unit, orig);
                },
                address,
            );
            let address = self.order_attack_unit.0 as usize - base;
            exe.hook_closure_address(
                OrderFn,
                |unit, orig| {
                    game_thread::order_attack_unit(unit, orig);
                },
                address,
            );
            let address = self.check_unit_resources_and_supply.0 as usize - base;
            exe.hook_closure_address(
                CheckUnitResourcesAndSupply,
                |player, unit_id, check_supply, show_error, orig| {
                    game_thread::check_unit_resources_and_supply(
                        self,
                        player,
                        unit_id,
                        check_supply,
                        show_error,
                        orig,
                    )
                },
                address,
            );

            if let Some(ref patch) = self.replay_minimap_patch {
                let address = patch.address.0 as usize - base;
                exe.replace(address, &patch.data);
            }

            if !self.use_legacy_cursor_sizing.load(Ordering::Acquire)
                && let Some(ref patch) = self.cursor_dimension_patch
            {
                debug!("Applying cursor dimension patch");
                let address = patch.address.0 as usize - base;
                exe.replace(address, &patch.data);
            } else {
                debug!("Legacy cursor sizing enabled");
            }

            let address = self.open_file.0 as usize - base;
            exe.hook_closure_address(
                OpenFile,
                move |a, b, c, orig| file_hook::open_file_hook(self, a, b, c, orig),
                address,
            );

            #[cfg(target_arch = "x86")]
            let prepare_issue_order_hook =
                move |unit, order, xy, target, fow, clear_queue, _orig| {
                    let unit = match Unit::from_ptr(unit) {
                        Some(s) => s,
                        None => return,
                    };
                    let order = bw_dat::OrderId(order as u8);
                    let x = xy as i16;
                    let y = (xy >> 16) as i16;
                    let target = Unit::from_ptr(target);
                    let fow = fow as u16;
                    let clear_queue = clear_queue != 0;

                    game::prepare_issue_order(self, unit, order, x, y, target, fow, clear_queue);
                };

            #[cfg(target_arch = "x86_64")]
            let prepare_issue_order_hook =
                move |unit, order, target: *mut bw::PointAndUnit, fow, clear_queue, _orig| {
                    let unit = match Unit::from_ptr(unit) {
                        Some(s) => s,
                        None => return,
                    };
                    let order = bw_dat::OrderId(order as u8);
                    let x = (*target).pos.x;
                    let y = (*target).pos.y;
                    let target = Unit::from_ptr((*target).unit);
                    let fow = fow as u16;
                    let clear_queue = clear_queue != 0;

                    game::prepare_issue_order(self, unit, order, x, y, target, fow, clear_queue);
                };

            let address = self.prepare_issue_order.0 as usize - base;
            exe.hook_closure_address(PrepareIssueOrder, prepare_issue_order_hook, address);

            let address = self.create_game_multiplayer.0 as usize - base;
            exe.hook_closure_address(
                CreateGameMultiplayer,
                move |info, name, password, map_path, a5, a6, a7, a8, orig| {
                    // Logging these params just to have some more context if ever needed.
                    // (This is a 16-byte struct passed by value)
                    let unk0 = a5;
                    let turn_rate = a6;
                    let is_bnet_matchmaking = a7 & 0xff;
                    let unk9 = (a7 >> 8) & 0xff;
                    let old_game_limits = (a7 >> 16) & 0xff;
                    let eud = (a7 >> 24) & 0xff;
                    let dynamic_turn_rate = a8;
                    info!(
                        "Called create_game_multiplayer, game params {unk0} {turn_rate} {is_bnet_matchmaking} {unk9} {old_game_limits} {eud} {dynamic_turn_rate}",
                    );
                    // This value is originally set to how many human player starting locations
                    // there are, but set it to match what we set for join side in
                    // game_state::join_lobby. Makes sure everybody can join if there are observers.
                    (*info).max_player_count = game_thread::setup_info().unwrap().slots.len() as u8;
                    orig(info, name, password, map_path, a5, a6, a7, a8)
                },
                address,
            );

            let address = self.spawn_dialog.0 as usize - base;
            exe.hook_closure_address(
                SpawnDialog,
                |a, b, c, o| dialog_hook::spawn_dialog_hook(a, b, c, o),
                address,
            );

            let address = self.step_game_logic.0 as usize - base;
            exe.hook_closure_address(
                StepGameLogic,
                move |a, o| {
                    let _pacing = crate::frame_pacing::step(self.next_game_step_tick());
                    let _timing = crate::frame_timing::step();
                    step_game_logic_hook(self, a, o)
                },
                address,
            );
            if let Some(step_game_loop) = self.step_game_loop {
                let address = step_game_loop.0 as usize - base;
                exe.hook_closure_address(
                    StepGameLoop,
                    move |orig| {
                        let _iteration = crate::frame_pacing::iteration(
                            self,
                            self.skip_render.is_some()
                                && (game_thread::is_replay() || native_sync_disabled()),
                        );
                        orig();
                    },
                    address,
                );
            }
            let address = self.render_screen as usize - base;
            exe.hook_closure_address(
                RenderScreen,
                move |callbacks, callback_count, orig| {
                    // Nothing of this frame has been drawn yet, so a setting that rebuilds the
                    // renderer's targets can't leave a queued draw pointing at the old ones.
                    self.write_pending_game_settings();
                    let own =
                        crate::frame_pacing::own_draw(!callbacks.is_null() && callback_count == 1);
                    // Background clients never draw replay playback once it has started. Live peers
                    // require the native render path for matching synchronization state.
                    let background_skip = crate::is_background_game()
                        && game_thread::is_replay()
                        && self.first_game_logic_frame_done.load(Ordering::Relaxed);
                    if let Some(skip_render) = self.skip_render
                        && (background_skip || own.as_ref().is_some_and(|own| own.skips()))
                    {
                        // The in-game loop's callback is the game's per-frame HUD update, which
                        // brings the UI in line with what the logic step changed: it hides the
                        // status portrait once the selection empties, for one. UI timers firing
                        // before the next draw rely on it having run since the step (the status
                        // portrait's animation timer reads the primary selected unit without a
                        // null check), so it runs on an undrawn iteration too. Ending the
                        // renderer's frame discards whatever it queued to draw.
                        let callbacks = callbacks as *const unsafe extern "C" fn();
                        for i in 0..callback_count {
                            (*callbacks.add(i))();
                        }
                        skip_render();
                        if background_skip {
                            #[cfg(debug_assertions)]
                            crate::debug_control::record_skipped_render_call();
                            // Rendering normally caps this loop's frequency. Keep event/turn
                            // polling responsive without busy-spinning after bypassing that cap.
                            std::thread::sleep(std::time::Duration::from_millis(16));
                        }
                    } else {
                        orig(callbacks, callback_count);
                    }
                },
                address,
            );

            {
                let address = self.sound.play_address() - base;
                exe.hook_closure_address(
                    PlaySound,
                    |id, volume, unk, x, y, orig| {
                        #[cfg(debug_assertions)]
                        crate::rollback_probe::note_play_sound();
                        // During a rollback tick the engine decides which requests are new once
                        // the whole tick has run, and plays those itself.
                        if let Some(ret) =
                            crate::rollback::sounds::intercept_play_sound(id, volume, unk, x, y)
                        {
                            return ret;
                        }
                        orig(id, volume, unk, x, y)
                    },
                    address,
                );
            }

            #[cfg(debug_assertions)]
            {
                let address = self.engine_alloc.0 as usize - base;
                exe.hook_closure_address(
                    EngineAlloc,
                    |size, tag, flags, unk, orig| {
                        let block = orig(size, tag, flags, unk);
                        crate::rollback_probe::note_flags_alloc(block, size, tag, flags);
                        block
                    },
                    address,
                );

                let address = self.engine_free.0 as usize - base;
                exe.hook_closure_address(
                    EngineFree,
                    |ptr, tag, flags, unk, orig| {
                        crate::rollback_probe::note_flags_free(ptr);
                        orig(ptr, tag, flags, unk)
                    },
                    address,
                );
            }

            {
                // Like the text the print_text hook handles, but without a player to attribute it
                // to: a player leaving or being eliminated, the game pausing.
                if let Some(address) = self.show_game_message {
                    exe.hook_closure_address(
                        ShowGameMessage,
                        |text, duration, orig| {
                            use crate::rollback::announcements::{Kind, key, should_announce};
                            let bytes = match text.is_null() {
                                true => &[][..],
                                false => CStr::from_ptr(text as *const std::ffi::c_char).to_bytes(),
                            };
                            if should_announce(Kind::GameMessage, key(bytes)) {
                                orig(text, duration);
                            }
                        },
                        address.0 as usize - base,
                    );
                }

                // A step takes a unit that dies, changes owner or boards a transport out of the
                // local selection, which the rollback engine puts back if a restore undoes that;
                // and the person's own selections make the simulation's selection for them, which
                // the local selection catches up with after a rollback.
                exe.hook_closure_address(
                    SelectUnits,
                    move |count, units, play_sound, send_command, orig| {
                        if !crate::rollback::tick_running() {
                            // The person selecting, which sends a command that makes the
                            // simulation's selection for them a few steps later.
                            let person_selecting = crate::rollback_live::native_sync_off()
                                && !self.selection.engine_selecting.load(Ordering::Relaxed);
                            let before = person_selecting.then(|| self.rollback_local_selection());
                            orig(count, units, play_sound, send_command);
                            if let Some(before) = before
                                && let Some(frame) = crate::rollback::position(self)
                                && let Some(pipe) = netcode_v2::with_turn_state(|s| s.pipe_depth())
                            {
                                crate::rollback::selection::note_selection_made(
                                    frame,
                                    pipe,
                                    &before,
                                    &self.rollback_local_selection(),
                                );
                            }
                            return;
                        }
                        let before = self.rollback_local_selection();
                        orig(count, units, play_sound, send_command);
                        let after = self.rollback_local_selection();
                        #[cfg(debug_assertions)]
                        {
                            let held = |x: &[Option<SelectedUnit>; 12]| x.iter().flatten().count();
                            if held(&after) > held(&before) {
                                debug!(
                                    "A step at frame {} added to the local selection: {} -> {} \
                                     units",
                                    crate::rollback::step_frame(),
                                    held(&before),
                                    held(&after),
                                );
                            }
                        }
                        crate::rollback::selection::note(
                            crate::rollback::step_frame(),
                            &before,
                            &after,
                        );
                    },
                    self.selection.select_units as usize - base,
                );

                // A right click writes the order confirmation marker and the target's blink into
                // sprites the rollback engine snapshots, so a restore to before the click undoes
                // them; the engine logs them here to make them again when it re-simulates.
                if let Some(feedback) = &self.click_feedback {
                    use crate::rollback::ui_writes::{UiWrite, record};
                    exe.hook_closure_address(
                        ShowCursorMarkerAt,
                        move |x, y, orig| {
                            record(self, UiWrite::CursorMarker { x, y });
                            orig(x, y);
                        },
                        feedback.show_cursor_marker_at.0 as usize - base,
                    );
                    exe.hook_closure_address(
                        SetSpriteSelectionFlashTimer,
                        move |object, timer, orig| {
                            record(
                                self,
                                UiWrite::SelectionFlash {
                                    object: object as usize,
                                    sprite: flash_target_sprite(object) as usize,
                                    timer,
                                },
                            );
                            orig(object, timer);
                        },
                        feedback.set_selection_flash_timer.0 as usize - base,
                    );
                }

                // A frame simulated on predicted inputs can decide the game without the real ones
                // doing so, so the engine holds the victory and defeat dialogs back until the frame
                // that asked for one is confirmed.
                if let Some((defeat, victory)) = self.mission_dialog_openers {
                    use crate::rollback::game_end::{MissionDialog, defer};
                    exe.hook_closure_address(
                        OpenDefeatMissionDialog,
                        |orig| {
                            if !defer(MissionDialog::Defeat) {
                                orig();
                            }
                        },
                        defeat.0 as usize - base,
                    );
                    exe.hook_closure_address(
                        OpenVictoryMissionDialog,
                        |orig| {
                            if !defer(MissionDialog::Victory) {
                                orig();
                            }
                        },
                        victory.0 as usize - base,
                    );
                }

                // The observer UI keeps its own records of what the simulation tells it, outside
                // the state the rollback engine snapshots, and would see a re-simulated frame's
                // notifications once more for every time the frame is simulated.
                if let Some(callbacks) = &self.observer_ui_callbacks {
                    use crate::rollback::announcements::{Kind, key, should_announce};
                    // A unit slot is reused once its unit is gone, so the slot's occupant count
                    // tells a new unit from the one a notification was about.
                    let unit_key = |unit: *mut bw::Unit, extra: u32| match unit.is_null() {
                        true => key((0usize, 0u8, extra)),
                        false => key((unit as usize, (*unit).minor_unique_index, extra)),
                    };
                    exe.hook_closure_address(
                        ObserverUiTrackBuildingUnit,
                        move |ui, unit, force, orig| {
                            if should_announce(Kind::ObserverTrackBuilding, unit_key(unit, force)) {
                                orig(ui, unit, force);
                            }
                        },
                        callbacks.track_building_unit.0 as usize - base,
                    );
                    exe.hook_closure_address(
                        ObserverUiTrackResearchOrUpgrade,
                        move |ui, unit, orig| {
                            if should_announce(Kind::ObserverTrackResearch, unit_key(unit, 0)) {
                                orig(ui, unit);
                                crate::rollback::observer_ui::observer_research_started(
                                    ui as usize,
                                    unit,
                                );
                            }
                        },
                        callbacks.track_research_or_upgrade.0 as usize - base,
                    );
                    exe.hook_closure_address(
                        ObserverUiRemoveBuildingUnitRecord,
                        move |ui, unit, orig| {
                            if should_announce(Kind::ObserverRemoveBuilding, unit_key(unit, 0)) {
                                orig(ui, unit);
                            }
                        },
                        callbacks.remove_building_unit_record.0 as usize - base,
                    );
                    exe.hook_closure_address(
                        ObserverUiFinishResearchOrUpgrade,
                        move |ui, unit, completed, orig| {
                            if should_announce(
                                Kind::ObserverFinishResearch,
                                unit_key(unit, completed),
                            ) && crate::rollback::observer_ui::observer_research_finishing(
                                ui as usize,
                                unit,
                            ) {
                                orig(ui, unit, completed);
                            }
                        },
                        callbacks.finish_research_or_upgrade.0 as usize - base,
                    );
                }
            }

            let address = self.decide_cursor_type.0 as usize - base;
            exe.hook_closure_address(
                DecideCursorType,
                move |orig| {
                    if let Some(render_state) = self.render_state.lock()
                        && let Some(val) = render_state.overlay.decide_cursor_type()
                    {
                        return val as u32;
                    }
                    orig()
                },
                address,
            );

            let address = self.load_ddsgrp_cursor.0 as usize - base;
            let check_custom_cursor_size = move || {
                if self.use_custom_cursor_size.load(Ordering::Acquire) {
                    let custom_size = *self.custom_cursor_size.lock();
                    self.cursor_scale_factor.write(custom_size);
                }
            };
            #[cfg(target_arch = "x86")]
            exe.hook_closure_address(
                LoadDdsgrpCursor,
                move |filepath, b, hotspot_x, hotspot_y, e, orig| {
                    check_custom_cursor_size();
                    orig(filepath, b, hotspot_x, hotspot_y, e)
                },
                address,
            );
            #[cfg(target_arch = "x86_64")]
            exe.hook_closure_address(
                LoadDdsgrpCursor,
                move |filepath, b, hotspot_xy, e, orig| {
                    check_custom_cursor_size();
                    orig(filepath, b, hotspot_xy, e)
                },
                address,
            );

            let address = self.print_text_addr.0 as usize - base;
            exe.hook_closure_address(
                PrintText,
                move |text, player, unused, orig| {
                    if text.is_null() {
                        return;
                    }
                    let injection = self.chat_injection.load(Ordering::Relaxed);
                    // A frame the rollback engine re-simulates prints its lines again each time.
                    // Chat shown while stalled belongs to no frame yet: it is matched against
                    // re-simulations once the stalled step records it.
                    if injection != ChatInjection::ShowWhileStalled as u8 {
                        use crate::rollback::announcements::{Kind, key, should_announce};
                        let bytes = CStr::from_ptr(text).to_bytes();
                        if !should_announce(Kind::PlayerText, key((bytes, player))) {
                            return;
                        }
                    }
                    if injection == ChatInjection::RecordShown as u8 {
                        return;
                    }
                    if self.print_text_hooks_disabled.load(Ordering::Acquire) <= 0
                        && let Ok(text) = CStr::from_ptr(text).to_str()
                    {
                        let handled = self.chat_manager.lock().handle_message(text, player);
                        if handled {
                            return;
                        }
                        if game_thread::is_replay() {
                            self.record_replay_chat_history_line(text, player);
                        } else {
                            self.record_chat_history_system_line(text, player);
                        }
                    }

                    orig(text, player, unused);
                },
                address,
            );

            let address = self.net_player_count_addr.0 as usize - base;
            exe.hook_closure_address(
                NetPlayerCount,
                move |orig| {
                    if netcode_v2::with_turn_state(|_| ()).is_some() {
                        // The native count reads the Storm session player list, which for a netcode-v2
                        // game holds only the local player (no Storm peers) — so BW would classify the
                        // game as single-player and draw the single-player minimap UI. Report the true
                        // count of registered net players so the multiplayer UI (diplomacy +
                        // communication buttons) is created.
                        let players = self.storm_players.resolve();
                        (0..bw::MAX_STORM_PLAYERS)
                            .filter(|&i| (*players.add(i)).state == 1)
                            .count() as u32
                    } else {
                        orig()
                    }
                },
                address,
            );

            if let Some(funcs) = self.status_screen_funcs {
                let funcs = std::slice::from_raw_parts_mut(funcs.0 as *mut bw::UnitStatusFunc, 228);
                for func in funcs {
                    unsafe extern "C" fn always_true() -> u32 {
                        1
                    }
                    unsafe extern "C" fn update_status(status_screen: *mut bw::Dialog) {
                        unsafe {
                            let bw = bw::get_bw();

                            let selected = match bw.client_selection()[0] {
                                Some(s) => s,
                                None => return,
                            };
                            let local_id = bw.local_player_id.resolve();
                            if local_id >= 0x80 {
                                // Show full unit info for observers
                                bw.local_player_id.write(selected.player() as u32);
                            }
                            bw.call_original_status_screen_fn(selected.id(), status_screen);
                            if local_id >= 0x80 {
                                bw.local_player_id.write(local_id);
                            }
                            let status_screen = bw_dat::dialog::Dialog::new(status_screen);
                            game_thread::after_status_screen_update(bw, status_screen, selected);
                        }
                    }
                    // Updating status every frame by always returning 1 from has_changed
                    // should be very cheap relative to other SC:R stuff, and allows us
                    // to intercept the dialog layout with less work.
                    func.has_changed = always_true;
                    func.update_status = update_status;
                }
            }

            if let Some(address) = self.load_sfx_audio_object {
                // Muted clients still preload SFX. Use the loader's native failure path so
                // its callers retain empty audio objects without opening or decoding assets.
                exe.hook_closure_address(
                    LoadSfxAudioObject,
                    |_asset, _sound_id, _orig| {
                        #[cfg(debug_assertions)]
                        crate::debug_control::record_skipped_sound_load();
                        0
                    },
                    address.0 as usize - base,
                );
            }

            self.rendering_patches(&mut exe, base);

            for &vtable in &self.console_vtables {
                let vtable = vtable.0 as *const scr::V_UiConsole;
                let relative = (*vtable).hit_test.cast_usize() - base;
                // Make console hittest return false when console is hidden.
                //
                // Unfortunately BW doesn't update hittest result until mouse moves,
                // so there's small bug with clicks right after console is shown/hidden.
                exe.hook_closure_address(
                    Console_HitTest,
                    move |console, x, y, orig| match self.console_hidden() {
                        true => 0,
                        false => orig(console, x, y),
                    },
                    relative,
                );
                // The console's art is queued by its own draw entry from the game's per-frame HUD
                // update. That update also expires chat lines, cycles palettes and keeps the
                // selection state current, so it always runs and only the art is held back.
                let relative = (*vtable).draw.cast_usize() - base;
                exe.hook_closure_address(
                    Console_Draw,
                    move |console, orig| match self.console_hidden() {
                        true => 0,
                        false => orig(console),
                    },
                    relative,
                );
            }

            sdf_cache::apply_sdf_cache_hooks(self, &mut exe, base);
            tick_gates::apply_tick_gate_hooks(&self.tick_gated_work, &mut exe, base);

            let create_file_hook_closure =
                move |a, b, c, d, e, f, g, o| create_file_hook(self, a, b, c, d, e, f, g, o);
            let get_file_attributes_closure = move |a, o| get_file_attributes_hook(self, a, o);

            let close_handle_hook = move |handle, orig: unsafe extern "C" fn(_) -> _| {
                self.check_replay_file_finish(handle);
                orig(handle)
            };
            // BW uses GetTickCount for a lot of things that should really have better than
            // 16ms resolution, so we hook this to give them a better timer. In practice this
            // improves the reliability of turn timing, which hopefully improves the reliability of
            // the netcode, and maybe other things
            crate::frame_pacing::start_tick_clock();
            let get_tick_count_hook =
                |_orig: unsafe extern "C" fn() -> u32| crate::frame_pacing::tick_count();
            let sleep_hook = |millis, orig: unsafe extern "C" fn(u32)| {
                if !crate::frame_pacing::skip_sleep(millis) {
                    orig(millis);
                }
            };
            drop(exe);
            hook_winapi_exports!(&mut active_patcher, "kernel32",
                "CreateEventW", CreateEventW, create_event_hook;
                "CreateFileW", CreateFileW, create_file_hook_closure;
                "CopyFileW", CopyFileW, copy_file_hook;
                "CloseHandle", CloseHandle, close_handle_hook;
                "GetFileAttributesW", GetFileAttributesW, get_file_attributes_closure;
                "GetTickCount", GetTickCount, get_tick_count_hook;
                "Sleep", Sleep, sleep_hook;
                "GetSystemTimePreciseAsFileTime", GetSystemTimePreciseAsFileTime, get_system_time_precise_as_file_time_hook;
            );
            hook_winapi_exports!(&mut active_patcher, "shell32",
                "SHGetFolderPathW", SHGetFolderPathW, sh_get_folder_path_w_hook;
                "ShellExecuteW", ShellExecuteW, shell_execute_hook;
            );
            hook_winapi_exports!(&mut active_patcher, "ws2_32",
                "connect", WsConnect, connect_hook;
            );

            // SCR wants to update gamepad state every frame, but in the end it
            // won't do any with it anyway. The query isn't completely free,
            // so dummy it out to let game spend time on better things.
            //
            // Note: This patch gets only applied if the DLL is already loaded,
            // so that we don't end up loading the DLL for no reason if a future
            // patch stops using this function.
            if windows::module_handle("xinput9_1_0").is_some() {
                let xinput_get_state_hook =
                    |_, _, _| winapi::shared::winerror::ERROR_DEVICE_NOT_CONNECTED;
                hook_winapi_exports!(&mut active_patcher, "xinput9_1_0",
                    "XInputGetState", XInputGetState, xinput_get_state_hook;
                );
            }
            crate::forge::init_hooks_scr(&mut active_patcher);
            debug!("Patched.");
        }
    }
}
