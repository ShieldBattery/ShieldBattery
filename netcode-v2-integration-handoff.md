# Netcode v2 (rally-point2) — game integration handoff

Status as of 2026-07-01, branch `rp2-integration`. This picks up where the first integration slice
(commit `bd6e86129`) left off. Read alongside `scr-netcode-replacement-guide.md` (the seam RE) and
`netcode-v2-build-plan.md` (WS-A). rally-point2 is pinned as a git dependency; the client API you
consume is documented in `../rally-point2/docs/architecture.md` and its `client/` crate.

## Decisions locked (with the team)

- **Scope B — all transport on rp2, no rally-point v1.** In-game *and* lobby turns leave Storm via
  the seam. Storm's **join/session handshake** packets still originate in Storm, but they surface to
  us through the existing SNP provider (`snp.rs::send_packet`), and the plan is to reroute them off
  that shim onto an rp2 **reliable/opaque channel** instead of rally-point v1 UDP. B's end state: one
  QUIC connection, v1 + the UDP socket gone, Storm's join *bookkeeping* retained as an intermediate
  step.
- **Scope C — full Storm removal — IS the committed end state, not optional (decided 2026-07-02).**
  We do not want Storm bookkeeping left in the tree. B is the stepping stone that gets transport
  working with native join still running; C then replaces join with direct state-setup calls so *we*
  assign the BW network ("storm") id (from the rp2/coordinator roster) instead of reading it back
  from Storm. That collapses the rp2-slot ↔ storm-id translation into a single id, and lets all the
  Storm-reading go away (the `storm_players` name/flags reads in `game_state.rs`, the
  `StormIdChanged` guard, the flags-as-join-complete signal). C is sequenced *after* B only for risk
  reasons — reproducing everything native join sets up (player structs, id tables, provider state,
  whatever `init_network_player_info` and the id-table writes touch) is the large, desync-sensitive
  part — not because it's discretionary. When starting C, enumerate those Storm-populated fields
  first (from `init_network_player_info` + the `net_player_to_game`/`net_player_to_unique` writes) so
  nothing is left implicitly depending on Storm.
- **Lobby turns ride the reliable control stream**, not the datagram turn path. In-game turns ride
  datagrams (`Payload` with `game_frame_count`); lobby turns are control-stream frames
  (`game_frame_count = None`).
- **IN hook = full replacement of `receive_storm_turns` (`0x73f4e0`)** — never call orig. Verified
  against the 12409 BNDB. Covers both callers (`step_network` + the lobby-init receive-only sibling
  `sub_747250`). See the updated guide §5.1.

## What's landed (this slice)

| Area | File | State |
|---|---|---|
| samase symbol surface | `game/scr-analysis/src/lib.rs` | ✅ all turn/pipe/leave symbols exposed |
| rp2 dependency | `game/Cargo.toml`, `Cargo.lock` | ✅ pinned to SHA `e8916614…`; builds i686 |
| Credential wire type | `game/src/app_messages.rs` (`NetcodeV2Setup`, `NetcodeV2Relay`, `Secret`) | ✅ redacted `Debug` |
| App-socket parse | `game/src/app_socket.rs` (`netcodeV2Setup`) | ✅ payload redacted from logs + error ctx |
| GameState plumbing | `game/src/game_state.rs` (`SetNetcodeV2Setup`, `netcode_v2_setup`) | ✅ non-gating stash |
| Identity + TLS trust | `game/src/netcode_v2/credentials.rs` | ✅ pinned-cert, fail-closed, unit-tested |
| Seam turn engine | `game/src/netcode_v2/mod.rs` (`SeamState`) | ✅ per-slot assembly, owned dispatch buffers, local echo, readiness gate, directive/pipe tracking; unit-tested |
| Async dial + handoff | `game/src/netcode_v2/session.rs` (`establish_session`, `with_seam`) | ✅ creds→bind→dial-in-order (home, then backup)→spawn `LinkDriver`→store `SeamState` in a recurse-checked global |

**Nothing is hooked yet** — the live netcode path is unchanged. `establish_session` is not called
from the init flow, and the three BW hooks that would drive `SeamState`/`with_seam` aren't installed
(hence the module-level `#![allow(dead_code)]`, to be removed when the hooks land). The engine and
async side are done and tested; what remains is the unsafe BW-thread wiring, which needs a live game
to self-test — see steps 2–4.

