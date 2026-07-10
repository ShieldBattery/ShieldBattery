# Netcode v2 (rally-point2) — tracker

> The single tracker for the netcode-v2 arc: replacing StarCraft's Storm networking with the
> rally-point2 QUIC transport, end to end. Started life as the synced-player-leave design
> (2026-07-03), grew to cover the whole replacement, re-synthesized 2026-07-07 and again
> 2026-07-08 (this file supersedes `netcode-v2-synced-leave-design.md`). **Completed work is an
> index here** — the reasoning trail lives in the `netcode-v2-integration` memory, the commits, and
> git history of the predecessor doc. **Designs for unbuilt work live here in full.** Delete when
> the arc lands on `master`.
>
> Branches: SB `rp2-integration`, rally-point2 `main` (`../rally-point2`), consumed via a git dep
> pinned by `rev` in `game/Cargo.toml` with a temporary `[patch]` to the local path that MUST be
> removed at landing (push rp2 → bump rev → delete patch).

## Completed (index — do not re-verify, all live-proven on loopback)

- **Synced leaves + departure pipeline:** relay-decided `LeaveDirective` on the reliable control
  stream; cross-relay mesh propagation + promotion; departure classification (left/dropped) +
  Ed25519-signed coordinator→server webhooks. rp2 `5aa759f`/`139c6ad`/`f906325`/`02f1a3f`/`d432bdc`,
  SB `43d06cae8`/`ebc3dcc1e`/`d022a414b`.
- **Results through the relay + desync detection + reconciliation:** opaque `GameResult` control
  frame is a v2 game's only results path; authority relay compares `0x37` `hash16` (majority
  policy, 1v1 void); `applyDesyncPolicy` + concession-only tiebreak; comp games results-exempt +
  self-closing. rp2 `3658f32`/`60244da`/`b7947bc`/`3793aaf`, SB `fce245851`→`1df15efc3`/`c3d693dbc`/
  `57ce77ae9`.
- **Native-lobby-over-rp2 ("2c"):** native create/join + lobby-command seam over a reliable rp2
  lobby channel; roster-seeded Storm session; template + net_player_info regressions found+fixed
  live; lag-screen keep-alive collapse. SB `4735f582e`…`71580fb69`, rp2 `5fec7f4`.
- **Team alliances fix** (`setup_team_alliances` writes derived alliance/vision outputs
  post-init, team-force types only): surviving teammates WIN. SB `f475993ab`.
- **In-game chat over rp2** (`GameChat` frame; chat-box tap → relay; inbound injected as classic
  `0x5c` ⇒ replay recording free). SB `421644de5`. Empty-Enter no longer sends (SB `d76216162`).
- **v1 Storm deletion sweep** (~4000 lines) + **sessionless solo TurnState** + **replay-viewer
  storm-id fix**. SB `446016e1e`/`12589b90a`. SNP pump + `net_player_count` hook are LOAD-BEARING
  under 2c — do not re-delete.
- **Observers** (players[12..16], rp2 slots = next array positions; relay observer-set-at-maker fix
  rp2 `0023711`) and **UMS scenario maps** (placement by map slot id; native FORC alliances). SB
  `8ced9f4ea`/`cec74d376`.
- **Relay-driven start:** authority relay fires `SessionStart` when every expected slot is live
  session-wide; the entire `startWhenReady` chain is deleted. rp2 `d057552`, SB
  `4d51187e5`/`16e670c79`. Gotcha: the DLL must keep the directive receiver alive session-long.
- **D11 same-relay reconnect:** driver-owned re-dial (jittered backoff, resume cursors, dedup
  survives rebind), relay turn-ring replay, grace cancel + slot reinstatement on re-register,
  promotion skips grace-pending departures. **5-message handshake — relay + dist DLL move
  together.** rp2 `3641b3e`/`5cb22f1`/`421b382`, SB `f462c9d75`. Same-relay blip (suspend/resume)
  proven; relay-process death = the deferred failover arc (fresh certs ⇒ pinned trust refuses).
