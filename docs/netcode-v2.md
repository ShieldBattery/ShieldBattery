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

**Remaining tier-2 / follow-ups (not built):**
- **Watch + auto-rebuild/relaunch** the preview on save (feels like hot reload for the crate); then
  optional true in-process reload via `hot-lib-reloader` — the pure-fn-of-plain-data factoring is
  exactly its shape (fn-body/style edits reload live; struct-layout changes need a relaunch).
- **In-game dev-only dylib hot reload** (32-bit dylib behind a dev cargo feature, watcher-swapped):
  edit overlay code, the running game picks it up next frame. Only egui UI qualifies — BW-native
  surfaces stay game-launch territory.
- **egui_mcp (dev-only):** eframe 0.35's off-by-default `inspection` feature + the new `egui_mcp`
  crate (app listens on port 5719 under `EGUI_INSPECTION=1`) would let an agent drive/inspect the
  preview app directly. Wire `eframe = { features = ["inspection"] }` into `overlay-preview` when
  agent-driven preview verification is wanted; also relevant to the game-test-harness egui hooks.
- Complements `docs/game-test-harness-design.md` (automated multi-client verification); this arc's
  view-models are what the harness's egui test-ID hooks want.

### In-game network stats overlay (`/netstat` — Travis request, 2026-07-08; not built)

A toggleable in-game surface (chat command `/netstat` via `handle_chat_command`, and/or hotkey)
for diagnosing bad games live: per-slot sim-stall attribution (the IN hook knows which slots it
waited on; cumulative + recent), turn-arrival latency/jitter, packet loss / RTT / congestion
(quinn per-connection stats), buffer-size directives over time (sparkline + change markers), and
own-link state history. All sources are already in-process (`TurnState`, driver/quinn stats,
buffer directives); a relay-pushed mesh-side stats frame can come later. Keep a ring buffer of
per-slot events ("last N minutes", not lifetime aggregates); the end-of-game `network_stalls`
summary is the seed. Build ON the UI dev mode view-model pattern (graphs iterate in the preview
app) — sequence after that arc.

### Reconnect / failover — relay death (deferred D11 half) — DESIGN SETTLED 2026-07-08, building

Same-relay blips are done (see Completed). Relay-process death is distinct: a restarted relay has a
fresh keypair, and the client's pinned-leaf-cert trust (fail-closed, by design) refuses it forever —
worse, the driver classifies a pin rejection as *transient* and retries forever, so today a dead
relay shows "reconnecting…" until token expiry or BW's native ~45 s stall-drop ends the game.

**Design: coordinator-mediated re-home.** Load-bearing facts (code-verified): the coordinator
already tracks relay liveness authoritatively (persistent control WS, 10 s heartbeats, 30 s
deadline, generation-fenced registry — `coordinator/src/registry.rs`, `api.rs::push_and_watch`);
tokens are relay-agnostic (bind tenant/session/slot/pubkey/expiry only) so a re-homed client keeps
its token; `MeshControl::apply_descriptor` already spins up full session state on a relay that has
never seen the session; the driver's `LoopState` (resume cursors, dedup via `Link::rebind`,
outbound buffer) survives reconnects, so re-home rides the same resume machinery. Scope: **in-game
only** (client escalates only once the game has started; lobby-phase relay death stays a bounded
load failure). Whole-group re-home: every slot homed on the dead relay moves together.

