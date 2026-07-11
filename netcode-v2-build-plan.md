# ShieldBattery Netcode v2 — Build Plan (rev 5)

> **Purpose.** Originally the sequenced task breakdown for building netcode v2 end-to-end. As of
> rev 5 the integration arc is **built, live-proven, and landed** — this doc is now (a) a status
> ledger for the original decisions and (b) the plan for what remains, which is essentially the
> **productionization arc**: cloud substrate, region selection, security hardening, and the
> platform features deferred past the loopback milestone.
>
> **Design detail lives in [`rally-point2/docs/architecture.md`](../rally-point2/docs/architecture.md)**
> (the living design doc — transport model, mesh, failover, latency buffer, coordinator, session
> lifecycle, and the "why not a standard reliable-ordered protocol" rationale). This doc
> deliberately no longer duplicates it. The original source docs are gone: the SC:R seam guide
> (`scr-netcode-replacement-guide.md`) and the integration tracker (`docs/netcode-v2.md`) were
> both deleted once embodied in code — git history has them if ever needed.
>
> **Rev history:** rev 2 (2026-06-23) six-lens adversarial review; rev 3 (2026-06-24) shared
> `transport` crate + D12; rev 4 (2026-06-28) per-slot origin seq model (client-assigned,
> preserved end-to-end); **rev 5 (2026-07-10)** post-landing synthesis — statuses below verified
> against the actual code, not assumed.

---

## 0. Where it stands (2026-07-10)

**The arc landed on master 2026-07-09.** v2 IS the netcode: the v1 rally-point path, Storm's UDP
transport, and the ClientReady/startWhenReady machinery are deleted (~4000 lines); there is no
native-transport fallback by design. SB pins `rally-point2:client` at `daaef455af21`; ALPN is
`rp2/5` (client) / `rp2-mesh/4` (mesh).

Live-proven on the loopback stack across the full acceptance matrix: every game mode (melee, FFA,
Team Melee/FFA, TvB, UMS scenarios, observers, solo-sessionless, replays), chat with all scopes
(including team-addressed chat in team-force modes), synced leaves + manual-drop UX, same-relay
reconnect blips, **relay-death re-home mid-game** (the Phase 2 "kill a relay → game survives"
milestone), results-through-relay → signed webhooks → server-side raw-results scoring, and
relay-side desync detection.

**Nothing runs in the cloud yet.** Everything below the loopback line — Fargate, regions, prod and
staging fleets, DDoS posture, coordinator HA — is unbuilt. That is the remaining plan (§3).

---

## 1. Decisions ledger

The original D1–D12, each with its verified status.

