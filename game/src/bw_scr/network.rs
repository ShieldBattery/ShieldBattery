//! Native turn dispatch and Storm session setup for the relay transport.

use std::borrow::Cow;
use std::cell::Cell;
use std::ffi::CStr;
use std::mem;
use std::ptr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;

use scr_analysis::{VirtualAddress, scarf};
use smallvec::SmallVec;

use crate::bw::players::StormPlayerId;
use crate::bw::{self, Bw, commands};
use crate::game_thread;
use crate::netcode_v2;

use super::{BwInitError, BwScr, Value, live_rollback_resimulating, native_sync_disabled, scr};

/// Resolved BW symbols the netcode v2 turn hooks need. Resolution is **required** — a missing symbol
/// fails game launch like any other analyzed symbol. There is no native-networking fallback at the
/// launch level: the platform is a full cutover to rally-point2 (all clients run the same netcode),
/// so a build that can't resolve the hooks must not run rather than silently degrade. (The per-hook
/// `orig` fallthrough still covers the *phases* the turn transport doesn't carry yet — lobby join, and any game
/// the app didn't hand a rally-point2 session.)
///
/// The `net_player_flags` array and the RNG-enable flag are reused from the existing [`BwScr`]
/// fields (`storm_player_flags` / `enable_rng`), so they are not duplicated here.
pub(super) struct NetcodeV2Bw {
    /// OUT hook target: `send_turn_message(buffer_ptr, len)` — the fully-assembled local turn just
    /// before it crosses into Storm's broadcast.
    pub(super) send_turn_message: VirtualAddress,
    /// IN hook target: `receive_storm_turns(...)`, replaced wholesale (we never call the original,
    /// so its obfuscated inner routine that memsets the arrays never runs).
    pub(super) receive_storm_turns: VirtualAddress,
    /// PIPE hook target: `flush_local_turns_to_latency_depth(...)`, replaced wholesale.
    pub(super) flush_local_turns: VirtualAddress,
    /// `get_outstanding_turn_count(out) -> success`, answered from the turn state in-game. Its only
    /// in-game caller is `send_command`'s overflow guard (the PIPE, its other caller, is replaced).
    pub(super) get_outstanding_turn_count: VirtualAddress,
    /// Native checksum recorder, invoked once per executed network step while sync is active.
    pub(super) record_turn_sync_slot: VirtualAddress,
    /// Enables native checksum generation after the initialized-game prelude.
    pub(super) sync_active: Value<u32>,
    /// Current position in the native 16-entry checksum ring.
    pub(super) sync_slot_index: Value<u8>,
    /// Called by the PIPE replacement to flush one turn (keep-alive seed + `send_turn_message` +
    /// sync append). No stack args — it reads its globals directly.
    flush_outgoing_command_turn: unsafe extern "C" fn(),
    /// Called by the IN replacement inside the synced-RNG window to drain `pending_leave_reason`.
    apply_pending_player_leaves: unsafe extern "C" fn(),
    /// `player_turns[12]`: per-slot pointer to that slot's command bytes for the executable turn.
    player_turns: Value<*mut *mut u8>,
    /// `player_turns_size[12]`: per-slot command byte length.
    player_turns_size: Value<*mut u32>,
    /// `game_frame_count`: the executable-turn index, used as the consensus coordinate on outbound
    /// turns and as the "next frame" fed to the turn state on receive.
    pub(super) game_frame_count: Value<u32>,
    /// `pending_leave_reason[12]` base: the synced per-slot leave mailbox (nonzero reason = a pending
    /// leave `apply_pending_player_leaves` will apply, then clear, in the synced-RNG window).
    pending_leave_reason: Value<*mut i32>,
    /// `continue_game_loop`: the byte the game step loop tests before each step; zero once any
    /// exit path (menu quit, quit to desktop, window close, the end-of-game dialogs) has asked the
    /// loop to leave. Read by the IN replacement to notice an exit request while stalled.
    pub(super) continue_game_loop: Value<u8>,
    /// Hook target: `storm_join_game(...)`, the Storm-level network join handshake. The netcode-v2
    /// native-lobby join replacement replaces it wholesale (building equivalent session state from
    /// our own inputs) whenever a lobby session seed is staged.
    pub(super) storm_join_game: VirtualAddress,
    /// Looks up the session-player node with the given 12-byte net key, or creates (and zero-inits,
    /// slot field = 0xffff) a fresh one. cdecl(net_key_ptr).
    storm_session_player_lookup_or_create:
        unsafe extern "C" fn(*const u8) -> *mut scr::StormSessionPlayer,
    /// Returns (creating if needed) the local player's session-player node. cdecl, no args.
    get_local_storm_session_player: unsafe extern "C" fn() -> *mut scr::StormSessionPlayer,
    /// Copies a slot name (max 0x7f chars + NUL) into the slot-name registry the lobby slot-setup
    /// handler's name lookups read. cdecl(slot, name_ptr); return value unused.
    storm_register_slot_name: unsafe extern "C" fn(u32, *const u8) -> u32,
    /// Handler for async lobby command class 0x4A, the per-slot force/alliance/vision apply.
    /// cdecl(record_ptr, guard); record is the 63-byte serialized command body.
    /// Resolved but not yet called by anything (no caller wired up yet).
    #[allow(dead_code)]
    apply_lobby_force_cmd: unsafe extern "C" fn(*const u8, i32) -> i32,
    /// Drains Storm's deferred inbound packet queue (packets that arrived before the local slot /
    /// turn-base were known). cdecl, no args; return value unused.
    snet_drain_deferred_queue: unsafe extern "C" fn() -> u32,
    /// `storm_local_player_slot`: the local storm session slot global (0xff = not in a session).
    storm_local_player_slot: Value<u8>,
    /// `storm_turn_base`: the base added to a session slot to form the game-level net player id.
    storm_turn_base: Value<u32>,
}

/// Outcome of the OUT hook consulting the turn state, deciding whether the turn went to rally-point2 or
/// should fall through to native Storm.
pub(super) enum TurnSendOutcome {
    /// No live turn state for this turn (lobby phase, or no rally-point2 session) — run native.
    Native,
    /// Handed to the turn state's driver.
    Submitted,
    /// The turn state is live but the driver channel is closed/full mid-game. Not falling back to Storm
    /// (peers are on the relay, so a Storm send wouldn't reach them); the dropped local turn makes
    /// our own IN stall, surfacing the dead session as a lag screen rather than a silent desync.
    Failed,
}

/// Outcome of the IN hook consulting the turn state.
pub(super) enum TurnReceiveOutcome {
    /// No live turn state for this step — run native `receive_storm_turns`.
    Native,
    /// Every required slot's turn is ready and the arrays are filled — return 1 (dispatch).
    Ready,
    /// A required slot is missing — return 0 (stall); nothing was consumed.
    Stall,
}

