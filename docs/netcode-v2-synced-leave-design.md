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
- **Observers under 2c — DONE + live-proven (2026-07-07).** Observers join the v2 roster like
  players (storm id ≡ rp2 slot; in a partial lobby they take the next array slots, not necessarily
  8–11) and land at `players[12..16]` with BW ids 0x80–0x83. DLL: `build_v2_joined_players` includes
  them (`player_id` = the `players[]` index 12..15 — the encoding the post-randomization mapping
  produces and `BwPlayerId::is_observer` expects), the v2 init registers them in `net_player_info`,
  and storm→`players[]` attribution scans `(0..8).chain(12..16)` (shared helper now used by live
  chat + replay paths), with an observer sender in a team game acting under its own slot (team byte
  0 would underflow the team-main-player lookup) and alliance checks treating observers as allied
  with no one (both observer id encodings would index past `players[0..8]`/`alliances[0..12]`).
  **rp2 relay bug found by the live test + fixed** (`0023711`): `apply_descriptor` recorded observer
  slots via a call that no-ops before the maker exists, and `sync_maker` created the maker later in
  the same function — a single-relay session (one push, pre-dial) lost its observer set, so the
  desync comparator compared the observer and flagged it diverged at frame 0 (observers legitimately
  emit non-matching hashes; SB's majority policy shrugged it off — only the observer's nonexistent
  result was discarded). Fix seeds the observer set at maker creation; regression test pins the
  single-push scenario. **Live-verified twice** (buggy relay, then fixed relay): melee 1v1 + 1 obs —
  all three reach `playing`, observer chat crosses both directions with correct attribution (sender
  game id 12), the observer's view stays frame-locked with proper SC:R observer UI, players continue
  when the observer leaves mid-game, results reconcile win/loss for the players only, and on the
  fixed relay the comparator stays silent (zero desync events). Follow-up: an observer's quit is
  classified as a drop (QUIC idle timeout), not a clean leave — the loop-end leave intent doesn't
  fire on the observer's exit path; no scoring impact. SB `8ced9f4ea`.
- **UMS scenario maps under 2c — DONE + live-proven (2026-07-07).** `build_v2_joined_players` now
  places UMS players by the map's slot id (`slot.player_id`, mirroring `setup_slots`; BW does not
  randomize UMS slots) instead of slot-list index, which diverged whenever the occupied map slots
  weren't contiguous from zero. Live-verified on a real scenario map (Colorless Fate 0.81 (Ob):
  two custom forces, forced races, occupied map slots {0,1,3}): sync-clean (comparator silent),
  chat attributed by map slot id on every client, and the map's own FORC flags drove alliances +
  allied victory **natively** — when the lone Players-force opponent quit, both the winner and the
  unitless Observers-force player resolved simultaneously (win / loss·loss in the DB, consistent
  and reconciled). That native path also **closes the "UMS FORC flags" backlog item**: no SB-side
  alliance derivation is needed for UMS — `setup_team_alliances` stays team-force-only by design.
  Rescue/neutral players weren't in this map; they're map-internal (not joinable slots), so the
  mechanism proven here covers them by construction — a live run on such a map remains an optional
  spot-check. SB `cec74d376`; map upload recipe: `POST /api/1/maps` (Bearer JWT from
  `POST /api/1/sessions` with `clientIds: []` + `Origin` header), multipart `file` + `extension`.
- **Replay playback under the swept build — FIXED + live-proven.** The deleted join loop used to
  overwrite the viewer slot's placeholder storm id; without it `ready_lobby_for_start` →
  `update_nation_and_human_ids` tripped `assert!(storm_id < 16)` (saw junk `27`). Fix: the replay
  branch resolves `bw.local_storm_id()`, waits (bounded) for the viewer's storm flag, calls
  `init_network_player_info`, and passes a real `storm_id_map` to `setup_slots`. Verified live:
  LastReplay reaches `playing`, slot 0 storm id `0`, no panic.

## Remaining work

### 2c increments still to verify / build

(none — observers and UMS scenario maps both landed 2026-07-07; see Completed.)

### Chat follow-ups

- **Send-side target scope is stubbed to All.** `dialog_hook::chat_target_scope` is plumbed but always
  returns `ChatTarget::All` — bw_dat's `Control` exposes no radio "checked" accessor for the `MsgFltr`
  dialog. It logs a one-time dump of the MsgFltr children (id/label/flags) on first chat send; a single
  live run pins the mapping, after which the All/Allies/Observers/Player selection can be read.
  Receiver-side scope filtering is already implemented (incl. the observer cases: an observer is
  allied with no one, so Allies-scoped chat never shows to or from one).
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

