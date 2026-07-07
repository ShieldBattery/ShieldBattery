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

### Overnight session 2026-07-06 (autonomous) — game-type layout verification + team-alliance bug

Loopback-verified scope-C direct registration across every non-melee game type (2–3 real clients,
relay `0x37` comparator watched throughout). **All five layouts are sync-clean** (zero relay
WARN/ERROR/desync, correct in-game rendering, correct BW victory dialogs):

| Game type | Sub-type tested | Layout sync | Result-on-drop |
|---|---|---|---|
| Top vs Bottom | 2v2 (2-on-top) | ✅ clean | ✅ both top survivors won (independent control) |
| Team FFA | 2 teams | ✅ clean | ❌ surviving teammate got a **loss** |
| Team Melee | 2 teams | ✅ clean | ❌ surviving teammate got a **loss** (reproduced) |
| FFA | — | ✅ clean | n/a (drop doesn't end a 3-way FFA) |
| Use Map Settings | standard 4p map, default forces | ✅ clean | n/a (UMS results are map-trigger-driven) |

**So the slot/team/storm-id *layout* item is satisfied** — direct registration produces
deterministic, correctly-placed games for all these types.

**BUT a real bug surfaced: scope-C never populates the BW alliance table (`game.alliances`) for team
games.** After a team game, every player is allied only to *itself* (`alliances[i][i]=Allied`, all
other pairs `Unallied`) — teammates on the same `players[].team` are `Unallied` to each other. Native
lobby join sets teammates to AlliedVictory; scope-C bypasses that and writes nothing.

- **Root cause evidence:** Team Melee, c1+c3 (team 1) vs c2 (team 2), `forceQuit` c2. c3's
  `player_results` (game-thread snapshot) showed BwPlayerId(0)=Victory allied only to [0], and
  BwPlayerId(2)=c3=Playing allied only to [2] — c1 and c3 mutually `Unallied`. `determine_game_results`
  (game_state.rs ~2437) only promotes a victor's allies to Victory when the alliance is
  `AllianceState::AlliedVictory` (both directions); with the alliance missing, c3 fell through to
  Defeat → reported/reconciled as a **loss** (DB confirmed: c1 win, c3 loss). Team FFA reproduced
  identically.
- **Why TvB "passed" anyway:** independent-control team games (TvB) let both teammates independently
  reach `VictoryState::Victory`, so no allied-victor promotion was needed — but TvB's alliance table
  is *also* unset, so its teammates can likely **friendly-fire** (unconfirmed — no combat occurred in
  the test). Melee/FFA/1v1 have no teams, so `Unallied` is correct for them (FFA verified fine).
- **The differentiator is shared control:** Team Melee/FFA designate one `team_game_main_player` per
  team who owns the units and reaches Victory; the non-main teammate has no units, stays Playing/Defeat
  at the drop frame, and *depends* on allied-victory propagation — which fails with the alliance unset.
- **The scenario that triggers the bad result:** the **last enemy alliance drops**, causing an instant
  allied victory. In a normal team game where the losing side is eliminated by play, both teammates are
  alive-and-victorious and score correctly; the mis-score is specific to a drop that *ends* the game.
- **Native alliance setup (RE-confirmed, 12409):** native `init_game` (0x6c8fd0) writes both the
  alliance table (`game.alliances` @ +0xE544, `[12][12]` u8) *and* shared vision (`game.visions` @
  +0xFC, `[12]` u32) for teammates — reading four per-team flag bytes at `game+0xE4C8`. Those flag
  bytes are set **only** by the multiplayer lobby-command path (`process_async_lobby_command` →
  `sub_736537`, from the lobby force-settings struct). Single-player never sets them (single-player
  has one human), and scope-C bypasses that lobby path → flags stay 0 → no human team alliances/vision.
  A tactical fix (write `game+0xE4C8`=0x0E for active teams pre-`init_game`, let native derive) exists
  but is **superseded by the direction pivot below.**

**⟹ DIRECTION PIVOT (Travis, 2026-07-06): stop hand-writing lobby-derived state; drive native lobby
setup over rp2.** The alliance/vision miss is one symptom of a structural issue — scope-C models a
*single-player* Storm session and re-derives the *multiplayer lobby's* state by hand, discovering each
gap only when a test hits it (crash-3, `net_player_count`=1, alliances, vision, likely chat). Decision:
let native BW run the real lobby (compute all state) while we replace only Storm's transport +
handshake. The full RE-verified implementation plan is the next section.

### Netcode v2 lobby setup — the native-lobby-over-rp2 plan ("2c")

> **Status (2026-07-07): BUILT (slices 1–5a) + live-verified on loopback; 3 issues open.** Committed
> as a checkpoint on `rp2-integration`. The native-lobby infrastructure works: melee, UMS-default,
> and **Team Melee are all sync-clean** (relay `0x37` comparator quiet), MP UI correct, players
> registered. Two live regressions were found and fixed in this pass: (a) **net_player_info** — slice
> 5a's swap to native `init_network_player_info` only populated the local player (its provider-gated
> name lookup doesn't resolve a roster-seeded remote), breaking the diplomacy/comm UI + drop-name;
> restored the direct write as `BwScr::v2_register_net_player`. (b) **game template** — slice 5a
> deleted `apply_game_type_template` assuming native create/join sets it, but the template rides the
> host's game-info blob which the roster-driven peer join synthesizes locally and never receives, so
> the peer ran UMS rules vs the host's real rules → frame-0 desync on every non-UMS type; restored
> `apply_game_type_template` (a deterministic local registry lookup, run on every client). Both were
> the same over-optimistic-deletion pattern.
>
> **3 OPEN ISSUES (handoff):**
> 1. **Alliance / surviving-teammate-loss (the headline bug this pivot exists to fix — STILL OPEN).**
>    Team Melee 2v1, forceQuit the lone enemy → DB shows the unit-owning teammate `win` but the
>    **other teammate `loss`** (should be an allied win). The game now SYNCS correctly, but the BW
>    alliance table (`game+0xE544`) is not set for shared-control team games, so
>    `determine_game_results` drops the non-victor teammate to defeat. This is the settling
>    experiment for the `?`-command Open decision below, and it resolves it to **OPTION 2, not option
>    1**: build the force/alliance record locally on every client (deterministic from map + game type
>    + team layout) and feed it through native `sub_736410` — no wire. Needs a samase analyzer for
>    `sub_736410` (0x736410). See "Open decision — the async `?` command".
> 2. **Start-of-game lag screen (native-lobby regression — was clean before).** Log-proven: NOT our
>    `do_countdown` (host/peer synced within 50ms). The host sends its own `0x48` lobby-init and
>    doesn't process it back for **~7s** (`Lobby game init command seen`), while the peer receives the
>    relayed copy in ~40ms. Cause (Travis): under native `create_lobby` the host runs SC:R's native
>    lobby machine, whose native countdown / lobby-state ladder gates when the host's own `0x48` is
>    processed; the peer's lobby is driven directly so it applies the relayed `0x48` immediately.
>    One-directional (only the host lags → peer waits at the frame-0 barrier; not a desync). Fix
>    direction: suppress or sync SC:R's native countdown on the host, and sync our own `do_countdown`
>    (it carries `// TODO(tec27): Sync countdown across clients`).
> 3. **In-game chat doesn't cross to peers.** PROBE-PROVEN it is NOT in the in-game turn stream: a
>    full game with real typing logged ZERO framed `0x5c` in the OUT hook (`send_turn_message`) OR in
>    `process_game_commands` (RECV). So chat leaves via a path our seam doesn't carry — which is why
>    it vanishes while sync stays perfect. Local sender attribution is now CORRECT (native-lobby
>    identity fix). Next: RE the chat SEND path (what the in-game chat input triggers) — never traced;
>    only the receive/dispatch side (`0x5c`→`print_text`) is known. Re-check the premise that SC:R
>    in-game chat even uses the classic `0x5c` command (it has its own modern chat overlay). `SNetSendMessage`
>    is a generic Storm primitive, NOT "the chat path" — don't assume it's the mechanism.
>
> The original slice plan follows unchanged for reference. Slice 5b (deletion sweep) is NOT done —
> and note the `net_player_count` hook is now LOAD-BEARING (keep it; native count returns garbage).

> **Original plan status:** designed + RE-verified against StarCraft **1.23.10.12409** on 2026-07-06.
> Self-contained; hand this to a developer. Supersedes scope-C direct registration for lobby setup —
> everything the current `init_game` `is_netcode_v2` branch does to set up the lobby (`setup_slots` /
> `register_net_player` / `ready_lobby_for_start` / `setup_team_alliances` direct writes) is *replaced*
> by this. All hex addresses are 12409 navigation aids — **resolve at runtime via samase_scarf**, never
> bake them in (see "samase prerequisites"). Also supersedes the `netcode-v2-slot-registration-cleanup`
> plan (that was hand-consolidation; this makes it native).

### Goal & hard constraints
Let native `create_game` (host) / `join_game` (peer) + the native lobby-command flow compute **all**
lobby-derived state — player structs, slots, teams, alliances (`game+0xE544`), shared vision
(`game+0xFC`), net player count, races, RNG seed. We replace only Storm's networking. Non-negotiable
constraints (Travis):
1. **No tunneling raw Storm-framed packets** — Storm's 12-byte header / resend / checksum are
   redundant; carry only bare command bytes.
2. **In-game turns stay on the existing rp2 datagram seam, unchanged.** This plan touches only the
   lobby phase (`!game_started`); the `set_game_started()` flip stays the exact lobby→game boundary.
3. **No hand-writing lobby state** — native computes it; we handle only the networking edges + seed the
   session membership the handshake would have produced.

### Why this is clean (the layering)
BW lobby is two layers: **SNP** (packet transport, `game/src/snp.rs`) underneath, and **lobby commands**
(state setup) above, carried as *turns*. Our in-game seam already hooks `send_turn_message` (0x740de0)
and `receive_storm_turns` (0x73f4e0), which sit **above** Storm's framing — so lobby setup commands are
visible there as bare command records. The plan reuses that seam for the lobby phase on the rp2
**reliable** channel, and short-circuits the handshake from the coordinator roster (which already
encodes the membership + slot assignment the handshake exists to agree on).

### Confirmed mechanism (12409 RE)
- **Host — `storm_create_game` (0x7aee60): keep native, unchanged.** It does **no networking and never
  waits on peers** — builds the session locally, sets `storm_local_player_slot = 0`, inits the local
  player struct, writes the turn-base out-param. Peers are normally admitted *asynchronously* later
  inside `snet_recv_packets` as their join packets arrive; we replace that admit with roster seeding.
- **Peer — `storm_join_game` (0x7b0220): replace its networking with a roster-driven success tail.**
  Native does 2 sends + 2 blocking waits (`sub_7ae5b0`): SEND join-request (type 1) → WAIT type-2
  accept (delivers the assigned slot into `storm_local_player_slot`) → SEND player-info (type 7) → WAIT
  types 9/0xa (admitted list / start). The waits only *produce* (a) the assigned slot and (b) session
  membership — **both already in the roster.** So skip all four network ops and run join's success tail
  (native `0x7b04e4`→end): set `storm_local_player_slot` from roster; fill the local player struct
  name/desc (`sub_7abb00`); register slot name (`sub_7ac8c0`); seed `snet_player_list` (host + all
  peers); set `*out = slot + storm_turn_base`; call `sub_7ad3a0`. Full replacement is cleaner than
  wrapping (the native body still calls `storm_send_to_player`).
- **Setup commands ride the seam (already captured).** Slot/color setup (`net_cmd_lobby_slot_setup`
  0x731880 → the `0x69` record) and the `0x48` game-init + RNG seed both flow `send_command` →
  `send_queued_lobby_commands` (0x730890, flushed every 50 ms by `step_lobby_network`) →
  **`send_turn_message` (0x740de0)** — the seam. Receive side: `receive_storm_turns` →
  `process_lobby_commands` (0x7479f1). We relay these **bare command bytes** over the rp2 reliable
  channel; native generates them on the host and applies them on peers.
- **Lobby turn barrier — satisfy via our receive hook.** `storm_receive_turns` (0x7b1150) walks
  `snet_player_list` each step and requires an in-order turn from each slotted + present member
  (timer-driven, not ack-gated). Since we replace the receive path during lobby (as in-game),
  synthesize each member's lobby turn: the host's carries the real command bytes; **peer turns only
  need empty keep-alives** (peers author only their own small join/ready/race requests).
- **The one gap — the force/alliance/vision `?` command does NOT ride the seam.** The command
  (`sub_736410` → `sub_736537`) that writes the per-team alliance flags (`game+0xE4C8`), shared vision
  (`game+0xFC`), force/team layout, and `lobby_state=3` travels on Storm's **async `SNetSendMessage`
  path** (received via `sub_73f490` → `process_async_lobby_command` 0x735ba0), **not**
  `send_turn_message`. See "Open decision" below.

### Session state to seed from the roster (the handshake's output)
`snet_player_list` (= `storm_session_player_list`, globals `data_f5db10`/`data_f5db18`) must hold every
roster member as a session-player struct **before** the lobby command flow or the barrier runs.
Per-member fields: 12-byte net key `+0x108`; flags `+0x118` (`| 4` = present/admitted); slot `+0x21a`
(byte, `0xff` = unassigned); name via the slot-name registry. Native helpers to reuse:
- `sub_7ab9d0` (0x7ab9d0) — lookup-or-create a session-player by net key.
- `sub_7abb00` (0x7abb00) — get-or-create the local player struct.
- `sub_7ac8c0` (0x7ac8c0) — register slot→name into `data_11df0fc[slot<<7]` (what
  `net_cmd_lobby_slot_setup`'s per-slot name lookups resolve against).
- `find_storm_session_player` (0x7aba90) — lookup by slot.
- Globals: `storm_local_player_slot` (host 0; peer from roster), `storm_turn_base`
  (game-player-id = slot + base).

**Critical ordering (RE):** the type-2 accept and the peer-admit that normally set
`storm_local_player_slot` + membership happen *inside the SNP pump*, which we remove. So these must be
written from the roster **before** the native lobby command flow or the `storm_receive_turns` barrier
runs — otherwise they read as unslotted / absent and the barrier never clears.

### Hook list
**Host:**
- **H1.** `storm_create_game` (0x7aee60) — **keep native** (samase: already resolved).
- **H2.** **Seed `snet_player_list`** with the N-1 peers after create (new code via `sub_7ab9d0` +
  `sub_7ac8c0`; net key derived from the QUIC peer identity, `+0x21a` = slot, `+0x118 |= 4`, register
  name). Replaces the async peer-admit.
- **H3.** **Seam capture/relay** — the host's `0x69` + `0x48` commands already flow through
  `send_turn_message`; relay the bare bytes on the rp2 reliable channel (extend the existing hook with
  a lobby-phase reliable route).
- **H4.** **Barrier synth** — during lobby, feed each member's lobby turn via the receive hook (peers =
  keep-alive).

**Peer:**
- **P1.** `storm_join_game` (0x7b0220) — **replace networking with the roster-driven tail** (skip the 2
  sends + 2 `sub_7ae5b0` waits; seed slot + `snet_player_list`; run the success tail). samase: NEEDS
  analyzer.
- **P2/P3/P4** — same seed / seam / barrier as H2/H3/H4.

**Async `?` command** — see Open decision (resolved: drop it, option 1).

### Implementation brief (slices 2–3) — concrete code targets

Pins are ready: `game/scr-analysis/Cargo.toml` bumped to samase `cf4458013` (builds clean, exit 0);
`game/Cargo.toml` has the DEV-ONLY `[patch]` onto `../../rally-point2/client` for the lobby channel
(remove + bump the `rev` at integration). The rp2 transport already carries `lobby_out`/`lobby_in`
end-to-end (`TurnChannels` fields, driven in `LinkDriver::run`), and `TurnState.channels` holds the
whole `TurnChannels`, so they're reachable as `self.channels.lobby_out`/`.lobby_in` with no new
`TurnState` field.

**Order the slices so each compiles clean with zero runtime change until the one that flips behavior:**

1. **Plumbing (no behavior change).** scr-analysis pass-throughs for the 7 new getters
   (`storm_join_game`, `storm_session_player_lookup_or_create`, `get_local_storm_session_player`,
   `storm_register_slot_name`, `snet_drain_deferred_queue`, `find_storm_session_player` →
   `Option<VirtualAddress>`; `storm_local_player_slot` → `Option<Operand>`; `storm_turn_base` already
   exists), matching the existing pass-through block in `scr-analysis/src/lib.rs`. Add the
   `StormSessionPlayer` `#[repr(C)]` struct (size 0x21c) to `src/bw_scr/scr.rs` alongside `StormPlayer`
   — fields per the anchors doc's struct table (`+0x08`/`+0x88` names, `+0x108` key, `+0x118` flags,
   `+0x1e0` turn-seq, `+0x21a` slot; `unkNN` gaps elsewhere). *Hold* the additions to
   `NetcodeV2Bw`/`resolve_netcode_v2` (`bw_scr.rs:341`/`746`) until slice 2 consumes them —
   `resolve_netcode_v2` is `ok_or(..)?` (hard launch fail) with no fallback, so an unused resolve is a
   launch requirement for no benefit.
