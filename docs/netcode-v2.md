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

- **Send-side target scope (stubbed to All) — pivot to the `chat_box_mode` global.** The MsgFltr
  dump was captured live (2026-07-08): children id 1="Send to player", 2="Send to everyone",
  3="Send to allies", 4=selected player name, Accept/Cancel −2/−3 — but all three radios report
  identical control flags (0x106) across scope switches, so the checked state is not readable from
  the dialog. Read the `chat_box_mode` global instead (it selects the InGame* channel; samase
  anchor: the four "InGame*" strings referenced only by `toggle_chat_box`). BinaryNinja + samase
  analyzer task; no human run needed. Receiver-side scope filtering already works.
- **Scrollable chat-history box (open decision).** The `0x5c` path feeds the classic overlay only;
  SC:R's scrollable box is fed by `sub_682140` (opaque battlenet Message). Verify first whether
  that box even renders in-game on retail under 2c — if not, this is moot.
- **Replay-playback chat render nit.** Chat records into .rep correctly (parse-confirmed) but
  didn't visibly render during playback — likely viewer-session storm/name state. Low priority.

### Overlay UI dev mode (direction agreed 2026-07-08 — not built)

Fast visual iteration for in-game egui UI (disconnect overlay first) without launching StarCraft.
egui is renderer-agnostic; an eframe host renders identically given the same fonts + ppp.

- Extract the overlay presentation into a pure view-model + render crate (host-compilable, no BW
  types): plain data in (`peers[] {name, seconds, tier, drop_unlocked, drop_requested}`, self
  state), egui paint out. `draw_overlay/disconnect.rs` (`DisconnectView` + render fns) is already
  close to liftable; the DLL adapts its live `TurnState` into the view-model.
- Tier 1 (ship first): an eframe preview bin rendering those fns over a game-screenshot backdrop
  with a control panel to emulate states (N disconnected users, elapsed, unlock, self-disconnect),
  watch + auto-rebuild/relaunch with knobs persisted across restarts. Tier 2 (optional):
  `hot-lib-reloader` for true in-process reload; the pure-fn factoring is exactly its shape.
- In-game dev-only dylib hot reload as a follow-up (32-bit dylib behind a dev cargo feature,
  watcher-swapped). Only egui UI qualifies — BW-native surfaces stay game-launch territory.
- **egui-upgrade investigation (Travis, 2026-07-08):** newer egui has better layout tooling (the
  overlay polish fought Grid baseline quirks — bare labels only; fixed-rect/layout-wrapped labels
  break the row baseline). An upgrade risks the replay/obs UI and the loading screen — use the
  preview app to verify an upgrade across every overlay state without game launches.
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

### Reconnect / failover — relay death (deferred D11 half)

Same-relay blips are done (see Completed). Relay-process death is distinct: a restarted relay has a
fresh keypair, and the client's pinned-leaf-cert trust (fail-closed, by design) refuses it forever.
Failover = coordinator-mediated re-home: coordinator tracks relay liveness, issues fresh
certs/endpoints for a backup relay, client re-dials there and resumes via the same cursor-replay
machinery; mesh re-homes similarly. Needs coordinator relay-liveness + a client-side relay list —
a separate arc. Today a relay death = every client's self-disconnect notice + reconciliation sweep;
acceptable interim.

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