| # | Decision (abbreviated) | Status |
|---|---|---|
| **D1** | QUIC data-plane in the game DLL; sync hooks ⇄ Tokio via bounded handoff | **Built as designed.** Three-hook seam (OUT/IN/PIPE), game-thread `TurnState` ⇄ Tokio `LinkDriver`; local echo is the only self-delivery path. |
| **D2** | Standalone multi-tenant coordinator; prod isolated | **Coordinator built** (per-tenant keys/tokens/quotas basics, session lifecycle, webhooks). **Prod + staging deployments not stood up** — only dev loopback exists. |
| **D3** | Fargate + scale-to-zero + direct dual-stack IPs, no GA | **Not started.** Note an unreconciled tension for Phase 5: D3 counts per-game IP rotation as a DDoS lever, while the enroll/advertise design assumes stable per-relay addresses. |
| **D4** | Design for observation; defer spectator | **Still deferred, deliberately.** No persisted per-game turn log — failover (D11) settled on bounded per-slot rings instead, so the "replicated turn log" cost question dissolved. (In-session *observers* are built and live-proven — that's a different feature.) |
| **D5** | Env-isolated fleets; untrusted dev = fully local loopback | **Loopback path proven daily** (mini coordinator + relays, pinned dev tenant key). Shared staging fleet not stood up. |
| **D6** | Per-tenant signing keys; conn-bound tokens; app-generated session keypair; challenge-response with TLS channel binding | **Built** (RFC 5705 exporter binding, pinned relay certs, tenant-signed `rp2-request-v1` app-server API). Open: tenant enrollment/rotation lifecycle; consolidating inbound-auth + webhook signing into one per-tenant credential story; moving client pubkey submission to queue/lobby time (today it rides game load). |
| **D7** | Region via GameLift beacons + ICMP fallback | **Not started.** Region/relay choice is entirely server/coordinator-assigned. |
| **D8** | Observability first-class from day one | **Built (2026-07-10).** Structured logs, relay-side desync ordinals, the in-game `/netstat` overlay, **and now the flight recorder** (`relay/src/flight_recorder.rs`: bounded per-session event/sample rings + lock-free turn counters, versioned-blob `FlightSink`, dev `--flight-dir` file sink, flush at session-close + drain). Remaining: durable S3 sink + read path (Phase 5); retention/PII policy is a labeled PROPOSAL in `architecture.md` awaiting ratification. |
| **D9** | Latency-buffer authority = relays; coordinator sets bounds | **Built, including the control law**: raise-immediately / lower-gated-by-dwell with anti-flap hysteresis, changes scheduled at a future turn, well-tested (`relay/src/consensus.rs`). Small leftovers: initial buffer directive at session start; rate-limited control-law logging. |
| **D10** | Validating relay (slot binding, command allowlist, control-command strip) | **Built + fuzzed**: cargo-fuzz target `validate_turn` asserting binding/no-amplification/fixpoint/attribution, plus a stable-CI randomized invariant test. |
| **D11** | Relay death / failover — *was open* | **Settled + built + live-proven.** App-server-mediated re-home (game clients NEVER talk to the coordinator — locked): DLL → SB games endpoint (results2-style auth) → tenant-signed coordinator `/session/rehome` → new relay. Reconnecting clients anchor their receive window at `min(oldest-unacked, retention-front)`; the retention ring re-carries missed turns; same-relay blips use the driver's internal re-dial with resume cursors. Drop policy: **no auto-drop** — survivor-initiated `RequestDrop` past a 30 s relay floor (45 s UI unlock); fully-abandoned sessions force-decide at 45 s. |
| **D12** | Replace Storm UDP wholesale; per-slot origin seq | **Built as designed.** The "lobby may later move to a reliable side-channel" hedge happened: lobby commands ride a dedicated `LobbyCommand` control frame, chat rides `GameChat`, and the relay's `SessionStart` directive replaced the entire startWhenReady chain. |

**Also resolved since rev 4** (was §6-open): synced player-leave determinism — proven live, not
asserted (leave pass runs in the synced-RNG window; full leave/promotion matrix green including
cross-relay). Deregister-on-drop, token connection-binding, and on-demand mesh dialing were
already recorded settled; they shipped.

---

## 2. What the phases produced (compact done-record)

Phases 0–3 hit their milestones, with the transport/mesh logic proven under loopback rather than
netem-first as originally sketched:

- **Phase 0–1:** rp2 workspace (`proto`/`transport`/`client`/`relay`/`coordinator`), SHA-pinned
  git dependency from `game/`, the three-hook seam, real games over a single validating relay.
- **Phase 2:** relay mesh (one QUIC connection per pair), topological fan-out + dedup, cross-relay
  leave/promotion matrix, and — beyond the original scope caveat — the full D11 failover build.
- **Phase 3:** coordinator end-to-end from the dev app server (sessions, tokens, descriptors,
  webhooks, lifecycle + reaps), buffer control law with anti-flap.
- **Beyond the plan:** the **2c native-lobby pivot** (native BW runs the real lobby; SB replaces
  only Storm's transport + join handshake — this replaced the hand-derived lobby state that kept
  leaking), raw end-of-game results with server-side scoring, the 0x37 `hash16`-only desync
  comparator (majority-authoritative), and the in-game disconnect overlay + input-block UX.

Detail: `rally-point2/docs/architecture.md`, SB/rp2 git history.

---

## 3. Remaining work (the production arc)

### Phase 4 — Region selection *(unchanged scope, not started)*
- GameLift ping beacons (D7) + first-class ICMP fallback → cached latency map → home region;
  verify beacon coverage against lit regions; logical regions.
- Today's placeholder: app-server-supplied region.

### Phase 5 — AWS orchestration *(not started; several contract reshapes land here)*
- Fargate task def (dual-stack ENI, IPv4 egress for ECR pull), scratch image, lobby-time
  provisioning, scale-to-zero, warm-pool fallback; cold-start budget measurement.
- **Dual-stack advertise** — **BUILT (2026-07-10, rp2 `d26aaf1`).** Additive `relay_addrs` (complete
  set, preference order) on `RelayHello`/`RelayEntry`/`RelayEndpoint`/`RelayPeer`; `relay_addr` stays
  primary; `addrs()`/`addr_for_family()` selection helpers; mesh dial walks candidates. Remaining here:
  **address discovery via ECS metadata** (still explicit `--advertise-addr` flags) + SB-side per-client
  family selection.
- **Coordinated relay drain** — **BUILT (2026-07-10, rp2 `5d0ea11`).** SIGTERM/ctrl-c → `Draining`
  frame → coordinator marks ineligible + set-before-ack `DrainAck`; assignment-lock linearization
  closes the create-vs-drain race; `--drain-timeout-secs` (90 < Fargate 120s) bounds the wait,
  leftovers abandoned to failover.
- **Reconcile D3's per-game IP rotation vs stable enroll addresses** (see D1/D3 note above).
- Load/scale test: N games/relay + RunTask-rate provisioning at realistic SB peak; cost model
  (NAT, cross-AZ mesh, telemetry egress).

### Phase 6 — Hardening + production rollout *(reshaped: the code cutover already happened)*
v1 is deleted from the codebase, so the original parallel-run/cohort/rollback-to-rally-point
machinery is moot. Production rollout is now: stand up the prod coordinator + fleet (D2) and the
shared staging fleet (D5), ship a client version that uses them (the platform already enforces
client-version currency, so no mixed-version games), keep the old rally-point *service* running
only until the minimum supported client is v2-only, then decommission it. Rollback = previous
client version while the old service still exists — that window is the safety story, define its
gate explicitly.

Security/tenancy items that must land before anything non-loopback:
- **Mesh `S===S` auth** — the accept side still labels links from the dialer's *self-asserted*
  `MeshHello.relay_id` (server-TLS-only, no client auth): any peer completing the mesh ALPN can
  claim another relay's id. Bind the id to authenticated identity (mTLS/internal CA or
  coordinator-issued mesh credential) and reject unexpected/duplicate ids before link
  registration. Recent cert-pinning work covers only the dialer's trust of the acceptor.
