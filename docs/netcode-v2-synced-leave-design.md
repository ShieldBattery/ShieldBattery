# Netcode v2 — remaining work tracker (design)

> **Status: the arc is mostly built, live-proven on loopback, and committed on `rp2-integration`.**
> This doc began as the synced-player-leave design (2026-07-03) and grew to cover the whole netcode-v2
> arc: results-through-the-relay, relay-side desync detection, the departure pipeline, and replacing
> StarCraft's native Storm networking (scope C → the native-lobby-over-rp2 "2c" pivot). Almost all of
> that now lives in the code, the commits, and the `netcode-v2-integration` memory — so it is
> redundant here. This file keeps a
> terse record of the completed arcs plus the design for the work that is **not yet built** — that
> unbuilt design (D11 reconnect, §17 disconnect UX, relay-driven start, pause, observers under 2c)
> exists only here. Re-synthesized 2026-07-07; the v1 deletion sweep + sessionless solo carve-out
> landed the same day. Delete once the remaining work lands.

The framing thesis still holds for the leave path: a coordinated player-leave is the sibling of a
latency-buffer directive — the relay decides one value, schedules it at a future frame, and every
client applies it deterministically. The build reused that machine rather than reinventing a
consensus protocol at the seam.

## Completed

Terse; the design detail is in the referenced commits, the code, the anchors doc, and the
`netcode-v2-integration` memory.

- **Synced player-leave determinism.** A coordinated leave rides the reliable control stream (a
  `LeaveDirective` pushed by the relay), not the turn envelope (envelope path live-disproven — a drop
  stalls the turn stream that would carry it). `LeaveTracker` dedups by slot; relay `decide_leave` sets
  `apply_at = departed_last_frame + 1`; QUIC keep-alive stops a stalled-but-alive survivor from
  idle-timing-out. Clean-leave intent (F10/natural end) → `send_leave_intent` (reason `3` = left vs
  `0x40000006` = dropped). Live-proven.
- **Cross-relay leave propagation.** Mesh control stream carries `SlotDeparted` / `LeaveDirective`
  (broadcast) + mesh cert pinning; full topology matrix live-proven (same-relay, peer/authority-homed
  drop, promotion + cached verbatim rebroadcast, peer-homed clean quit). rp2 `5aa759f`, `139c6ad`,
  `f906325`.
- **Departure classification.** Keyed on the DLL's already-sent terminal result (graceful exit emits a
  clean leave + the app server holds the result at victory-dialog time), so the false-"dropped" case is
  caught with no in-game hook. SB `43d06cae8`.
- **Departure notification.** Relay → coordinator → app-server webhook, Ed25519-signed (tenant key,
  pubkey-fetch), camelCase body, evidence retained unconditionally. rp2 `02f1a3f`/`d432bdc`, SB
  `ebc3dcc1e`/`d022a414b`.
- **Relay-side desync detection.** Authority relay compares each slot's per-turn `0x37` `hash16` (only
  the shared-state hash; fog bytes are per-sender, never cross-compared) → signed `DesyncNotice` →
  `game_desync_events`. Majority-authoritative; 1v1 / even split is void. rp2 `3658f32`, SB `c3d693dbc`.
- **Desync-aware reconciliation + concession-only tiebreak + session-close-at-victory + adversarial
  audit.** `applyDesyncPolicy` (majority-discard/void/dispute); departure tiebreak replaced by a
  concession-only rule (order was gameable by lingering); `WMission` victory closes the session into
  `local_only`; a five-deep malicious-client audit fixed calibration poisoning + leave-frame inflation.
  SB `57ce77ae9` (+ Codex fixes), rp2 `3793aaf`.
- **Results through the relay.** Opaque `GameResult` control frame is the only result path for a v2
  game (`results2` HTTP closed for them); session lifecycle owns game end (departure notices embed the
  slot result, `SessionClosed` ordered last, sweep asks the coordinator for liveness); computer games
  are results-exempt, hidden, self-closing. `lockedAlliances` persisted in `GameConfig`. SB
  `fce245851`→`1df15efc3`, `b84372bff`; rp2 `60244da`/`b7947bc`.
- **Cross-repo landing (leave/results arc).** Dev `[patch]` removed, rp2 pushed, `game/Cargo.toml` rev
  bumped, `rp2-integration` pushed. SB `ae3b8f111`.
