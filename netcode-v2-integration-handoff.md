# Netcode v2 (rally-point2) — game integration handoff

> **Slice 4 landed (2026-07-02): the control plane (WS-E + WS-F) is built and both DLL gaps are
> closed.** The server can now request a coordinator session (pubkey collection → `POST
> /session/create` → per-player token/relays/roster publish), the Electron app generates the
> per-session keypair and sends `netcodeV2Setup` to the DLL, and the DLL maps every roster slot and
> seeds the pipe at game start. The whole path is **dormant unless the server sets
> `SB_RP2_COORDINATOR_URL`** — with it unset, games load byte-for-byte as before. What still blocks
> a live loopback game is on the **rally-point2 side** (tenant enrollment in the coordinator binary
> + relay-cert conveyance) — see **"Slice 4 — what landed"**.
> **Decision (2026-07-02): seam symbol resolution is a hard launch error, not a native fallback** —
> full cutover to rally-point2, all clients on one netcode, so a build that can't resolve the seam
> must not run.

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

## Slice 3 — what landed (2026-07-02)

All in `game/`, branch `rp2-integration`. Builds i686, `cargo clippy --all-targets` clean, unit
tests green (seam engine 8 + credentials 6 + new command-strip 2).

- **Session call site** (`game_state.rs::init_game`): consumes the stashed `netcode_v2_setup` and
  `await`s `netcode_v2::establish_session` before the network is declared ready. On a dial error it
  logs and falls back to native for the session (with no session, the hooks pass through).
  `netcode_v2_setup` is `None` in production today → this whole block is skipped.
- **Offset resolution is required** (`bw_scr.rs::resolve_netcode_v2`): all 10 seam symbols
  (`send_turn_message`, `receive_storm_turns`, `flush_local_turns_to_latency_depth`,
  `flush_outgoing_command_turn`, `apply_pending_player_leaves`, `player_turns`, `player_turns_size`,
  `game_frame_count`, `pending_leave_reason`, plus the reused `net_player_flags`/`enable_rng`)
  resolve at launch or launch fails naming the missing one — cut over rather than degrade. No runtime
  plausibility gate: the samase analysis is reliable (it finds a symbol or it doesn't, which the
  hard-fail catches), so the earlier plausibility/self-test gating was dropped as dead weight once
  verified working in-game.
- **Three hooks** (`bw_scr.rs`, installed together only because resolution is required): OUT
  `send_turn_message` → `submit_local_turn` (control commands stripped first); IN full-replace
  `receive_storm_turns` (fills the three arrays, runs the synced leave pass after releasing the seam
  lock, `mark_local_turn_executed` once per step); PIPE full-replace
  `flush_local_turns_to_latency_depth` off the seam's `latency_turns`/`outstanding_turns`. **Each
  hook is gated `has_game_started() && with_seam(..).is_some()`; otherwise it calls `orig`** — so
  lobby stays native and a no-session game is byte-for-byte the legacy path. OUT arg order
  (`buffer_ptr`, `len`) reconfirmed against the 12409 LLIL call site (`0x74e2b0`).
- **Local slot mapping** (`game_state.rs::update_bw_slots`): maps our own rp2 slot (from the token)
  → our storm id via `SeamState::map_local_storm` when our storm id solidifies.
- **Control-command suppression** (`bw::commands::strip_control_commands`): the OUT hook strips
  `0x55`/`0x5f`/`0x66` before submitting so they can't rewrite the pinned globals.
- **Synced leave pass** (`BwScr::run_seam_leave_pass`): reproduces `set_rng_enable(1)` →
  `apply_pending_player_leaves` → restore, and reports drained slots to `mark_slot_left`.