**Current-flow facts (mapped 2026-07-07, ready for the build):** `startWhenReady` today is NOT a
readiness quorum — the server publishes it unconditionally the moment its own setup work (map lookup,
rp2 session mint, `setNetcodeV2Setup` fan-out) completes (`game-loader.ts:715`). The only ready-style
input the server collects is the pubkey PUT. The DLL latches it in `can_start_game`
(`GameStateMessage::StartWhenReady`, one-time `AwaitableTaskState` latch) but by the time it waits on
that latch the rp2 session is fully dialed (`establish_session`) and the native lobby fully built
(create/join, `setup_slots`, lobby_state 8) — the latch only gates leaving the lobby screen; the
frame-0 barrier (`receive_turns` parks until every required slot has a turn) is the true lockstep
sync and stays untouched. App/renderer are pure relays (`startWhenReady` ws event →
`activeGameStartWhenReady` IPC → `gameCommand` latch with resend-on-connect). Server keeps the 75s
load timeout + status-report cancellation regardless. **rp2 has:** per-slot registration at auth
(`routing::register`, the live per-relay roster), per-slot reliable push channels + mesh
control-frame broadcast (the LeaveDirective template), and the lobby replay log (solves
late-control-stream delivery). **rp2 lacks:** a session-wide expected-slot set on the descriptor
(derive from `slot_refs` or add explicitly) and slot-granular cross-relay presence (today's
`MeshPresence` is a scalar live-count feeding authority verdicts). Build shape: authority relay fires
a `SessionStart` control frame once every expected slot is live session-wide (re-push on late
register; idempotent client latch); DLL waits on it in place of the `can_start_game` latch (solo/
replay paths start immediately — no relay); then delete the `startWhenReady` chain end-to-end
(server publish + ws event + renderer handler + IPC + app latch + DLL message).

Subtlety: "all slots dialed + authenticated" is early presence (clients dial during
`establish_session`, before the map loads) — the same timing as today's `startWhenReady`; the true
lockstep sync remains the frame-0 barrier the relay already owns. So it is the same two-tier structure
(early "go" + hard frame-0 sync), consolidated onto the relay. What stays with the app server: session
creation + setup/token/roster distribution, and MMR/timeout bookkeeping.

**Staging:** the current build already proves 2c on `startWhenReady`; migrating "go" to a relay
start-directive is a clean follow-up that deletes `startWhenReady` and the `ClientReady` overlay, each
step independently testable.

**BUILT + LIVE-PROVEN through increment B (2026-07-07/08).** rp2 `d057552`: the coordinator carries
the session's full slot set on the descriptor (`expected_slots`, serde-default empty = off); relays
announce registering slots to mesh peers (`SlotPresent`) and every relay accumulates the session-wide
live set (so a mid-startup promotion can evaluate coverage); only the authority fires `SessionStart`
(a one-shot latch; a departure uncovers a not-yet-started session; a started one stays started); the
directive fans to local slots on the same per-slot reliable push channel as leave directives +
broadcasts across the mesh, and a slot registering after start is re-pushed immediately
(at-least-once — clients dedup). Wire: `ControlFrame` oneof field 7 = fieldless `SessionStart`;
mesh oneof 7/8 = `SlotPresent`/`SessionStart`. SB `4d51187e5`: `establish_session` returns the
directive receiver; the relay init path awaits it (in the lobby-stepping `select!` where the
`allow_start` wait sat) then hands the receiver to a session-lifetime drain task — REQUIRED, not
optional: the driver closes the link if a re-pushed directive hits a dropped receiver.
`establish_sessionless` fabricates + parks the channel like the others. Live-verified loopback:
both melee-1v1 clients log the wait → directive-received transition, play to a correct DB result,
zero desync; solo + replay unchanged. **Increment C DONE (SB `16e670c79`): the `startWhenReady`
chain is deleted end-to-end** — server publish, gameLoader ws event, renderer relay case,
`activeGameStartWhenReady` IPC, app latch + resend-on-connect, DLL message + `can_start_game`
latch, and the replay path's own deferred start caller (`startReplayWhenReady`, an unmapped second
consumer the sweep found). Solo/replay init proceeds directly once local init is ready (lobby init
still completes in the game thread's StartGame handler — `step_lobby_init` alone can never finish
it, which is why the old loops were pure gates). Live-verified on the fully rebuilt stack (new
DLL + restarted server + restarted Electron mains): melee 1v1 gates on the directive with a
correct reconciled result and zero desync; solo and replay launch clean. **The relay-driven start
arc is complete** — the app server no longer participates in "go" at all.

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