**The seam turn engine (`SeamState`) — what the IN hook calls.** `receive_turns(next_frame)` drains
the inbound channel into per-slot FIFOs, and returns `true` only when every *required* slot (each
mapped slot; a synced leave clears one via `mark_slot_left`) has a turn queued — popping exactly one
turn per slot into owned `Bytes` dispatch buffers. On `false`, nothing is consumed and the IN hook
returns 0 to stall. After `true`, iterate `dispatch_buffers()` → `(storm_id, &[u8])` to fill
`player_turns[]`. **Local echo:** the relay fans out to peers only (never the sender), so
`submit_local_turn` also queues our own turn into our slot — that's the sole path our commands reach
the local sim, and it keeps them on the same latency delay as everyone else's (guide §5.4 #3).

## What's next (in rough order)

### 0. App-side sender (WS-F) — does not exist yet
Nothing on the TypeScript side sends `netcodeV2Setup` (zero references outside `game/`). The DLL's
`GameState.netcode_v2_setup` stays `None` — and the whole seam silently never activates — until the
Electron app: generates the per-session Ed25519 keypair (D6), requests a coordinator-signed token
embedding the public half, and forwards token + key + relay endpoints over the app socket as a
`netcodeV2Setup` message (camelCase fields matching `app_messages.rs::NetcodeV2Setup`). Follow the
existing `setRoutes` flow in `app/game/game-server.ts` / `active-game-manager.ts` as the template.

### 1. ✅ Async setup: dial the relay, spawn the driver — DONE (`netcode_v2/session.rs`)
`establish_session(&NetcodeV2Setup)` runs on the DLL's Tokio runtime and does the full sequence:
build credentials, `bind_endpoint`, dial the home relay trying each address in order (v6 then v4)
and falling back to the backup relay, `LinkDriver::new` + `tokio::spawn(driver.run())`, then store a
`SeamState` in a recurse-checked global. The `ClientEndpoint` is kept alive for the session inside
`NetcodeV2Session` (it owns the UDP socket). `driver.run()`'s `Err` = link failure = player dropping;
logged, no reconnect yet (D11). **The remaining wiring for this step is the call site:** consume the
stashed `GameState.netcode_v2_setup` during init (before `network_ready_future` completes) and
`await establish_session`; on `Err`, fall back to the legacy path for the session (don't fail the
game). The BW hooks reach the seam via `netcode_v2::with_seam(|seam| …)`.

### 2. Install the three hooks (`bw_scr.rs`) — the unverified part; gate it
Resolve the addresses from the `scr_analysis::Analysis` getters, declare hooks in the `hooks` module
(`whack_hooks!`), install like the existing `StepNetwork`/`StepIo` examples. **Gate activation on the
startup self-test + offset plausibility (step 4): if either fails, don't install/activate the seam
hooks and run native networking for the session** (guide §5.5/§6). All three hook bodies reach the
seam through `with_seam(|seam| …)`, which returns `None` (→ fall back to native behavior) when there
is no session or on a re-entrant call. Bodies:

- **OUT — `send_turn_message`.** Hand the assembled `(buffer_ptr, len)` to
  `with_seam(|s| s.submit_local_turn(commands, frame))`. `frame = Some(game_frame_count)` in-game,
  `None` in lobby. (Lobby turns still need the reliable control stream — §4; today
  `submit_local_turn` only pushes the datagram `outbound` channel.)
- **IN — full-replace `receive_storm_turns`.** Do **not** call orig. In one `with_seam` call:
  `if s.receive_turns(next_frame)` then iterate `s.dispatch_buffers()` → `(storm_id, &[u8])`, writing
  `player_turns[storm]` / `player_turns_size[storm]` / `net_player_flags[storm] |= 0x10000|0x20000`;
  also `s.apply_due_directive(next_frame)` and `s.mark_local_turn_executed()` **once for the step**.
  Return that bool as readiness (1 = dispatch, 0 = stall). The dispatched `Bytes` are owned by the
  seam and valid until the next `receive_turns` (guide §5.4 #4). **Then, after the `with_seam` closure
  returns (lock released),** run the synced leave pass `set_rng_enable(1) →
  apply_pending_player_leaves → set_rng_enable(orig)` — release first because the leave pass can issue
  commands that re-enter the OUT hook, which would re-lock the seam. On a detected leave, a separate
  short `with_seam(|s| s.mark_slot_left(storm))` drops that slot from the readiness set.
- **PIPE — replace `flush_local_turns_to_latency_depth`.** Loop `while
  with_seam(|s| s.outstanding_turns()) < with_seam(|s| s.latency_turns()) { flush one turn }` — i.e.
  drive the flush off the seam's counters, not the native `builtin_turn_latency + net_user_latency`
  (coalesce into a single `with_seam` read per iteration in practice).

### 3. slot ↔ storm-id mapping
Native join assigns storm ids in join order, so the map is learned during lobby init. Populate
`SeamState::map_slot(slot, storm_id)` as players join (SB already tracks this in
`game_thread/lobby_init.rs` / the lobby setup path — find where storm ids are assigned and mirror
it). The token's slot is the rp2 slot; the BW arrays are indexed by storm id.

### 4. rally-point2 asks (coordinate with that team)
- **Opaque session/lobby `ControlFrame` kind.** For scope B we need Storm's join packets (and lobby
  turns, per the reliable-stream decision) to ride the rp2 reliable control stream. Today
  `ControlFrame` only has `oversize_turn: Payload`. Ask for an opaque blob frame kind
  (addressed to a slot / broadcast within the session) + client send/recv API + relay forwarding.
  This is the architecture doc's reserved "chat/resync/lobby-control future frame kinds."
