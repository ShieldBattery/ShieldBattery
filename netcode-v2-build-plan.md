# ShieldBattery Netcode v2 — Build Plan (rev 6)

> **Purpose.** Originally the sequenced task breakdown for building netcode v2 end-to-end. The
> integration arc is **built, live-proven, landed, and thrice-reviewed** — this doc is now the plan
> for what remains: the **productionization arc** (cloud substrate, region selection, security
> hardening) plus the deferred platform/SB backlog. Done-work detail deliberately lives elsewhere:
> **design in [`rally-point2/docs/architecture.md`](../rally-point2/docs/architecture.md)**, the
> finding-level review record in rp2 commit messages, and prior revisions of this file in git
> history.
>
> **Rev history:** rev 2 (2026-06-23) six-lens adversarial review; rev 3 (2026-06-24) shared
> `transport` crate + D12; rev 4 (2026-06-28) per-slot origin seq model; rev 5 (2026-07-10)
> post-landing synthesis; **rev 6 (2026-07-11)** re-synthesis after the review passes closed —
> done-detail pruned to pointers, remaining work is the document.

---

## 0. Where it stands (2026-07-11)

**The arc landed on master 2026-07-09; v2 IS the netcode** (v1 rally-point path, Storm UDP, and
ClientReady/startWhenReady deleted, ~4000 lines; no native-transport fallback by design).
Live-proven on the loopback stack across the full acceptance matrix: every game mode (melee, FFA,
team modes, UMS, observers, solo-sessionless, replays), chat in all scopes, synced leaves +
manual-drop UX, same-relay reconnect blips, **relay-death re-home mid-game**, results → signed
webhooks → server-side scoring, and relay-side desync detection.

**Three review passes are fully closed** (rev-2 adversarial; Codex 6b over `cb63193`, fixed in
`daaef45..3185b08`; Codex 6c over `e3d539b`, fixed in `e3d539b..28765d5` — 13 commits, one per
finding, each gate-clean with revert-verified tests). Per-finding rationale lives in those commit
messages. Highlights that changed behavior contracts: the emptied-session close now defers while a
held+undecided+homed departure promises a reconnect; the client driver never blocks on embedder
channels (`GameStalled` covers wedged leave/lobby/session-start consumers; chat/connectivity drop
on full); failed/terminal connections close promptly post-classification; rustdoc is a `-D
warnings` CI gate.

Current pins: SB `rally-point-client` at `3b24dedcd3e9…` (rp2 `main` tip, pushed; the Phase 6
security arc — see below); ALPN `rp2/5` (client) / `rp2-mesh/5` (mesh — bumped by the mesh-auth
arc). Standing rules: consume rp2's re-exported quinn/rustls/proto (never
direct deps); any rp2 change = push rp2 → bump the SB `rev` pin → rebuild via `game\build.bat`;
relay stays PII-free; wire changes additive only; no drift toward a standard reliable-ordered
protocol (rationale in `architecture.md`).

**Nothing runs in the cloud yet** — Fargate, regions, prod/staging fleets, DDoS posture,
coordinator HA are all unbuilt. That is §2.