**Design decisions settled 2026-07-08 (informed by the §17 build; not yet built):**

- **The driver owns reconnection; the TurnChannels stay alive.** Today a link death kills the
  `LinkDriver`, dropping every channel sender — which is exactly how the §17 self-disconnect notice
  detects it. That shape makes reconnect awkward (a new driver would need to re-wire channels into a
  live `TurnState`). D11 inverts it: `LinkDriver::run` catches the QUIC connection error and re-dials
  internally (same token + keypair — the token is per-session and the connection binding is a
  possession proof, re-provable on a fresh connection), keeping all channels alive across attempts.
  Self-disconnect detection then migrates from "channel closed" to a driver-emitted self-connectivity
  status on the existing `connectivity` channel (e.g. a reserved self marker or a dedicated channel),
  which the overlay renders as "Connection lost — reconnecting… ([Abandon])" and clears on success.
- **Relay accepts re-registration for a live-or-graced slot.** `routing::register` already re-pushes
  `SessionStart` on re-register; D11 extends acceptance: a slot re-authenticating while its drop grace
  runs cancels the grace (the `LeaveGrace::cancel` path already exists) and fans
  `connectivity(slot, true)` — survivors' overlays clear. A re-register after the leave was decided is
  rejected (the slot is gone; the client gets a terminal "you were dropped").
- **Turn resync = bounded replay from cursor.** The relay keeps a per-session bounded ring of
  forwarded turns (bounded by the grace window: grace-seconds × turn rate × per-turn size — small).
  A reconnecting client's hello carries its last-delivered turn seq per slot (the client already
  tracks delivery per slot); the relay replays everything newer on the reliable stream before
  resuming live fan-out. The lobby channel already has replay-log semantics (the late-dial catch-up
  pattern) — the turn ring is its in-game sibling. The reconnecting client's own OUTBOUND gap is
  filled by its send queue (it kept producing turns while stalled — they buffered locally; on
  reconnect they flush in order).
- **No auto-drop — the drop is always a human decision (Travis, 2026-07-08).** The grace timer stops
  being a decision trigger and becomes an *unlock*: after **45 s minimum sustained disconnection**,
  any single survivor may trigger the drop (`RequestDrop` up the control stream; the authority honors
  it only for a slot it knows is disconnected with the unlock elapsed; rate-limit per requester).
  No quorum initially — the 45 s floor already protects the disconnected player, and a unanimous-vote
  tier inverts the griefing surface (one absent survivor holds the game hostage). SC:R's
  accumulated-disconnection-in-a-window unlock and an escalating scheme (45 s = all survivors vote,
  90 s = any one) are compatible refinements to revisit only if single-requester shows abuse.
  **Sequencing guard:** the interim 10 s auto-drop stays until RequestDrop ships and is removed in
  the SAME increment — without a request path, removing auto-drop would let one dropped player stall
  a game forever. The survivor overlay gains the Drop button at unlock (it needs an input rect via
  `add_ui_rect` — the §17 overlay is deliberately non-interactable today). The
  §17 grace-collapse-on-promotion tradeoff gets revisited here (promotion restarts the remaining
  unlock window instead of deciding immediately).
- **Suppress BW's native "Waiting for players" stall dialog (Travis, 2026-07-08).** The egui overlay
  is the sole disconnect surface — the native dialog (empty name list under the seam, an unwired
  Drop Players button, and its own countdown that contradicts the 45 s policy) must not appear at
  all. The `dialog_hook` spawn-interception (the mechanism that taps `chat_box`/`MsgFltr` by dialog
  name) is the natural tool: identify the stall dialog's name and swallow/hide it. Fold into the
  RequestDrop increment so the replacement lands with the suppression.
- **Relay-death failover stays deferred** (move to a backup relay + mesh re-home) — it needs
  coordinator-side relay liveness + client-side relay list, a separate arc. A relay death today =
  every client's self-disconnect notice + eventual reconciliation sweep; acceptable interim.
- **Ordering:** rp2 first (re-register acceptance + grace cancel + turn ring + replay-on-hello),
  live-testable with a synthetic client before touching the DLL; then the driver-owned re-dial; then
  the overlay actions ([Abandon] first — it's just the existing quit; [Reconnect] as the manual
  trigger for the automatic machinery).