- **Native-lobby-over-rp2 ("2c") — slices 1–5a built + live-proven.** Native `create_game`
  (host) / `join_game` (peer) + the native lobby-command flow compute all lobby-derived state; SB
  replaces only Storm's transport + handshake (roster-seeded `snet_player_list`, a full-replacement
  hook on `storm_join_game`, and a lobby-phase reliable seam relaying bare command bytes). Melee,
  UMS-default, and Team Melee are all sync-clean (relay `0x37` comparator quiet), MP UI correct.
  Two over-optimistic-deletion regressions from 5a were found + fixed live: **net_player_info** (native
  `init_network_player_info` only populates the local player → restored the direct write as
  `v2_register_net_player`; the `net_player_count` hook is now **load-bearing**) and the **game
  template** (peer join synthesizes the game-info blob locally and never receives the host's, so it ran
  UMS rules → frame-0 desync; restored `apply_game_type_template` on every client). SB `4735f582e`,
  `d239d02d2`, `a372e454f`; RE trail in the `netcode-v2-integration` memory + git history.
- **Game-type layout verification.** Direct registration produces deterministic, sync-clean games for
  every non-melee type: Top vs Bottom, Team FFA, Team Melee, FFA, UMS-default (all relay-quiet, correct
  BW victory dialogs). The slot/team/storm-id layout item is satisfied.
- **Team alliances (surviving-teammate-loss bug) — FIXED + live-verified.** Shared-control team games
  (Team Melee/FFA) scored a surviving teammate as a loss on last-enemy drop, because BW's alliance
  matrix (`game.alliances`) + shared vision (`game.visions`) were never set — natively they derive at
  game init from per-force FORC flag bytes populated only by the async lobby force command (class
  `0x4A`), which 2c bypasses on every client. That record is not locally buildable under 2c (its
  staging/lobby-global inputs have no samase analyzers and a zero-fill would stomp map-load state), and
  writing the decoded native *inputs* pre-init was live-disproven (init re-derives them from map data).
  Fix: `setup_team_alliances` (game_thread.rs, from `after_init_game_data`) writes the derived
  *outputs* directly on every client — allied-victory both ways + mutual vision for every same-team
  `players[]` pair, team-force types only, non-replay. Server-ordered slots ⇒ identical on all clients
  ⇒ sync-safe. Verified Team Melee 2v1 forceQuit → surviving teammate WINS. SB `96480c84a` (superseded
  input-write) + `f475993ab` (working output-write); samase `apply_lobby_force_cmd` accessor resolved
  as groundwork (`472d08328`). Full RE trail: the `netcode-v2-integration` memory + git history.
- **Start-of-game lag screen — FIXED + live-verified.** Not the native countdown (refuted by
  instrumentation): a keep-alive backlog in the lobby seam pacing — `lobby_receive_turns` consumed one
  echoed buffer per call as its pacing gate while the flush is driven by ~4 threads (~2:1
  overproduction), so the host's `0x48` sat behind ~140 queued keep-alives drained at 50ms each (6.95s).
  Fix: collapse leading keep-alives in `lobby_receive_turns` (a real command never waits behind
  information-free keep-alives; cadence still echo-gated) + permanent flush-thread/backlog probes. Host
  `0x48` send→process dropped 6.95s → 86ms. SB `71580fb69`.