1. **Coordinator `POST /session/rehome`** — tenant-authenticated, **app-server-mediated** (Travis,
   2026-07-09: game clients never talk to the coordinator, even for failover — the coordinator
   stays a private control-plane service with exactly two client kinds: tenant app servers and
   relays). The DLL asks the SB server (results2-style game auth: gameId + userId + resultCode);
   the SB server makes the tenant-signed `POST /session/rehome` (`rp2-request-v1` scheme, same as
   `/session/create`) with `{tenant, session, dead_relay_id}` and relays the answer. Lenient
   per-(tenant,session) rate limit coordinator-side (re-asks every ~5 s must work), plus normal SB
   throttling. Decision:
   - Named relay still live in the registry → respond `stay` (client resumes same-relay retry —
     covers "one client's network path is broken while the relay is fine"; never re-home the
     group on one client's word. Individual-slot re-home = future refinement).
   - Dead → pick R_new: prefer a live relay *already serving the session* (has mesh state, maybe
     turn history); else lowest-id live registered relay; none → `unavailable` (client falls back
     to today's terminal behavior). Mutate `session_relays` (all slots homed on the dead relay →
     R_new), rebuild + push descriptors to all serving relays, replace the dead relay *in place*
     in `authority_order`. Idempotent: concurrent requests against the same dead relay get the
     same R_new (per-session rehome generation). Respond `RelayEndpoint{relay_id, addr, cert_der}`.
2. **Descriptor additions (additive):** `resumed: bool` (R_new must skip SessionStart machinery —
   the session is in flight; prevents a never-firing start gate when departed slots will never
   dial) + `departed_slots: [(slot, kind)]` (coordinator seeds R_new's consensus with already-
   DECIDED departures from its lifecycle accounting — critical for single-relay sessions where no
   surviving mesh peer exists to replay `SlotDeparted`s; keeps promotion/comparator/expected sets
   correct). An *undecided* hold at death is lost by design: survivors re-wait the fresh 30 s
   relay floor on R_new and re-click Drop — clocks restart, correctness holds.
3. **Client driver:** escalation classification in `reconnect_link` — immediate on a TLS
   pin-rejection (fresh cert = restarted process, unambiguous), else after ~10 s of consecutive
   dial failures, and only when the game has started. Budget: ~13 s QUIC idle detect + ~10 s
   escalate + rehome round trip + dial ≈ 25 s, comfortably under BW's native ~45 s stall-drop. The
   embedder supplies a **`RehomeProvider`** async callback at driver construction; when escalation
   fires, the driver calls it and receives a new dial target (fresh `ClientEndpoint` bound to the
   new pinned cert + addr + server_name) or Stay/Unavailable. Driver resumes onto the new target
   with existing cursors. **Outbound retention ring:** keep own sent turns in a small ring
   (~512 turns / 256 KiB cap, ample — lockstep stalls within pipe-depth turns of relay death)
   independent of ack retirement; on a re-home dial (only), re-inject the ring as unacked so the
   fresh relay (empty turn ring) can fan out anything a peer never received; peer `(slot,seq)`
   dedup collapses overlaps. This closes the loss window where the dead relay acked a turn but
   never fanned it out (architecture.md's "clients are the turn log" D11 note, realized).
4. **SB plumbing:** `relayId` added to the relay info in `NetcodeV2ServerSetup`/`NetcodeV2Setup`
   (the client names which relay it believes dead, updated after a successful re-home). New SB
   games endpoint (results2-auth pattern) → `NetcodeV2Service.rehomeSession` (tenant-signed
   coordinator call); a `newTarget` relay converts through the same `relayEndpointToInfo` as
   session create, so the DLL consumes the standard `NetcodeV2RelayInfo` shape (serverName
   included — no client-side derivation). DLL `RehomeProvider` posts to the SB server with the
   same reqwest plumbing the results2 report uses. The SB↔client channel is already trusted/TLS in
   production (the relay `cert_der` rides it as a trust anchor, same as at session create).
   Overlay: existing "reconnecting…" covers re-home; terminal `unavailable` falls into the
   existing channels-closed terminal path.

Accepted resets on re-home: fresh comparator SyncTracker (ordinal restart — pre-existing desync
ordinal PK note applies), drop-hold clocks, buffer control-law re-seeds from bounds, lobby log
empty (in-game scope), chat ephemeral. Coordinator-restart amnesia (session unknown at rehome) →
`unavailable`; acceptable. Verification: dev stack with TWO relays (ids 1+2), kill relay 1
mid-game → both clients re-home to 2, game resumes, comparator silent, correct results; plus
same-relay blip regression (escalation must not fire early) and no-backup-available fallback.

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
- TS cleanup: unused `GameNetworkStatus.fallbackFrom`. Pre-existing pg `DeprecationWarning` in
  `setReconciledResult`.
- `StormSessionPlayer` 64-bit field offsets unverified (v2 native-lobby init hard-fails cleanly on
  x86_64 until verified). `TurnStateHarness` tuple → named struct. Lobby-phase send failure could
  fail-fast the load instead of riding the 75 s timeout.

### Landing checklist

1. Human-gated checks — **done 2026-07-08** (chat under overlay, input block, pause/unpause,
   MsgFltr dump, ally-quit variants).
2. Push rally-point2 `main`; bump the `rev` in `game/Cargo.toml`; delete the `[patch]`.
3. Full loopback matrix re-run on the pinned rev (no patch).
4. Land `rp2-integration` on `master`; delete this doc (its remaining-work sections should be
   empty or moved to issues).