- **RequestDrop bundle (no-auto-drop policy):** indefinite relay `DropHolds` decided only by a
  survivor's `RequestDrop` past a 30 s relay floor (45 s client button unlock); 45 s
  abandoned-session force-decide; two-tier "Waiting for players" overlay (stall tier ≥3 s local,
  confirmed tier on relay signal, per-player Drop buttons); real-signal self-notice; native
  "TimeOut" dialog suppressed; window_proc input-block with WM_CHAR passthrough (chat works under
  the overlay). rp2 `a6c9300`/`cb4734a`/`18811be`/`09f18e1`, SB `3bb3c…`→`ba87d2876`, polish
  `d76216162`. **Human-verified live (2026-07-08): chat + blocked orders under the overlay,
  pause/unpause through the seam (comparator silent).**
- **Raw end-of-game results + server-side scoring:** clients report raw evidence (`version: 2`,
  players[] with raw victoryState/alliances[8]/stormId, netPlayers[] wasDropped/hasQuit,
  localPlayerLoseType; computers get rows with null userId) on both relay + results2 paths; server
  stores raw jsonb verbatim (`games_users.reported_results`, legacy = absent `version`) and derives
  verdicts at reconcile time (`server/lib/games/raw-results.ts`, faithful port of
  `determine_game_results` + 13 ported scenario tests). Stage-2 evidence rules: corroborated-victory
  veto (uncorroborated quit-Victory ⇒ Disconnected; sound because the result frame precedes the
  leave intent) + synthesized last-standing victory (linger-proof). Live-proven: melee 1v1, Team
  Melee 2v1, and BOTH one-way-ally variants (clean quit + killed process) scored correctly —
  the historical inversion was most likely the old client digest's bug; rules verified as no-ops on
  correct evidence. DLL digest remains only for the local `/game/result` app message. SB
  `e74feb535`/`d76216162`. Payload ~1.5 KB max vs the relay's 4096-byte cap (rp2 untouched).
- **Acceptance matrix: COMPLETE, all green** (melee 1v1, FFA 3p, Team Melee 2v1, Team FFA 2v1,
  TvB 2v1 incl. engine-consumption proof of vision + allied victory, solo-vs-AI sessionless,
  replay, observers, real UMS). Chat verified per game type; chat-in-replay confirmed by .rep parse.

### Standing invariants / locked decisions (also in the memory — don't re-litigate)