- Until that exists, lobby turns / join can't fully move off Storm-SNP; a **temporary** interim is
  to keep join on the existing SNP→rally-point-v1 path while in-game turns run on rp2 (that's "scope
  A" as a stepping stone), but the agreed target is B.

### 5. Safety rails (guide §5.5, §6)
- **Self-test before committing a game to the transport:** round-trip a known turn through the seam
  at startup; on failure fall back to native/rally-point networking for the session.
- **Offset plausibility gates:** e.g. `builtin_turn_latency == 2`, sane latency-loop math; on failure
  fall back rather than risk a desync.
- **Suppress the native latency knob + turn-rate commands** (`0x55`/`0x5f`/`0x66`): the relay owns
  latency via `buffer_directive` (applied out-of-band by `apply_due_directive`); a user clicking the
  in-game latency knob must not desync expectation vs reality (dev-note gotcha #2 / guide §5.3).

### 6. Still-open / blocked
- ✅ **`pending_leave_reason` samase analyzer — LANDED (2026-07-02, samase pin `8f2e353b`).** Exposed
  as `scr_analysis::Analysis::pending_leave_reason()` → the `int32[0xc]` array-base `Operand` (storm-id
  indexed, stride 4, both widths; `0` = none, `0x40000006` = dropped, other nonzero = left). The
  server-agreed deterministic-leave write is now unblocked; the native-parity interim is no longer
  needed. Self-test cross-check: its base should sit `0x30` (== 12×4) below `net_players` — both
  resolve independently via samase, so compare them at startup rather than deriving one from the other.
- **Synced player-leave determinism** (agreeing *which turn* + identical per-slot apply order and
  RNG state across all clients, including clients that never detected the drop locally — guide §5.8)
  and **reconnect/failover (D11)** are still open *designs* — the analyzer unblocks the write, but the
  consensus/ordering protocol is the relay/coordinator's job; don't invent leave/reconnect handling
  at the seam unilaterally.

## Security notes (done here; keep these invariants)

- **Private key never logged.** `Secret` redacts `Debug`; `app_socket` redacts by mechanism via the
  `SENSITIVE_COMMANDS` list — for commands on it, the raw message text, the payload debug log, the
  `context()` error input, *and* serde's own error message (which can echo mistyped field values)
  are all redacted, including on the pre-parse "Invalid message" path. Add any new secret-bearing
  command to `SENSITIVE_COMMANDS` and all of that applies automatically; if you add new error paths
  that touch the setup elsewhere, still do **not** format the key. (Plaintext lives in memory until
  drop — zeroization-on-drop is a noted follow-up needing the `zeroize` crate.)
- **TLS trust is pinned + fail-closed.** `SessionCredentials::from_setup` trusts only the relay leaf
  cert(s) the coordinator sent — no webpki roots, no system roots, no accept-any. An empty/malformed
  cert set is an error, never a silently-empty store. Don't "helpfully" add fallback roots; direct
  relay IPs (D3) mean there is no public CA to fall back to.
- **Token decoded, not trusted-as-sent.** session/slot/tenant come from decoding the signed token,
  not from separate fields. Key↔token match is checked by the relay (challenge response), by design.
- **Version skew is a feature.** We consume rally-point-client's re-exported quinn/rustls so the DLL
  and transport can't drift; ALPN mismatch is rejected at the TLS handshake. When bumping the rp2
  pin, rebuild both sides.