**Live loopback matrix: DONE on the region-arc pin (2026-07-11/12).** Mid-game relay kill →
re-home 2→1 with clean resume + correct win/loss (region e2e), and a same-relay ~20s
suspend/resume blip with clean recovery, comparator silent (netstat live pass — the reworked
overlay's event ticker recorded the outage itself). Both legs ran on `a351106`+.

## 1. Decisions ledger (compact)

D1 (QUIC in DLL, three-hook seam), D4 (defer spectator; in-session observers ARE built), D8
(observability: logs, desync ordinals, `/netstat`, flight recorder), D9 (relay-owned buffer
control law), D10 (validating relay, fuzzed), D11 (app-server-mediated re-home; no auto-drop —
survivor `RequestDrop` past 30s floor / 45s UI; abandoned sessions force-decide at 45s), D12
(Storm replaced wholesale; per-slot origin seq; lobby/chat/start on control frames): **built as
designed**. D2 (multi-tenant coordinator) and D5 (env-isolated fleets): **software built,
deployments not stood up**. D3 (Fargate + scale-to-zero + dual-stack) and D7 (GameLift beacon
region selection): **not started**. D6 (tokens/keys/challenge-binding): **built**, with lifecycle
leftovers in §2 Phase 6.

Leftovers extracted from "done" decisions (tracked in §2): D6 tenant enrollment/rotation +
credential consolidation + pubkey-at-queue-time; D8 durable flight-recorder sink + read path
(policy ratified: 14-day DO Spaces lifecycle, 30-day desync pin, identity-transit wording fixed);
D9 initial buffer directive at session start + rate-limited control-law logging; D3's per-game IP
rotation vs stable enroll addresses tension.

---

## 2. Remaining work (the production arc)

### Phase 4 — Region selection *(BUILT + e2e-proven 2026-07-11; design detail in this section — the
former `docs/region-selection-design.md` is deleted, full text in git history)*
- **Per-player home relays** end to end: coordinator region config (`--regions` JSON: per region an
  opaque `id`, `display_name`, GameLift-style UDP `beacon`, always-up TCP `fallback` — one registry
  so ids and measurement targets can't drift) + unauthenticated `GET /regions` (pubkey-endpoint
  precedent; SB is the only intended caller) + region-tagged relay enroll (unknown-region refusal
  close 4002) + per-slot region placement (slots sharing a region share a relay; distinct regions
  mesh; region-less/unlit degrades to the global lowest-id fallback, never rejects) +
  region-preferring rehome (rp2 `eea3776..a351106`, pushed); SB: region list distribution, app-side
  beacon measurement (UDP echo median-of-5 primary, TCP-connect fallback — fallback is
  ranking-only so TCP-vs-UDP skew is fine; total failure surfaces the manual picker), matchmaking
  `(region, rtt)` + `SB_REGION_BACKBONE_RTT_JSON` three-term latency
  (`rtt_a/2 + backbone/2 + rtt_b/2`, worst pair), lobby/queue → session-create per-slot regions,
  Server region setting (Auto default, renders its resolution; a manual pick that disappears from
  the region list is treated as Auto), `dev-beacon` loopback ping endpoints with artificial delay.
- **Live-proven on loopback**: two fake regions at 10/80ms delays → settings showed
  "Auto — Local A (11ms)" / manual pick; a cross-region lobby game homed slot 0 on relay 1 and
  slot 1 on relay 2 (meshed, production path); mid-game relay kill re-homed 2→1 with clean resume
  and a correct win/loss; the admin game page shows session id + home/rehome relay history
  (`games.netcode_v2_relays`). Dev recipe: `dev-beacon --listen 127.0.0.1:20000=10 --listen
  127.0.0.1:20010=80`, a regions JSON naming them (`local-a`/`local-b`), two relays enrolled with
  `--region` — different desired regions then produce a real meshed cross-relay session (this
  replaced the `dev_relay_split` escape hatch, deleted 2026-07-12 both repos).
- **Remaining for production regions**:
  - **Beacon coverage verification** — when the real region list exists, verify every listed AWS
    region actually has a GameLift beacon (no China; some regions may lack one) and pick each
    region's always-up TCP fallback endpoint (e.g. a regional AWS API endpoint); the config makes
    both explicit per region, so this is list-building, not code.
  - **Backbone RTT table values** — `SB_REGION_BACKBONE_RTT_JSON` (sorted-pair keys, same-region
    0) needs real numbers; an unconfigured pair defaults to a conservative 150ms, which is fine
    for match quality but now also feeds the initial-buffer hint, so it inflates cross-region
    initial buffers until set. Static config for now; could later be derived from live mesh RTTs
    (the relays measure those) — sourcing idea, not committed work.
  - **Region config deployment/admin story** — how `--regions` (and the backbone table) ship and
    change in production; Phase 5/6 territory alongside tenant enrollment.