- Input-block = window_proc block (RE-settled; command-layer strip and native disable flags both
  proven unsafe). No auto-drop at the RELAY layer — but note BW's NATIVE sim-level stall-drop still
  fires ~45 s after link death (dialog suppressed, timer alive) and ends the game without a click;
  acceptable (games can't hang), revisit only if longer waits are wanted (separate RE to disable).
- Seam resolution is a hard launch failure; no native-transport fallback. v2 = TR24 + Low latency.
- Out-of-band data rides dedicated ControlFrame kinds, never unframed turn payloads.
- Client reports may only VOID/dispute, never claim a win; departure order arbitrates nothing.
- Security: pinned fail-closed relay TLS trust (no system roots); `Secret` redaction +
  `SENSITIVE_COMMANDS`; session/slot/tenant only from the signed token; consume rp2's re-exported
  quinn/rustls; rebuild both sides on a pin bump.
- Dev: rebuild the DLL only via `game\build.bat`; **restart the dev Node server for server code
  changes** (webpack-watch recompiles, the process keeps its old bundle); relay + dist DLL are
  handshake-paired; loopback runbook + gotchas live in the `netcode-v2-integration` memory.

## Remaining work

### Chat follow-ups

- **Send-side target scope — DONE + live-proven for everyone/allies (SB `dacea67b5`).** The MsgFltr
  radio checked-state isn't in control flags, so the scope is read from BW's `chat_box_mode` byte
  global (samase `chat_box_mode()` accessor, samase `711a5204`; scr-analysis rev bumped, resolved
  on `BwScr` warn-and-degrade like the minimap globals). `dialog_hook::chat_target_scope` maps
  2=everyone→All, 3→Allies, 5→Observers, 4→Player (target from the bw_dat-named
  `Game.chat_dialog_recipient`, BW player id → storm id → rp2 slot via the identity map, degrade to
  All on any unresolvable target). The analyzer is version-independent — resolved on the live 13515
  build (no warn). **Live-proven in a Team Melee 2v1:** send-to-everyone reached both teams;
  send-to-allies reached only the teammate, not the enemy. **Known follow-up (Team Melee only):**
  BW's "send to player" dialog addresses *teams*, not individual slots, in team-shared-control
  games, which doesn't map cleanly onto the slot-addressed transport — it reaches one team member
  or degrades to everyone. A proper fix needs RE of the team-melee recipient encoding + a
  multi-slot `ChatTarget`; niche (positional games list real players and work), deferred. Observers
  scope is coded but not separately live-exercised (receiver filter already treats an observer as
  allied with no one). Receiver-side filtering was already proven.
- **Scrollable chat-history box (open decision).** The `0x5c` path feeds the classic overlay only;
  SC:R's scrollable box is fed by `sub_682140` (opaque battlenet Message). Verify first whether
  that box even renders in-game on retail under 2c — if not, this is moot.
- **Replay-playback chat render nit.** Chat records into .rep correctly (parse-confirmed) but
  didn't visibly render during playback — likely viewer-session storm/name state. Low priority.

### Overlay UI dev mode — TIER 1 DONE (2026-07-08 late, SB `84d61fafb`); egui UPGRADED (`1551a185d`)

Built: the `game/overlay-ui` workspace crate (host-compilable, egui-only lib via a shared
`[workspace.dependencies]` egui so DLL and preview can never drift) holding the disconnect
view-model + all render fns + colors/fonts/style install; the DLL keeps only the
TurnState→view-model adaptation (its build graph is unchanged — eframe/winit gated behind the
`preview` feature, cargo-tree-verified). The `overlay-preview` eframe bin renders the same code
with emulation knobs (rows/tier/elapsed with auto-tick, unlock/requested, self-state, ppp,
optional PNG backdrop), persisted to JSON across restarts, plus a headless `--smoke` mode.

**egui upgraded 0.31 → 0.35** (Travis-prioritized): one real backend change (the font atlas is now
a color image — the D3D11 path got simpler), `run_ui`/`content_rect`/`global_style` renames, a
MouseWheel TouchPhase. Live-verified: game launches + plays on the new backend, disconnect overlay
screenshot-checked in-game (crisp Skrifa-rendered text, layout identical, comparator silent).
**Debug-screenshot note:** `__sbDebugGame.screenshot(gid)` returns `{path,width,height}` — it
writes a PNG; agents can Read it for visual verification without a human.

**Remaining tier-2 / follow-ups:**
- **Watch + auto-rebuild/relaunch — DONE (SB, `game/overlay-ui/watch-preview.mjs`, `pnpm run
  overlay-preview:watch`).** A dependency-free Node watcher (no cargo-watch/watchexec) watches
  `overlay-ui/src`, debounces saves, rebuilds `overlay-preview` (cargo run from the crate dir so it
  picks up `game/.cargo/config.toml` — i686 + crt-static), and swaps the running process on success
  (a failed build keeps the old instance up). Locates the exe from cargo's JSON artifact stream, so
  no hardcoded target path; forwards `-- <args>` to the app (e.g. `-- --backdrop shot.png`, or
  `-- --smoke` for a headless build+run loop). Verified end-to-end (initial build+launch + a
  touch-triggered incremental rebuild+relaunch). Next: optional true in-process reload via
  `hot-lib-reloader` — the pure-fn-of-plain-data factoring is exactly its shape (fn-body/style edits
  reload live; struct-layout changes need a relaunch).
- **In-game dev-only dylib hot reload** (32-bit dylib behind a dev cargo feature, watcher-swapped):
  edit overlay code, the running game picks it up next frame. Only egui UI qualifies — BW-native
  surfaces stay game-launch territory.
- **egui_mcp (dev-only):** eframe 0.35's off-by-default `inspection` feature + the new `egui_mcp`
  crate (app listens on port 5719 under `EGUI_INSPECTION=1`) would let an agent drive/inspect the
  preview app directly. Wire `eframe = { features = ["inspection"] }` into `overlay-preview` when
  agent-driven preview verification is wanted; also relevant to the game-test-harness egui hooks.
- Complements `docs/game-test-harness-design.md` (automated multi-client verification); this arc's
  view-models are what the harness's egui test-ID hooks want.

### In-game network stats overlay (`/netstat`) — BUILT (2026-07-09, SB `cff6797d4` + polish `6cefd55d9`)

Toggleable in-game diagnostic surface (chat command `/netstat`/`/netstats` in the chat-box send
tap, swallowed as a local command; also `__sbDebugGame.toggleNetStats(gameId)`). Observation-only
`TurnState` instrumentation (feeds back into nothing, sync-safe): per-slot sim-stall attribution
(episodes from the same required && queue-empty condition readiness uses), turn-arrival pacing
(age / EWMA interval / max recent gap), buffer-directive history (painter-drawn sparkline), own-link
transitions; bounded ~5-min rings. Renders via the `overlay-ui` view-model pattern (`netstat.rs` +
`build_netstat_view` adapter) — translucent top-right panel with a 1px `GREY40` border, anchored at
a 54px top offset to clear the resource counters; the `age` column shows a steady `·` until a peer
is actually stale. `queryState.turnState.netStats` exposes the snapshot for headless checks.
**Live-verified** in a 1v1 (screenshot-confirmed panel + live numbers). Tier-2 graphs (relay-pushed
mesh stats, richer plots) can iterate in the preview app later.

### Reconnect / failover — relay death — BUILT + core-live-proven (2026-07-09); FULL RE-VERIFY PENDING

Coordinator-mediated re-home + a receive-window fix that also repairs a latent same-relay-reconnect
bug. rp2 `bc27eac`/`f26535d`/`c9f08d0`/`19a364b`/`1ff722b`; SB `72d415446`/`6cefd55d9`.

**What it does.** On a relay's process death (fresh keypair ⇒ pinned trust refuses it forever), the
client driver escalates a failed reconnect to an embedder `RehomeProvider` (immediate on a TLS
pin-rejection, else after ~10 s of failures, in-game only). The DLL asks the **SB server**
(results2-style game auth: gameId + userId + resultCode; the DLL never talks to the coordinator);
the SB server makes the tenant-signed `POST /session/rehome` (`rp2-request-v1`, same as
`/session/create`) with `{tenant, session, dead_relay_id}`. The coordinator (which already tracks
relay liveness via the control-WS heartbeat) answers **stay** (named relay still enrolled AND still
serving this session), **unavailable** (nothing can take over / unknown session), or **newTarget**:
it moves the whole homed group to a replacement relay (prefers one already serving the session),
rebuilding every serving descriptor as a `resumed` one seeding the already-decided `departed_slots`
(so a fresh relay never re-fires SessionStart, never waits on departed slots, and a promotion
re-broadcasts the seeded leaves verbatim). Tokens are relay-agnostic, so the client keeps its token;
the `newTarget` relay converts through the same `relayEndpointToInfo` as session create, so the DLL
consumes a standard `NetcodeV2RelayInfo` (serverName + pinned cert included). The driver dials it
with the same identity + resume cursors; an outbound retention ring (~512 turns) re-injects on the
re-home dial so a fresh relay's empty turn ring re-fans anything a peer missed.

**Receive-window fix (the load-bearing correctness piece).** A fresh `Link` builds a from-zero
receive window every connection, so *any* resume — re-home OR same-relay — past ~4096 turns (~3 min)
was rejected out-of-window and the link fatally closed. On re-home this killed both slots' links at
the same absolute seq, so the survivor never saw the peer drop (confirmed-disconnect tier never
fired → no Drop button / timer / input block — the live symptom). Fix: the reconnecting client
anchors its own-slot receive window on the fresh relay — **oldest-unacked seq** on a same-relay dial,
**retention-ring front** on a re-home dial — and the relay bases the window there. Additive (rides
the existing resume-cursor frame; 5-msg handshake unchanged). This also repairs the shipped
same-relay reconnect, which had the same latent bug for any >3-min game.

**Hardening (adversarial-review-driven).** Driver owns the current relay id and passes it to the
provider (killed a DLL split-brain that wedged the client naming a live relay as dead); coordinator
stay-vs-recorded-rehome ordering fixed; oversize retained turns re-staged until send succeeds; SB
rehome endpoint rejects an already-reported/departed participant (no rate-limit-drain DoS on a real
survivor's failover) + integer-validates ids; DLL request timeout 12 s (covers the SB→coordinator
round trip).

**Accepted resets on re-home:** fresh comparator SyncTracker (ordinal restart), drop-hold clocks,
buffer control-law re-seed, empty lobby log (in-game scope), ephemeral chat. Coordinator-restart
amnesia → `unavailable`.

**Live status.** Core re-home LIVE-PROVEN on loopback (killed relay 1 mid-1v1 → coordinator logged
"session re-homed onto a replacement relay new_relay=2" → both clients resumed on relay 2 → 0x37
comparator silent). **Full re-verify check (a) RAN 2026-07-09 ~2:22 AM and FAILED — the window fix
in rp2 `1ff722b` is incomplete.** A 1v1 driven ~8k turns, relay 1 killed: rehome endpoint +
coordinator + resume all worked (both slots re-authorized on relay 2 within ~22 s), but 130 ms
later relay 2 fatally closed the slot-1 client's link: `payload (slot 0, seq 7559) is beyond the
receive window`. **Root cause (confirmed in source): dedup-key mismatch.** The DLL sends every
outbound turn with wire `slot: 0` (`game/src/netcode_v2/mod.rs:661`); the transport `Link` dedups
incoming payloads by that untrusted wire slot (`transport/src/link.rs:314`), but the
reconnect/re-home anchor is applied under the AUTHORIZED slot (`relay/src/routing.rs:838`). The
anchor is therefore a silent no-op for every client whose authorized slot ≠ 0 — its resumed stream
is rejected out-of-window past seq ~4096 and the link closes. Slot 0 works by key coincidence
(which is why the unit test on SlotId(0) and the short-game live proof both passed). Affects BOTH
re-home and the shipped D11 same-relay reconnect. **Fix IN FLIGHT (claimed by session 7080bf9b —
see `.claude-session-claim.md` in the rp2 checkout; do not edit rp2 concurrently):** relay
client-edge links rebind incoming payloads to the authorized ingress slot before dedup
(`Link::with_ingress_slot`, used at `relay/src/server.rs:321`); client fan-in + mesh links
unchanged. Then re-run the full matrix: (a) re-home past 4096 turns then peer force-quit →
survivor's confirmed-disconnect tier + Drop button + timer + input-block (a NON-slot-0 client is
the regression case); (b) same-relay blip in a >3-min game; (c) no-backup `unavailable` fallback;
(d) overlay border/offset/age visual. The pre-landing review findings below are queued behind this
fix (finding 1 touches the same anchor semantics: its `min(oldest_unacked, retention.front)` client
anchor composes with — and is orthogonal to — the ingress-slot rebind).

> **Coordination note (2026-07-09 ~2:40 AM):** two goal sessions ran this checklist concurrently
> and collided on the shared dev stack + Electron clients (rival coordinator/relay/Node launches at
> 2:20–2:21 died on port binds; a second lobby start at 2:22:24 tore down the first session's
> re-home test game post-failure). The live-fail evidence above predates the collision and is
> valid. Sessions MUST check for a `.claude-session-claim.md` in a checkout before writing to it,
> and should record checklist progress here.
>
> **Ledger (update in place):** finding 1 below = **FIXED, rp2 `12a8556`** (review session).
> Ingress-slot dedup fix (the live-fail root cause above) = in flight, session 7080bf9b, touching
> `transport/src/link.rs` + `relay/src/server.rs` + transport/relay tests ONLY (client/driver.rs,
> coordinator untouched). Findings 2–3 = UNCLAIMED as of 2:45 AM — review session, if you take
> them, note it here first; 7080bf9b will otherwise pick them up after the live re-verify matrix.
> **Review session (8e28c4ec) standing down (2:46 AM):** finding 1 fix is test-proven (new
> `rehome_own_slot_anchor` unit test + existing re-home/reinject tests green; patch also backed up
> to my scratchpad) — live re-gate is 7080bf9b's non-slot-0 matrix case (a). Hands-off rp2 + the
> live stack from here.
> **Finding 2 SB-side — DONE, SB `e4e281fcb` (8e28c4ec, 2:57 AM):** coalesce concurrent re-home
> asks in `NetcodeV2Service`, keyed `(session, deadRelayId)` — one in-flight coordinator call is
> shared, and the terminal `newTarget` decision is cached (size-capped, oldest-first) so staggered
> survivors are answered with no coordinator round-trip and no rate-limit token. Only `newTarget`
> cached (coordinator records it idempotently); `stay`/`unavailable` transient → always re-ask;
> rejected ask clears the in-flight slot. Unit-tested (6 cases: coalescing, newTarget-cache,
> stay/unavailable re-ask, per-dead-relay isolation, reject-then-retry); lint+typecheck clean, all
> 17 service tests green. Touched `netcode-v2-service.ts` + its test ONLY (game-api.ts untouched —
> the coalescing lives entirely in the service). **The COORDINATOR half of finding 2 (bucket
> eviction / `forget()` wiring / per-tenant cap in rp2) is STILL 7080bf9b's**; my SB coalescing
> makes the coordinator see ~1 ask per rehome event, which relieves the fan-in drop, but the bucket
> leak / enumeration surface still wants the coordinator-side fix. Finding 3 still 7080bf9b's.
> The live dev stack (coordinator 80756, relay2 72536, Node 51720, Electron 88672/66068) currently
> belongs to 7080bf9b's re-verify; do NOT relaunch services or drive the Electron clients without
> claiming them here.
>
> **7080bf9b (7:15 PM) — Codex adversarial pass over rp2 `12a8556..1516260` + SB `e4e281fcb`:
> 4 majors, all accepted, fixes in flight (rp2 + SB agents, same claims).** (i) lifecycle close
> never removes the session's descriptor from the `RelayDescriptors` outbox (`remove` is
> test-only) → a relay reconnecting post-close is re-synced the dead session and re-applies it;
> (ii) a `rehome` racing a full close can insert a recorded rehome + push descriptors AFTER close
> cleared them (resurrection window; fix = re-validate membership under the mutation lock, bail
> Unavailable); (iii) the limiter bucket map is only time-window bounded — unique-garbage-session
> spray holds O(rate×window) buckets (fix = hard cardinality cap, evict stalest); (iv) SB's cached
> `newTarget` goes stale on a chained relay death → survivors livelocked onto a dead cached relay
> (fix = DROP the answer cache, keep in-flight coalescing — the coordinator's recorded answer is
> liveness-checked + token-free since `1516260`, so the cache is strictly worse than asking).
> Clean angles: version skew both directions, multi-slot/observer/mesh keying, recorded-rehome
> fast-path liveness, anchor math incl. oversize redivert staging.
>
> **7080bf9b (6:30 PM) — LIVE MATRIX COMPLETE, all four green** on rp2 `27aecbe` (slot-stamp fix)
> + `137d34c` + `12a8556`, SB `e4e281fcb` (Node restarted on it):
> **(b) re-run PASS** — 20 s relay suspend at ~7000 turns: both clients re-registered the instant
> the relay woke, turns resumed at normal cadence (the pre-`27aecbe` run mutually deadlocked right
> here), no desync, no window errors. Post-blip clean-quit teardown reconciled unknown/unknown via
> the abandoned-session force-decide — expected under no-auto-drop for a both-sides-forceQuit end,
> not a failover defect (check (a) already proved the real drop→win path).
> **(c) PASS** — killed the only relay mid-game: both clients entered the amber "Lost connection
> to the server, reconnecting…" self-notice (screenshot-verified), DLL→SB rehome asks answered
> `unavailable` and re-asked every ~20 s indefinitely, no crash, teardown clean.
> Remaining before landing: findings 2 (coordinator half) + 3 (agent in flight, same rp2 claim),
> fresh adversarial pass, then the landing sequence.
>
> **7080bf9b (3:20 AM) — live matrix on rp2 `137d34c` (ingress-slot fix) + `12a8556`:**
> **(a) PASS** — 1v1 to ~7400 turns, relay1 killed, re-home to relay2 in ~22 s, BOTH slots resumed
> (zero window closes — the pre-fix run died 130 ms in), turns flowed 90+ s, then peer hard-killed:
> survivor confirmed tier ≤13 s, elapsed timer, Drop unlocked at exactly 45 s, overlay + dimmed
> input-block screenshot-verified, requestDrop decided instantly, DB scored win/loss (7:09 game).
> **(d) PASS** — /netstat screenshot: 1 px border, clear of resource counters, calm `·` age column,
> post-re-home it showed "down 1×" + peer stall history correctly.
> **(b) FAIL — second wire-slot-keying twin, client side.** 20 s relay suspend at ~5600 turns:
> both clients re-registered instantly on resume, links QUIC-alive, but the game mutually
> deadlocked — each side's in-flight turn stranded. Root cause: the driver stamps outbound `seq`
> but NOT `slot`, so the client's `AckManager.unacked_payloads` keys under wire slot 0 and
> `oldest_unacked_seq(own_slot)` returns None for any slot≠0 client → the same-relay anchor falls
> back to `next_outbound_seq` (one PAST the in-flight turn) → the relay (authorized-keyed since
> `137d34c`) treats the re-sent turn as already-delivered and strands it. Also breaks ack-beacon
> retirement for slot≠0 clients (relay beacons now name the authorized slot; client window keyed
> 0). Fix in flight (same rp2 claim): driver stamps `payload.slot = own_slot` at the
> seq-assignment point (before retention), making all client keys coherent. Re-home check (a)
> passed despite this because its anchor is `min(unacked, retention.front)` → falls back to
> retention.front when the unacked lookup misses — the value happens to be safe there.
>
> **7080bf9b (2:52 AM):** acknowledged — taking findings 2–3 after the live matrix. Both
> independently source-verified, two nuances for the implementation: (2) the un-evicted map is
> specifically the api-level `AppState.rehome_limiter` buckets — `RehomeLimiter::forget` is
> invoked only by its own tests, and `Lifecycle` close calls `setup.forget_rehomes()` (the rehome
> *record* map, already bounded) with no path to the limiter, so close→limiter plumbing (or
> eviction inside `check_at`) is needed; also serve the idempotent recorded-rehome answer BEFORE
> spending a limiter token, so straggler re-asks can't starve a real survivor. (3) confirmed
> as stated: lifecycle full-close (lifecycle.rs:316–324) never removes `session_relays`/
> `session_refs`, so `serving_relays()` stays non-empty forever — leak + closed-session
> re-homeability.

#### Pre-landing review findings (2026-07-09, 3× Opus adversarial pass over `bc27eac^..1ff722b` + SB `72d415446`/`6cefd55d9`; each verified against source in the main loop)

Auth verified **clean** — `verify_tenant_request` reconstructs `rp2-request-v1:<ts>:<METHOD>:<path>:<body>`
from exact wire bytes (raw body, uppercase method, path+query), constant-time ed25519, fails closed
on empty/wrong/missing sig; cross-tenant is structurally impossible (verify key looked up by body
`tenant`, session lookup keyed on same tenant). Split-game, cert-freshness/pinning, malicious-client
rehome, and manual-drop×rehome composition all reviewed **safe**. Three real defects to fix **before
landing** (none reachable by the clean 1v1 kill already live-proven, so all would pass a minimal gate
while breaking real games — fix + re-gate before cutover):

1. **[Confirmed, comparator-fatal] Re-home resume anchor strands the sub-retention window tail.**
   `client/src/driver.rs:1878-1880` anchors the re-home resume at `retention.front().seq`, but
   `ack_manager::reset_connection` (`:94`) *intentionally preserves the full unacked window* and the
   redundancy pass re-carries all of it. `UNACKED_WINDOW_CAP` (1024) = **2× `RETENTION_TURN_CAP`**
   (512), so when own-slot in-flight is 513–1024 (a relay degrading under forward-path loss *then*
   dying — the `forward_path_sustained_loss_trips_the_unacked_window_cap` regime), the oldest
   `in_flight − 512` turns are re-carried but buried below the fresh relay's anchor → never fanned to
   peers → permanent stall / 0x37 mismatch at turn 1. The same-relay path is correct (anchors at
   `oldest_unacked_seq`, covering the whole window). **Fix:** re-home anchor =
   `min(oldest_unacked_seq(own_slot), retention.front)` — never drop the tail (that breaks lockstep).
   **Not reachable on a clean instant kill** (in-flight stays small) → the live 1v1 proof did not and
   could not exercise it. Add a test: drive own-slot in-flight past 512, re-home, assert sub-front
   turns still reach the peer.
2. **[Confirmed, major] Burst-3 rehome limiter is mis-modeled for N-client fan-in.** The coordinator
   limiter (`coordinator/src/rehome.rs`) is keyed `(tenant, session)`, `REHOME_BURST=3`, refill 1/5 s,
   and `check()` runs *before* `session::rehome` so idempotent re-asks spend a token. But every game
   client independently POSTs `netcodeV2Rehome` (`server/lib/games/game-api.ts:531`) → SB forwards
   each to the coordinator under the same session id → **all N live survivors share one burst-3
   bucket** (the target only reaches a client in its *own* non-429 response; no SB-side coalescing).
   Home-relay death in a ≥5-player game 429s the tail survivors → DLL maps 5xx to `Unavailable` →
   re-escalates only every 15 s → 1–2 players stall-dropped despite a healthy replacement. The
   existing `6cefd55d9` guard only excludes *finished* players, not live survivors. **Also** (2nd
   Opus, security angle): `check_at` is `or_insert`-only with **no eviction** — the line-15 docstring
   "idle buckets pruned lazily on access" is false and `forget()` is dead code (test-only), so the
   bucket map leaks for the coordinator's lifetime and session-id enumeration by an authenticated
   tenant is an unbounded-memory + CPU (per-request ed25519) DoS. **Fix:** SB server coalesces
   concurrent per-`gameId` rehome calls into one coordinator round-trip and fans the single decision
   back out (fixes both the drop *and* the enumeration surface); wire `forget()` into `Lifecycle::remove`
   and evict idle buckets on access as documented; or, minimally, raise burst to lobby-max + add a
   per-tenant aggregate cap.
3. **[Plausible, medium] `rehome` has no terminal-state guard; `session_relays`/`session_refs` are
   never retired.** `session::rehome` decides purely from serving-set non-emptiness + registry
   liveness, and membership is inserted at `create_session` but removed nowhere (`Lifecycle::remove`
   retires only `reaps`/`forget_rehomes`). A rehome for an already-closed session can pick a target,
   re-stage a `resumed`+`mark_session_started` descriptor on a live relay, and a straggler whose token
   hasn't expired could connect to a resurrected game; also races mid-teardown. **Fix:** gate `rehome`
   on the lifecycle's live-session view and retire `session_relays`/`session_refs` on close.
   Minor/robustness (not gate-blocking): chained-relay-death strands a straggler naming the
   twice-dead original on `Unavailable` (2 deaths inside one escalation window); fallback target
   selection isn't tenant/region-aware; 5-min replay window has no nonce cache; `relay_id=0`
   `serde(default)` silently no-ops failover on a DLL/server version skew (safe degrade, but no warn).

### Post-cutover cleanup (final form — once v2 is *the* netcode)

- Drop `netcodeV2` naming from everything public; `GameSetup.useNetcodeV2` goes away.
- Submit client pubkey + region at matchmaking-search / lobby-create-join instead of game load
  (removes the load-time round-trip; late joiners submit at join). Keypair lifetime per-search /
  per-lobby is defensible (token is per-session + connection-bound); do NOT promote to a long-lived
  per-login key without a security review.
- Fold /session/create inbound auth + webhook signing into one per-tenant credential story.

### Backlog (small / deferred)

- Client desync-report hook (pure-fog gap; VOID-only, rate-limitable).
- Oversize-turn amplification: byte-budget the relay forward channel (`routing.rs`).
- Self-desync-void abuse rate-limit (currently just a WARN with participants).
- Post-promotion desync ordinal PK collision (add an authority epoch to the event identity if ever
  revisited).
- Observer quit classifies as drop, not clean leave (loop-end intent doesn't fire on the observer
  exit path; no scoring impact).
- Relay protocol hygiene: initial buffer directive at session start; rate-limited control-law
  logging.
- Pre-existing pg `DeprecationWarning` in `setReconciledResult`.
- `StormSessionPlayer` 64-bit field offsets unverified (v2 native-lobby init hard-fails cleanly on
  x86_64 until verified). `TurnStateHarness` tuple → named struct. Lobby-phase send failure could
  fail-fast the load instead of riding the 75 s timeout.

### Landing checklist

1. Human-gated checks — **done 2026-07-08** (chat under overlay, input block, pause/unpause,
   MsgFltr dump, ally-quit variants).
1b. **Address the three pre-landing failover review findings** (see failover section, 2026-07-09):
   the re-home anchor tail-strand (comparator-fatal, needs a >512-in-flight re-home test), the
   burst-3 fan-in limiter (drops tail survivors in ≥5-player games + bucket-leak DoS), and the
   missing rehome terminal-state guard. Each needs live re-gate, not a blind commit.
2. Push rally-point2 `main`; bump the `rev` in `game/Cargo.toml`; delete the `[patch]`.
3. Full loopback matrix re-run on the pinned rev (no patch).
4. Land `rp2-integration` on `master`; delete this doc (its remaining-work sections should be
   empty or moved to issues).