- **Mesh session-id tenant scoping** — `MeshPacket` carries a bare `session: u64`; the driver
  fail-closed refuses cross-tenant collisions but the wire can't disambiguate. Likely folds into
  mesh auth (bind a link to its tenant). Known benign gap: `MeshControl` marks a `Join` delivered
  when enqueued, so a refused colliding `Join` isn't retried on the occupier's leave.
- **Tenant lifecycle** — enrollment, key rotation/revocation (active/suspended/revoked checked per
  request), how a developer gains/loses staging access; consolidate `/session/create` inbound auth
  + webhook signing into one per-tenant credential story.
- Confirm the untrusted-dev loopback truly never touches a shared coordinator/fleet.

Platform features — **five of six built 2026-07-10** (design/review in the main loop, implementation
delegated, each gated on `clippy -D warnings` + `cargo test --workspace`):
- **Active-player presence** — **BUILT (rp2 `2dd9e3f`).** Heartbeat carries the relay's live roster
  (idle beat byte-identical, PII-free); generation-fenced coordinator presence store; drop = prompt
  queueable signal; 35s TTL. Tenant-signed `POST /presence/query`, **fail-open** (documented rationale:
  locking players out on infra flap is worse than the status quo). Relay stays PII-free.
- **Flight recorder (D8)** — **BUILT (rp2 `c4817da`)** — see D8 ledger row. Durable S3 sink + read path
  remain (Phase 5); retention/PII PROPOSAL awaits ratification.
- **Protocol-version negotiation (WS-K)** — **BUILT (rp2 `3ce2da1`).** `RelayHello` carries a
  `[min_protocol, protocol]` window; coordinator negotiates before enroll (WS close 4001 + 60s relay
  backoff on refusal, downgrade on overlap); mesh acceptor refuses with a QUIC app-code before the driver
  spawns. Skew tests both directions.
- **End-to-end turn-delivery tracking** — **BUILT (rp2 `cb63193`).** Beacon `delivered_through` cursors
  (final-delivery truth) shared to the authority over a new mesh-control frame; per-(origin,dest) lag +
  hop fold; one clamped additive cushion into the buffer law (law untouched); surfaced via flight samples.
- **Coordinator HA** — **NOT built.** RTO, registry in a shared store, hot-standby. Running games already
  survive a coordinator outage (relays run the live game), but session *creation* and re-home don't. The
  last unbuilt platform feature; also the backstop for review finding D1/D2 (an in-memory-only coordinator
  is where the stale-serving-set and same-id-restart failover bugs live).

### Phase 6b — Pre-production hardening backlog (external review 2026-07-10)