- The v1 rally-point pipeline (service, app manager, IPC, admin UI, deps, `rally_point_servers`,
  `games.routes`, launch-arg port) is **deleted**.

### Phase 5 — AWS orchestration *(not started, two contracts pre-built)*

**Substrate decisions (ratified with Travis 2026-07-12):** coordinator runs on DigitalOcean
beside the SB app servers — docker-compose, single restart-tolerant instance (HA right-sizing
under Phase 6); tenant/region registry stays config-file, no database in v1; coordinator secrets
via `.env`; relay secrets injected by the ECS task definition from SSM Parameter Store (free
tier; not Secrets Manager); relay↔coordinator control stays public WSS guarded by the existing
bootstrap secret — no VPN/tailnet layer (Tailscale remains for box admin only); provisioning
calls use a narrowly-scoped IAM user key (RunTask/StopTask/DescribeTasks on the relay task
family) in the coordinator `.env`; relay IPs are stable for a task's lifetime and fresh per
task, advertised at enroll via ECS-metadata discovery — which settles the former
per-game-IP-rotation vs stable-enroll-address tension (no rotation machinery; DDoS baseline =
natural per-task IP churn + Shield Standard).

**Provisioning + relay-identity design (ratified with Travis 2026-07-12):** relay identity is
born at launch — the coordinator (the sole launcher of relay tasks) mints `(relay_id, one-time
enroll token, region)` at RunTask, passes them via container env overrides, and records them in
a **SQLite ledger** on the compose volume (tokens stored hashed; task ARN, cert-fingerprint
binding, lifecycle state, timestamps). Enroll, after the unchanged PoP challenge: unknown id ⇒
token required, validated + consumed, fingerprint bound; re-enroll ⇒ same fingerprint required,
no token; task end ⇒ id tombstoned, never enrollable again. Token-less Hellos are refused
whenever a provisioner is configured; dev/loopback without one keeps today's self-asserted-id
path. **This closes the offline-relay-id takeover (the Phase 6 design gate) structurally** — an
id is live, launching, or retired; the "offline but claimable" class no longer exists.
Env-override visibility (DescribeTasks / CloudTrail readers, i.e. account-internal only) is
accepted: single-use + a launch deadline + a source-IP cross-check at enroll. Addresses are
coordinator-sourced for provisioned relays via one resolution rule — `ledger.addrs.or(hello.addrs)`
— with the ledger populated from DescribeTasks → ENI → public addrs (adds
`ec2:DescribeNetworkInterfaces` to the narrow IAM policy); dev relays keep Hello self-report; no
new address wire fields.

**Warm/scale policy (same conversation):** warm signals are tenant-signed, idempotent, TTL'd
(`POST /regions/warm`), renewed by *activity* — matchmaking renews while queued; lobbies renew on
join/slot-change/countdown, debounced — so an idle-for-days lobby lapses and its relay drains.
The relay/region setting is **locked while in a gameplay activity** (matchmaking or lobby; new SB
item) so an activity's region set is fixed at join. Hold-until-ready backstop: a create naming an
unlit region ⇒ the coordinator kicks RunTask and returns an additive `provisioning` response; SB
holds the launch with visible status, capped ~60–90s (calibrate after measuring), then falls back
to the nearest lit region — **fallback ordering derived from the backbone RTT table**, not a
second config. v1 scale target is 0-or-1 relay per region but the loop is target-N from day one;
the loop is written against a `Provisioner` trait (`EcsProvisioner` + a local `ProcessProvisioner`
spawning relay binaries) so mint→launch→enroll→drain→retire, deadline sweeps, and `startedBy`
orphan reconciliation are all testable without AWS. Cold-start measurement (RunTask→enrolled
distribution, free from ledger timestamps) is an early task once one region stands — it
calibrates the hold cap. Budget guardrail: beat the old rally-point ~$70/mo (peak-hour min-1
pins in busy regions are ~$9/mo each if the cold tail annoys). **IaC = plain Terraform** (state
in S3/Spaces — it holds secrets, never git; OpenTofu is the drop-in license hedge; CDK rejected —
slow opaque deploys).