2. **Lobby seam (host + peer share H3/H4/P3/P4).** Extend the three hooks so the `!game_started`
   branch is no longer pure-`Native` when a v2 session is live:
   - **OUT** (`netcode_v2_send_turn`, `bw_scr.rs:2357`): during lobby with a live session, relay the
     lobby turn buffer over `self.channels.lobby_out` (new `TurnState` method) and echo it into the
     local member's own synthesized turn. **RESOLVED (RE, 2026-07-06): native self-apply is
     turn-store loopback, uniformly for every lobby command class** — `storm_broadcast_to_players`
     (0x7b22d0) ends with a `storm_send_to_player` to the *local* node, which links the message into
     the local node's per-class received queue (`node+0x180` for class-2 turns); `storm_receive_turns`
     reads the local slot from that same queue, and the lobby dispatch (`step_network` →
     `sub_745df0` → `process_lobby_commands`) runs for every flagged slot with no local exclusion.
     So OUT suppresses the native send entirely and **returns success** (a failure return trips
     `ERROR_SEND_MESSAGE` via 0x740e28); the host's own bytes reach `process_lobby_commands` through
     the synthesized local turn, exactly like the in-game `echo_local_turn`. Wire content: the flush
     hands `send_turn_message` bare concatenated command records; **an empty tick is exactly one
     byte, `0x05` (keep-alive)** — the 0xc-byte Storm header exists only below `send_turn_message`.
     **Keep-alive-only buffers are echoed locally but never relayed** (the relay lobby log caps at
     1024 commands / 256 KiB; 20 Hz keep-alives would exhaust it in ~51 s).
   - **IN** (`netcode_v2_receive_turns`, `bw_scr.rs:2384`): during lobby, synthesize each session
     member's lobby turn — each member's queued `lobby_in` bytes, or a synthesized 1-byte `0x05`
     keep-alive when none — and fill `player_turns[]`/sizes/flags exactly like the in-game full
     replacement (the native `storm_receive_turns` barrier and its `+0x118 & 4` gate never run; the
     receive gate does natively require the *local* member's turn too, hence the OUT echo).
     **Pacing: gate readiness on the local echo queue** — dispatch one turn per member per local
     flush (stall between flushes), reproducing native's ~50 ms lobby turn cadence instead of
     free-running on every poll.
   - The `set_game_started()` flip (`game_thread.rs:220`) stays the exact lobby→game boundary;
     `seed_netcode_v2_pipe` (`game_thread.rs:223`) is unchanged.
3. **Host seed (H1/H2).** Keep native `storm_create_game` (still called via the reinstated
   `create_lobby`/`bw_scr.rs:3575` path). After it, seed `snet_player_list` for the N-1 peers from the
   roster via `storm_session_player_lookup_or_create` (net key from the QUIC peer identity) →
   `+0x21a = slot`, **`+0x118 |= 4`** (the barrier-gate bit — verified required), `storm_register_slot_name`.
   **Requires: the host occupies rp2 slot 0** (native create inherently makes the creator storm
   session slot 0, and storm id ≡ rp2 slot is the identity the whole seam rides on). The server
   did NOT guarantee this — `game-loader.ts`'s v2 slot assignment iterated `players` in bare
   order — so the loader now orders the host first (2026-07-06; the host resolved identically to
   the published `GameSetup.host`).
4. **Peer join replacement (P1).** This is a **full-replacement hook on `storm_join_game` itself**
   (that is what the samase analyzer's address is for): slice 5 reinstates the native
   `join_lobby`/BW-join flow above it, which natively authors the peer's join/slot/race request
   records (they ride the seam like every lobby command), and when that flow reaches
   `storm_join_game` the hook skips the 2 sends + 2 waits and instead: seeds `snet_player_list`
   (host + all peers from the roster, same as H2), sets `storm_local_player_slot` from the roster,
   runs the success tail (anchors doc's 0x7b04e4→end — local node slot/name fill,
   `storm_register_slot_name`, `*out = slot + storm_turn_base`), and **calls
   `snet_drain_deferred_queue`** (load-bearing). Skip the two `data_11df1b4`/`data_11df120` writes
   (verified dead under full replacement).
   **RESOLVED (RE, 2026-07-06), with a shape revision.** The prefix does NOT build the session
   state — on a native peer the game-info blob (`data_11df128`/`12c`) and the `data_11df*`
   game-info globals are populated by a Storm inbound handler (`sub_7ae120`) copying the HOST's
   advertised blob, which never runs under our transport. Rather than replicate that (a pile of
   new samase symbols), **the hook body calls `storm_create_game` itself** — the exact
   create-then-overwrite pattern scope-C live-proved — then fixes up: `storm_local_player_slot` =
   roster slot, local node slot byte + name, `storm_register_slot_name` under the roster slot,
   seed the remote members (which re-registers registry entry 0 with the host's name), `*out`,
   drain, return TRUE. Each client builds its own blob from identical SB-fed inputs; nothing ever
   compares blobs across machines. The create must happen **inside the hook**, not before
   `join_lobby`: natively no session exists when BW's join flow starts, so pre-creating one risks
   already-in-session guards in the BW-level join code — at hook time the pre-hook environment is
   byte-identical to native. Stash (game name, local name, slot count, roster members with names +
   derived 12-byte net keys) is set by the v2 init path before `join_lobby`; stash absent → the
   hook calls `orig` (v1 joins unaffected).
   **Host-ness needs no care beyond host≡slot 0 (RE-verified):** the `0x48`/`0x3C` handlers apply
   only from sender slot 0, emission gates on plain lobby globals (`in_lobby_or_game`,
   `lobby_state`, the countdown counter) — no session-object owner flag anywhere, and the host
   emits fine with zero real Storm peers. The peer's own lobby authoring is a single `0x3D`
   race/team/slot record on the captured seam; the async `SNetSendMessage` path carries only
   chat/whisper/force records, so the seam misses nothing a peer authors.
5. **Delete scope-C + reinstate native.** Remove the `is_netcode_v2` direct-registration block
   (`game_state.rs:416‑562`: `setup_slots` v2 arm's storm-id path, the `register_net_player` loop,
   `ready_lobby_for_start` as-hand-driven, `create_local_storm_session`-as-peerless,
   `build_v2_joined_players`, the `SetV2JoinedPlayers` message, the `net_player_count` hook), plus
   `network_manager.rs` / `netcode/ack_manager.rs` / `netcode/storm.rs`, retired `messages.proto`
   payloads, and the app-side rp2-v1 `createRoutes`-for-v2. Reinstate the native `create_lobby`
   (guard at `game_state.rs:358`) / `join_lobby` (`:565`) calls — the `bw_scr.rs` wrappers (`3575`/`3681`)
   are unchanged and still present.
   **Settled shape (RE-informed, 2026-07-06): v1 parity, not lobby-state handoff to native.** The
   v1 path ALSO hand-drives lobby state (every client runs `setup_slots` + `ready_lobby_for_start`
   → `lobby_state=8`; SB's own countdown; host sends the `0x48` directly via `send_command` once
   the server clears start) — 2c keeps exactly that drive, with the native create/join + seeded
   session underneath. What 2c changes is the layer scope-C faked: a genuine multiplayer Storm
   session with the full membership. Supporting RE (final pass): the host NEVER spontaneously
   broadcasts slot state — per-slot `0x3E` records (`sub_7355e0`, 6 bytes from `players[]`) are
   authored only reactively when a lobby-change record is processed, and the full-state `0x16c`
   record's send queue (`data_11cc6d8`) is never written in this build (it arrives via the Storm
   join handshake we replace) — so under SB's pre-agreed arrangement no slot-broadcast machinery
   ever fires, the seam realistically carries only pacing keep-alives (not relayed) + the host's
   `0x48`, and **no new samase symbols are needed**. Two ordering requirements: for v2, native
   `create_lobby`/`join_lobby` must run AFTER `establish_session` + seam enable +
   `populate_identity_slots` (the seam must be live before any lobby traffic; identity map before
   dispatch); and **keep `set_lobby_state(4)` on all clients** — the native 4-setter is the
   lobby-entry `0x16c` receive handler, which never fires under 2c. Also delete the scope-C
   compensations native create/join now covers: `write_game_data`, `apply_game_type_template`,
   `v2_load_map`, `init_game_network`-as-hand-called, `set_local_storm_id`; and don't gate v2 load
   on `init_routes_when_ready` once the app-side v1-route provisioning dies. Native lobby_state
   ladder for reference (fully traced, unused by SB's drive): 4 ←`0x16c` entry; `0x3C`→5 + counter;
   `sub_7310a0` ticks 5→6→7 (authors the `0x48` at 7); the next `send_queued_lobby_commands` bumps
   7→8; 9 at counter zero.

**`?` command: dropped (option 1).** No `setup_team_alliances` exists in the DLL today (there never
was one — the earlier plan text was aspirational), and the RE verdict is that native alliance/vision
derive from network cmds + map forces, not the `?` command. So slices 2–4 simply never emit or apply
the `?`; the headline Team Melee acceptance test is the behavioral confirmation.

**Verification is live-loopback-gated, per the whole project's pattern** — a wrong slot/team/storm-id
or barrier synth desyncs on turn 1, caught by the relay `0x37` comparator. Build slices 3–4 behind a
live self-test run (rp2 coordinator+relay loopback per the runbook), not blind. Slices 1 (plumbing)
and the deletion sweep are compile-verifiable; the behavioral middle needs a running game.

### Open decision — the async `?` (force/alliance/vision) command
The only setup command the seam does not capture. Options, in preference order:
1. **Verify it's non-load-bearing and drop it** — its effects (alliance flags / vision / force layout)
   may be fully re-established by the slot-setup command + `init_game`'s own derivation on both sides.
   Check what it actually contributes first.
2. **Feed it locally** on each client — call native `process_async_lobby_command` / `sub_736410` with a
   locally-derived force-settings input (deterministic from the shared map + game type + team layout;
   native-processed, no wire, and *not* hand-writing the output — we provide native's input, native
   derives the tables).
3. **Hook the async path** — a second, smaller transport tap on the `SNetSendMessage`/`storm_send_to_player`
   (0x7abef0) send filtered to the `?`-class message, or feed the receive at `sub_73f490` (0x73f490),
   carried over rp2 reliable like the seam commands.

Note: the earlier interim tactical fix (writing `game+0xE4C8`=0x0E) is a *partial* substitute only —
the `?` command also does force/team layout + `lobby_state=3`, so the 4-byte write alone doesn't fully
replace it. Resolve with a focused check before committing to option 2 or 3.

**RE progress (2026-07-06, partial — BinaryNinja MCP died mid-pass and needs a restart; it stopped
responding right after a very large `get_xrefs_to` result):**
- **Premise correction:** `sub_736410` is the RECEIVE/APPLY entry, not a builder — its only caller is
  `process_async_lobby_command` (0x735C49, the `'?'`=0x3F dispatch case), and `sub_736537`'s only
  caller is `sub_736410` (tail-call). There is **no local/direct caller anywhere**, so a client
  applies the `?` effects only on receiving the Storm message — host self-application is either a
  not-yet-found builder that also applies locally, or Storm loopback. Finding the **sender** is the
  key remaining item for FEED-vs-HOOK.
- **`0x69` slot-setup does NOT overlap:** `net_cmd_lobby_slot_setup` (0x731880) writes slots,
  `rgb_colors`, skins, color-remap `game+0x1038A`, and sets `lobby_state=4` — it never touches
  `game+0xE4C8/0xE4C0/0xE4C4`. The alliance-flag bytes are established **only** by the `?` command
  (among the seam-carried commands compared so far; `0x48` overlap still unchecked).
- **Wire record → target map (verified):** record `+0x2B`→`game+0xE4C0`, `+0x2F`→`game+0xE4C4`,
  **`+0x33`→`game+0xE4C8` (alliance flags)**, `+0x37`→`sub_758160(copy)`, `+0x1F`→`data_11CC714`,
  `+0x27`→`data_11CC71C`; plus team-layout staging records (`data_11CF860`, 0x24 stride; fixed ids
  0x80–0x83) and `set_lobby_state(3)` (0x731088; `lobby_state` global = **0x11CC668**, u8).
- **Nav aid:** the game struct base is an encrypted pointer — `*(0xF333CC) ^ 0x307A98A3`.

**VERDICT (second RE pass, 2026-07-06 — the deciding decompiles are done): lean OPTION 1 (drop the
`?` command entirely), OPTION 2 as the safe fallback; option 3 (second transport tap) is ruled out.**
Evidence, per effect of the `?` command:
- **The 0xE4C0/0xE4C4/0xE4C8 writes appear DEAD for gameplay.** Every init_game delegate was
  decompiled (`sub_6C10E0` → writes only a player-id bitmask `game+0xEA`;
  `setup_players_on_game_start` 0x756120→sub_756639 → colors/race/names/slot compaction; plus
  sub_7557e0/59b6e0/6c7020/764110/6c7210/754fd0) — **no reader of `game+0xE4C8` anywhere** across
  ~20 functions in the init/lobby/alliance surface; the only writer is the `?` handler itself.
  The real alliance matrix is `game + player*0xC + 0xE544` ([12][12], row stride 0xC), written by
  **network alliance commands** (`cmd_alliance` 0x73A4C0, cmd 0x0E; vision cmd 0x0D), and the
  in-game ally dialog reads 0xE544/0xFC as the SOURCE. Forces come from `game+0xC4` (types) /
  `game+0xD0` (forces) copied from the players struct by sub_764110 — shared map/template data.
  ⚠️ **This contradicts the earlier one-function RE note** ("init_game sets alliances+vision from
  game+0xE4C8") that motivated treating `?` as load-bearing — the deeper pass supersedes it, but
  the live experiment below is the behavioral tiebreaker.
- **`set_lobby_state(3)` is droppable.** `process_start_countdown_0x3C` requires `lobby_state == 4`
  (else abort) and sets 5; slot-setup (0x731880) is what sets 4; `handle_lobby_init_0x48` requires
  `== 8` and doesn't set it. **No consumer requires state 3.** (Ladder: slot-setup→4, countdown→5,
  …→8 for 0x48; the 5→8 advancer is untraced — slices 2–3 must let native advance it.)
- **The one residual risk:** the `?` handler also rebuilds the arranged player-slot staging table
  `data_11cfa10` (raw map slots `data_11cf860` come from map load, independent). If the players-
  struct force arrangement depends on that staging table rather than slot-setup's own records,
  effect (c) is live — then use **option 2**: the record consumed is deterministic lobby/template
  state, so every client can build it locally and call `sub_736410` (no wire). Option 3 is
  unnecessary either way.
- **Settling experiment (also the plan's headline acceptance test):** run a v2 Team Melee/2v2 game
  with no `?` command — if allies can't attack each other, share vision, and the surviving teammate
  WINS on last-enemy drop, option 1 is confirmed; wrong alliances ⇒ build option 2.
- **Left unfinished (MCP crashed again — trigger this time: `get_data_decl` on 0xF5DB10):** the `?`
  SENDER was never located (only needed if option 2), and handoff-doc gaps #5 (+0x118 flag writer)
  and #6 (list-container member split) remain — see `netcode-v2-samase-lobby-analyzers.md`.

### samase prerequisites (samase_scarf — Travis's domain, prereq for the DLL slices)
Expose so the seeding + peer-join replacement resolve at runtime (no baked offsets):
- **Functions:** `storm_join_game` (0x7b0220), `sub_7ab9d0` (0x7ab9d0), `sub_7abb00` (0x7abb00),
  `sub_7ac8c0` (0x7ac8c0), `find_storm_session_player` (0x7aba90). Only if #7 → option 3:
  `process_async_lobby_command` (0x735ba0), `sub_73f490` (0x73f490). Only if wrapping join instead of
  replacing it: `sub_7ae5b0` (0x7ae5b0).
- **Globals:** `snet_player_list`/`storm_session_player_list` (`data_f5db10`/`data_f5db18`),
  `storm_local_player_slot`, `storm_turn_base`; session-player struct offsets `+0x108` key,
  `+0x118` flags, `+0x21a` slot.
- **Already resolved (reuse):** `storm_create_game`, `single_player_start`, `send_turn_message`,
  `receive_storm_turns`.

### rp2 (rally-point2) changes — the lobby reliable channel

> **Status: BUILT (2026-07-06), uncommitted in the rp2 `main` working tree; tests + clippy green.**
> Reviewed; two design deltas from the sketch below were adopted (slot stamping, replay log).

As built:
- `proto/proto/wire.proto`: `LobbyCommand { uint32 slot; bytes payload }` as `ControlFrame.kind` arm 5
  **and** `MeshControlFrame.kind` arm 5 (cross-relay games need lobby fan-out over the mesh too).
  **Delta 1 — the message carries a `slot`, not just opaque bytes:** the receiving DLL must attribute
  the bytes to the authoring member's synthesized lobby turn (peers author their own join/ready/race
  requests, not only the host). Client→relay the field is ignored (the relay stamps the authenticated
  connection's slot, same trust rule as `GameResult`); relay→client it's authoritative. Mesh copies
  are stamped by the origin relay before they leave.
- `transport/src/control.rs`: `ControlInbound::Lobby(LobbyCommand)` + reader arm + `send_control_lobby`.
- `client/src/driver.rs`: `TurnChannels.lobby_out` (`Vec<u8>` → relay) and `.lobby_in`
  (`(SlotId, Vec<u8>)` from other members); a lobby send failure is correctness-critical
  (`DriverError`, like an undeliverable oversize turn), not best-effort like `GameResult`.
- **Relay** (`relay/src/lobby.rs`, new): per-session `LobbyRegistry` — fan-out to every local member
  except the author (the author's game echoes locally) + mesh fan-out, **plus Delta 2 — a per-session
  ordered replay log**: clients dial with real skew and the host's turn barrier is satisfied by locally
  synthesized peer turns, so its lobby machine can emit `0x69`/`0x48` before a peer's link exists;
  the relay logs every delivered command (client-edge and mesh-received) and replays the log, in
  order, to any member whose control stream comes up later. Replay/live handoff is exactly-once by
  construction (snapshot + member-insert and append + fan-out share one lock). Caps: 1024 commands /
  256 KiB per session (warn once + drop past cap). Log dropped when the relay's last local member
  departs.
- E2E-tested: same-relay + cross-relay in-order delivery with slot stamping; late-dialing peer replays
  the full sequence on both relays (relay B's log fed purely by the mesh, zero local clients at send
  time); peer-authored command reaches the host with the relay-stamped (never client-asserted) slot.

**Consumer contract for slices 2–3 (the DLL):**
- The DLL must **drain `lobby_in` for the session's whole life**, discarding after `set_game_started`
  — the relay is phase-agnostic, the driver `await`s the hand-off, and a hostile client can spray
  commands mid-game up to the log cap; an undrained channel would wedge the driver.
- A mid-lobby reconnect **replays the entire log** (only the member's own authored commands are
  skipped) — re-application must be safe before lobby reconnect is ever supported (moot until D11).

**Known theoretical race (documented, not fixed):** mesh session-joins are descriptor-driven, so a
lobby command reaching a peer relay before that relay processed its session descriptor would be
dropped at mesh dispatch (debug log) and never resent — lobby commands carry no dedup identity, so
the leave machinery's idempotent reconcile-on-join can't be reused. In SB's flow descriptors are
pushed at session create and clients can't dial until the create response has propagated through
setup + game launch (seconds of margin vs milliseconds of skew). If it ever fires in practice, the
fix shape is per-origin ordinals + reconcile-on-join.

### Slice order
0. **samase** — expose the storm-session internals above *(Travis / samase_scarf; prereq for 2–3)*.
   **Handoff doc written + RE-anchored:** `docs/netcode-v2-samase-lobby-analyzers.md` (2026-07-06) —
   per-symbol anchors, the exact join-success-tail sequence, struct size 0x21c + verified field map,
   and **`sub_7ad3a0`** characterized (deferred SNET-queue drain, load-bearing → a replacement hook
   must call it → it needs an analyzer). Two small gaps remain for a short BinaryNinja session
   (the `+0x118` present-flag writer — currently NOT confirmed, don't seed it on faith — and the
   `data_f5db10`/`f5db18` list-container member split); the `?`-command verdict is tracked in the
   Open decision section above.
1. **rp2 lobby channel** — ✅ **BUILT 2026-07-06** (uncommitted in rp2 `main`; see the rp2 section
   above for the as-built shape, the two design deltas, and the DLL consumer contract).
2. **DLL host** — seed `snet_player_list` from the roster after `create_game`; extend the seam to relay
   lobby commands on the reliable channel during lobby; barrier synth.
3. **DLL peer** — replace `storm_join_game` networking with the roster-driven tail + seeding.
4. **#7** — resolve the async `?` command per the Open decision.
5. **Delete scope-C + v1 remnants** — the `is_netcode_v2` direct-registration block of `init_game`
   (`setup_slots` v2 path, `register_net_player` loop, `ready_lobby_for_start`, `setup_team_alliances`,
   `create_local_storm_session`-as-peerless, `build_v2_joined_players`, the `net_player_count` hook),
   plus `network_manager.rs` / `netcode/ack_manager.rs` / `netcode/storm.rs`, the retired
   `messages.proto` payloads, and the app-side rally-point-v1 `createRoutes`-for-v2. Reinstate the
   native `create_lobby`/`join_lobby` calls (`bw_scr.rs` wrappers, still present).
6. **Re-test the full matrix** (below).

### Acceptance / testing (loopback, per the runbook; relay `0x37` comparator quiet = sync-clean)
- **Melee 1v1 + FFA** — no regression (baseline).
- **Team Melee / Team FFA / Top-vs-Bottom** — `queryGameState` slots correct; **surviving teammate
  WINS when the last enemy drops** (`forceQuit`); no friendly-fire in TvB. *(This is the exact bug that
  motivated the pivot — it must now pass natively.)*
- **Observers** — 2p + 1 obs; observer registers, players sync to a result.
- **Solo vs computer** — loads + plays (native lobby handles the single-human case; the scope-C
  solo/comp carve-out becomes moot).
- **UMS** — ideally a real scenario map with custom forces (map-driven forces/alliances).
- **In-game handoff** — transport flips to datagrams at `set_game_started`;
  `networkStatus.transport === 'netcodeV2'`.

**UMS caveat:** only a *standard melee map played as Use Map Settings* (default forces) was verified —
sync-clean. A real UMS **scenario map** (custom forces, rescue/neutral players, non-contiguous
`player_id` slots) is **not in the dev DB** and still needs verifying. Under the native-lobby pivot,
UMS force/alliance setup would also become native (map-driven), likely closing the
`build_v2_joined_players` player_id gap too.

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
