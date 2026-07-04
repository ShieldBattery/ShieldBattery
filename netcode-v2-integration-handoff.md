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
  `SB_RP2_RELAY_SERVER_NAME` (default `localhost`). Relay certs are no longer server config:
  each session response carries `cert_der` per relay (validated via `X509Certificate` before
  being handed to clients). `SB_RP2_RELAY_CERT` is gone.
- `GameLoader.doGameLoad` (when enabled + >1 human + ≤12 participants): publishes
  `setGameConfig` with `useNetcodeV2: true` → each client submits its per-session pubkey via
  `PUT /api/1/games/:gameId/netcodeV2Pubkey` (participants only — enforced via
  `GameLoader.isLoadingForUser`) → `NetcodeV2Service.createSessionForGame` awaits all pubkeys
  (abortable, load-timeout backstop), calls `POST /session/create` (snake_case JSON, byte fields
  as number arrays), and returns per-player `{token, homeRelay, backupRelay?, roster}` → published
  as `setNetcodeV2Setup` per player, **always before `startWhenReady`** (the DLL consumes the
  setup when its init starts). Cleanup (`discardGame`) runs on session create, load success, and
  cancel.
- >12 participants falls back to legacy netcode with a warning — the coordinator caps slots at
  11 (`MAX_SLOT`, BW's 12 network participants), so this only triggers on malformed configs.

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
1. ✅ **Tenant enrollment in the coordinator binary — DONE** (rp2 `8dcddda`). The coordinator now
   takes `--dev-tenant` (enrolls the tenant at startup; defaults `--tenant sb-dev` /
   `--kid dev-key-1`, matching the relay, with 1..=6 buffer bounds) and logs the verifying key
   as hex for the relay's `--tenant-pubkey`. `--tenant-key <hex-or-file>` pins a hex-encoded
   PKCS#8 keypair so the pubkey survives restarts; without it a fresh keypair is generated and
   its PKCS#8 hex logged for pinning next run. Verified live: coordinator + relay
   (`--coordinator-url`) up, `POST /session/create` for `sb-dev` returns 200 with two signed
   tokens; unknown tenant still 400s.
2. ✅ **Relay cert in the session response — DONE** (rp2 `d5b5732`). The relay reports its
   client-edge leaf cert (DER) in its enroll Hello; the coordinator records it and session
   responses carry home/backup relays as `RelayEndpoint {relay_id, relay_addr, cert_der}`. SB
   server consumes it per relay (validated via `X509Certificate`); `SB_RP2_RELAY_CERT` is
   deleted. Verified live: the `cert_der` in a real session response parses as the relay's
   self-signed `DNS:localhost` cert.
3. ✅ **Raise `MAX_SLOT` (7 → 11) — DONE** (rp2 `d5b5732`). Coordinator-side validation only (the
   relay never had a slot cap). Verified live with a 12-player `/session/create` → 12 tokens. SB
   game-loader cap raised 8 → 12 to match.
4. **Opaque session/lobby `ControlFrame` kind** (pre-existing ask, unchanged — needed for scope
   B's lobby-turns-on-reliable-stream).

**✅ LIVE LOOPBACK VERIFIED (2026-07-03):** the full stack ran end-to-end for the first time — a
real 2-player lobby game (claude-1/claude-2 via the runbook below): pubkeys → coordinator session
→ relay authorized both tokens (`client authorized tenant="sb-dev" session=… slot=0/1`) → both
DLLs logged **"Netcode v2 session established"** → game loop running with turn seqs advancing
over the QUIC link, zero WARN/ERROR through gameplay. Gotcha that cost one failed run: the app
injects `game/dist/shieldbattery.dll`, which only `game\build.bat` refreshes — a bare
`cargo build` leaves a stale dist DLL (ours predated the plausibility-gate deletion and fell back
to native networking).

**Dev loopback runbook (verified working):** run `rally-point-coordinator`
(`--allow-insecure-control --dev-tenant`, optionally `--tenant-key` to pin the key; passing
`--bootstrap-secret <s>` instead of `--allow-insecure-control` also works — give the relay the
matching `--coordinator-secret <s>`) and `rally-point-relay` (`--tenant-pubkey` = the hex pubkey
the coordinator logs at startup, `--coordinator-url` + `--relay-id`; no cert flags needed — the
relay self-signs and its cert reaches clients through the coordinator's session response), then
start the SB server with `SB_RP2_COORDINATOR_URL`/`SB_RP2_TENANT` pointing at them, and load a
2-player game (two clients on one machine work). Watch for "netcode v2 session established" in
the game logs — or, as of slice 5, assert `networkStatus.transport === 'netcodeV2'` from the
renderer Redux state over CDP (see slice 5 below), then the in-game turn flow through the seam.

**Two Windows loopback gotchas (cost one failed run each, 2026-07-04):**
- **Give the relay `--listen 127.0.0.1:14900` explicitly.** Its default `[::]` UDP bind is
  IPv6-*only* on Windows, and the session response then advertises `127.0.0.1` — so the client's
  v4 dial times out in silence (relay logs nothing, DLL logs `dial timed out after 10s`, game
  falls back to native). The same applies to the coordinator: it binds `[::]:14910`, so point the
  relay and `SB_RP2_COORDINATOR_URL` at `http://[::1]:14910`, not `127.0.0.1`.
- The relay dial failure is *visible in Redux now* (`networkStatus: {transport: 'native',
  fallbackFrom: 'netcodeV2', error: 'netcode v2 relay could not be dialed: …'}`) — check that
  before grepping anything.

## Slice 5 — what landed (2026-07-04): game observability, first slice (§7 items #1 + scaffold)

The first slice of the §7 verification-tooling task. Verified live end-to-end (below). All
tests/lints green: 59 Rust tests, 858 TS tests, clippy/typecheck/lint clean.

- **`/game/networkStatus` DLL→app event (SHIPS IN PROD — safe subset).**
  `app_messages.rs::{NetworkTransport, NetworkStatus}`; sent once from `init_game` when the
  transport choice settles: `{transport: 'netcodeV2'}` on session established, `{transport:
  'native', fallbackFrom: 'netcodeV2', error}` on dial failure, `{transport: 'native'}` on the
  no-setup (legacy/replay) path. Same trust boundary as `/game/start`.
- **App relay into `GameStatus`:** `game-server.ts` routes it to
  `ActiveGameManager.handleNetworkStatus`, which stores it on the active game and re-emits
  `gameStatus`; `ReportedGameStatus` (common/games/game-status.ts, new `GameNetworkStatus` type)
  now carries `networkStatus` on **every** status report for the game, so a verifier can assert
  it at any later moment (e.g. once `playing`). Reset explicitly in `setGameConfig` so a
  relaunch can't show a stale transport. Renderer gets it for free via the existing
  `@active-game/status` → `state.gameClient.status.networkStatus`.
- **Dev-only Redux exposure for verifiers:** `client/index.jsx` sets `window.__sbReduxStore`
  (non-production bundles only), so CDP assertions are one `eval` — no fiber-walking, no log
  grepping.
- **`debug_control` scaffold (DEBUG-ONLY, the §7 security split, enforced):**
  `#[cfg(debug_assertions)] mod debug_control` (game/src/debug_control.rs) with one `Ping`
  command → `/game/debug/pong` reply, plus the cfg-gated `"debugControl"` dispatch arm in
  `app_socket.rs` and a cfg-gated `GameStateMessage::DebugControl` variant — the full
  command→game_state→reply round-trip pattern that §7 #2 (queryState) and #3 (forced scenarios)
  should extend. Unit-tested. No app-side sender exists yet; when one is added it must be
  dev-gated (`isDev`/`SB_SESSION`) as defense in depth.
- **Release compile-out: PROVEN, and don't re-verify it by string-grepping.** Method that works:
  drop `#[cfg(debug_assertions)] compile_error!(…)` into lib.rs — `cargo check --release` must
  pass (assertions off ⇒ the whole debug surface is excluded) and `cargo check` must fail
  (positive control); then remove the probe. Method that **lies**: grepping the release DLL for
  command strings — release codegen materializes even *shipping* literals (e.g.
  `/game/setupProgress`) as immediate stores in .text, so absence proves nothing.
- **Live-verified (2026-07-04):** 2-player loopback (runbook above, claude-1/claude-2): both
  renderers asserted `state.gameClient.status.networkStatus.transport === 'netcodeV2'` over CDP
  while the game was `playing`, relay authorized slots 0/1. The **fallback event was live-verified
  too** (the first run hit the IPv6 bind gotcha: Redux showed `{transport: 'native', fallbackFrom:
  'netcodeV2', error: 'dial timed out…'}` — the new event diagnosed its own test run).

**§7 remaining:** #2 `debug/queryState` (seam snapshot: readiness set, per-slot storm ids, buffer,
turn counts), #3 forced scenarios (leave/desync/buffer injection — the power tool for §6's
leave/reconnect work), #4 app-side screenshots (Electron `desktopCapturer`, no DLL change). All
three should build on the slice-5 patterns (`debug_control` for #2/#3; the `networkStatus`-style
relay for anything new that's prod-safe).

## Slice 6 — what landed (2026-07-04): debug/queryState (§7 #2) + the Seam→TurnState rename

> **Naming note for readers of the sections above:** older sections refer to `SeamState` /
> `with_seam` / "the seam turn engine". Those identifiers were renamed this slice (below); the
> *concept* — the three-hook interposition point — is still called "the seam" in the RE guide and
> in prose here, but the code no longer uses the word.

- **`Seam*` identifiers renamed across `game/`** (review feedback: RE-doc jargon is not a type
  name; types are named for what they hold). `SeamState` → `TurnState`, `with_seam` →
  `with_turn_state`, `NetcodeV2Session.seam` → `turn_state`, `run_seam_leave_pass` →
  `run_synced_leave_pass`, `SeamSend`/`SeamReceive` (bw_scr) → `TurnSendOutcome`/
  `TurnReceiveOutcome`. Comments across the crate reworded to "turn state / turn transport / turn
  hooks"; one deliberate "seam" survives in the `netcode_v2/mod.rs` module doc describing the hook
  boundary itself. Related style rule now in force: comments must stand on their own — no
  project-narrative framing, no cross-context jargon (e.g. `common/` types don't mention "netcode
  v2 turn seam").
- **`debug/queryState` (§7 #2) — DEBUG-ONLY, live-verified.** `DebugControlCommand::QueryState`
  (`debug_control.rs`) → game_state calls `with_turn_state(|s| s.debug_snapshot())` (safe from the
  async thread: the recurse-checked mutex blocks cross-thread, only same-thread re-entry gets
  `None`) → replies on `/game/debug/state` with `{turnState: null | {localSlot, latencyTurns,
  outstandingTurns, slots: [{slot, userId, stormId|null, required, queuedTurns, hasDispatch}]}}`.
  `TurnState::debug_snapshot()` is a pure read and degrades (never panics) on indices the arrays
  can't track. Release compile-out re-proven with the `compile_error!` probe, both directions.
- **App-side sender (defense in depth, per the §7 split):** `activeGameDebugQueryState` IPC is
  registered **only when `isDev || SB_SESSION`**; `ActiveGameManager.debugQueryState` correlates
  replies FIFO-per-game with a 5s timeout (a release DLL never recognizes `debugControl`, so
  timeout = "not a debug build"), and pending queries are rejected on game teardown. Types in
  `common/games/game-debug.ts`.
- **Verifier surface:** dev bundles expose `window.__sbDebugGame.queryGameState()` next to
  `__sbReduxStore` — the whole assertion is one CDP eval returning the parsed snapshot.
- **Live-verified (2026-07-04):** 2-player loopback per the runbook (claude-1/claude-2, relay
  `--listen 127.0.0.1:14900`, coordinator at `http://[::1]:14910`): both clients `playing` with
  `networkStatus.transport === 'netcodeV2'`, then `queryGameState()` on each returned consistent
  live state — c1 `{localSlot: 0, latencyTurns: 2, outstandingTurns: 2}`, c2 `{localSlot: 1, …}`,
  both rosters mapped slot 0↔storm 0↔user A / slot 1↔storm 1↔user B, all slots `required` with
  turns flowing (`hasDispatch: true`). Also note: relay `--relay-id` is **numeric** (`--relay-id 1`;
  a string id fails arg parsing).
- **Verified:** 63 Rust tests + clippy `-D warnings` clean; typecheck/lint clean; 85 TS tests in
  the touched areas; compile-out probe both directions; live CDP assertions above.

**§7 remaining after slice 6:** #3 forced scenarios (leave/desync/buffer injection via new
`DebugControlCommand` variants — note anything that must touch BW memory, e.g. writing
`pending_leave_reason`, has to execute on the **game thread**, not the async thread that handles
`debugControl`; route it like the existing game-thread requests), #4 app-side screenshots.

## Slice 7 — what landed (2026-07-04): debug `forceLeave` (§7 #3, leave-only)

- **`DebugControlCommand::ForceLeave { slot }` — DEBUG-ONLY, live-verified.** game_state (async
  thread) records the slot on the `TurnState` (`debug_force_leave`); the IN hook drains it on the
  **game thread** (`apply_forced_leaves`, run at the top of `netcode_v2_receive_turns`), writes that
  slot's storm `pending_leave_reason` (`0x40000006` = dropped) and `mark_slot_left`s it so a step
  stalled on the departed peer can proceed. The existing `run_synced_leave_pass` then applies it in
  the synced-RNG window on a ready step, identical to a real drop. The async→game-thread hop is the
  key structural point (async can't touch BW memory) — `debug_force_leave` just queues; the game
  thread does the write.
- **Determinism (documented on `apply_forced_leaves`):** this is the per-client *trigger*, NOT
  consensus. A one-sided injection is correct for a 1v1 opponent-drop (one remaining client); 3+
  player games need the same slot injected on every remaining client on the same turn (what §6's
  coordinated leave will do). Don't add cross-client coordination at the seam.
- **No `SetLatency`/buffer-injection command** (decided with Travis 2026-07-04): clients don't set
  latency in v2 — the relays own it (D9) — so a client-side latency override would be actively
  misleading. `forceLeave` is the whole of #3 for now.
- **App-side (dev-gated `isDev || SB_SESSION`):** `activeGameForceLeave(gameId, slot)` IPC,
  fire-and-forget → `gameCommand debugControl {type:'forceLeave', slot}`; verify the effect via
  `queryState`. `window.__sbDebugGame.forceLeave(gameId, slot)`.
- **Live-verified (2026-07-04):** 2-player loopback (claude-1 slot 0 / claude-2 slot 1), both
  `playing` on netcodeV2. `queryState` baseline: both slots `required: true, hasDispatch: true`.
  `forceLeave(gameId, 1)` on claude-1 → claude-1's `queryState` immediately showed slot 1 flip to
  `required: false, hasDispatch: false` (slot 0 untouched); the game log recorded `was_dropped:
  true`, the native synced-leave applied, claude-1 took the allied-victory path and the game
  resolved to a real result (`/game/result` → victory for slot 0, defeat for slot 1) and
  `finished` on both clients — i.e. the trigger drove the game to completion with no human quit,
  which is exactly the point for testing the §6 leave/reconnect paths.
- **Verified:** 66 Rust tests + clippy `-D warnings` clean; typecheck/lint clean; compile-out probe
  both directions; the live run above.

**§7 remaining after slice 7:** #4 screenshots. **Decision (2026-07-04): do #4 IN-GAME, not
app-side.** The app-side `desktopCapturer` route was tried and reverted: window sources carry no
owning PID, so it can only match by a guessed title and **can't distinguish two concurrent dev
clients** (both windows are "StarCraft") — fatal for the verify-app two-client flow — and it can't
capture exclusive-fullscreen. In-game capture from forge's own `HWND` (`FORGE_WINDOW`) grabs the
right window per instance and rides the `debug_control` channel like `queryState` (reply a base64
PNG). forge does NOT currently hook rendering (only window management), so: GDI `BitBlt` from the
HWND for windowed mode now (modest), with a D3D11 `Present`-hook backbuffer capture as the
escalation if exclusive-fullscreen capture is ever needed (large, greenfield graphics-hook work).

## What's next (in rough order)

### 0. ✅ Control plane (WS-E + WS-F) + roster + bootstrap seeding — DONE (slice 4)
See "Slice 4 — what landed". rp2 ask #1 (coordinator tenant enrollment) has landed, so the
smallest path to a *live* seam test is now just running the dev loopback runbook above.

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
  - **Observed live (2026-07-03):** with no leave-initiation wired, a peer quitting/dropping pops
    SC:R's native "Waiting for players / Drop Players" timeout dialog on the remaining client (the
    slot stays `required`, the IN hook returns `Stall`, which triggers `run_timeout_dialog` — guide
    §5.5) instead of the peer vanishing cleanly. Expected for now; clicking "Drop Players" recovers
    (the dialog's drop writes `pending_leave_reason`, which `run_seam_leave_pass`/`mark_slot_left`
    then drain). Closing this = the coordinated-leave write above, which also lets the remaining
    client skip the dialog on a *clean* quit (native BW shows it only on unclean drops).

### 7. Game observability + debug-control channel (verification tooling) — IN PROGRESS
> **First slice landed 2026-07-04 — see "Slice 5 — what landed" above** (#1's transport event +
> the `debug_control` scaffold + the release compile-out proof + live CDP verification). Remaining
> here: #2 (queryState), #3 (forced scenarios), #4 (screenshots).

**This task can be picked up by a different developer.** It's
tooling, not netcode — independent of the still-open leave/reconnect designs (#6), can proceed in
parallel, and will directly *help* verify #6's work once it lands. It came out of the 2026-07-03
live-loopback session: verifying in-game behavior today is log-grep-only (you scrape
`game-<session>.0.log` for strings like "Netcode v2 session established" and infer state), and
there is no way to *drive* the game to a condition and *assert* on the result. This task makes
in-game behavior observable and assertable — and, at the debug tier, drivable.

**Build on what already exists — the game is not a black box.** The DLL already speaks structured
JSON up a websocket to the app (`game/src/app_socket.rs`): it sends `/game/setupProgress`,
`/game/start`, `/game/result`, `/game/finished`, `/game/resultSent`, `/game/replayUploaded`,
`/game/windowMove`, `/game/replaySaved` (see the `send_message`/`encode_message` sites in
`game_state.rs` + `lib.rs`), and the channel is **bidirectional** — the app sends `netcodeV2Setup`
*down*, dispatched in the `match &*message.command` at `app_socket.rs:212`. The app
(`app/game/active-game-manager.ts`) already turns the upward messages into a `GameStatus` state
machine (`common/games/game-status.ts`) exposed via `getStatus()` + a `gameStatus` event, which the
renderer holds in Redux — so anything relayed this way is observable from a verifier over CDP
(playwright-cli) without touching the DLL log at all. The work is routing *more* of what the DLL
knows up this existing, already-observable channel — not building a new bridge.

**THE load-bearing constraint — the debug/prod security split (do not skip):** any surface that
lets something *control or query* a running game is a grief/cheat vector (force a leave on another
player, read hidden/opponent state → maphack-adjacent) and MUST NOT exist in the production DLL.
Enforce it at **compile time** with `#[cfg(debug_assertions)]`, **not** the `if cfg!(debug_assertions)`
runtime branch the panic-hook backtrace uses (`lib.rs:170`): a runtime guard still *ships* the
dangerous code in the binary, where it's a patch target and one bug from being reachable. `#[cfg]`
means the handlers, the state-exposure functions, *and* the `app_socket.rs` dispatch arms for those
commands are physically absent from a release build — the command names aren't even recognized.
This is real and free: prod builds via `game\build.bat release` → `--release`, and the release
profile has no `debug-assertions` override, so `debug_assertions` is genuinely off in production
(the DLL already uses this discriminator in three places). Put the whole risky surface in a single
`#[cfg(debug_assertions)] mod debug_control` so it's trivially auditable ("is X in prod? it's under
the debug module → no"), and belt-and-suspenders dev-gate the app's *sending* side
(`isDev`/`SB_SESSION`) so the production app never emits these — the DLL `#[cfg]` is the load-bearing
guarantee, the app gate is defense in depth. Payoff: because exclusion is compile-time, it doesn't
matter whether a trigger could arrive from the trusted local app or (the real nightmare) from
something reachable via network/game data — the "force a leave" primitive simply isn't in the
shipped binary.

**The four pieces, ranked by value/effort, each labeled on which side of the split it falls:**

1. **Structured status events up the existing websocket — SHIPS IN PROD (safe subset), do this
   first.** Add DLL→app messages for the milestones currently only grepped from logs:
   `session_established`, `game_result` (richer than today), and coarse lifecycle. These are the
   *same trust boundary* as the `/game/start` message that already ships — outbound, to the local
   app — so they're prod-safe. The app relays them into `GameStatus`/an events stream exactly like
   the existing commands; the verifier asserts on a structured event via CDP instead of regexing a
   rotating log. **Keep the always-on set to coarse, non-sensitive lifecycle signals.** Netcode
   *health* about your own client (buffer size, turns-in-flight) is borderline-fine; anything
   per-opponent or granular goes behind the debug gate (see #2). When unsure, gate it. This is the
   direct upgrade of the 2026-07-03 friction and is genuinely small (one new command + one app-side
   handler, mirroring `/game/setupProgress`).
2. **Pull/query debug command — DEBUG-ONLY (`#[cfg(debug_assertions)]`).** Add a `debug/queryState`
   request the app sends down and the DLL answers with a snapshot: seam readiness set, per-slot
   storm ids, current buffer, turn counts. Lets the verifier assert invariants *at a chosen moment*
   — e.g. "after the peer left, slot N is `mark_slot_left`" — which is exactly what would have let
   the 2026-07-03 session confirm the leave behavior directly instead of inferring it from the drop
   dialog. Reuses the existing inbound dispatch path; the work is exposing internal state safely and
   gating the whole arm.
3. **Command injection / forced scenarios — DEBUG-ONLY, the netcode power tool.** Because the seam
   already sits at the turn/command layer and can *write* `pending_leave_reason`, a debug command
   could **force** a leave, a desync, or a buffer change on demand — so netcode verification stops
   needing two humans and a real quit. Highest value for the #6 leave/reconnect work specifically
   (test those paths deterministically). Composes with #1/#2: force it, then assert the event/state.
4. **Screenshots — SHIPS IN PROD-safe, coarse-confirm layer (outside the control surface).**
   Capturing the game's *own* window is not a game-integrity vector, so do it **app-side** (Electron
   `desktopCapturer` on the SC:R window, or a native BitBlt) → known path/IPC, **no DLL change**, and
   it slots into the verify-app CDP flow (playwright triggers an app IPC → app grabs the window →
   returns an image a vision pass reads). Value is precisely the visual-only states logs miss: the
   "Waiting for players / Drop Players" dialog, a victory/defeat banner, a crash modal, a
   black/frozen screen. Useless for fine sim assertions — a spot-check, not the backbone. Still
   worth dev-gating the IPC for tidiness, but that's hygiene, not a security requirement.

**Suggested first slice + acceptance:** ship #1's `session_established` as a structured event
(unconditional, safe) relayed through `GameStatus`, and prove a verifier can assert on it over CDP
(Redux/`getStatus()`) instead of grepping the DLL log — with the `debug_control` module scaffolded
(even if empty) and a release-build check confirming the debug commands compile out. That
establishes both the pattern and the security split so #2/#3 can't accidentally graduate into a
release DLL. Then #4 (screenshots, app-side) as a cheap parallel add, and #2/#3 as the
netcode-specific deepening. Endgame: #1 + #3 + #4 together = an agent can *drive* a game and
*verify* it (force a peer-leave, screenshot to confirm the UI, assert the structured `player_left`)
with no person at the keyboard.

**File pointers:** `game/src/app_socket.rs` (send + the `:212` inbound dispatch),
`game/src/game_state.rs` (existing `send_message` sites — model new events on these),
`app/game/active-game-manager.ts` (`GameStatus` handling), `common/games/game-status.ts` (status
enum + any new event types), `app/game/*` (screenshot IPC + `isDev` gate). Prod build discriminator:
`game\build.bat release` / `#[cfg(debug_assertions)]`.

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