A thorough Codex review of the rally-point2 repo, **each finding then adversarially re-verified against
HEAD (`cb63193`) in the system's own terms** (lockstep integrity > game recoverability > resource
exhaustion > hygiene). Only findings that survived verification are listed; the reviewer's stale/by-design
claims were dropped after checking (transient-empty-roster teardown already preserves the maker + undecided
holds + rebuilds the ring — the `cb4734a`-era fix holds; the unbounded coordinator-notice buffer is a
deliberate, correctly-weighed choice; relay-ref webhook precedence is by-design for restart survival;
μs-seeded session ids stay in JS safe-int range until ~2255; the leave-directive **apply-frame** is
single-sourced from the `SlotDeparted` record so its determinism holds). None of these pushes the design
toward a standard reliable-ordered protocol — they are gaps in the redundancy/reconnect model as built.

**Almost every item here is a multi-relay / failover / cloud-lifecycle path** — the loopback-proven
single-relay core is largely unaffected — so this is genuinely Phase-5/6 work, not a regression in what
landed. Ranked by tier:

> **Fix-pass status (2026-07-10 session, rp2 `daaef45..b75d756`, 6 commits, all gated on clippy
> `-D warnings` + full workspace tests):** FIXED — B8, C4 (+a third race found during implementation),
> B2, C2 (reset half), A1, A3, C6, D10, B9, B5 (transport scope). AWAITING TRAVIS — D1+D2 (design memo
> below), the NEW mesh-resume-from-cursor gap (below), flight-recorder retention PROPOSAL, landing moment.
> OPEN — the remaining resource tier (D3/D4/D7, C1/C5/C8, B1/B3/B4/B7/B12), A2, B11, B6/B10, D5/D8/D11/D13,
> A4/A5, and B5's same-shape casts in relay `consensus.rs`/`mesh.rs`.