/// The leave reason the `forceUnsyncedLeave` debug command writes into `pending_leave_reason`. BW's
/// "dropped" reason (`0x40000006` → `strPLAYER_WAS_DROPPED`), so a forced leave reads on this
/// client exactly as a real drop does — same string, same synced-leave handling.
#[cfg(debug_assertions)]
const FORCED_UNSYNCED_LEAVE_REASON: i32 = 0x40000006u32 as i32;

/// The amount the `forceDesync` debug command adds to the local player's minerals. A visible,
/// obviously-divergent resource change; on its own it only desyncs indirectly (once the extra
/// minerals alter a spend), so it's paired with the RNG-seed perturbation below for a deterministic
/// trip of the per-turn sync check.
#[cfg(debug_assertions)]
const FORCED_DESYNC_MINERAL_BONUS: u32 = 5000;

/// The value the `forceDesync` debug command XORs into this client's synced RNG seed. The seed is
/// folded into the per-turn sync checksum every client compares, so diverging it on one client
/// trips the peers' sync check on the next matching turn — a deterministic, immediate desync
/// trigger (and, because every subsequent RNG draw diverges, a genuine cascading one) rather than
/// waiting for a resource change to indirectly affect unit state.
#[cfg(debug_assertions)]
const FORCED_DESYNC_RNG_XOR: u32 = 0x5B5B_5B5B;

impl NetcodeV2Bw {
    /// Resolves the netcode v2 turn-hook symbols. Every symbol is required — a missing one is a launch
    /// failure naming it, consistent with the rest of `BwScr::new` (no native fallback at launch; full
    /// cutover to rally-point2).
    pub(super) fn analyze(
        analysis: &mut scr_analysis::Analysis<'_>,
        ctx: scarf::OperandCtx<'static>,
    ) -> Result<NetcodeV2Bw, BwInitError> {
        let send_turn_message = analysis.send_turn_message().ok_or("send_turn_message")?;
        let record_turn_sync_slot = analysis
            .record_turn_sync_slot()
            .ok_or("record_turn_sync_slot")?;
        let sync_active = analysis.sync_active().ok_or("sync_active")?;
        let sync_slot_index = analysis.sync_slot_index().ok_or("sync_slot_index")?;
        let receive_storm_turns = analysis
            .receive_storm_turns()
            .ok_or("receive_storm_turns")?;
        let flush_local_turns = analysis
            .flush_local_turns_to_latency_depth()
            .ok_or("flush_local_turns_to_latency_depth")?;
        let flush_outgoing_command_turn = analysis
            .flush_outgoing_command_turn()
            .ok_or("flush_outgoing_command_turn")?;
        let get_outstanding_turn_count = analysis
            .get_outstanding_turn_count()
            .ok_or("get_outstanding_turn_count")?;
        let apply_pending_player_leaves = analysis
            .apply_pending_player_leaves()
            .ok_or("apply_pending_player_leaves")?;
        let player_turns = analysis.player_turns().ok_or("player_turns")?;
        let player_turns_size = analysis.player_turns_size().ok_or("player_turns_size")?;
        let game_frame_count = analysis.game_frame_count().ok_or("game_frame_count")?;
        let pending_leave_reason = analysis
            .pending_leave_reason()
            .ok_or("pending_leave_reason")?;
        let continue_game_loop = analysis.continue_game_loop().ok_or("continue_game_loop")?;
        let storm_join_game = analysis.storm_join_game().ok_or("storm_join_game")?;
        let storm_session_player_lookup_or_create = analysis
            .storm_session_player_lookup_or_create()
            .ok_or("storm_session_player_lookup_or_create")?;
        let get_local_storm_session_player = analysis
            .get_local_storm_session_player()
            .ok_or("get_local_storm_session_player")?;
        let storm_register_slot_name = analysis
            .storm_register_slot_name()
            .ok_or("storm_register_slot_name")?;
        let apply_lobby_force_cmd = analysis
            .apply_lobby_force_cmd()
            .ok_or("apply_lobby_force_cmd")?;
        let snet_drain_deferred_queue = analysis
            .snet_drain_deferred_queue()
            .ok_or("snet_drain_deferred_queue")?;
        let storm_local_player_slot = analysis
            .storm_local_player_slot()
            .ok_or("storm_local_player_slot")?;
        let storm_turn_base = analysis.storm_turn_base().ok_or("storm_turn_base")?;

        Ok(NetcodeV2Bw {
            send_turn_message,
            receive_storm_turns,
            flush_local_turns,
            get_outstanding_turn_count,
            record_turn_sync_slot,
            sync_active: Value::new(ctx, sync_active),
            sync_slot_index: Value::new(ctx, sync_slot_index),
            flush_outgoing_command_turn: unsafe { mem::transmute(flush_outgoing_command_turn.0) },
            apply_pending_player_leaves: unsafe { mem::transmute(apply_pending_player_leaves.0) },
            player_turns: Value::new(ctx, player_turns),
            player_turns_size: Value::new(ctx, player_turns_size),
            game_frame_count: Value::new(ctx, game_frame_count),
            pending_leave_reason: Value::new(ctx, pending_leave_reason),
            continue_game_loop: Value::new(ctx, continue_game_loop),
            storm_join_game,
            storm_session_player_lookup_or_create: unsafe {
                mem::transmute(storm_session_player_lookup_or_create.0)
            },
            get_local_storm_session_player: unsafe {
                mem::transmute(get_local_storm_session_player.0)
            },
            storm_register_slot_name: unsafe { mem::transmute(storm_register_slot_name.0) },
            apply_lobby_force_cmd: unsafe { mem::transmute(apply_lobby_force_cmd.0) },
            snet_drain_deferred_queue: unsafe { mem::transmute(snet_drain_deferred_queue.0) },
            storm_local_player_slot: Value::new(ctx, storm_local_player_slot),
            storm_turn_base: Value::new(ctx, storm_turn_base),
        })
    }
}

/// Writes a Storm session-player node's slot the way native join does: the low byte only. A node is
/// created with its `u16` slot field set to 0xffff, and native join overwrites just the low byte,
/// leaving the high byte 0xff; readers compare only the low byte, so writing the full `u16` would
/// diverge from native and be wrong.
unsafe fn write_session_player_slot(node: *mut scr::StormSessionPlayer, slot: u8) {
    unsafe {
        (&raw mut (*node).slot).cast::<u8>().write(slot);
    }
}

/// Copies a player name into a session-player node's `name` buffer, matching Storm's own bound: at
/// most 0x7f characters plus a NUL terminator (the buffer is 0x80 bytes).
unsafe fn copy_session_player_name(node: *mut scr::StormSessionPlayer, name: &CStr) {
    unsafe {
        let bytes = name.to_bytes();
        let len = bytes.len().min(0x7f);
        let dest = (&raw mut (*node).name).cast::<u8>();
        ptr::copy_nonoverlapping(bytes.as_ptr(), dest, len);
        dest.add(len).write(0);
    }
}