- **In-game chat over rp2 — implemented + live-verified.** SC:R in-game chat rides its battlenet
  ClientSdk gateway (dead under 2c), not the classic `0x5c` turn command. Re-homed onto a new reliable
  `GameChat` control frame: the chat-box dialog hook's non-slash branch submits to the driver's
  `chat_out` channel + suppresses the native gateway send; inbound chat is drained on the game thread
  and each message (plus the sender's own echo) injected as the classic `0x5c` record via the native
  command processor (arg `0` = live ⇒ lands in the replay for free), with mute/block filtering free via
  the existing `print_text` hook. Debug surface for verify-app: `__sbDebugGame.sendChat(gameId, text)` +
  a `turnState.chatLog` ring buffer in `queryState`. Verified bidirectional 1v1: messages crossed the
  relay, attribution consistent across clients, zero desync. SB `421644de5`; follow-ups tracked below.
- **rp2 reliable lobby + chat channels — committed.** `LobbyCommand` (ControlFrame/Mesh arm 5,
  correctness-critical, per-session ordered replay log for late-dialing members, caps 1024 cmds /
  256 KiB) and `GameChat` (arm 6, best-effort, no replay log, `target_kind`/`target_slot` scope the
  relay never interprets, 256-byte size cap + per-slot token-bucket rate cap). rp2 `5fec7f4`.
- **v1 Storm deletion sweep — DONE + live-proven.** The dead v1 transport is gone: DLL
  `network_manager.rs`, `netcode/{ack_manager,sequence_buffer,storm}.rs`, in-process `rally_point.rs`
  + `udp.rs`, the `messages.proto` wire kinds (`StormWrapper`/`ClientReady`/`ClientAck*`) and their
  build wiring, the v1 network-debug overlay panel, and the ClientReady peer-readiness handshake +
  its `storm_player_flags` join-polling loop — ~4000 lines. `snp.rs` shrank to inert provider stubs
  (`choose_snp` still needs a valid table for Storm's local session create), and the SNP packet pump
  + `SNP_INITIALIZED` gate **stay** — native lobby create/join initializes the provider and its tick
  drives the lobby seam's flush+receive (live-disproven that they could be dropped: removing them
  stalled the `0x48` on turn 0). App/server side: rally-point ping + `createRoutes` + the `setRoutes`
  event/IPC/handler are gone; a multi-human load now **requires** netcode v2 and fails loudly
  otherwise; turn rate/latency fixed at 24/Low. KEPT (live under v2): the `net_player_count` hook,
  `check_player_drops`, the `network_results` `has_quit`/`was_dropped` derivation + the
  `storm_player_flags` accessor. `slot_to_storm` is now identity-seeded only (`map_local_storm`/
  `map_storm_for_user` deleted). SB `446016e1e` (DLL) + `12589b90a` (app/server).
- **Solo / computer-game carve-out — DONE (sessionless `TurnState`) + live-proven.** A
  single-human-vs-AI game stands up a **sessionless** turn state: `local_only` from birth, no
  credentials/dial/`LinkDriver`. `establish_sessionless` (session.rs) fabricates the `TurnChannels`
  and parks their far ends alive in `SessionLink::Sessionless(ParkedChannels)`, so every driver-bound
  send (turn/lobby/chat/leave/result) lands in a void instead of erroring on a closed channel;
  `TurnState::new_sessionless` sets `local_only=true`, roster = `[(SlotId(0), local_user)]`, seeds the
  identity map. `init_game` is now four-way: setup present → relay path; else replay → local playback;
  else exactly one human → sessionless; else (multi-human, no setup) → hard `GameInitError`. Solo runs
  the native lobby setup a relay host does (create_lobby / template / `v2_register_net_player` for the
  lone human / setup_slots / lobby-state drive) minus seeding + dial, reports its result over HTTP
  (`submit_result_report` returns `false` for a `Sessionless` link), and does NOT hit the x86_64
  refusal gate (no `StormSessionPlayer` writes). Verified live: solo-vs-AI reaches `playing`, single
  required slot 0, turns flowing, transport `native`.
- **Replay playback under the swept build — FIXED + live-proven.** The deleted join loop used to
  overwrite the viewer slot's placeholder storm id; without it `ready_lobby_for_start` →
  `update_nation_and_human_ids` tripped `assert!(storm_id < 16)` (saw junk `27`). Fix: the replay
  branch resolves `bw.local_storm_id()`, waits (bounded) for the viewer's storm flag, calls
  `init_network_player_info`, and passes a real `storm_id_map` to `setup_slots`. Verified live:
  LastReplay reaches `playing`, slot 0 storm id `0`, no panic.

## Remaining work

### 2c increments still to verify / build

- **Observer registration under 2c.** rp2 observer slots 8–11 → `players[12+n]`, storm id = rp2 slot
  8+n (stays < 16, which `update_nation_and_human_ids` requires; the `0x80–0x83` value is the
  observer's game/net-player id derived from the `players[]` index, not its storm id). Observers
  register like players but at `players[12+n]`. The subtlest part; the players-only path is now fully
  swept, so this is the next natural build.
- **UMS scenario-map verification.** Only a standard melee map played as UMS (default forces) is
  verified sync-clean. A real UMS scenario map (custom forces, rescue/neutral players, non-contiguous
  `player_id` slots) is not in the dev DB and still needs verifying; under 2c its force/alliance setup
  is native (map-driven), which likely also closes the `build_v2_joined_players` player_id gap and
  supplies UMS FORC flags for the chat/alliance follow-ups.

### Chat follow-ups

- **Send-side target scope is stubbed to All.** `dialog_hook::chat_target_scope` is plumbed but always
  returns `ChatTarget::All` — bw_dat's `Control` exposes no radio "checked" accessor for the `MsgFltr`
  dialog. It logs a one-time dump of the MsgFltr children (id/label/flags) on first chat send; a single
  live run pins the mapping, after which the All/Allies/Observers/Player selection can be read.
  Receiver-side scope filtering is already implemented.
- **Observer-sender chat drops.** `unique_player_for_storm` scans only `players[0..8]` (same limit as
  the replay-command path), so a message from an observer's storm id is dropped. Resolve alongside
  observer registration.
- **Scrollable chat-history box (open decision).** The `0x5c`/`print_text` path feeds the classic
  transmission-line overlay only; SC:R's modern scrollable in-game box is fed by `sub_682140` (opaque
  `battlenet::chat::Message`). **Verify first** whether that box even renders in-game on retail SC:R
  (2c's gateway is dead) — if not, the overlay path is already full parity and this is moot; if so,
  feeding it is a higher-effort follow-up (construct the opaque Message).
- **Chat-in-replay: recording CONFIRMED by .rep parse (2026-07-07).** All three matrix-run replays
  (FFA/Team FFA/TvB, `server/uploaded_files/replays/`) contain the injected `0x5c` records with
  correct sender game ids (jssuh parse; sender bytes match the live `chatLog` attribution exactly).
  Remaining nit: the message did not visibly render during LastReplay *playback* (screenshots
  covering the render window show an empty message area) — likely the viewer session's
  `players[].storm_id`/name state, not data loss. Low-priority polish; investigate when touching the
  replay-viewer path.

### Relay-driven start

Move the "everyone's here, go" signal from the app server to the relay. The app server owns it today
only for a historical reason that has evaporated: rally-point v1 relays were dumb forwarders with no
session membership, so the DLLs synced readiness peer-to-peer (`ClientReady`). rp2's smart relays hold
the roster and already fan reliable control-stream directives to every client, so the relay is now the
natural synchronization authority — the one component that sees every client dial in and authenticate.
A relay "all slots present → start" directive (same machinery as the buffer/leave directives) replaces
**both** `startWhenReady` *and* the peer `ClientReady` handshake, and a reconnecting client (D11) is
re-synced by the relay rather than by app-server orchestration.

Subtlety: "all slots dialed + authenticated" is early presence (clients dial during
`establish_session`, before the map loads) — the same timing as today's `startWhenReady`; the true
lockstep sync remains the frame-0 barrier the relay already owns. So it is the same two-tier structure
(early "go" + hard frame-0 sync), consolidated onto the relay. What stays with the app server: session
creation + setup/token/roster distribution, and MMR/timeout bookkeeping.

**Staging:** the current build already proves 2c on `startWhenReady`; migrating "go" to a relay
start-directive is a clean follow-up that deletes `startWhenReady` and the `ClientReady` overlay, each
step independently testable.

### Reconnect / failover (D11)

The whole design ships the **permanent-leave** path with an *immediate* trigger (matching today's
no-reconnect reality). Reconnect + resync + a relay grace period are deliberately kept separate in D11,
and the code is shaped so D11 drops in without rework:

- The leave trigger grows a **grace period**: on link loss the home relay holds before `decide_leave`,
  giving the client's reconnect+resync a window to re-establish and resume producing turns; the leave
  fires only on grace expiry. (A grace means survivors *stall* for its duration — the
  survivor-stall-vs-reconnect-chance tradeoff is the D11 tuning knob; the "~40s then extremely unlikely
  to reconnect" intuition *is* that grace length.)
- Relay-death failover is the other half: a survivor stalled far past a leave's expected arrival has
  lost its authority/relay, and the D11 resync path (move to a backup relay, replay from cursor)
  applies.
- Self-disconnect (below) is the client-side half D11 upgrades directly — same connection-down trigger,
  same state machine.

The leave directive is orthogonal to *how long we wait before deciding a departure is permanent*, so
nothing here forecloses reconnect.

### Disconnect UX (§17 target — design direction, not built)

Shape the connection-lost work toward this end state; the interim ships auto-removal (~10s) because
without a reconnect path waiting is pointless. Shares its UI/overlay with self-disconnect.

- **Disconnected player's side:** "You've lost connection — [Reconnect] [Abandon]." Reconnect is a
  first-class user action (alongside D11's automatic attempts) into the **same** game; abandon resolves
  to the disconnect loss via SB's existing end-game path. (Open: confirm the exact existing "you've been
  disconnected" entry point — the `NetworkError` variants in `network_manager.rs`/`game_state.rs` and
  how they surface as a game status — and reuse it.) Detection keys on the **transport fact** (my QUIC
  connection to the relay is down → `TurnState`'s `inbound` reads closed while `game_started`), never on
  a stall duration (false-positives on jitter).
- **Survivors' side:** an overlay naming *which* players are disconnected, with a grace timer (~45s)
  before a **manual "Drop"** unlocks. Dropping stays a human decision even after the timer (important /
  friendly games may wait minutes). Flow: relay detects link death → broadcasts "slot X disconnected"
  (a connection-state control frame, not yet a leave) → survivors wait → either X reconnects+resyncs
  (D11) or a survivor clicks Drop → `RequestDrop` up the control stream → authority `decide_leave` → the
  built directive path. The anti-grief check simplifies to "authority honors a `RequestDrop` only for a
  slot it knows is disconnected with the grace elapsed." (Open policy: single request vs quorum;
  `RequestDrop` rate-limit.)
- **"Feels like a paused game, not a modal."** Survivor↔survivor chat during the wait needs out-of-band
  chat on the reliable control stream — which the `GameChat` channel now provides (it works during turn
  stalls, unlike a turn-stream command). Open: replay interleaving — each client stamping received OOB
  chat at its own current frame may be acceptable cosmetic divergence; unresolved.
- **Prerequisite ordering:** cross-relay leave routing first (done); then the overlay + self-disconnect
  built to THIS shape (named players, timer, non-modal), initially wired to v1 semantics; D11 fills the
  [Reconnect] branch and the drop-gating.

### Pause/unpause through the v2 seam (unproven)

Native pause is a synced turn-stream command and turns keep flowing while paused, so the seam *should*
carry it unchanged — but nobody has proven pause/unpause through the v2 transport, and the F10-quit RE
showed quit-adjacent flows have surprising native structure. Verify in a live 2-player game: pause, chat
while paused, unpause, confirm no stall/desync.

### Acceptance / testing matrix (loopback runbook; relay `0x37` comparator quiet = sync-clean)

Re-run after any 2c increment. Post-sweep (2026-07-07, both rounds) status — **matrix complete, all
seven configurations green**:

- **Melee 1v1** — ✅ re-proven post-sweep: sync-clean, chat bidirectional + correctly attributed,
  transport `netcodeV2`, DB win/loss correct.
- **FFA 3-player** — ✅ re-proven post-sweep: sync-clean, three-way chat (every message on every
  client, attribution consistent), `forceQuit` both losers → DB win/loss/loss correct.
- **Team Melee 2v1** — ✅ re-proven post-sweep: sync-clean, `forceQuit` the lone enemy → both surviving
  teammates WIN (alliance fix intact).
- **Team FFA 2v1** — ✅ re-proven post-sweep: sync-clean, chat crosses teams (receiver-side filter,
  send stubbed to All), alliance matrix + visions identical on all 3 clients, `forceQuit` the lone
  enemy → both teammates WIN.
- **Top vs Bottom 2v1** — ✅ re-proven post-sweep: sync-clean, chat delivered to both other clients,
  alliance matrix identical on all 3 clients. **Engine-consumption spot-checks passed live:** shared
  vision actually renders (each teammate's minimap shows the other's base; the lone enemy sees only
  its own), and allied victory actually fires (survivors hit `hasResult` in-game the moment the last
  enemy quit — the victory checker read `alliances[i][j]==2`). Friendly-fire targeting uses those same
  alliance cells; a manual unit-vs-ally combat poke needs human play and is the only remaining
  (optional) check. TvB matrix diagonal reads 2 for the teamed slots (vs 1 in Team FFA) — native
  template-derived, identical on all clients, benign.
- **Solo vs computer** — ✅ proven post-sweep on the new sessionless `TurnState`: reaches `playing`,
  single required slot, turns flow, transport `native`.
- **Replay** — ✅ proven post-sweep: LastReplay reaches `playing`, viewer storm id resolves, no panic.
- **Observers** — 2p + 1 obs; observer registers, players sync to a result. Not built (see above).
- **UMS** — a real scenario map with custom forces (not yet done).
- **In-game handoff** — transport flips to datagrams at `set_game_started`;
  `networkStatus.transport === 'netcodeV2'`.

### Post-cutover cleanup (final form — not built)

Once netcode v2 is *the* netcode (not behind `SB_RP2_COORDINATOR_URL`), the interim's provisional
shape should be removed rather than ossified:

- **Drop `netcodeV2` from everything public.** With one transport there is no "v2" to name — public
  fields/types become transport-agnostic (`clientKey`/`sessionPublicKey`, `region`), and
  `GameSetup.useNetcodeV2` goes away (every game uses it, nothing to branch on).
- **Submit the client key + region at matchmaking-search / lobby-create-join, not at game load.** The
  only hard constraint is that the server holds the client's current pubkey *before* it mints the
  session token (game-load); search-start and lobby create/join both precede load. Submitting there
  removes the dedicated load-time `netcodeV2Pubkey` route (the key rides the queue/lobby-entry request),
  removes the load-critical-path round-trip, and bundles naturally with `region`. Late lobby joiners
  submit at their join. **Keypair lifetime is a blast-radius choice, not a per-load requirement:**
  per-search (matchmaking — already per-game) / per-lobby (spans back-to-back games; accept per-lobby
  reuse or refresh per game via an existing signal). The token is per-session + connection-bound (TLS
  channel binding), so a leaked key still needs the matching per-game token — per-search/per-lobby is
  defensible. **Do NOT** promote to a long-lived per-login key without a security review.

### Security invariants (embodied + tested — keep when touching the credential/transport code)

- Private key never logged: `Secret` redacts `Debug`; `app_socket`'s `SENSITIVE_COMMANDS` redacts the
  raw text, payload debug, error context, and serde's own error message for those commands. Add any new
  secret-bearing command to that list. (Zeroize-on-drop is a noted follow-up.)
- TLS trust is pinned + fail-closed (`credentials.rs::SessionCredentials::from_setup`): trusts only the
  relay leaf cert(s) the coordinator sent — no webpki/system roots, no accept-any; empty/malformed cert
  set is an error. Direct relay IPs mean there is no public CA to fall back to — don't add fallback
  roots.
- Session/slot/tenant come from decoding the signed token, never separate fields; key↔token match is
  checked by the relay. We consume rally-point-client's re-exported quinn/rustls so the DLL and
  transport can't drift (ALPN mismatch rejected at handshake) — rebuild both sides when bumping the pin.

### Backlog (small / deferred)

- **Client desync-report hook.** Closes the pure-fog desync gap (a divergence living only in
  vision-masked fog that never perturbs a hashed value and reaches the result-lock first). A client
  report can only VOID/dispute (safe direction — rate-limitable, never claims a win). Optional
  fast-follow feeding the same `DesyncNotice` pipeline.
- **Oversize-turn amplification.** The forward channel is bounded by count, not bytes, so a valid 64 KiB
  turn is cloned into every peer channel (memory spike + a lever to force-drop honest teammates). Fix:
  byte-budget the forward channel / lower `MAX_CONTROL_FRAME_LEN` / rate-limit oversize turns (relay
  `routing.rs`).
- **Self-desync-void abuse rate-limit.** The "self-desync to void my own loss" escape has no per-user
  throttle; the app server logs participants at WARN on a `no_majority` void, but automated
  rate-limiting is deferred.
- **Post-promotion desync ordinal PK collision.** After an authority promotion the comparator re-bases
  sync ordinals low, so a desync straddling a failover could collide on `game_desync_events`'
  `(game_id, sync_ordinal)` PK and drop as a duplicate. Within the accepted "straddling-death miss
  once" envelope; a revisit could add an authority-generation/epoch component to the event identity.
- **UMS FORC flags.** `MapForce` (app_messages.rs) doesn't carry the CHK FORC force-property flags, so
  team-force alliances for a UMS scenario map can't yet be derived the way melee team types are — folds
  into the UMS scenario-map work.
- **Pre-existing pg `DeprecationWarning`.** Concurrent `client.query` in the `setReconciledResult`
  transaction path — observed during reconcile, not introduced by this work.
- **TS-side `GameNetworkStatus.fallbackFrom` cleanup.** Unused field; optional removal.