**Lockstep-integrity (fix before multi-relay production):**
- **Home-relay binding gap (A1) — FIXED (rp2 `414b313`).** Additive `homed_slots: Vec<SlotId>` on
  `SessionDescriptor` (serde-default; EMPTY = unenforced, preserving legacy descriptors, dev harnesses, and the
  descriptor-arrival race's admit-first behavior exactly); `serve_connection` refuses a slot homed elsewhere with
  new `SLOT_NOT_HOMED_CLOSE` (0x08) before touching the roster. One correction to the sketch's premise found
  during implementation: the coordinator computed `slot_homes` at create and DISCARDED it — nothing persisted
  slot→relay granularity — so `SessionRefs` gained a `homes: BTreeMap<SlotId, RelayId>` (covers observers — they
  ride in `request.players`), reassigned dead→r_new inside `rehome_inner` before the descriptor rebuild so r_new's
  resumed descriptor gains the moved slots. No token change.
- **Control-stream death doesn't trigger reconnect (B2) — FIXED (rp2 `7156381`).** All THREE reader-disarm sites
  (client `driver.rs`, relay client-edge `routing.rs` — which also silently lost `RequestDrop` + clean-leave
  intents, degrading F10 quits into drop+holds — and mesh `mesh.rs`) now treat a control-reader end on a live
  connection as a link failure recovered by the existing reconnect machinery: client surfaces
  `ControlStreamLost` through `absorb_link_close` (clean-stop-aware) into `is_link_failure`; relay closes the
  connection with `CONTROL_STREAM_LOST_CLOSE` (0x07) so the client redials into fresh streams; mesh driver exits
  `ConnectionFailed` so the dial supervisor redials + Join-time reconcile re-syncs. Unconditional, not
  `game_started`-gated — pre-start a dead control stream stranded `SessionStart` too, and register's re-push
  covers it. Regression tests on all three edges.
- **Reconnect admission races the drop decision (C4) — FIXED (rp2 `25be7cd`).** `server.rs::serve_connection` read
  departure+hold state in two non-atomic lock takes and reused the snapshot after `register`; a `HANDSHAKE_OK`
  write failure after `release`+`reinstate_slot` erased the hold *and* the departure record with no rollback.
  Fixed as sketched, plus a third interleaving found during implementation (an old link dying mid-admission
  orphaned a hold+record against the freshly admitted player — a survivor's later `RequestDrop` would be honored
  against a connected player): the hold entry's removal is now the one claim point every racing side goes through
  (`release()` returns whether it claimed; `honor_drop_request` stands down on a lost claim; admission claims +
  reinstates atomically via `DropHolds::take_if_pending` under one holds-lock acquisition; admission mutates
  nothing until the ack is written; a dropped-reason `announce_departure` stands down under the roster lock if a
  reconnect already reclaimed the seat; the mesh `SlotConnectivity(true)` mirror claims identically). The
  abandoned force-decide keeps decide-then-release — already atomic under the decision-maker lock. Adjacent
  pre-existing race noted, NOT fixed (backlog): `end_slot_link`'s `session_emptied` snapshot can fire the
  emptied-session teardown (incl. `session_closed` to the coordinator + turn-ring drop) after a reconnect has
  re-registered.
- **Mesh forward-queue silently drops fresh turns (C2) — FIXED (rp2 `7019abd`), with a caveat that spawned the
  NEW mesh-resume finding above.** `Full` now signals the congested link's own per-link `Notify` (mirroring the
  client edge's lagging-slot precedent; healthy sibling links untouched, `Closed` silent) and the driver exits
  `ConnectionFailed` into the existing dial-supervisor redial. The fix sketch's "force resume-from-cursor"
  assumed mesh-side ring replay exists — it doesn't (see the NEW finding), so this turns an unbounded silent gap
  into a loud bounded reset but does NOT re-feed the dropped turn; marked `TODO(mesh-resume)` at the site.
  Per-session isolation on the shared pair deliberately not built (C5's rate caps address the spam vector).
- **Non-transactional transport recv (B3).** `link.rs`/`mesh_link.rs` `process_incoming` commit each payload to
  dedup then `return Err` on a later out-of-window payload in the same packet, discarding the already-accepted
  fresh ones from the return value while dedup keeps them; reconnect preserves dedup, so the resume cursor's
  replay is deduped away → silent per-slot stall. Boundary-only (needs the receiver ~4096 seqs behind), so it
  degrades an already-failing link. **Fix:** make recv transactional — return the accepted-fresh payloads even
  when a later one is out-of-window (don't hard-kill mid-packet), or two-pass window-check before committing.
- **Same-relay resume loses oversize turns + lobby commands (B1).** Oversize turns are retained *before* their
  one-time control-stream write but same-relay resume skips retention reinjection (that's re-home-only), and
  lobby commands are never retained at all. A drop in the window between the local `write_all` and the relay
  fanning out loses the frame. Narrow for oversize (rare), more reachable for pre-game lobby commands. **Fix:**
  stage the control-stream-only subset (oversize + unacked lobby) into `pending_control_redivert` on the
  same-relay path too, without re-injecting the datagram ring (which the prefix-gap concern rightly excludes).
- **Outage buffer silently drops game turns (B4).** `driver.rs` drops the oldest unsequenced turn past a 256
  cap, then assigns gapless transport seqs on resume — a semantic game turn vanishes with no gap to detect.
  Abnormal precondition (a long outage without a lockstep stall). **Fix:** surface a terminal error (like
  `UnackedWindowExhausted`) or backpressure the game thread; never silently discard a produced turn.
- **Dual-authority decision-seq collision (A2, buffer half).** During the acknowledged staggered-handoff window
  two relays can both read `Authority::SelfRelay`, both `+= 1` to the same `decision_seq`, and stamp different
  `buffer_turns`; clients keep whichever equal-seq directive arrived first (strictly-greater lets neither
  displace the other) → different buffers → divergence. Low reachability (rare window × coincident differing
  decisions). **Fix:** add a globally-ordered identity — authority epoch or relay-rank alongside `decision_seq`;
  clients break ties deterministically. (The **leave** half is already reconciled by the single-sourced
  `SlotDeparted` apply-frame; only the buffer directive needs this.)

- **NEW (found during C2, 2026-07-10): mesh links have no resume-from-cursor — any mesh link death loses
  in-flight turns permanently.** The mesh dial supervisor (`mesh_edge.rs::run_mesh_dial`) re-establishes a FRESH
  connection with fresh transport state on every redial; `turn_ring.replay()`'s only caller is the client-facing
  reconnect (`routing.rs`), and the Join-time reconcile re-syncs *leaves* only. So turns unacked at the moment a
  relay-pair link dies (QUIC blip, B2's control-death reset, C2's full-queue reset) are never re-fed — a
  permanent per-(slot,seq) gap at the peer, whose clients stall in lockstep. The loopback matrix never saw it
  because dev mesh links never blip. C2's fix sketch said "force resume-from-cursor" assuming the machinery
  existed; it does not. **Effectively a missing multi-relay feature, same blocking tier as A1 — needs Travis's
  design ratification (new additive mesh frame): on link (re)establishment each side announces per-(session,
  slot) receive cursors for shared sessions; the other side replays its turn ring past them, filtered to
  locally-homed origins (no-echo rule). Ring + replay + dedup primitives all exist; only the mesh join-time
  exchange is new.**

**Game-recoverability:**
- **Re-home leaves lifecycle serving-set stale (D1) — every failover.** `session::rehome_inner` updates
  `SessionSetup.session_relays` but never the `Lifecycle`'s cached `serving_relays`, so after a successful
  re-home `all_relays_closed()` can never be satisfied (dead relay never reports `SessionClosed`, `r_new` isn't
  in the set): the final `sessionClosed` webhook never fires, the `SessionState` + its `drain_queue` task leak,
  and the session reads `is_alive` forever (even `/sessions/alive` believes it live). Narrower premature-close
  mode if the "dead" relay was only partitioned and reconnects. **Fix:** `Lifecycle::on_rehome` that swaps
  dead→`r_new` in the cached set (called from `rehome_session` on `NewTarget`), or read the authoritative
  `setup.serving_relays()` in the accounting.
- **Same-id relay restart wedges the whole group (D2) — the sharpest.** The stay-check keys only on relay *id*:
  a relay that restarts in place (normal with pinned ids), loses its in-memory state, and re-enrolls under the
  same id with a *new* cert is still "enrolled + serving" ⇒ `Stay`. Clients pinned to the old cert can never
  complete TLS, escalate, get `Stay` again — permanent wedge for every homed client. The recorded-rehome
  ordering fix doesn't help (no re-home is ever recorded — `Stay` precedes the insert). **Fix:** record the cert
  (or enroll incarnation/generation) each session was created under; return `Stay` only if the currently-enrolled
  cert matches — a same-id re-enroll with a different cert reads as dead → `NewTarget` with the relay's new cert
  so clients re-pin (a restarted relay is a valid fresh target; clients re-inject their retention ring).

  **D1+D2 PROPOSED design (2026-07-10 session, awaiting Travis's ratification — implementation deliberately
  not started):**
  - **Key D2's stay-check on the pinned CERT (fingerprint), not the enroll `generation`.** The registry already
    mints a strictly-increasing `generation` per enroll (`registry.rs`, added for drain fencing), but it bumps on
    every benign control-WS reconnect of a healthy relay that kept its state and cert — where `Stay` is the
    *correct* answer — so generation-keying would turn every control-plane blip into a whole-group re-home. The
    cert is exactly what clients pin: cert-changed ≡ clients can never complete TLS again ≡ the wedge. (A restart
    that persisted its cert but lost session memory is also correctly `Stay`: enroll-time descriptor re-sync
    rebuilds the relay's session state and clients reconnect through the ordinary same-relay path.) Record a
    cert fingerprint (SHA-256 of DER) per session membership at create, update for `r_new` at re-home — an
    in-place extension of `session_relays` under its existing lock, no new lock-order edges, no wire change.
    Stay-check becomes: serving AND enrolled AND enrolled-cert matches recorded cert. On mismatch → dead →
    `NewTarget`, and the replacement pick must allow `r_new == dead_relay` (the restarted relay is live,
    enrolled, and a valid fresh target — clients re-pin its new cert and re-inject their retention ring).
  - **D1: `Lifecycle::on_rehome(tenant, session, dead, r_new)`** swaps dead→new in the cached `serving_relays`
    (dedup if `r_new` already present, mirroring the `session_relays` retain/replace), called from
    `rehome_session` on `NewTarget`. Same-id-new-cert re-home is an id-level no-op swap, which is correct — the
    lifecycle accounting is id-keyed and the restarted relay can still report `SessionClosed`. Rejected
    alternative: having the accounting read `setup.serving_relays()` live — it couples `Lifecycle` to
    `SessionSetup`'s locks from the notice-dispatch path (new lock-order edges through `on_session_closed`,
    which today deliberately takes its two locks non-nested).
- **Promotion ignores active drop holds (A3) — FIXED (rp2 `b75d756`).** `sync`/`sync_maker` now take the real
  held-slot set; `MeshControl` carries the per-relay `DropHolds` (`with_drop_holds`, wired in `main.rs`;
  always-empty harmless default for control planes with no turn path) and `apply_descriptor` feeds
  `pending_slots` through, mirroring the presence-driven caller. Regression tests at both maker and registry
  level.
- **Beacon reader exits on a briefly-full channel (B8) — FIXED (rp2 `d486355`).** `transport/src/beacon.rs`'s
  reader `return`ed on `TrySendError::Full`, permanently killing reverse-path retirement for the connection
  lifetime. Now drops just that frame on `Full` (cursors are per-slot monotonic and push-on-advance, so the next
  advance re-sends higher) and exits only on `Closed`; loopback-QUIC regression test added (verified to fail
  against the old behavior).
- **`UnackedWindowExhausted` still terminal (B11).** Its comment gates the resync on "the open failover design"
  — which has since landed. **Revisit:** consider routing the trip into the re-home/resync path (gated on
  `game_started`) rather than game-over, after confirming the replacement relay actually clears the backlog.

**Resource exhaustion (cloud-lifecycle; pairs with Phase 5):**
- **Webhook response body escapes timeout + is unbounded (D3).** `notify.rs` times out only response *headers*
  then `.collect()`s the body with no timeout/cap; a slow/endless endpoint hangs the session's FIFO queue
  (blocking `sessionClosed`) and can exhaust memory. **Fix:** one timeout around request+body, and a `Limited`
  body cap; treat a hit as one failed attempt.
- **Replayable create + never-started sessions never reaped (D4).** No idempotency/nonce (documented), so an
  ordinary HTTP retry inside the ±5-min window mints a duplicate session; a session whose clients never dial
  gains no accounting, so no reap ever fires — leaking `SessionState` + task + descriptors per duplicate.
  **Fix:** tenant-scoped idempotency key returning the existing response; a never-started grace-reaper.
- **Mesh recovery state unbounded (C1).** The mesh `AckManager` has neither the ack-beacon (`retire_through`
  has no relay-side callers) nor an `UNACKED_WINDOW_CAP` trip — only a flush gate. Sustained mesh reverse-path
  loss grows memory + redundancy work. Trusted links ⇒ MEDIUM. **Fix:** a mesh ack-beacon and/or a mesh
  window cap that resets the link.
- **Lobby caps don't protect the mesh (C5).** Past the local lobby-log cap, `routing.rs` still fans every lobby
  command into the *unbounded* mesh control channel (no rate cap, unlike chat), growing memory and head-of-line-
  delaying `SlotDeparted`/`LeaveDirective` behind the spam. **Fix:** `lobby::deliver` returns admit/refuse; fan
  out to the mesh only on admit; and/or a per-slot lobby rate cap like `chat::admit`.
- **Unbounded webhook queues + no global dispatch concurrency (D7).** One detached `drain_queue` task per
  `SessionState`, each an unbounded channel, no fleet-wide semaphore — compounds D3/D4. **Fix:** bound the
  per-session queue and gate dispatch behind a global `Semaphore`.
- **Mesh handshake bypasses the admission semaphore (C8).** The permit drops before the ~5s mesh identity/control
  setup, and `run_mesh_accept` spawns uncapped; with no mesh auth today an attacker on `MESH_ALPN` can hold open
  arbitrarily many stalled mesh handshakes. Folds into the mesh-auth work. **Fix:** hold the permit across the
  mesh hello/control setup, or a dedicated mesh-accept semaphore.
- **Client-supplied receive-window anchor overflow (B7).** An unclamped resume anchor of `u64::MAX` + a turn at
  `seq=u64::MAX` overflows the dedup prefix fold (debug panic / release wrap). Task-isolated to the attacker's own
  slot-link, so contained. **Fix:** clamp/reject the anchor against a sane ceiling, or `checked`/`saturating`
  prefix arithmetic.
- **Shutdown leaves reader tasks holding the connection (B12).** Detached control/beacon reader tasks keep a
  `connection.clone()` parked on `accept_*`, so a clean driver exit doesn't free the QUIC connection / relay slot
  until the idle timeout (backstopped by coordinator reaps). **Fix:** `connection.close()` on the clean-exit paths
  (wakes the readers), or retain + `abort()` the reader handles.
- **Mesh session dedup never removed (C6) — FIXED (rp2 `b75d756`).** `deregister_seen` now runs in
  `end_slot_link`'s session-emptied teardown alongside lobby/chat/turn-ring (chosen over the sketch's
  `MeshControl::end_session` — the per-relay last-local-slot teardown is the pairing point and closes the leak
  window sooner; a reconnect recreating an empty seen set at worst re-forwards once, which client dedup absorbs).

**Hygiene / defense-in-depth (cheap, do opportunistically):**
- Leave-directive conflict handling: the relay forwards a consensus-rejected conflicting directive to clients
  anyway (A4, ignores `observe_leave`'s `#[must_use]`), and the client's conflict check is `debug_assert!`
  (A5) — release builds silently accept the first with no signal. Convergent by the single-sourcing contract,
  but **A5 should become a runtime guard that logs/reports** (never re-opens the slot) so a contract violation
  is observable in production.
- `BufferBounds` inverted-bounds panic (D10) — **FIXED (rp2 `b75d756`)**: `clamp` normalizes `min>max`
  internally (chosen over `#[serde(try_from)]` — no shadow-type precedent in the codebase).
- Session-request validation gaps (D5): duplicate slots, oversized `external_id`/`external_ref`, oversized
  `dev_relay_split`. Tenant is authenticated ⇒ low, but cheap to reject.
- Transport `u32 as u8` slot narrowing (B5) — **FIXED (rp2 `b75d756`)** in the transport crate
  (`link.rs`/`mesh_link.rs` ingress refuses a non-`SlotId`-sized wire slot as a `MalformedSlot` link failure
  instead of a truncating cast; driver's datagram failure mode moves from silent drop to reconnect).
  Same-shape casts in `relay/src/consensus.rs` and `relay/src/mesh.rs` flagged as follow-up (outside the
  transport scope). Still open in this cluster: redundancy refill scans low-slot-first (B6, bounded by tiny
  turn sizes → order by `send_count`); mesh-conditions sizing under-counts the protobuf field framing with an
  incorrect comment (B10, absorbed by `MESH_PACKET_OVERHEAD` slack today). `proto/src/beacon.rs::decode_frame`
  short-input panic (B9) — **FIXED (rp2 `b75d756`)**: honest `DecodeFrameError::BadLength`.
- Orphan desync notices leak a dedup entry (D8, insert-before-dispatch with no prunable state). Golden
  byte-vector test for the signed-token wire format is missing (D11, round-trip-only tests would let a symmetric
  encoder/decoder change silently break deployed tokens). API player tokens use `ExpiresAt(u64::MAX)` (D6,
  acknowledged dev placeholder — production must set a finite lifetime).
- **Stale public docs (D13).** `README.md` still lists an unbuilt "replicated turn log"; `client/src/lib.rs`
  describes failover as open (it landed); `relay/src/lib.rs` describes the coordinator connection as *polling*
  (it's a held WS push) and the consensus layers as unbuilt (authority handoff, desync, synced leaves, delivery
  tracking, flight recorder all landed). Refresh to match HEAD. (The flight-recorder claims are now *correct* —
  it was built 2026-07-10.)

### SB-side small backlog (carried from the deleted tracker)
Drop `netcodeV2` naming from public surfaces; submit client pubkey + region at
matchmaking/lobby time instead of game load (no long-lived keypair without a security review);
client desync-report hook (VOID-only); relay forward-channel byte budget (oversize amplification);
self-desync-void rate-limit; post-promotion desync-ordinal PK collision (authority epoch, if
revisited); observer quit classifies as drop rather than clean leave (no scoring impact); initial
buffer directive at session start + rate-limited control-law logging; scrollable chat-history box
decision (verify SC:R's box renders in-game at all before building the battlenet Message feed);
replay-playback chat renders into `.rep` but not visibly during playback (low).

---

## 4. Open questions (pruned to the genuinely open)

- **Recovery-window vs downlink-coalescing byte budget** — define when implementing coalescing
  (low-stakes: the window is small and coalescing is weak-downlink-only).
- **DDoS without anycast** — validate Shield Standard on raw Fargate IPs; when is Shield
  Advanced/Spectrum required (likely near-term); interacts with the IP-rotation question (§3 P5).
- **GameLift beacon coverage** vs lit regions; rate-limit caching; ICMP-fallback parity.
- **Coordinator↔relay control-protocol skew** — see negotiation item in §3 P6; nothing to be
  skew-compatible *with* until a second deployment exists.
- **Presence details** — TTL multiple, fail-open vs fail-closed (§3).
- **Flight-recorder retention/PII policy** for `session↔user` (§3).

Everything else from the old §6 is either settled (recorded in §1) or absorbed into §3 as
concrete work items.

---

*rev 5 synthesized 2026-07-10: statuses verified against `rally-point2` and `shieldbattery`
source, not carried forward on faith. rev 2's adversarial-review findings and rev 3/4's transport
decisions remain load-bearing and live on in `rally-point2/docs/architecture.md`.*