impl BwScr {
    /// OUT hook body (`send_turn_message`): in-game, hand the fully-assembled local turn to the turn
    /// state, having stripped the native latency/turn-rate control commands so they can't rewrite the
    /// pinned globals mid-game. Before the game starts, the lobby stays on native Storm networking
    /// unless the turn state's lobby seam is latched on (see [`TurnState::enable_lobby_seam`] — the
    /// native-lobby setup path, a later slice); when it is, the raw buffer goes to
    /// [`TurnState::submit_local_lobby_turn`] with no [`commands::strip_control_commands`] — the
    /// lobby command set is different from the in-game one and must relay byte-identical. Returns
    /// [`TurnSendOutcome::Native`] whenever there is no live session, or (pre-game) the seam isn't
    /// enabled.
    pub(super) unsafe fn netcode_v2_send_turn(
        &self,
        buffer: *const u8,
        len: usize,
    ) -> TurnSendOutcome {
        unsafe {
            if !self.game_started.load(Ordering::Acquire) {
                let commands = std::slice::from_raw_parts(buffer, len);
                let outcome = netcode_v2::with_turn_state(|s| {
                    if !s.lobby_seam_enabled() {
                        return None;
                    }
                    Some(s.submit_local_lobby_turn(commands))
                })
                .flatten();
                return match outcome {
                    None => TurnSendOutcome::Native,
                    Some(true) => TurnSendOutcome::Submitted,
                    Some(false) => TurnSendOutcome::Failed,
                };
            }
            // A re-simulated frame's turn went out when the frame was first simulated.
            if live_rollback_resimulating() {
                return TurnSendOutcome::Submitted;
            }
            let nc = &self.netcode_v2;
            let frame = nc.game_frame_count.resolve();
            if !IN_TURN_FLUSH.with(|flag| flag.get()) {
                // `send_command` ends the turn early when a command won't fit in it, which is
                // native behavior: the turn is complete (one sync record, like any other) and the
                // pipe sends one fewer later. See `netcode_v2_outstanding_turns` for its cap.
                static LOGGED: AtomicU32 = AtomicU32::new(0);
                if LOGGED.fetch_add(1, Ordering::Relaxed) < 20 {
                    let in_flight = netcode_v2::with_turn_state(|s| s.outstanding_turns());
                    debug!(
                        "netcode v2: turn filled before the pipe flush: frame {frame} len {len}                          in_flight {in_flight:?}"
                    );
                }
            }
            let commands = std::slice::from_raw_parts(buffer, len);
            let filtered = commands::strip_control_commands(commands, &self.game_command_lengths);
            let filtered: Cow<'_, [u8]> = match native_sync_disabled() {
                true => Cow::Owned(
                    commands::strip_sync_commands(&filtered, &self.game_command_lengths)
                        .into_owned(),
                ),
                false => filtered,
            };
            let sync_ring = if nc.sync_active.resolve() != 0 {
                Some(nc.sync_slot_index.resolve())
            } else {
                None
            };
            #[cfg(debug_assertions)]
            crate::input_latency_probe::on_local_turn(&filtered, frame, &self.game_command_lengths);
            match netcode_v2::with_turn_state(|s| {
                s.submit_local_turn(&filtered, Some(frame), sync_ring)
            }) {
                None => TurnSendOutcome::Native,
                Some(true) => TurnSendOutcome::Submitted,
                Some(false) => TurnSendOutcome::Failed,
            }
        }
    }

    /// IN hook body (full replacement of `receive_storm_turns`): drain the turn state and, when every
    /// required slot is ready, fill `player_turns[]` / `player_turns_size[]` / `net_player_flags[]`
    /// and run the synced leave pass. Never calls the original.
    ///
    /// Before the game starts, the lobby stays fully native (native join is retained for now) unless
    /// the turn state's lobby seam is latched on (see [`TurnState::enable_lobby_seam`] — the
    /// native-lobby setup path, a later slice). When it is, this fills the same arrays from the
    /// lobby-phase turn assembly instead — [`TurnState::lobby_receive_turns`], the lobby analogue of
    /// the in-game turn assembly below, paced by the local echo rather than a readiness set. That
    /// branch is drain→gate→dispatch only: it runs no leave/directive machinery, since there are no
    /// frames or leaves during lobby in this slice.
    ///
    /// With the seam still off, the turn state's pipe is empty at the lobby→game transition — the
    /// first in-game receive would stall forever (`network_ready = 0` → `step_network` skips the
    /// PIPE flush → deadlock; native avoids this because the lobby's unconditional flush pre-seeds
    /// the pipe). [`seed_netcode_v2_pipe`](Self::seed_netcode_v2_pipe) closes that gap by running
    /// the PIPE fill once at the transition.
    pub(super) unsafe fn netcode_v2_receive_turns(&self) -> TurnReceiveOutcome {
        unsafe {
            if !self.game_started.load(Ordering::Acquire) {
                let nc = &self.netcode_v2;
                // Chat stays live for the driver's whole session, unlike lobby commands, so it can
                // already be arriving before the game starts. Nothing renders it yet — drain and
                // discard so the channel never backs up and wedges the driver (mirrors `lobby_in`'s
                // own discard-drain once the game HAS started; see `drain_chat_inbound`).
                netcode_v2::with_turn_state(|s| {
                    s.drain_chat_inbound(false);
                    // Drain the connectivity stream pre-start too so it can't back up and wedge the
                    // driver; a pre-start peer frame records nothing (there is no in-game overlay
                    // yet to show it on), though an own-slot frame still updates the self-link flag
                    // — harmlessly, since that overlay is gated on the game having started too.
                    s.pump_connectivity(false, Instant::now());
                    // Same back-pressure discipline for region-label frames (the relay doesn't send
                    // them pre-start, but a drained channel can never wedge anything).
                    s.pump_region_labels();
                });
                let ready = netcode_v2::with_turn_state(|s| {
                    if !s.lobby_seam_enabled() {
                        return None;
                    }
                    if !s.lobby_receive_turns() {
                        return Some(false);
                    }
                    Self::fill_turn_dispatch(
                        nc.player_turns.resolve(),
                        nc.player_turns_size.resolve(),
                        self.storm_player_flags.resolve(),
                        s.lobby_dispatch_buffers(),
                    );
                    Some(true)
                })
                .flatten();
                return match ready {
                    None => TurnReceiveOutcome::Native,
                    Some(false) => TurnReceiveOutcome::Stall,
                    Some(true) => TurnReceiveOutcome::Ready,
                };
            }
            let nc = &self.netcode_v2;
            if netcode_v2::with_turn_state(|s| s.predicts_inputs()) == Some(true) {
                return self.netcode_v2_receive_predicted(nc);
            }
            // Only BW's running game loop reaches this branch: the pre-loop pipe seed drives the
            // send side, and lobby init runs before the started flag flips. Its first pass is
            // therefore the proof the simulation is stepping, and the moment the relay (and through
            // it the app server) learns this player's load finished. Latched inside; every later
            // receive is a no-op.
            netcode_v2::with_turn_state(|s| s.submit_game_started());
            let next_frame = nc.game_frame_count.resolve();
            // Apply coordinated synced leaves due at this frame BEFORE the readiness check below, so a
            // departing slot is already dropped from `required` when `receive_turns` runs and its
            // `pending_leave_reason` is written for `run_synced_leave_pass` to drain on the ready
            // step. A due leave is what unstalls a step gated on the departing peer. The directive is
            // observed during `receive_turns`' drain; on the step it first arrives the readiness check
            // still stalls, and the next poll of this (stalled) receive applies it here and proceeds.
            self.apply_due_leaves(nc, next_frame);
            // If applying those leaves emptied the remote-human roster in a game that has computer
            // players, close the networked session: the lone human plays on versus the AI entirely
            // locally while the relay session ends cleanly behind them. This is the same local-only
            // latch the victory dialog uses, triggered instead by the roster emptying.
            //
            // Once local-only, a later result report (the human eventually wins or loses versus the
            // AI) is handed to a driver that has already sent its leave intent, so the driver drops
            // it and no HTTP fallback runs — a report from a session that has closed has nowhere
            // trustworthy to go, and games with computers do not track results, so dropping it is
            // correct. Gated on computers-present precisely so a human-only game — where "alone"
            // means the winner's result is imminent — never closes ahead of that report.
            if netcode_v2::with_turn_state(|s| s.should_self_close()).unwrap_or(false) {
                netcode_v2::begin_local_only();
            }
            // Debug-only: the `forceUnsyncedLeave` command's local (non-consensus) injection — same effect,
            // sourced from a queued slot rather than a relay directive. Must also precede the receive.
            #[cfg(debug_assertions)]
            self.apply_forced_unsynced_leaves(nc);
            // Debug-only: the `forceDesync` command's one-shot mineral perturbation on this client.
            #[cfg(debug_assertions)]
            self.apply_forced_desync();
            // Debug-only: the `sendChat` command's queued messages, sent + locally echoed through
            // the same path a human's own Enter keypress uses.
            #[cfg(debug_assertions)]
            self.apply_debug_chat();
            // In-game chat delivered from peers over the relay, each injected as the classic chat
            // record after passing its target scope's receive-side filter.
            self.apply_chat_inbound();
            self.print_chat_notices();
            // Skin relay: our own blob goes out once, as soon as native code has filled its
            // slot (polled per receive step, bounded wait), and peers' blobs are written into
            // their senders' current players[] slots as they arrive.
            self.broadcast_local_skin_once();
            self.apply_skins_inbound();
            // Relay-pushed slot-connectivity changes: a peer's drop/reconnect updates the turn
            // state's disconnected set, our own updates the self-link flag, for the survivor
            // overlay to render. Render-side only — no game state, alliances, or turn pipeline are
            // touched here. Region-label frames ride the same per-step pump cadence and are
            // likewise render-side only (the `/netstat` home column and header).
            netcode_v2::with_turn_state(|s| {
                s.pump_connectivity(true, Instant::now());
                s.pump_region_labels();
            });
            let ready = netcode_v2::with_turn_state(|s| {
                if !s.receive_turns(next_frame) {
                    return false;
                }
                // The bytes are owned by the turn state (refcounted `Bytes`) and stay valid until the
                // next `receive_turns`, which covers the whole step_network dispatch.
                Self::fill_turn_dispatch(
                    nc.player_turns.resolve(),
                    nc.player_turns_size.resolve(),
                    self.storm_player_flags.resolve(),
                    s.dispatch_buffers(),
                );
                s.apply_due_directive(next_frame);
                // Exactly once per executed step (one local turn leaves the pipe), NOT per dispatched
                // slot — see TurnState::mark_local_turn_executed.
                s.mark_local_turn_executed();
                true
            });
            match ready {
                None => TurnReceiveOutcome::Native,
                Some(false) => {
                    self.end_session_for_requested_exit(nc);
                    TurnReceiveOutcome::Stall
                }
                Some(true) => {
                    // Leave pass runs with the turn-state lock released: the leave handlers can issue
                    // commands that re-enter the OUT hook, which would re-lock the turn state.
                    let leaving = self.run_synced_leave_pass(nc);
                    for (storm, _) in leaving {
                        netcode_v2::with_turn_state(|s| s.mark_slot_left(storm));
                    }
                    TurnReceiveOutcome::Ready
                }
            }
        }
    }

    /// IN hook body for an in-game step of a game that predicts inputs: the step runs ahead of the
    /// turns it has not received, up to the prediction limit, and a rollback simulates it again
    /// once they arrive (see [`TurnState::predict_inputs`]).
    ///
    /// The turn state keys every slot's turns by turn index, derived from `game_frame_count`, which
    /// the rollback snapshot restores along with the rest of the simulation. A step simulated again
    /// takes its turns from the same table and injects the chat its first run injected; everything
    /// else the receive does (taking turns off the network, directives, skins, connectivity, the
    /// local turn leaving the pipe) happened when the step first ran. Leaves are taken on either
    /// kind of step, since a leave that arrives after its step ran is applied by the step's second
    /// run. Chat goes into the replay only once the step is known to run, so that no rollback
    /// between a stalled attempt and the real one can drop it from the replay: while the step is
    /// stalled, chat is shown without being recorded, and once it runs, recorded without being
    /// shown again.
    unsafe fn netcode_v2_receive_predicted(&self, nc: &NetcodeV2Bw) -> TurnReceiveOutcome {
        unsafe {
            let step = nc.game_frame_count.resolve();
            if live_rollback_resimulating() {
                return self.netcode_v2_redispatch(nc, step);
            }
            netcode_v2::with_turn_state(|s| s.submit_game_started());
            self.apply_due_leaves(nc, step);
            if netcode_v2::with_turn_state(|s| s.should_self_close()).unwrap_or(false) {
                netcode_v2::begin_local_only();
            }
            #[cfg(debug_assertions)]
            self.apply_forced_unsynced_leaves(nc);
            #[cfg(debug_assertions)]
            self.apply_forced_desync();
            #[cfg(debug_assertions)]
            self.apply_debug_chat();
            self.broadcast_local_skin_once();
            self.apply_skins_inbound();
            netcode_v2::with_turn_state(|s| {
                s.pump_connectivity(true, Instant::now());
                s.pump_region_labels();
            });
            let ready = netcode_v2::with_turn_state(|s| {
                if !s.receive_turns(step) {
                    return false;
                }
                Self::fill_turn_dispatch(
                    nc.player_turns.resolve(),
                    nc.player_turns_size.resolve(),
                    self.storm_player_flags.resolve(),
                    s.dispatch_buffers(),
                );
                s.apply_due_directive(step);
                if netcode_v2::dispatches_turns(step) {
                    s.mark_local_turn_executed();
                }
                true
            });
            match ready {
                None => TurnReceiveOutcome::Native,
                Some(false) => {
                    self.show_chat_while_stalled();
                    self.end_session_for_requested_exit(nc);
                    // BW runs no PIPE flush until the step can run, so a stall on this client's
                    // own downlink sends its turns from here, outside the turn state's lock (each
                    // flush re-enters the OUT hook). The rest of the session never waits on them.
                    let owed = netcode_v2::with_turn_state(|s| {
                        s.turns_to_send_while_stalled(Instant::now())
                    })
                    .unwrap_or(0);
                    flush_outgoing_turns(nc, owed);
                    TurnReceiveOutcome::Stall
                }
                Some(true) => {
                    self.record_chat_shown_while_stalled();
                    self.apply_local_chat_echoes();
                    self.apply_chat_inbound();
                    self.run_predicted_leave_pass(nc);
                    TurnReceiveOutcome::Ready
                }
            }
        }
    }

    /// IN hook body for a step that simulates again a step the game has already run, in a game that
    /// predicts inputs: dispatches the turns the input table has for it now and injects the chat it
    /// injected the first time. See [`netcode_v2_receive_predicted`](Self::netcode_v2_receive_predicted).
    unsafe fn netcode_v2_redispatch(&self, nc: &NetcodeV2Bw, step: u32) -> TurnReceiveOutcome {
        unsafe {
            self.apply_due_leaves(nc, step);
            let chat = netcode_v2::with_turn_state(|s| s.redispatch(step)).unwrap_or_default();
            for (storm, target, text) in &chat {
                self.inject_chat_message(*storm, *target, text);
            }
            netcode_v2::with_turn_state(|s| {
                Self::fill_turn_dispatch(
                    nc.player_turns.resolve(),
                    nc.player_turns_size.resolve(),
                    self.storm_player_flags.resolve(),
                    s.dispatch_buffers(),
                )
            });
            self.run_predicted_leave_pass(nc);
            TurnReceiveOutcome::Ready
        }
    }

    /// Runs the synced leave pass of a step in a game that predicts inputs. A step that applies a
    /// leave changes state outside the rollback snapshot, and applying it a second time corrupts
    /// that state, so the step becomes one no rollback reaches back past.
    unsafe fn run_predicted_leave_pass(&self, nc: &NetcodeV2Bw) {
        unsafe {
            let leaving = self.run_synced_leave_pass(nc);
            if !leaving.is_empty() {
                crate::rollback::mark_irreversible_step();
            }
            for (storm, _) in leaving {
                netcode_v2::with_turn_state(|s| s.mark_slot_left(storm));
            }
        }
    }

    /// Lets a game that has been asked to exit actually leave a stalled lockstep step.
    ///
    /// Once no turn set has arrived for a couple of seconds, `step_network` parks in a native wait
    /// loop that keeps pumping window messages, events, and rendering, and polls the IN hook until a
    /// complete step can be assembled. That loop never reads `continue_game_loop`, so a quit
    /// confirmed from the in-game menu (or a window close) while stalled clears the flag and then
    /// waits forever: the outer step loop, the only reader of the flag, is never reached again
    /// while the missing peer's turn never arrives. The player sees the game stop drawing and can
    /// only kill the process.
    ///
    /// Called on every stalled receive. When the flag is already clear, the game's outcome for this
    /// client is settled (it is leaving), so the session ends the same way the victory dialog ends
    /// it: the result report is snapshotted first, then the session goes local-only, which
    /// fabricates a leave for every remote slot and announces our own clean leave. The next poll
    /// assembles a step from our own echoed turns, the wait loop exits, and the step loop finally
    /// observes the exit request. The result is taken before the fabricated leaves apply so it
    /// reflects the game as the player left it, not one in which every opponent left afterwards.
    /// No-op once local-only (the transition is one-way), and a no-op with no live session.
    unsafe fn end_session_for_requested_exit(&self, nc: &NetcodeV2Bw) {
        unsafe {
            if nc.continue_game_loop.resolve() != 0 {
                return;
            }
        }
        let already_local_only = netcode_v2::with_turn_state(|s| s.is_local_only()).unwrap_or(true);
        if already_local_only {
            return;
        }
        info!(
            "netcode v2: game loop exit requested during a network stall; ending the session \
             locally so the exit can proceed"
        );
        game_thread::send_game_results();
        netcode_v2::begin_local_only();
    }

    /// Fills `player_turns[]` / `player_turns_size[]` / `net_player_flags[]` from a set of dispatched
    /// per-slot buffers. Shared by [`netcode_v2_receive_turns`](Self::netcode_v2_receive_turns)'s
    /// lobby-phase and in-game branches, which differ only in where `buffers` comes from.
    ///
    /// A full replacement doesn't run the native memset, so every slot is cleared first: a stale
    /// ready bit on a slot we don't fill would make step_network dispatch garbage.
    unsafe fn fill_turn_dispatch<'a>(
        player_turns: *mut *mut u8,
        player_turns_size: *mut u32,
        flags: *mut u32,
        buffers: impl Iterator<Item = (StormPlayerId, &'a [u8])>,
    ) {
        unsafe {
            for i in 0..bw::MAX_STORM_PLAYERS {
                *flags.add(i) = 0;
                *player_turns_size.add(i) = 0;
            }
            for (storm, bytes) in buffers {
                let i = storm.0 as usize;
                *player_turns.add(i) = bytes.as_ptr() as *mut u8;
                *player_turns_size.add(i) = bytes.len() as u32;
                *flags.add(i) = 0x10000 | 0x20000; // present | turn-ready
            }
        }
    }

    /// PIPE hook body (full replacement of `flush_local_turns_to_latency_depth`): flush enough turns
    /// to reach the turn state's latency target, or in a game that predicts inputs every turn its
    /// pacing has due if that is more (see [`TurnState::turns_to_flush`]), driven off its own
    /// in-flight counter rather than the native `get_outstanding_turn_count` (which goes
    /// degenerate-0 once Storm's send/ack counters stop advancing, causing an unbounded flush).
    /// Returns `false` before the game starts or with no live session, so the caller runs the
    /// original.
    pub(super) unsafe fn netcode_v2_flush_pipe(&self) -> bool {
        unsafe {
            if !self.game_started.load(Ordering::Acquire) {
                return false;
            }
            // A re-simulated frame's turns went out when the frame was first simulated, and the
            // local commands issued since belong to the frame about to be stepped.
            if live_rollback_resimulating() {
                return true;
            }
            let nc = &self.netcode_v2;
            // Read the shortfall under the lock, then release before flushing — each flush re-enters
            // the OUT hook (which re-locks the turn state) and bumps the in-flight counter by one.
            let to_flush = netcode_v2::with_turn_state(|s| s.turns_to_flush());
            match to_flush {
                None => false,
                Some(n) => {
                    flush_outgoing_turns(nc, n);
                    true
                }
            }
        }
    }

    /// Hook body for `get_outstanding_turn_count`: in-game, the local turns in flight per the turn
    /// state, standing in for Storm's own count (which goes degenerate once its send/ack sequence
    /// stops advancing). The count gates `send_command`'s early flush: when a command won't fit in
    /// the turn being built, BW sends that turn early unless the count is already at
    /// `16 - builtin_turn_latency`, in which case it drops the command. That cap keeps every sync
    /// record in flight inside BW's 16-entry checksum ring; past it, peers check records against
    /// ring entries that have been overwritten and drop this client despite identical sims.
    /// Returns `None` (let Storm answer) before the game starts, with no turn state, or with native
    /// sync off, where no peer checks the ring and a predicting session keeps more turns in flight
    /// by design.
    pub(super) fn netcode_v2_outstanding_turns(&self) -> Option<u32> {
        if !self.game_started.load(Ordering::Acquire) || native_sync_disabled() {
            return None;
        }
        netcode_v2::with_turn_state(|s| s.outstanding_turns())
    }

    /// Seeds the turn state's pipe at the lobby→game transition. The lobby is gated native, so nothing
    /// has primed the turn state when the game starts: the first in-game receive would stall waiting for
    /// turns no one has sent, and the PIPE flush that would send them only runs once the network is
    /// ready — a lockstep deadlock. Native pre-seeds via the lobby's unconditional flush; this is
    /// the turn transport's equivalent, running the PIPE fill once, unconditionally, from the game thread
    /// right after `set_game_started`. Every client seeds its own `latency_turns` turns, which
    /// reach peers via the relay fan-out (and ourselves via the local echo), so everyone's first
    /// receive finds a full turn queued. No-op when there is no live session (the lobby's native
    /// flush already primed the native pipe).
    ///
    /// This runs before BW zeroes its executable-turn index (done at the top of the initialized-game
    /// loop, ahead of the native pre-loop flush), so the seeded turns are stamped with the lobby-era
    /// index; the turn state sends them frameless for that reason (see
    /// [`TurnState::submit_local_turn`](netcode_v2::TurnState::submit_local_turn)).
    pub fn seed_netcode_v2_pipe(&self) {
        unsafe {
            self.netcode_v2_flush_pipe();
        }
    }

    /// Seeds Storm's session-player list with the given non-local session members, standing in for
    /// the peer-admit that native networking performs when each member's join packet arrives. For
    /// each member: look up (or create) its list node by net key, write the low byte of its slot,
    /// set the present/turn-expected flag, and register its slot name.
    ///
    /// The local player is never in `members` — its node is set up by the local-identity fixup in
    /// the join replacement instead. The host uses this to admit its peers after `storm_create_game`;
    /// the join replacement uses it to admit everyone but the local player.
    pub unsafe fn v2_seed_storm_session_members(&self, members: &[netcode_v2::StormMemberSeed]) {
        unsafe {
            let nc = &self.netcode_v2;
            for member in members {
                let node = (nc.storm_session_player_lookup_or_create)(member.net_key.as_ptr());
                if node.is_null() {
                    // The lookup allocates on miss and only returns null on allocation failure,
                    // which shouldn't happen; skip the member rather than dereference null.
                    error!(
                        "netcode v2: failed to create Storm session player for slot {}",
                        member.slot
                    );
                    continue;
                }
                write_session_player_slot(node, member.slot);
                // Bit 0x4 = present/turn-expected. Native sets it from a Storm event listener when a
                // peer is admitted; seeding replaces that admit, so seeding must set it or the
                // receive-turns barrier would never expect this member's turns.
                (*node).flags |= 0x4;
                // Write the node's own name buffer, not just the slot-name registry: native
                // init_net_player reads a session member's name straight off the node (via
                // storm_get_player_name_data) and skips a member whose node name is empty, leaving
                // that player's net_player_info entry unpopulated (state stays 0). Without this a
                // seeded remote is invisible to the per-player registration that follows.
                copy_session_player_name(node, &member.name);
                (nc.storm_register_slot_name)(
                    member.slot as u32,
                    member.name.as_ptr() as *const u8,
                );
            }
        }
    }

    /// Writes one human's `net_player_info` (the "storm players") entry directly: state = in-use plus
    /// the display name. Native `init_net_player` only fills this from a session member Storm's own
    /// provider-gated lookup resolves, which succeeds for the local player but not for a
    /// roster-seeded remote, so a remote's entry would otherwise stay empty — leaving its name blank
    /// everywhere the table is read (the multiplayer-player count that gates the diplomacy UI, the
    /// "player was dropped" notice, chat sender names). The `flags`/`unk4`/`protocol_version` values
    /// match what the native `init_network_player_info(_, 0, 1, 5)` path always wrote; they are only
    /// snapshotted into a per-player record, never read by gameplay.
    pub unsafe fn v2_register_net_player(&self, storm_id: u8, name: &str) {
        unsafe {
            let players = self.storm_players.resolve();
            let entry = players.add(storm_id as usize);
            let mut fabricated = scr::StormPlayer {
                state: 1,
                unk1: 0,
                flags: 0,
                unk4: 1,
                protocol_version: 5,
                name: [0; 0x60],
            };
            for (&input, out) in name.as_bytes().iter().zip(fabricated.name.iter_mut()) {
                *out = input;
            }
            *entry = fabricated;
        }
    }

    /// Re-applies the direct `net_player_info` writes for every staged human and observer. Entering
    /// BW's lobby screen runs native `init_game_network`, which zeroes the entire table — including
    /// entries written during setup. Slots that produce native lobby commands get repopulated by
    /// `init_net_player` as their commands flow, but an observer never participates in the native
    /// lobby command protocol, so its entry stays cleared — and the in-game leave/drop text message
    /// resolves the departing name from this table, rendering it blank. Call once lobby init has
    /// fully completed (no lobby machinery can run the wipe again after that). Idempotent:
    /// rewriting an already-populated entry stores the same bytes.
    pub unsafe fn v2_reapply_net_players(&self, registrations: &[(u8, String)]) {
        unsafe {
            let players = self.storm_players.resolve();
            for &(storm_id, ref name) in registrations {
                let entry = players.add(storm_id as usize);
                if (*entry).state == 0 {
                    debug!("net_player[{storm_id}] was cleared during lobby init; re-registering");
                }
                self.v2_register_net_player(storm_id, name);
            }
        }
    }

    /// Copies BW's game template for `game_type` into `game_data.game_template`. On the host, native
    /// game creation does this from a registry BW loads from data files; the roster-driven peer join
    /// builds its session locally and never receives the host's game-info blob, so its template block
    /// stays zeroed — which BW reads as a Use-Map-Settings game (map triggers run, no alliance UI,
    /// map-defined victory instead of the real game type's rules). Every client loads the same
    /// registry at startup, so this local lookup reproduces the host's template exactly. Errors if the
    /// game type is not registered.
    pub unsafe fn apply_game_type_template(&self, game_type: bw::BwGameType) -> Result<(), ()> {
        unsafe {
            // The lookup keys on the game type split into low/high bytes; our game types all fit in
            // the low byte, so the high byte is always 0.
            let template = (self.find_game_type_template)(
                game_type.primary as u32,
                0,
                game_type.subtype as u32,
            );
            if template.is_null() {
                error!(
                    "No game template registered for type {}/{}",
                    game_type.primary, game_type.subtype
                );
                return Err(());
            }
            let dest = self.game_data.resolve();
            (*dest).game_template = *(template as *const bw::GameTemplate);
            Ok(())
        }
    }

    /// Full replacement for `storm_join_game` used when a lobby session seed is staged: builds this
    /// client's Storm session state from our own inputs rather than the network join handshake the
    /// native function performs (two sends and two blocking waits).
    ///
    /// The native function's prefix tears down any prior session, and a native peer's session state
    /// (game-info blob plus globals) is assembled by an inbound-message handler that never runs in
    /// this seam. `storm_create_game` constructs the equivalent state from our own inputs, after
    /// which the local identity is corrected to the roster slot and the other members are seeded in
    /// place of the network admit. Nothing ever compares session blobs across machines, so each
    /// client building its own from identical server-fed inputs is sound.
    ///
    /// Returns 1 (TRUE) on success — the native caller then stores `*out_net_player_id` as the local
    /// net player id — or 0 (FALSE) on failure, handing control to the caller's join-failure path.
    pub(super) unsafe fn v2_run_join_replacement(
        &self,
        seed: &netcode_v2::LobbySessionSeed,
        out_net_player_id: *mut u32,
    ) -> u32 {
        unsafe {
            let nc = &self.netcode_v2;
            // The native join flow retries: a failure after this replacement already succeeded once
            // (e.g. the caller's map load) re-invokes it. storm_create_game is the one non-idempotent
            // step, so skip it when a session is already live. `in_lobby_or_game` is the reliable
            // test: create_local_storm_session itself sets it to 1 and nothing else on this path
            // touches it, so it is provably 0 on the first attempt and 1 on every retry after a
            // successful create. (storm_local_player_slot's 0xff not-in-session sentinel is what
            // native join's own entry guard checks, but its pre-first-write state is unverified — a
            // zero-initialized global would read as "in session" and wrongly skip the first create.)
            // Every step below is overwrite-or-recompute and safe to re-run.
            let session_already_live = self.in_lobby_or_game.resolve() != 0;
            if !session_already_live {
                // 1. Build equivalent session state. A fresh local session with no peers makes the
                //    local player session slot 0; the fixup below moves it to the roster slot.
                if let Err(e) = self.create_local_storm_session(
                    &seed.game_name,
                    &seed.local_name,
                    seed.slot_count,
                ) {
                    error!("netcode v2: join replacement storm_create_game failed: {e:08x}");
                    return 0;
                }
            }
            // 2. Local identity fixup: correct the local session slot and node from the 0 that create
            //    produced to this client's roster slot.
            nc.storm_local_player_slot.write(seed.local_slot);
            let local = (nc.get_local_storm_session_player)();
            if local.is_null() {
                error!("netcode v2: join replacement could not resolve local session player");
                return 0;
            }
            write_session_player_slot(local, seed.local_slot);
            // Create already wrote the local name into this node; rewriting it keeps the fixup
            // self-sufficient and identical for any future caller.
            copy_session_player_name(local, &seed.local_name);
            (nc.storm_register_slot_name)(
                seed.local_slot as u32,
                seed.local_name.as_ptr() as *const u8,
            );
            // 3. Seed the other members. Done after the local fixup so its slot-name registration for
            //    the local slot re-registers over the local name create left at that index.
            self.v2_seed_storm_session_members(&seed.members);
            // 4. The local game-level net player id the native caller stores: session slot plus the
            //    turn base.
            // Every roster consumer treats the game-level net player id as identical to the session
            // slot; that holds because the turn base stays 0 in this flow (its native writers are
            // the Storm turn-advance and join paths, which never run here). Assert it so a violation
            // is loud in debug rather than a silent identity mismatch.
            debug_assert_eq!(
                nc.storm_turn_base.resolve(),
                0,
                "storm_turn_base expected to be 0"
            );
            *out_net_player_id = seed.local_slot as u32 + nc.storm_turn_base.resolve();
            // 5. Native join's success tail drains Storm's deferred inbound queue. Nothing can be
            //    queued when no Storm networking has run, but calling it keeps the replacement
            //    faithful to the native tail and covers any provider-queued edge.
            (nc.snet_drain_deferred_queue)();
            // 6. TRUE: the caller treats the join as succeeded.
            1
        }
    }

    /// Applies coordinated synced leaves due at `next_frame`, run at the top of the IN hook before
    /// the readiness check. Drains the turn state's [`LeaveTracker`](netcode_v2) for slots whose
    /// relay-agreed apply frame has arrived, writes each departing slot's `pending_leave_reason`
    /// mailbox (drained by [`run_synced_leave_pass`](Self::run_synced_leave_pass) in the synced-RNG
    /// window on the ready step) and drops it from the readiness set — so a step stalled on the
    /// departing peer can proceed. No-op with no live session.
    ///
    /// This is the **production** leave path: the reason, slot, and apply frame all come from the
    /// authority relay's directive, so every client applies the identical leave at the identical
    /// frame and the native drain is deterministic across all of them (including clients that never
    /// observed the drop locally). It is the consensus-backed twin of the debug-only, per-client
    /// [`apply_forced_unsynced_leaves`](Self::apply_forced_unsynced_leaves).
    unsafe fn apply_due_leaves(&self, nc: &NetcodeV2Bw, next_frame: u32) {
        unsafe {
            let Some(due) = netcode_v2::with_turn_state(|s| s.take_due_leaves(next_frame)) else {
                return; // no live session
            };
            for (storm, reason) in due {
                *nc.pending_leave_reason.resolve().add(storm.0 as usize) = reason as i32;
            }
        }
    }

    /// Debug-only `forceUnsyncedLeave` application, run at the top of the IN hook. Drains the slots the
    /// `forceUnsyncedLeave` command queued on the turn state and, for each one that maps to a storm id,
    /// writes that storm's `pending_leave_reason` mailbox and drops the slot from the readiness set.
    /// The existing native synced-leave pass ([`run_synced_leave_pass`](Self::run_synced_leave_pass))
    /// then detects the written reason and applies it in the synced-RNG window on a ready step,
    /// exactly as it would for a real drop; the `mark_slot_left` here is idempotent with the pass's
    /// own re-report. An unmapped slot (no storm id yet) can't be leaked into `pending_leave_reason`,
    /// so it's warned and skipped.
    ///
    /// # Determinism
    ///
    /// Writing `pending_leave_reason` and running `apply_pending_player_leaves` consumes synced RNG
    /// on THIS client only. That is faithful to the real per-client leave mechanism, but a one-sided
    /// injection desyncs a *continuing* multi-player game: peers that didn't apply the same leave on
    /// the same turn diverge. For a 1v1 opponent-drop test (one remaining client) this is correct as
    /// is; for 3+ player games the caller must inject the same slot on every remaining client on the
    /// same turn — which is what the (still-unbuilt) coordinated-leave consensus will do. This is the
    /// trigger, NOT the consensus; it deliberately does no cross-client coordination.
    #[cfg(debug_assertions)]
    unsafe fn apply_forced_unsynced_leaves(&self, nc: &NetcodeV2Bw) {
        unsafe {
            let Some(forced) = netcode_v2::with_turn_state(|s| s.take_forced_unsynced_leaves())
            else {
                // No live session — nothing to force.
                return;
            };
            for slot in forced {
                let storm = netcode_v2::with_turn_state(|s| s.storm_id_for_slot(slot)).flatten();
                let Some(storm) = storm else {
                    warn!("netcode v2: forceUnsyncedLeave for unmapped slot {slot:?}; skipping");
                    continue;
                };
                *nc.pending_leave_reason.resolve().add(storm.0 as usize) =
                    FORCED_UNSYNCED_LEAVE_REASON;
                netcode_v2::with_turn_state(|s| {
                    s.mark_slot_left(storm);
                    // Observation-only: tag the slot's net-stats row with how it departed.
                    s.record_departure(storm, FORCED_UNSYNCED_LEAVE_REASON as u32);
                });
            }
        }
    }

    /// Debug-only `forceDesync` application, run at the top of the IN hook. When the command has
    /// armed the turn state's one-shot flag, diverges this client's simulation from its peers:
    ///
    /// - XORs [`FORCED_DESYNC_RNG_XOR`] into the synced RNG seed. The seed is folded into the
    ///   per-turn sync checksum, so this trips the peers' sync check on the next matching turn
    ///   deterministically (and every subsequent RNG draw diverges, so the desync also cascades
    ///   through unit behavior). This is the reliable trigger.
    /// - Adds [`FORCED_DESYNC_MINERAL_BONUS`] to the local player's minerals, a visible in-game
    ///   confirmation the command landed and a second, resource-level divergence.
    ///
    /// No-op with no live session, or before the game struct exists.
    ///
    /// # Determinism
    ///
    /// The whole point is to break determinism: these writes happen on this client alone, so its
    /// state and command stream drift from every peer. This is the trigger for observing desync
    /// behavior through the transport, and it deliberately does no cross-client coordination.
    #[cfg(debug_assertions)]
    unsafe fn apply_forced_desync(&self) {
        unsafe {
            let armed = netcode_v2::with_turn_state(|s| s.take_forced_desync());
            if armed != Some(true) {
                // No live session, or no perturbation pending.
                return;
            }

            // The synced RNG seed sits one u32 past the operand analysis resolves (mirrors the read
            // in `BwScr::rng_seed`).
            let seed_ptr = self.rng_seed.resolve_as_ptr().add(1);
            let old_seed = seed_ptr.read_unaligned();
            let new_seed = old_seed ^ FORCED_DESYNC_RNG_XOR;
            seed_ptr.write_unaligned(new_seed);
            warn!("netcode v2: forceDesync perturbed RNG seed {old_seed:#x} -> {new_seed:#x}");

            let game = self.game();
            if game.is_null() {
                // The RNG divergence above is enough to trip the sync check; the minerals write is
                // just a visible extra, so a missing game struct isn't fatal.
                warn!("netcode v2: forceDesync before game struct exists; skipped minerals write");
                return;
            }
            let game = bw_dat::Game::from_ptr(game);
            let player = self.local_player_id.resolve();
            // The game's minerals array has one entry per game player (12 wide); an observer's id
            // falls outside it and has no resources to perturb anyway.
            const GAME_PLAYER_COUNT: u32 = 12;
            if player >= GAME_PLAYER_COUNT {
                warn!(
                    "netcode v2: forceDesync with non-player local id {player}; skipped minerals"
                );
                return;
            }
            let player = player as u8;
            let current = game.minerals(player);
            let perturbed = current.saturating_add(FORCED_DESYNC_MINERAL_BONUS);
            game.set_minerals(player, perturbed);
            warn!(
                "netcode v2: forceDesync perturbed local player {player} minerals {current} -> {perturbed}"
            );
        }
    }

    /// Reproduces `receive_storm_turns`' synced player-leave pass for the IN replacement: runs
    /// `apply_pending_player_leaves` inside the synced-RNG window (leave handling can consume synced
    /// RNG, so it must run with the same RNG state on every client) and returns the storm slots whose
    /// pending reason was drained this pass, together with that reason, so the turn state can drop
    /// them from its readiness set and the completed native boundary can be logged. Must be called
    /// with the turn-state lock released — the leave handlers can re-enter the OUT hook.
    unsafe fn run_synced_leave_pass(
        &self,
        nc: &NetcodeV2Bw,
    ) -> SmallVec<[(StormPlayerId, u32); 4]> {
        unsafe {
            let reasons = nc.pending_leave_reason.resolve();
            let mut leaving: SmallVec<[(StormPlayerId, u32); 4]> = SmallVec::new();
            for i in 0..bw::MAX_STORM_PLAYERS {
                let reason = *reasons.add(i);
                if reason != 0 {
                    leaving.push((StormPlayerId(i as u8), reason as u32));
                }
            }
            let orig_rng = self.enable_rng.resolve();
            self.enable_rng.write(1);
            (nc.apply_pending_player_leaves)();
            self.enable_rng.write(orig_rng);
            for &(storm, reason) in &leaving {
                info!(
                    "netcode v2: native synchronized leave pass completed: storm_slot={} \
                     reason={:#010x}",
                    storm.0, reason,
                );
            }
            leaving
        }
    }
}

thread_local! {
    /// Set while SB asks BW to flush turns (the PIPE replacement, or a stalled client sending the
    /// turns it owes), so a turn send that arrives on the OUT hook from any other native path can be
    /// told apart and logged.
    static IN_TURN_FLUSH: Cell<bool> = const { Cell::new(false) };
}

/// Has BW flush `count` local turns, each re-entering the OUT hook.
unsafe fn flush_outgoing_turns(nc: &NetcodeV2Bw, count: u32) {
    IN_TURN_FLUSH.with(|flag| flag.set(true));
    for _ in 0..count {
        unsafe { (nc.flush_outgoing_command_turn)() };
    }
    IN_TURN_FLUSH.with(|flag| flag.set(false));
}