Build order: (1) ledger + token enroll (rp2); (2) provisioner trait + loop + sweeps (rp2);
(3) warm + pending-create + SB signals/hold/setting-lock; (4) Terraform + scratch image + DO
compose; then stand up one region and measure.

> **Status (2026-07-12): legs 1–3 BUILT, both repos; leg 4 remains.** rp2 local `main` (UNPUSHED,
> awaiting go-ahead) = `6766a70` ledger + one-time-token enroll (close 4005, OptionalPeerAddr,
> coordinator-sourced addr override), `090437b` Provisioner trait + reconcile loop +
> ProcessProvisioner + real-relay e2e (drain via the assignment lock + new `clear_draining`),
> `987ef0f` POST /regions/warm + hold-until-ready create (202, nothing minted while pending,
> cap→fallback), `10667a0` EcsProvisioner (early-Running at ENI-attach, expected-IP set,
> rustls+ring only, fake-tested — no live AWS). SB `d45fa72ef` (this branch) = warm signals
> (queue join + 60s renewal + lobby occupancy/countdown, 30s debounce), 202 poll loop
> (byte-identical re-signed re-POST), game-loader 90s deadline extension via new
> `common/async/extendable-deadline.ts` (the 75s base timeout equals the coordinator hold cap),
> `setLoadingStatus` event + LaunchingGameDialog status line, region-setting lock. None of the
> rp2 legs touch the client crate's API, so the eventual pin bump is routine. Leg 4 still to do,
> plus: live loopback pass of the provisioning path (ProcessProvisioner dev stack), translate-i18n
> for the two new strings, cold-start measurement to calibrate the hold cap.

- Fargate task def (dual-stack ENI, IPv4 egress for ECR pull), scratch image, scale-to-zero per
  the policy above; cold-start budget measurement.
- Pre-built on the rp2 side: **dual-stack advertise** (`relay_addrs`, `d26aaf1`) and **coordinated
  relay drain** (SIGTERM → `Draining`/`DrainAck`, 90s bound, `5d0ea11`). Remaining here: address
  discovery via ECS metadata (still explicit `--advertise-addr` flags) + SB-side per-client
  address-family selection.
- **Flight-recorder durable sink + read path** (DO Spaces, 14-day lifecycle rules) — the dev
  `--flight-dir` file sink exists; production needs the S3-compatible sink and a way to fetch
  blobs by `<tenant>/<session>/<relay_id>.json`.
- Load/scale test: N games/relay + RunTask-rate provisioning at realistic SB peak; cost model
  (NAT, cross-AZ mesh, telemetry egress).

### Phase 6 — Hardening + production rollout

