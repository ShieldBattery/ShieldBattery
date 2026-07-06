# Netcode v2 — synced player-leave determinism (design)

> **Status: mostly built and live-proven; this is a condensed tracker of what remains.** This doc
> tracked the netcode-v2 synced-player-leave work on branch `rp2-integration` and grew, over
> 2026-07-03…07-06, to cover far more than the original leave path: results-through-the-relay,
> relay-side desync detection, the departure-notification pipeline, and scope C (replacing
> StarCraft's native Storm networking entirely). Almost all of that is now built, live-proven on
> loopback, and committed — its detail lives in the code, the commits, and the `netcode-v2-integration`
> memory, so it is redundant here. This condensed version keeps a terse record of the completed arcs
> and focuses on the remaining work. It will be deleted once that remaining work lands.

The original one-line thesis still frames the leave path: a coordinated player-leave is the sibling
of a D9 latency-buffer directive — the relay decides one value, schedules it at a future frame, and
every client applies it deterministically. The build reused that machine rather than reinventing a
consensus protocol at the seam.

## Completed

Each arc below collapses multiple original sections; the design detail is in the referenced commits
and in the code.

- **Synced player-leave determinism.** A coordinated leave rides the **reliable control stream** (a
  `LeaveDirective` pushed by the relay), *not* the turn envelope — the envelope path was live-disproven
  (a drop stalls every survivor and stops the turn stream, so an envelope stamp can never arrive).
  Client-side `LeaveTracker` dedups by slot (never by `leave_seq`); the relay's `decide_leave` computes
  `apply_at = departed_last_frame + 1`; QUIC keep-alive stops a stalled-but-alive survivor's link from
  idle-timing-out and cascading. The determinism gate is live-proven: survivors of a mid-game drop
  continue synced to a real result, automatically, zero desync. Clean-leave intent (F10 quit / natural
  end): loop-end → `send_leave_intent` → "player has left" on survivors near-instantly (reason `3` =
  left vs `0x40000006` = dropped).
- **Cross-relay leave propagation.** A mesh control stream carries `SlotDeparted` / `LeaveDirective`
  (broadcast, not routed to "the" authority) plus mesh cert pinning; the full topology matrix is
  live-proven (same-relay, peer-homed, authority-homed drop, promotion + cached verbatim rebroadcast,
  peer-homed clean quit). rp2 `5aa759f`, `139c6ad`, `f906325`.
- **Departure classification.** Keyed on the DLL's already-sent terminal result, not a game-side
  trigger — a graceful exit already emits a clean leave and the app server already holds the result at
  victory-dialog time, so the false-"dropped" case (ungraceful exit) is caught without any in-game
  hook. SB `43d06cae8`.
- **Departure notification.** Relay → coordinator → app-server webhook, Ed25519-signed with the
  tenant key (pubkey-fetch), camelCase body, evidence retained unconditionally (recording a departure
  is never suppressed by a held result). rp2 `02f1a3f` / `d432bdc`, SB `ebc3dcc1e` / `d022a414b`.
- **Relay-side desync detection.** The authority relay compares each slot's per-turn `0x37` sync
  `hash16` (only the shared-state hash — the fog/vision bytes are per-sender and must never be
  cross-compared) → signed `DesyncNotice` → `game_desync_events`. Majority-authoritative: the minority
  is named as diverged; 1v1 or an even split is undecidable (void). rp2 `3658f32`, SB `c3d693dbc`.
- **Desync-aware reconciliation + concession-only tiebreak + session-close-at-victory + adversarial
  audit.** `applyDesyncPolicy` consumes the events (matchmaking: majority-discard or void; lobby:
  dispute); the departure tiebreak was replaced with a concession-only rule (sole reporter vs an
  abandoner-without-a-report) because departure *order* was gameable by lingering; `WMission` victory
  closes the v2 session into `local_only`; a five-deep malicious-client audit fixed calibration
  poisoning and leave-frame inflation, among others. SB `57ce77ae9` (+ Codex fixes), rp2 `3793aaf`.
- **Results through the relay.** An opaque `GameResult` control frame is the *only* result path for a
  v2 game (the `results2` HTTP door is closed for them); fast force-reconcile fires on ledger-close;
  "session lifecycle owns game end" replaced the blind reconciliation timer (departure notices embed
  the slot's result, `SessionClosed` is ordered last, the sweep asks the coordinator for liveness);
  computer games are results-exempt, hidden from records, and self-close their sessions, with a
  one-time stats-repair migration. `lockedAlliances` is persisted in `GameConfig`. SB `fce245851` →
  `1df15efc3`, `b84372bff`; rp2 `60244da` / `b7947bc`.
- **Cross-repo landing.** Dev `[patch]` removed, rp2 pushed, `game/Cargo.toml` rev pin bumped,
  `rp2-integration` pushed. SB `ae3b8f111`.
- **Scope C stage 0 (RE closure) + stage 1.** Direct player registration replaces StarCraft's native
  Storm join: the DLL assigns each player's BW network ("storm") id from the rally-point2 roster and
  registers players itself (inlined `init_net_player` writes + `players[]` fill +
  `rebuild_storm_to_game_maps`). A minimal local Storm session is created via `storm_create_game`
  (BW's game-init derefs the session object); `init_game_network` is ordered before the roster write
  (it zeroes `players[]`); the game template is populated so BW runs melee rules, not Use-Map-Settings;
  and the in-game multiplayer UI is restored by hooking `net_player_count` to report the true roster
  count (the peerless session otherwise reads as 1 → single-player UI). Live-proven: synced 2-player
  games, melee rules, victory-on-leave, diplomacy/comm buttons. Commits `f23611bdd`, `d239d02d2`,
  `a372e454f`.

## Remaining work

### Chat (in-game) — in progress

In a scope-C game, in-game chat is broken two ways: (1) a peer's chat message never reaches the
receiver's display, and (2) every message renders as coming from the host (player 0 / claude-1),
including the sender's own copy on its own screen. Ruled out: the replay/observer display filter
(`is_replay == 0`, the local player is not an observer); local-id defaulting (ids are correct and
distinct per client); and the `net_player_count` fix (restoring the MP UI did not help chat).

**RE of the native `0x5c` chat handler (12409).** Command `0x5c` dispatches through
`command_dispatch_index_table` (0x748790) → case `0x36` → `print_text` (0x721430). Fixed 0x52-byte
layout: `data[0]=0x5c`, `data[1]` = the **sender game player id** (the value displayed), `data[2..]` =
the 0x50-byte message. The handler is **unconditional** — it reads `data[1]` and calls `print_text`
with no recipient check, no sender validation, no `net_player_to_game` translation, and no
`command_user` involvement; `print_text` renders `players[data[1]].name` verbatim (own colour if
`data[1] == local_player_id`, else received colour).

- **Symptom (2) — understood.** `data[1]` is literally `0` in our commands (native BW writes the
  sender's own game id there on send; scope-C leaves it 0 — the send path is obfuscated, unread), so
  every message renders as `players[0]` = the host. Clean fix: **rewrite `data[1] = command_user`**
  (the correct sender game id the turn-processing path already computes) before the handler runs — a
  byte rewrite of a non-sim command, so it cannot affect the sync hash. Understood and ready, but
  unverifiable until symptom (1) is fixed.

- **Symptom (1) — the blocker, and a key finding.** Instrumenting our `process_game_commands` hook to
  log every `0x5c` it processes showed **the log never fired — for the peer's chat *or* the local
  player's own message.** So the chat `0x5c` does **not** traverse the `process_game_commands` path we
  hook, even though gameplay commands do (desync=0). Chat is therefore delivered/processed by a path
  our seam doesn't cover — it is *not* dropped inside the command handler (which is unconditional).
  Leading hypotheses:
  - In-game chat may be sent via a **separate Storm out-of-band path** (e.g. `SNetSendMessage`), not
    the turn-command stream our OUT hook (`send_turn_message`) carries. Scope-C's neutered Storm
    transport would then drop the peer copy, while the local echo displays via a direct `print_text`
    (explaining the empty `process_game_commands` log even for the *own* message). If so, chat must be
    **re-homed onto an rp2 reliable side-channel** — the same out-of-band-chat channel the Disconnect
    UX section already wants. (Note: this would contradict the earlier assumption that in-game chat
    rides the turn stream — worth settling.)
  - Or our `game_command_lengths` table mis-frames `0x5c` (the RE says fixed 0x52), so `iter_commands`
    never yields a clean `[0x5c, …]` command and both our send-side `strip_control_commands` and the
    receive-side walk mishandle it.

**Next diagnostic (whoever resumes):** instrument the OUT hook (`netcode_v2_send_turn`) to log whether
a `0x5c` is present in the outgoing turn buffer when chat is typed. If **yes** → chat rides the turn
stream and the drop is receive-side (chase why `process_game_commands` never sees it — the
`step_network` / `receive_storm_turns` / `player_turns[]` path). If **no** → chat uses a separate
(likely Storm out-of-band) send path and needs re-homing onto an rp2 reliable channel. Also confirm
`game_command_lengths[0x5c] == 0x52`. No new samase symbol is needed for the handler itself; the fix
lives in our existing OUT/IN/command hooks plus, most likely, a new reliable side-channel.

### Scope C — remaining stage-1 increments

Stage 1's player path is proven; these increments extend it:

- **Observer registration.** rp2 observer slots 8–11 map to game-player structs `players[12+n]`. The
  observer's **storm id stays in 0-11 (= its rp2 slot)** — `update_nation_and_human_ids` asserts
  `storm_id < 16` and indexes the 12-entry `net_player_to_game`; the `0x80-0x83` value is the
  observer's *game/net-player* id, which the handler derives from the `players[]` index (12-15), not
  its storm id. So observers register exactly like players but at `players[12+n]` with storm id =
  rp2 slot 8+n. Built as a follow-up increment once the players-only path is synced-clean (observer
  id handling is the subtlest part).
- **Solo/comp-game carve-out (open Q6).** A single-human-vs-AI game has no v2 session and today runs
  native create + SNP with zero peers; deleting the SNP shim (stage 2) kills that path. Two options:
  build a **sessionless `TurnState`** that runs `local_only` from the start (no `establish_session`)
  so Storm can be fully deleted and every game is seam-driven; **or** keep native create for solo
  games as a documented, weaker intermediate ("no Storm in any *networked* game"). The first is the
  clean end state; the second is defensible if the sessionless construction grows hairy.
- **Non-melee game-type slot/team layouts.** Scope-C registration — the storm-id-from-roster
  assignment plus the `players[]` slot/team fill — is proven only for **melee** (players in positional
  slots 0–N, no teams). Game types with *particular* layouts each need verifying, and likely handling,
  under direct registration: **Top vs Bottom** (players split into top/bottom teams; subtype =
  players-on-top), **Team Melee** and **Team FFA** (shared-control teams), and **Use Map Settings**
  (map-defined forces, slots, and positions). The per-type *rules* are already covered — the game
  template now comes from `find_game_type_template` keyed on game type — so this is specifically about
  the slot/team/storm-id *layout*: `setup_slots` already has `is_ums` and team-aware branches, so part
  may be covered, but their interaction with the scope-C storm-id assignment must be checked game-type
  by game-type. A wrong slot/team/storm-id mapping desyncs on turn 1, so the relay `0x37` comparator
  catches any mistake immediately in loopback. One-on-one and FFA are melee-shaped and likely already
  fine.

### Scope C — stage 2 (deletion sweep)

Once the stage-1 increments are proven, delete the now-dead native path outright:
`snp.rs`, `network_manager.rs`, `ack_manager.rs`, `netcode/storm.rs`; the retired `messages.proto`
payload kinds (`StormWrapper`, `ClientReady`/`ClientAck*`); the app/server rally-point-**v1** route
provisioning; and the Storm-read list — the `storm_players` / `storm_player_flags` reads, the
`StormIdChanged` guard, the flag-polling join-signal, `check_player_drops`, the `network_results`
`has_quit` derivation, etc. (all now owned by `TurnState` / `LeaveTracker`). `slot_to_storm` collapses
to identity. Also removes the `LoadSnpList` hook and the `StepIo` snet pump.

### Relay-driven start

Move the "everyone's here, go" signal from the app server to the **relay**. The app server owns it
today only for a historical reason that has evaporated: rally-point *v1* relays were dumb forwarders
with no notion of session membership, so nothing at the network layer knew the roster and the DLLs
synced readiness peer-to-peer (`ClientReady`). rp2's smart relays hold the roster (session descriptor)
and already fan reliable control-stream directives to every client, so the relay is now the natural
synchronization authority — it is the one component that sees every client dial in and authenticate. A
relay "all slots present → start" directive (same machinery as the buffer/leave directives) would
replace **both** `startWhenReady` *and* the peer `ClientReady` handshake, and a reconnecting client
(D11) would be re-synced by the relay rather than by app-server orchestration.

Subtlety: "all slots dialed + authenticated" is *early presence* (clients dial during
`establish_session`, before the map loads) — the same timing as today's `startWhenReady`; the true
lockstep sync remains the frame-0 barrier, which the relay already owns. So it is the same two-tier
structure (early "go" + hard frame-0 sync), consolidated onto the relay. What genuinely stays with the
app server: session creation + setup/token/roster distribution, and MMR/timeout bookkeeping (though
even an "all-present" notice could ride the coordinator→webhook pipeline).

**Staging:** prove scope-C registration + local-drive first on the existing `startWhenReady`, then
migrate "go" to a relay start-directive as a clean follow-up that deletes `startWhenReady` and the
`ClientReady` overlay. Each step stays independently testable.

### Reconnect / failover (D11)

This whole design ships the **permanent-leave** path with an *immediate* trigger (matching today's
no-reconnect reality). Reconnect + resync + a relay grace period are deliberately kept **separate** in
D11, and the code is shaped so D11 drops in without reworking anything:

- The leave trigger grows a **grace period**: on link loss, the home relay holds before `decide_leave`,
  giving the client's reconnect+resync path a window to re-establish and resume producing turns; the
  leave fires only on grace expiry. (A grace means survivors *stall* for its duration — the
  survivor-stall-vs-reconnect-chance tradeoff is the D11 tuning knob; Travis's "~40s then extremely
  unlikely to reconnect" intuition *is* that grace length.)
- Relay-death failover is the other half: a survivor stalled far past a leave's expected arrival has
  lost its authority/relay, and the D11 resync path (move to a backup relay, replay from cursor)
  applies.
- Self-disconnect (below) is the client-side half D11 upgrades directly — same connection-down
  trigger, same state machine, so the v1 code is exactly the seam D11 extends.

The leave directive is orthogonal to *how long we wait before deciding a departure is permanent*, so
nothing here forecloses reconnect.

### Disconnect UX (§17 target — design direction, not built)

The connection-lost work should be shaped toward this end state; v1 ships the interim auto-removal
(~10s) because without a reconnect path waiting is pointless. Shares its UI/overlay with self-disconnect.

- **Disconnected player's side:** "You've lost connection — [Reconnect] [Abandon]." Reconnect is a
  first-class *user* action (alongside D11's automatic attempts), reconnecting into the **same** game;
  abandon resolves to the disconnect loss via SB's existing end-game path. (Open: confirm the exact
  existing "you've been disconnected" entry point — the `NetworkError` variants in
  `network_manager.rs` / `game_state.rs` and how they surface as a game status the app renders — and
  reuse it rather than adding a new one.) Detection keys on the **transport fact** (my QUIC connection
  to the relay is down → `TurnState`'s `inbound` reads closed while `game_started`), never on a stall
  duration (which false-positives on jitter).
- **Survivors' side:** an overlay naming *which* player(s) are disconnected, with a grace timer (~45s,
  the native-drop-timer intuition) before a **manual "Drop"** action unlocks. Dropping stays a human
  decision even after the timer (important events / friendly games may wait minutes). Flow: relay
  detects link death → broadcasts "slot X disconnected" (a connection-state control frame, *not* yet a
  leave) → survivors wait under the overlay → either X reconnects+resyncs (D11) or a survivor clicks
  Drop → `RequestDrop` up the control stream → authority `decide_leave(dropped)` → the built directive
  path. This reinstates a manual drop (Trigger B / `RequestDrop`) but on *our* overlay, so there is no
  BinaryNinja dependency; the anti-grief check simplifies to "the authority honors a `RequestDrop` only
  for a slot it knows is disconnected with the grace elapsed." (Open policy: single request vs a
  quorum; a `RequestDrop` rate-limit.)
- **"Feels like a paused game, not a modal" — the chat problem.** In-game chat is a turn-stream command,
  which is why chat works during a native *pause* (sim stops, turns flow) but dies during a *stall*
  (turns stop). Survivor↔survivor chat during the wait therefore needs **out-of-band chat on the
  reliable control stream** (a new fanned-out `ControlFrame` kind — the same reliable side-channel the
  in-game-chat and resync work will want). Open: replay interleaving — each client stamping received
  out-of-band chat at its own current frame may be acceptable cosmetic divergence; unresolved.
- **Prerequisite ordering:** cross-relay leave routing stays first (done); then the overlay +
  self-disconnect built to THIS shape (named players, timer, non-modal), initially wired to v1
  semantics; D11 fills the [Reconnect] branch and the drop-gating.

**Related, still unproven — pause/unpause through the v2 seam.** Native pause is a synced turn-stream
command and turns keep flowing while paused, so the seam *should* carry it unchanged — but nobody has
proven pause/unpause through the v2 transport, and the F10-quit RE showed quit-adjacent flows have
surprising native structure. Verify in a live 2-player game: pause, chat while paused, unpause, confirm
no stall/desync.

### Backlog (small / deferred)

- **Client desync-report hook.** Closes the pure-fog desync gap (a divergence living only in
  vision-masked fog state that never perturbs a hashed value and reaches the result-lock before it
  does). A client report can only ever **VOID/dispute** (the safe direction — a false report denies MMR
  to both and is rate-limitable), never claim a win, so it does not reopen the "don't trust client
  report shape" concern. Optional fast-follow feeding the same `DesyncNotice` pipeline.
- **Oversize-turn amplification.** The forward channel is bounded by *count*, not bytes, so a valid
  64 KiB turn is cloned into every peer channel (a memory spike touching other sessions, and a lever to
  force-drop honest teammates). Fix direction: byte-budget the forward channel / lower
  `MAX_CONTROL_FRAME_LEN` / rate-limit oversize turns (relay `routing.rs`).
- **Self-desync-void abuse rate-limit.** The accepted "self-desync to void my own loss" escape has no
  per-user throttle; the app server logs participants at WARN on a `no_majority` void for manual review,
  but automated rate-limiting is deferred.
- **Post-promotion desync ordinal PK collision.** After an authority promotion the comparator re-bases
  sync ordinals low, so a desync straddling a failover could collide on `game_desync_events`'
  `(game_id, sync_ordinal)` PK and drop as a duplicate. Within the already-accepted "straddling-death
  miss once" envelope; a future revisit could add an authority-generation/epoch component to the event
  identity.
- **Pre-existing pg `DeprecationWarning`.** Concurrent `client.query` in the existing
  `setReconciledResult` transaction path — observed during reconcile, not introduced by this work;
  worth a later look.
- **TS-side `GameNetworkStatus.fallbackFrom` cleanup.** Unused field; optional removal.