**Two gaps that blocked a *live* seam game — BOTH CLOSED in slice 4:**
1. **Remote slot↔storm mapping — closed.** `NetcodeV2Setup` now carries the full slot `roster`
   (`[{slot, userId}]`, from the coordinator's session response via the server); `update_bw_slots`
   maps every peer through `SeamState::map_storm_for_user` as their storm id solidifies. The local
   slot still comes from the signed token (`map_local_storm`), with a cross-check that logs an
   error if the roster disagrees with the token about our own slot.
2. **In-game pipe bootstrap — closed.** `BwScr::seed_netcode_v2_pipe` runs the PIPE fill once from
   the game thread right after `set_game_started()` (game_thread.rs, before `run_game_loop`), so
   every client seeds `latency_turns` turns at the transition; peers receive them via relay
   fan-out, ourselves via the local echo. No-op with no live session.

## Final form (post-cutover) — the target the interim should converge to

> Design agreed with Travis 2026-07-03. **Not built yet** — this records where the slice-4 interim
> should land once netcode v2 is the *only* netcode, so the interim's provisional bits (the
> dedicated route, the `netcodeV2`/`useNetcodeV2` naming, the load-time submission) get removed
> rather than ossified.

**Naming: drop `netcodeV2` from everything public.** Once v2 is the only transport there is no
"v2" to name — it's just *the* network session. Public fields/types become transport-agnostic
(`clientKey`/`sessionPublicKey`, `region`), and `GameSetup.useNetcodeV2` goes away entirely (every
game uses it, so there's nothing to branch on).

**Submit the client key + region at matchmaking-search / lobby-create-join — not at game load.**
The only hard constraint is that the server must hold the client's current public key *before* it
calls the coordinator to mint the session token (which happens at game-load). Search-start and
lobby create/join both sit before load, so submitting there:
- removes the dedicated load-time route (`netcodeV2Pubkey`) — the key rides the queue/lobby-entry
  request the client already sends;
- removes the load-critical-path round-trip (the slice-4 deferred serialization concern) — the
  server already has the key when `doGameLoad` reaches the session mint;
- bundles naturally with `region` (known client-side at that point via the GameLift beacons, D7),
  so the payload reads as "my connection identity + where I am" — the entry ticket into
  matchmaking/lobby.

Late lobby joiners submit at *their* join, so the fold-into-join flow covers them.

**Keypair lifetime is a deliberate blast-radius choice, NOT a per-load requirement.**
Cryptographically you do not need a fresh key per game load — you need the server to hold a current
key whose private half the client still has at launch. So generate earlier and reuse for the
resulting game's token. How long one keypair lives:
- **Matchmaking:** one search → one match → one game, so a per-search key is already per-game.
  Fold into the queue request; rotate on each new search. Clean, no dedicated route.
- **Lobby:** a lobby can play multiple games back-to-back, so a per-lobby key spans several games
  (more reuse than the per-session design nominally wants). Two options: (a) accept one key per
  lobby lifetime (simplest), or (b) refresh per game via a tiny key push riding an existing
  launch/ready signal (not a resurrected `netcodeV2` route).
- **Risk is modest either way** because the token is per-session and connection-bound (TLS channel
  binding, D6): a leaked private key still needs the matching per-game token to do anything. So
  per-search / per-lobby is defensible. **Do NOT** promote it to a long-lived persistent
  (per-login) key without a deliberate security review — that turns the private key into a durable
  credential and discards the point of the per-session-key design.

**Recommendation:** generate + submit `{clientKey, region}` at search-start and lobby
create/join; rotate on each new search / fresh lobby entry; for the multi-game-lobby case default
to per-lobby reuse unless the per-game refresh is wanted (Ed25519 keygen is microseconds, so cost
isn't the constraint — tightness of the blast radius is the only dial). The app already holds the
private key in local process memory across the game's life; this just holds it from search/lobby
entry instead of from load — same trust boundary, slightly longer window.

## Slice 4 — what landed (2026-07-02): control plane (WS-E + WS-F) + DLL gap closure

Everything below is **dormant unless the server sets the netcode v2 env vars**; without them the
flag `GameSetup.useNetcodeV2` is never set and every client path no-ops. This is the **interim**;
the target it should converge to is the "Final form" section above.

**Server (WS-E), new `server/lib/netcode-v2/netcode-v2-service.ts`:**
- Config from env: `SB_RP2_COORDINATOR_URL` (presence enables), `SB_RP2_TENANT`,
  `SB_RP2_RELAY_CERT` (path to the relay's leaf cert PEM — parsed/validated via `X509Certificate`
  at startup, pinned into every client's setup; interim until the coordinator conveys per-relay
  certs), `SB_RP2_RELAY_SERVER_NAME` (default `localhost`).
- `GameLoader.doGameLoad` (when enabled + >1 human + ≤8 participants): publishes
  `setGameConfig` with `useNetcodeV2: true` → each client submits its per-session pubkey via
  `PUT /api/1/games/:gameId/netcodeV2Pubkey` (participants only — enforced via
  `GameLoader.isLoadingForUser`) → `NetcodeV2Service.createSessionForGame` awaits all pubkeys
  (abortable, load-timeout backstop), calls `POST /session/create` (snake_case JSON, byte fields
  as number arrays), and returns per-player `{token, homeRelay, backupRelay?, roster}` → published
  as `setNetcodeV2Setup` per player, **always before `startWhenReady`** (the DLL consumes the
  setup when its init starts). Cleanup (`discardGame`) runs on session create, load success, and
  cancel.
- >8 participants (8 players + observers) falls back to legacy netcode with a warning — the
  coordinator caps slots at 7 (`MAX_SLOT`); see rp2 asks below.

**Client renderer (`client/active-game/socket-handlers.ts`):** on `setGameConfig` with
`useNetcodeV2`, asks the app for the session pubkey (IPC `activeGameGenNetcodeV2Keys`) and submits
it (3 attempts; terminal failure reports a load error so the lobby fails fast instead of hanging).
Forwards `setNetcodeV2Setup` → IPC `activeGameSetNetcodeV2Setup`. Both no-op outside Electron.

**Electron app (WS-F):**
- `app/game/netcode-v2-keys.ts`: generates the Ed25519 keypair and assembles the **PKCS#8 v2**
  document by hand (ring only accepts v2; Node only exports v1). The 85-byte layout is verified
  against the RFC 8032 §7.1 vector on BOTH sides — `netcode-v2-keys.test.ts` (TS) and a
  `credentials.rs` test (ring accepts the exact bytes) — so template drift breaks a test.
- `active-game-manager.ts`: keys generated per game id (never carried across game ids — the
  config spread explicitly drops v2 state when the id changes), private key merged into the
  server's setup and sent to the DLL as `netcodeV2Setup` **before** `setupGame`.
  `maybeSendGameSetup(game)` gates `setupGame` on config+routes (+v2 setup when `useNetcodeV2`),
  takes the game snapshot explicitly so `handleGameConnected`'s awaits can't emit a swapped
  game's setup, and the keys-missing error path quits the launched game process.

**Wire types:** `common/games/netcode-v2.ts` (`NetcodeV2ServerSetup` + `clientPrivateKey` ⊃
`NetcodeV2Setup`, field-name-compatible with `game/src/app_messages.rs`), `setNetcodeV2Setup` in
`GameLoaderEvent`, `useNetcodeV2` on `GameSetup`, two new IPC invokeables in `common/ipc.ts`.

**DLL:** roster field + `map_storm_for_user` + token/roster cross-check; `seed_netcode_v2_pipe`
at the lobby→game transition (details in the closed-gaps list above).

**Review pass:** a multi-agent review of this slice surfaced 10 findings (participant check,
orphaned game process, slot-cap overflow, cross-game key reuse, an await-gap regression, web-client
no-op, retry hardening, plus cleanups) — 9 fixed, 1 deferred (see latency note below). Verified:
858 TS tests + 55 Rust tests green, clippy/typecheck/lint clean.

**Deferred (noted, not built):**
- The v2 handshake is serialized after route creation on the load critical path (keygen + pubkey
  round-trip + coordinator POST all happen post-`setGameConfig`, pre-`startWhenReady`). Fine for
  dev; before production, trigger keygen earlier so the client round-trip overlaps the
  ping/route phase.
- Old clients ignore `useNetcodeV2` and never submit a pubkey → the load times out (75s). Version
  gating (WS-E "client-version homogeneity") is the real answer.

**rally-point2 asks (blocking the live loopback test, coordinate with that team):**
1. **Tenant enrollment in the coordinator binary.** `coordinator/src/main.rs` builds
   `tenant::new_store()` **empty** and has no enroll flag/API — a stock coordinator 400s every
   `/session/create` with TenantNotFound. Needs a dev flag (e.g. `--tenant/--kid`, generating or
   accepting a signing key and printing the pubkey for the relay's `--tenant-pubkey`), mirroring
   the relay's dev-key generation.
2. **Relay cert in the session response.** `SessionResponse.home_relay`/`backup_relay` carry only
   `relay_id` + `relay_addr`; the client must pin the relay's leaf cert, so today it rides SB
   server config (`SB_RP2_RELAY_CERT`). The coordinator should convey each relay's cert (it could
   collect it at enrollment).
3. **Raise `MAX_SLOT` (7 → 11).** BW supports 12 network participants (8 players + 4 observers);
   the current cap forces observer-carrying lobbies onto legacy netcode.
4. **Opaque session/lobby `ControlFrame` kind** (pre-existing ask, unchanged — needed for scope
   B's lobby-turns-on-reliable-stream).

**Dev loopback runbook (once rp2 ask #1 lands):** run `rally-point-coordinator`
(`--allow-insecure-control` + the new tenant flag) and `rally-point-relay` (`--cert/--key` a
known PEM pair, `--tenant-pubkey` from the coordinator's tenant key, `--coordinator-url`), then
start the SB server with `SB_RP2_COORDINATOR_URL/SB_RP2_TENANT/SB_RP2_RELAY_CERT` pointing at
them, and load a 2-player game (two clients on one machine work). Watch for "netcode v2 session
established" in the game logs, then the in-game turn flow through the seam.

## What's next (in rough order)

### 0. ✅ Control plane (WS-E + WS-F) + roster + bootstrap seeding — DONE (slice 4)
See "Slice 4 — what landed". The smallest path to a *live* seam test is now: land rp2 ask #1
(coordinator tenant enrollment), then run the dev loopback runbook above.

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

### 2. ✅ Install the three hooks (`bw_scr.rs`) — DONE (slice 3; kept for the hook-body reference)
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

### 3. ✅ slot ↔ storm-id mapping — DONE (local in slice 3, peers via roster in slice 4)
`update_bw_slots` maps the local slot from the token (`map_local_storm`, with a roster
cross-check) and every peer through the roster (`map_storm_for_user`) as storm ids solidify.

### 4. rally-point2 asks (coordinate with that team)
- **Opaque session/lobby `ControlFrame` kind.** For scope B we need Storm's join packets (and lobby
  turns, per the reliable-stream decision) to ride the rp2 reliable control stream. Today
  `ControlFrame` only has `oversize_turn: Payload`. Ask for an opaque blob frame kind
  (addressed to a slot / broadcast within the session) + client send/recv API + relay forwarding.
  This is the architecture doc's reserved "chat/resync/lobby-control future frame kinds."
- Until that exists, lobby turns / join can't fully move off Storm-SNP; a **temporary** interim is
  to keep join on the existing SNP→rally-point-v1 path while in-game turns run on rp2 (that's "scope
  A" as a stepping stone), but the agreed target is B.

### 5. Safety rails — resolved (see the 2026-07-02 decision + slice 3)
The self-test/plausibility gating was **deliberately dropped** (hard launch failure on symbol
resolution replaced it; samase either finds a symbol or it doesn't). Control-command suppression
(`0x55`/`0x5f`/`0x66`) landed in slice 3 (`bw::commands::strip_control_commands` in the OUT hook).

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