**Security/tenancy blockers before anything non-loopback:**
- **Mesh `S===S` auth** *(LANDED 2026-07-12 — rp2 `main` pushed `44fc216..3b24ded`, SB pin bumped
  `7c94786ec`, DLL rebuilt, 142 DLL tests + game clippy green; two adversarial passes closed)* —
  the accept side no longer trusts the dialer's self-asserted `MeshHello.relay_id`. Shipped shape
  (no CA, no new credential kind, nothing paid): relay identity = the SHA-256 fingerprint of its
  self-generated TLS cert. Legs, each a gate-clean commit reviewed line-by-line in the main loop:
  - `2c0a310` coordinator distributes the enrolled fleet's `(relay_id, cert fingerprint)` set to
    every relay (additive `MeshPeers` control frame, republished under the registry lock on every
    membership change).
  - `50ca99f` the mesh dialer presents its serving cert as TLS client identity; the acceptor
    (request-not-require client-cert verifier) pins the presented leaf against the fleet set,
    refusing with distinct close codes (no-cert / unknown-id / fingerprint-mismatch). ALPN
    `rp2-mesh/4`→`/5`. Enforced when the fleet map is non-empty; `--require-mesh-peer-auth` fails
    closed even during the pre-first-push startup window.
  - `e2dc426` enroll now binds identity for real: a nonce proof-of-possession (relay signs
    `ENROLL_POP_CONTEXT ++ nonce` with its TLS key, coordinator verifies via rustls-webpki —
    ECDSA P-256 + Ed25519, RSA refused) closes the copy-a-public-cert hole; an **atomic**
    duplicate-id refusal (`try_enroll`, check+insert under one lock — a review fix over the
    initial check-then-insert TOCTOU) keeps one live connection per id.
  - `335065e` **mesh session-id tenant scoping (transport layer)**: `MeshPacket` carries an
    additive tenant tag and the transport `MeshLink` demuxes datagrams by `(tenant, session)`.
    **Scope correction (Codex review):** this fixed the transport datagram demux only — the
    relay's driver-level `joined` map (`relay/src/mesh.rs`) is still keyed by the bare `SessionId`
    with a fail-close guard that *refuses* a second tenant sharing a session id, rather than
    serving both. So on a shared coordinator two tenants with a colliding session id still can't
    both mesh through the same relay pair (one stalls). Fully closing it needs a tenant on every
    mesh control-stream frame + report + ack-cursor frame (they all carry a bare `session`), a
    broad wire change to lockstep-critical code — recorded as a follow-up below, not a quick fix.
    The behavior is *safe* (fail-closed refusal, never cross-wiring), and colliding μs-seeded ids
    on the one shared staging/dev fleet are rare.
  - **Adversarial-review fixes** (a dedicated opus reviewer attacked the trust boundaries; each
    finding independently verified in the main loop before fixing):
    - `99657a6` **[HIGH] version-downgrade defeated the whole enroll-binding leg.** PoP + the
      duplicate-id refusal ran only at negotiated version ≥ `ENROLL_POP_MIN` (3), but
      `MIN_SUPPORTED` was 2 and the version is self-asserted in the Hello — so a bootstrap-secret
      holder advertising a v2 window negotiated down, skipped the challenge, and hit the
      unconditional-replace `enroll` path, impersonating any relay with any cert. Fix: **PoP is
      now mandatory** — `MIN_SUPPORTED = 3` (sub-v3 refused at negotiation), the challenge +
      `try_enroll` run unconditionally, the sub-threshold enroll branch is deleted, and a
      compile-time assert (`MIN_SUPPORTED ≥ ENROLL_POP_MIN`) guards against regression.
      **RATIFIED by Travis 2026-07-12** ("backwards compatibility on this stuff does not matter at
      all right now, none of it has been deployed to anyone"). Dropping v2 relay backward-compat to
      make the security check unskippable.
    - `33ddab0` **[MEDIUM] mesh peer-auth was off by default.** `--require-mesh-peer-auth`
      defaulted false though its doc said "production sets this," leaving a coordinator-driven
      relay with an unauthenticated mesh-accept window from boot to first fleet push. Fix: a
      coordinator-driven relay (`has_coordinator`) always fails closed regardless of the flag;
      dev/static `--mesh-peer` keeps the default-off behavior.
  - **Second review pass (Codex, over `44fc216..805febf`) — triaged 2026-07-12.** No new
    high/critical; corroborated the two above (Codex reviewed pre-fix). Fixed: `f5240c1`
    **[low] token expiry failed open on a pre-epoch clock** (`unix_now` returned 0 → every real
    expiry read as future → expired tokens admitted; now `u64::MAX` = fail closed); `fcad0d2`
    **[med] enroll-handshake ordering** — a relay reconnecting with a queued notice or mid-drain
    sent that frame ahead of the PoP proof and was refused, locking it out of re-enrolling; fix
    completes the challenge (new enrollment phase, shared challenge-answer + close-classify
    helpers) before any application frame; `3b24ded` **[low] provisional-sweep race** — a
    descriptor applying as a mark expires could spuriously reap the session (self-healing); fix =
    decision-maker existence check before reaping. Dismissed as by-design:
    the provisional window pausing on a coordinator outage / restarting on reconnect (intentional —
    don't reap when descriptors can't arrive).
  - **Recorded follow-ups from the Codex pass** (real, not yet built):
    - **Tenant scoping incomplete at the relay driver layer** (the `335065e` scope correction
      above) — the `joined` map + mesh control/report/ack frames need a tenant to serve (not
      refuse) two same-id tenants on a shared coordinator. Broad wire change; safe as-is.
    - **Admit-first slot homed elsewhere isn't disconnected** — a client admitted before its
      descriptor, then homed on a *different* relay by that descriptor, keeps its connection here
      (leg D's provisional sweep only reaps sessions with *no* descriptor). Needs a per-slot
      re-check on descriptor apply. Overlaps the assigned-session-allowlist item.
    - **No revocation of established mesh links** — cert rotation or fleet removal doesn't tear
      down an already-verified mesh link (the fingerprint pin is single-shot at accept). Needs a
      re-verification / teardown-on-fleet-change path.
  - **Still open in this item:** the **coordinator-pushed assigned-session allowlist** (the
    shadow-slot amplification angle on the home-relay fail-open) was *not* built as a distinct
    mechanism — peer authentication now blocks a rogue relay from joining the mesh at all, which
    closes the fleet-amplification path; whether a per-session peer allowlist is still wanted on
    top is a Travis call (§3 folded it into this item).
- **Tenant lifecycle + per-relay identity provisioning** — enrollment, key rotation/revocation
  (active/suspended/revoked per request), staging access story; consolidate `/session/create`
  inbound auth + webhook signing into one per-tenant credential; move client pubkey submission to
  queue/lobby time (today it rides game load; no long-lived keypair without a security review —
  the queue/lobby-join requests that already carry `(region, rttMs)` are the natural vehicle: same
  surfaces, same lifetime). Registry shape decided 2026-07-12: config-file tenants (no database in
  v1) with per-tenant state + current/next keys, so rotation is a config edit and reload, not a
  schema. **Sharpened by the Codex review (the one design gap the mesh-auth arc left open):**
  enroll proof-of-possession binds a connection to *a* certificate the relay holds the key for, but
  it does **not** bind a `relay_id` to a *specific* expected identity — the coordinator accepts
  whatever `relay_id` a PoP-verified Hello claims, and the atomic duplicate-id refusal only
  protects an *already-live* id. So a bootstrap-secret holder can enroll as an **offline** relay's
  id with its own (proven) cert; the coordinator then distributes the attacker's fingerprint for
  that id and clients/peers pin it. **Design ratified 2026-07-12 — the launch-minted identity
  ledger in §Phase 5's provisioning block (in build):** relay ids are coordinator-minted per task
  with a one-time enroll token, so there is no offline-but-claimable id class at all. The
  *tenant*-credential half of this item (enrollment/rotation/consolidation, pubkey-at-queue-time)
  remains open.
- **Finite token lifetimes** *(LANDED `8f33192`)* — the `ExpiresAt(u64::MAX)` dev
  placeholder is replaced by a configurable fixed lifetime from create (`--player-token-lifetime-secs`
  / env, default 6h ≈ 2× the longest game ever observed ~3h). Tokens are checked only when
  presented — at every connect/reconnect (initial, same-relay blip, re-home) — so expiry mid-game
  is harmless while a connection lives, and a post-expiry reconnect refusal degrades to the normal
  disconnect UX (hold → RequestDrop / abandoned force-decide), never a hang. Consequence kept by
  design: never-started sessions are held ~the token lifetime before reaping, since a valid
  token means a straggler could still connect. Additive escape hatch if marathon games ever
  matter: mint fresh tokens on the rehome response (noted, not built).
- **Client admit-first admission is now bounded** *(BUILT `805febf`, unpushed)* — a session
  admitted on a valid token with no applied descriptor is provisional (10s); the relay's sweep
  tears it down if no descriptor names it in time (`PROVISIONAL_EXPIRED_CLOSE`, retryable), so a
  stale/misrouted token can no longer park a session on an arbitrary fleet relay indefinitely.
  Armed only while the coordinator control connection is up (an outage restarts every window on
  reconnect rather than reaping on time debt); dev/static `--mesh-peer` never arms.
- Confirm the untrusted-dev loopback truly never touches a shared coordinator/fleet.

**Coordinator HA** *(right-sized 2026-07-12)* — deliberately not hot-standby: a single
restart-tolerant instance (docker restart policy) on the DO box beside the app servers. Running
games survive an outage (relays run the live game); session create / re-home / presence pause
until restart, and relay re-enroll + heartbeats repopulate the registry (relay-ref webhook
precedence exists for exactly this). Hot standby + a shared registry store stay a documented
future option if scale demands it.

**Rollout story** (reshaped — the code cutover already happened): stand up prod coordinator +
fleet (D2) and shared staging fleet (D5); ship a client version that uses them (platform enforces
client-version currency, so no mixed-version games); keep the old rally-point *service* running
only until the minimum supported client is v2-only, then decommission. Rollback = previous client
version while the old service exists — that window is the safety story; define its gate
explicitly.

**Engineering follow-ups** (filed during the review passes, none blocking):
- `UnackedWindowExhausted` stays terminal by design; genuine recovery needs a trend-based
  hysteresis re-arm (trip only if the backlog grows past its level at reconnect time) — real
  design work if ever wanted.
- **Computed initial buffer at session start** — *BUILT both repos + LIVE ACCEPTANCE PASSED
  2026-07-11/12.* Cross-region loopback game (auto local-a vs manual local-b): both DLLs logged
  "session-start directive received with initial buffer depth 4 turns" (= hint 121ms → 3 + 1 hop
  cushion; slot 1's copy arrived via the mesh-peer fan-out path), /netstat ticker's FIRST event was
  the dwell step-down `4 → 3` (no upward correction, no pre-game event), steady state 2 (target 1 +
  in-game hop cushion — correct). Same-region control game: "depth 1 turns" both clients, overlay
  read `buffer 1 turns · steady since start`. The authority relay sizes an initial depth once, at the
  session-start coverage latch, and stamps it onto `SessionStart` (new optional protobuf field;
  absent → clients keep the tenant-min seed): inputs are pre-start conditions (new: a handshake
  sample at slot registration + a 500ms pre-start tick — the receive-driven sampler never fires
  pre-start since lobby traffic rides the control stream) run through the existing target formula,
  plus an SB-supplied `latency_estimate_ms` create hint (worst-pairwise one-way, ms; ms→turns
  conversion lives relay-side), plus a +1 hop cushion for multi-relay sessions. A fully-observed
  single-relay session ignores the hint (a stale estimate must not distort what the window saw);
  per-client conditions confirmed to NOT cross the mesh pre-start (they ride the forwarded-turn
  envelope only). The authority adopts the depth as its current buffer (else the first-frame
  re-affirm — which is also the old-client convergence path — would clobber it back to min); mesh
  peers adopt off the broadcast; resumed relays stamp absent so a re-push never resizes a live
  game. Landed: rp2 `263a1d6..16de546` pushed; SB Node `1234a8b98`+`268987563`+`364a2e9b0`
  (rttMs plumbing — it never reached session create before — backbone util mirroring server-rs,
  additive request field); DLL leg `077a68c32`; pin now `44fc216` (after the `dev_relay_split`
  removal).
- ~~Rate-limited control-law logging (the other D9 leftover)~~ — **already DONE** (`c1d5531`,
  `trace_control_inputs`, frame-gated at 600 turns); the earlier "leftover" note was stale.
- Live loopback matrix on the current pinned build (see §0).

### SB-side small backlog (carried from the deleted tracker)
~~Persist the rp2 session id + relay history on the game record~~ (DONE 2026-07-11: session id was
already persisted; `games.netcode_v2_relays` home/rehome events + admin game-page display landed
with Phase 4); ~~`/netstat` polish~~ (DONE 2026-07-12: reworked per `docs/netstat-design.md` —
identity header with live session/relay id, 1 Hz-sampled buffer + worst-gap strips, a recent-events
ticker, per-player create-time home relay/region column, turn-rate row gone; a TR8-feel emulation
for UMS players remains a future idea with different UI); ~~remove the lobby turn-rate setting~~,
~~USEFUL_QUERIES fix~~, ~~region-settings translations~~ (all DONE 2026-07-12);
**lock the relay/region setting while in a gameplay activity** (matchmaking or lobby — keeps an
activity's warm-signal region set fixed at join; ratified 2026-07-12, part of the provisioning
arc leg 3);
drop `netcodeV2` naming from public surfaces (surveyed: the only user-visible instance is the
admin game-page debug section title — everything else is internal identifiers + the two DLL-facing
route names; low urgency, rename needs a target-naming decision); client desync-report hook
(VOID-only);
~~relay forward-channel byte budget (oversize amplification)~~ (DONE 2026-07-12, rp2 local
`e6d126b`, unpushed: per-slot aggregate byte budget alongside the count bound, isolates via the
existing lagging-peer signal, client-edge only); ~~self-desync-void rate-limit~~ (DROPPED
2026-07-12 — an unrecognized orphan item from a prior developer; maps to no mechanism in the
relay code and Travis has no recollection of it, so it can't be scoped or actioned; git history
keeps the original wording if it ever resurfaces with context);
post-promotion desync-ordinal PK collision (authority epoch, if revisited); observer quit
classifies as drop rather than clean leave (no scoring impact); scrollable chat-history box
decision (verify SC:R's box renders in-game at all before building the battlenet Message feed);
replay-playback chat renders into `.rep` but not visibly during playback (low).

---

## 3. Settled by design — do not re-chase

Recorded so future reviews/sessions don't re-litigate (reasoning in rp2 commit messages +
`architecture.md`):
- **No auto-drop** of disconnected players; holds decided only by survivor `RequestDrop` (30s
  floor) or the 45s abandoned-session force-decide.
- **Game clients never talk to the coordinator** — re-home is app-server-mediated (results2-style
  auth), locked.
- **B1 lobby half scoped out**: lobby commands have no dedup identity, so a same-relay-resume
  replay would double-apply; the oversize-turn half is handled.
- **Unbounded coordinator-notice buffer** is a deliberate, weighed choice (delivery over memory).
- **Relay-ref webhook precedence** is by-design for restart survival; μs-seeded session ids stay
  in JS safe-int range until ~2255.
- **Home-relay fail-open for unknown sessions** (empty homed set = unenforced) preserves the
  descriptor-arrival race's admit-first behavior; the fleet-amplification angle is folded into the
  mesh-auth item above, not an A1 regression.
- **Presence fail-open** (35s TTL): locking players out on infra flap is worse than the status
  quo.
- **Never-started sessions** keep today's immediate emptied-roster close (nothing force-decides
  their holds, so deferral would be unbounded); their holds still survive and admit a quick
  re-dial.

## 4. Open questions (genuinely open)

- **Recovery-window vs downlink-coalescing byte budget** — define when implementing coalescing
  (low-stakes: the window is small and coalescing is weak-downlink-only).
- **DDoS without anycast** — baseline decided 2026-07-12: natural per-task IP churn + Shield
  Standard on raw Fargate IPs. Open half: when Shield Advanced/Spectrum becomes necessary —
  revisit if targeted attacks materialize.
- **GameLift beacon coverage** vs lit regions; rate-limit caching; which beacon-independent
  fallback (see §2 Phase 4 — the original ICMP idea assumed an in-region ping target that
  scale-to-zero doesn't guarantee).
- **Coordinator↔relay control-protocol skew** — negotiation exists (WS-K); nothing to be
  skew-compatible *with* until a second deployment exists.

---

*rev 6 synthesized 2026-07-11 after Phase 6b/6c closed: statuses verified against `rally-point2`
`28765d5` and the SB tree, not carried forward on faith. The finding-level review record (6b:
`daaef45..3185b08`; 6c: `e3d539b..28765d5`) lives in rp2 commit messages; rev 5's full text is in
this file's git history.*