**Relay side BUILT (rp2 `3641b3e`, 2026-07-08; not yet DLL-live-tested).** Re-dial during a pending
drop grace registers normally (grace cancels — locally at classification, cross-relay via the
`connectivity(true)` signal the receiving relay's dispatch now hooks), and the relay replays missed
turns cursor-based: the handshake gained a **fifth message** (resume-cursor frame: u16-LE count +
`(u8 slot, u64-LE last-delivered-seq)` entries, cap 16, empty = fresh dial — **wire-breaking**, a
4-message client auth-times-out against a 5-message relay, so the dist DLL and dev relay must move
together), a per-session turn ring records at the fan-out choke point post-session-start
(count-bound derived from grace×24tps×12slots×1.5, byte-bound 4 MiB, drop-oldest), and replay rides
`OversizeTurn` frames on the reliable control stream oldest-first before live fan-out resumes (the
client's per-(slot,seq) dedup makes stale cursors degrade to extra replay, never corruption).
Re-dial after the decision → terminal `SLOT_DEPARTED_CLOSE = 0x06` (distinct from
`SLOT_TAKEN_CLOSE` 0x02 = live double-connect); the future DLL re-dial loop must treat 0x06 as
stop-retrying. Integration tests cover the full two-client reconnect (exact missed turns, in order,
no leave fires) and the terminal refusal. Next: the driver-owned re-dial (client crate), then the
RequestDrop bundle.

**Driver + DLL built (rp2 `5cb22f1`, SB `f462c9d75`); first live blip test found a promotion race
(fix in flight).** The driver's `run_reconnecting` re-dials internally (jittered 500ms→5s backoff,
3s dial timeout, real resume cursors from the reorder cursor; unacked payloads re-carry and the
receive dedup survives the rebind), signals `(own_slot,false/true)` on the connectivity channel
(§17's self notice now reads "— reconnecting…" and clears on success); channels closing = terminal
only. **Live findings (2026-07-08):**
1. **Killing the relay process is NOT a reconnect test** — the restarted relay has a fresh keypair
   and the client's pinned-leaf-cert trust (fail-closed, by design) rejects it forever
   (`BadSignature` re-dial loop). Same-relay blips must be simulated by SUSPENDING the relay
   process (`NtSuspendProcess` ~20 s then resume — same cert, same in-memory state). Relay-process
   death is the deferred failover arc (coordinator-mediated re-home with fresh certs).
2. **The suspend/resume blip exposed a real race:** on resume the relay processed both stale link
   deaths (graces armed), presence flapped the authority away-and-back, both clients re-registered
   ("re-registered within its drop grace; cancelling the held leave" ✓) — but the re-promotion
   re-derived and broadcast BOTH held departures as leave directives (`rebroadcast_leaves=2`),
   ending the game (both results `unknown`). This is the §17 interim tradeoff ("promotion collapses
   an in-flight grace") invalidated by reconnection. Fix: a promotion must skip departures whose
   grace hold is pending — the hold's expiry/cancel is the sole decider for graced drops; ungraced
   undecided departures keep immediate re-derivation (never-lose-a-departure).
3. **Fix LANDED (rp2 `421b382`) + blip test GREEN.** Two load-bearing halves (negative-control
   proven): the handoff drain skips grace-pending slots (threaded INTO the drain — filtering its
   output would mark the slot decided and swallow the grace's later decision), and a re-register
   within grace REINSTATES the slot (discards the departure record — its cancelled grace would
   otherwise leave it undecided-and-ungraced, exactly what a promotion re-derives). Live re-run:
   20 s relay suspend mid-game → both clients re-registered, zero leaves decided, game resumed
   seamlessly (overlay cleared, comparator silent through and after the outage), redundant
   SessionStart re-push drained as designed. **Same-relay blip reconnection is LIVE-PROVEN
   end-to-end.** (The end-game scoring of that particular run was scrambled by a deliberate
   one-way alliance experiment — see the ally-quit backlog item; a no-blip control confirmed the
   quit/results path healthy.)

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

**INTERIM SHAPE BUILT + LIVE-PROVEN (2026-07-08).** rp2 `cbbbcc5`: `SlotConnectivity{slot,connected}`
frames (ControlFrame oneof 8; mesh oneof 9) fan to every client the instant a slot's link dies (clean
leaves fan nothing) and on every registration; the authority's leave decision for a DROP holds for
`DISCONNECT_GRACE` (10 s interim) then decides exactly as before — clean leaves bypass the hold, a
clean intent during a slot's drop grace cancels it ("left" supersedes held "dropped"), and the hold is
local/ephemeral on every observing relay so an authority failover never loses the departure (tradeoff:
the grace collapses to immediate on promotion rather than restarting — the D11 revisit restarts it
when the window grows + manual Drop arrives). SB `2268cd7ea`: `TurnState` drains the connectivity
channel on the game thread (post-`game_started` only), and an always-on non-interactable egui notice
(top-center, no input rect — clicks/keys pass through, ships in release) names each dropped peer with
an elapsed counter, ending on reconnect or the slot's applied leave; the client's OWN link death is
detected as the connectivity channel CLOSING (deterministic on driver death) and renders "Connection
to the server lost" (never for local-only sessions). **Live-proven:** hard-killed a client's game
process → survivor showed "claude-2 lost connection — waiting… (4s)" during the grace, automatic drop
at ~23 s total (~13 s QUIC idle detect + 10 s grace), correct win/loss reconciled; killed the relay →
both clients showed the self-disconnect line. **Bonus finding:** BW's NATIVE "Waiting for players"
stall dialog still appears under 2c (it keys on the sim stall, not Storm) with a Drop Players button
and countdown — its name list is empty under the seam and its Drop button's behavior under 2c is
unknown/unwired; cohabitation is acceptable interim, but the D11/manual-drop work should either feed
it names or suppress it in favor of the egui overlay. Remaining §17/D11 work: manual Drop (RequestDrop
up the control stream + authority honoring it only past grace), [Reconnect]/[Abandon] actions on the
self-disconnect notice, longer grace, grace restart on promotion.

### Pause/unpause through the v2 seam (unproven)

Native pause is a synced turn-stream command and turns keep flowing while paused, so the seam *should*
carry it unchanged — but nobody has proven pause/unpause through the v2 transport, and the F10-quit RE
showed quit-adjacent flows have surprising native structure. Verify in a live 2-player game: pause, chat
while paused, unpause, confirm no stall/desync.

**Automation attempt (2026-07-07): needs a human or the test harness.** Synthetic keyboard input
(SendKeys) DOES reach the game — two live chat-box sends fired the send tap — but menu interactions
don't automate: the F10 Game Menu (which has "Pause Game") ignores Esc/Break sends, and mouse clicks
computed from debug screenshots miss because the screenshot coordinate space is the game's render
target, not the physical window (observed 1260×973 capture vs 1074×751 window; non-uniform ratios).
The clean future path is synced-command *injection* through the seam via the debug surface (submit
pause/resume bytes into the outgoing turn like real input) — but that belongs to the game-test-harness
design (`docs/game-test-harness-design.md`, input-simulation goal), so don't build an ad-hoc one.

**Same finding for the MsgFltr send-scope pin:** the one-time dump is reachable (two live sends logged
"no MsgFltr dialog observed yet; defaulting to All"), but the `MsgFltr` dialog is NOT instantiated by
opening the chat box or by Tab — it's presumably created by a menu screen (Options → message filters),
which hits the same menu-automation wall. One human run that opens that screen then sends a chat pins
the mapping.

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
- **Observers** — ✅ 2p + 1 obs live-proven (see the Completed entry): registration, chat both ways,
  frame-locked view, mid-game observer leave, correct results, comparator silent on the fixed relay.
- **UMS** — ✅ real scenario map live-proven (see the Completed entry): custom forces, forced races,
  non-contiguous map slots, native FORC-driven alliances/victory, correct reconciled results.
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

- **Raw client results + server-side scoring (direction agreed with Travis 2026-07-08; subsumes the
  ally-quit fix).** Clients stop reporting digested verdicts and instead report RAW end-of-game
  evidence: per-player BW victory state (pre-allied-victors-expansion), the end-time alliance
  matrix, and anything else scoring needs (departure kind/timing already arrives via the relay's
  departure notices). The server derives the verdict — one brain, iterable without client releases,
  cross-client-diffable field by field. Motivating case: a one-way mid-game alliance in unranked
  melee (loser allies winner, then leaves) makes BW's native allied-victors pass score the LEAVER
  victorious; the survivor's digested report arrives inverted and reconciliation can only shrug
  (unknown/unknown). With raw evidence the ally-quit case is trivially distinguishable from genuine
  allied victory, and the concession-only principle extends naturally (a live-game leaver is not
  awardable a win off an opponent's report). Design points: version the raw schema from day one;
  raw-ONLY (no client digest — the DLL keeps its local victory/defeat dialog as presentation, not
  scoring); the GameResult frame stays relay-opaque (payload just gets richer); majority/concession
  arbitration unchanged, just over better inputs. Ranked stays additionally guarded by
  `lockedAlliances`.

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
- **Pre-existing pg `DeprecationWarning`.** Concurrent `client.query` in the `setReconciledResult`
  transaction path — observed during reconcile, not introduced by this work.
- **TS-side `GameNetworkStatus.fallbackFrom` cleanup.** Unused field; optional removal.
