# ShieldBattery Netcode v2 — Build Plan (rev 8)

> **Purpose.** The plan for what remains on the road to production launch, plus the
> hardening/polish backlog. The build arc is DONE: v2 IS the netcode, the staging cloud substrate
> is live and self-scaling, and every launch-path feature (backbone RTTs, flight recorder,
> monitoring, tenant credentials, pubkey timing, prod region catalog) is built and — where staging
> allows — live-verified. Done-work detail deliberately lives elsewhere: **design in
> [`rally-point2/docs/architecture.md`](../rally-point2/docs/architecture.md)**, **ops runbooks in
> `rally-point2/infra/terraform/README.md` and `deployment/coordinator/README.md`**, the
> finding-level review record in rp2 commit messages, and prior revisions of this file in git
> history (rev 7 carries the closed launch-path items' full closure records).
>
> **Rev history:** rev 2 (2026-06-23) six-lens adversarial review; rev 3 (2026-06-24) shared
> `transport` crate + D12; rev 4 (2026-06-28) per-slot origin seq model; rev 5 (2026-07-10)
> post-landing synthesis; rev 6 (2026-07-11) re-synthesis after the review passes closed; rev 7
> (2026-07-15) launch-path regrouping after the staging standup; **rev 8 (2026-07-17)** —
> re-synthesis after launch-path items 1–5 closed; only prod standup, rollout, and the load test
> remain.

---

## 0. Where it stands (2026-07-17)

**The arc lives on the SB `rp2-integration` branch — not yet on master (an accidental early merge
there was rolled back; Travis lands master himself); v2 IS the netcode** (v1 rally-point path,
Storm UDP, and ClientReady/startWhenReady deleted; no native-transport fallback by design).
Live-proven across the full acceptance matrix on loopback AND on the staging cloud substrate;
three adversarial review passes fully closed (rev-2, Codex 6b, Codex 6c).

**Staging runs in the cloud and scales itself.** The staging coordinator
(https://staging-rp2-coordinator.shieldbattery.net, DO box, in-process ACME TLS, direct-exposed by
rule; tailnet name `staging-rp2-coordinator`) provisions Fargate relays on demand across
us-east-1/us-west-2/eu-central-1. Hands-off lifecycle proven end to end repeatedly: warm signal →
mint + RunTask → enroll 14–22s (nine cold-start datapoints) → real games over relay IPv6 → clean
lockstep or desync-void as appropriate → webhooks → scale to zero. Backbone RTTs self-measure
per-direction and serve on `GET /regions`; flight recordings land durably in Spaces
(`staging-rp2-flight`, 14d/30d prefix lifecycle) with desync pinning; client pubkeys ride
queue/lobby-join and were staging-verified through relay connection auth.

**Configuration is one-spot by design:** (1) `rally-point2/infra/terraform/region-catalog.json` —
the only region declaration (now carries the ratified 11-region prod set + per-env CIDRs; both
stacks derive from it); (2) coordinator box `config/tenants.json` + `.env` — the only place a
tenant exists (keygen.mjs one-shot mint; relays get verifying keys pushed at enroll); (3) SB app
server `.env` — the tenant's own credential + coordinator URL.

**Current pins:** SB `rally-point-client` at rp2 `f517e80` (= main tip 2026-07-17: Prometheus
metrics listener + prod region catalog); ALPN `rp2/5` / `rp2-mesh/5`. Coordinator image channel
`:stable` (manual promote workflow), relay `:latest` on staging / `:stable` on prod.

**Standing rules** (violating these has bitten before): consume rp2's re-exported
quinn/rustls/proto (never direct deps); any rp2 change = push rp2 main → bump the SB `rev` pin →
rebuild via `game\build.bat` (NEVER bare cargo build) → game tests + clippy; **coordinator deploys
before relay images**; relay stays PII-free; wire changes additive only; no drift toward a
standard reliable-ordered protocol (rationale in `architecture.md`); rp2 gates = fmt (LF),
clippy `--all-targets --workspace -- -D warnings`, `test --workspace`, rustdoc `-D warnings`.

## 1. Decisions ledger (compact)

D1 (QUIC in DLL, three-hook seam), D4 (defer spectator; in-session observers ARE built), D6
(tokens/keys/challenge-binding — launch-minted relay identity closed the offline-takeover class;
tenant credential story closed, see §3), D8 (observability: logs, desync ordinals, `/netstat`,
flight recorder + durable sink, Prometheus metrics), D9 (relay-owned buffer control law + computed
initial depth), D10 (validating relay, fuzzed), D11 (app-server-mediated re-home; no auto-drop),
D12 (Storm replaced wholesale): **built as designed**. D3 (Fargate + scale-to-zero + dual-stack)
and D7 (GameLift beacon region selection): **built AND live on staging**. D2 (multi-tenant
coordinator) / D5 (env-isolated fleets): **software built; staging live; prod not stood up.**

---

## 2. Remaining work

1. **Monitoring staging hookup** *(built + landed 2026-07-16/17 — rp2 `ce72cd9`, SB `0c6423aba`;
   hookup DEFERRED by Travis: not redeploying the monitoring VM for now).* When picked up:
   promote a coordinator image ≥ `ce72cd9` → staging box `.env`
   `COORDINATOR_METRICS_LISTEN=[::]:14911` + updated compose/serve.json → `docker compose up -d`
   → monitoring box: copy `prometheus.yml` + `grafana/dashboards/rally-point.json`, recreate the
   prometheus container → verify both targets up + the dashboard populates during a staging game.
   (Scrape config already lists both coordinator boxes; `rp2-coordinator` = the future prod box,
   a down target until it exists.)

2. **Prod standup** — prod coordinator box (same deployment dir + runbooks as staging:
   `infra/terraform/README.md`, `deployment/coordinator/README.md`) + prod fleet apply
   (`prod.tfvars`; task defs pull `:stable`, so promote a soaked relay sha first) + prod tenant
   minted via keygen. Checklist inherited from the region-catalog work:
   - **Enable the `ap-east-1` and `mx-central-1` account opt-ins BEFORE any apply** (ECR
     replication errors otherwise).
   - Verify Fargate dual-stack works in `mx-central-1` (new region).
   - The prod box's `TAILSCALE_HOSTNAME` should be `rp2-coordinator` (monitoring scrape config
     already lists it).
   - Cross-env note: the day the prod coordinator exists beside staging,
     coordinator↔relay control-protocol skew becomes real — negotiation exists; deploy-order
     covers each single deployment.

3. **Rollout execution** — ship a client version pointed at prod (platform enforces
   client-version currency, so no mixed-version games); keep the old rally-point *service*
   running only until the minimum supported client is v2-only, then decommission. Rollback =
   previous client version while the old service exists — **the rollback gate is STILL UNDEFINED
   (what signal/threshold triggers it, who calls it) — define it with Travis before shipping.**

4. **Load/scale test + cost model** at realistic SB peak: N games/relay, RunTask-rate
   provisioning, egress cost (the one usage-scaling AWS line item; idle fleet ≈ $0). Cold-start
   datapoints keep accumulating free in the ledger (nine so far, 14–22s); recalibrate the 75s
   provisioning hold cap when there's a real distribution.

### External review triage (2026-07-17, rp2 `f517e80`)

An external dev reviewed the whole rp2 repo (12 "high" + ~12 "medium" + ~7 "low"). Every finding
was re-verified against the code by four adversarial agents (facts, not the reviewer's severity);
no P0. Verdicts + categorization below; **full per-finding detail — precise rp2 file:line anchors,
failure mechanism, existing mitigations, and exact fix shape, enough to fix each without the
original review — is in [`netcode-v2-review-triage.md`](netcode-v2-review-triage.md)** (the
address-before-prod + opportunistic sets in implementable depth; backlog stays at the granularity
below). Reviewer was strong — correctly declined to flag intentional unordered-transport behavior;
several "highs" verified NARROWER than written; four were non-issues.

**Address before prod** — player-facing correctness (no attacker needed):
- **T1+T2 (+R1+R8) — the mesh-dedup seam.** Multi-relay mesh permanently dies past ~4096 turns/slot
  (redial re-opens a base-0 receive window; any seq ≥4096 rejected forever), and an oversize mesh
  turn triggers it early (delivered over the control stream, never recorded in the datagram dedup —
  the client `Link` has `deliver_external`/`anchor` for exactly this; `MeshLink` has neither). R1/R8
  share the root: `observe_turn_frame` runs BEFORE `mark_seen` dedup (unlike the desync comparator,
  deliberately after), so reflooded duplicates corrupt the leave-decision frame history (a
  frame-inflating cheater can strand survivors) and mis-stamp the hop-budget origin. ONE coherent
  fix: give `MeshLink` an anchor + `deliver_external` (or forward-collapse), and move
  `observe_turn_frame` into `deliver_turn_to_locals`. CONFIRMED. M+S.
- **R2** — a client that blips while another player's leave is decided hangs forever on reconnect;
  decided leaves are replayed to new mesh links but never to reconnecting clients. CONFIRMED. S/M.
- **C4** — draining relays count toward warm capacity but can't take placement → replacement doesn't
  launch until the old relay disconnects. CONFIRMED. S (one-line: count `!draining`).
- **C8** — every Fargate relay task leaves a permanent coordinator outbox shell; session cleanup
  scans all of them. Grows continuously under scale-to-zero. CONFIRMED. M.

**Address before prod** — cheap admission/resource bounds the direct-exposure rule calls for
(reachable by a *compromised enrolled relay* — high bar, but the coordinator is a single
direct-exposed box):
- **C2** — flight-upload takes ownership of the ≤4 MiB payload before acquiring an upload permit →
  misbehaving relay + slow S3 OOMs the box. CONFIRMED. S/M (acquire before spawn).
- **C1** — heartbeat presence isn't ownership-validated (sibling Departure/Desync/Result frames
  are); a relay can forge a victim's presence. NARROWER than stated (presence only, NOT results;
  35s-TTL self-heal). CONFIRMED. M (add the existing `relay_serves_session` check).
- **C6** — control-WebSocket keeps 64 MiB library message default; no pre-Hello socket cap; heartbeat
  vectors uncapped (RTT *store* is already bounded — that sub-claim PARTLY). CONFIRMED. M.
- **R5** — mesh accept spawns a task holding a live connection before the handshake permit;
  pre-auth reachable on a public relay. CONFIRMED. S/M (permit before spawn).
- **R6** — one peer stalling a control stream (connection still alive) freezes every session on that
  relay-pair link, unbounded memory. CONFIRMED. M (bounded writer + timeout→reset).

**Address before prod** — prod-standup footguns + CI (natural to do while standing up prod):
- **I1** — `promote-coordinator.yml` interpolates the SHA input into a `packages:write` shell job
  (injection); the sibling `promote-relay.yml` ALREADY does it safely — copy the env-var+quote+regex
  pattern. CONFIRMED. S.
- **I2** — relay promotion retags region-by-region with no all-or-nothing preflight, no `concurrency`
  group → half-promoted fleet. CONFIRMED. M.
- **C10** — flight-store misconfig detected only on first use (exactly the staging sample-bucket
  incident); add a bounded startup probe. CONFIRMED. S.
- **C7** — ECS config lacks `deny_unknown_fields` (typo'd security-group silently defaults) and a
  zero provision-interval panics the provisioning loop while the API stays healthy. Tenant-config
  half was ALREADY safe (PARTLY). CONFIRMED (the two real parts). S.

**Opportunistic** (real, cheap, narrow — pre-prod if time, else fast-follow): R3 (teardown race —
narrowed: maker survives; non-started sessions only), R4 (presence-stream-only death → stale
authority; treat reader death as link failure), R7 (relay/client equal-seq directive tiebreak
disagree — bounded QoS blip), R9 (consensus counter overflow — release wraps, but debug/tests
panic), I4-cert_der (one wrong doc line), I5-slice (`.dockerignore` + `--locked` on the Dockerfiles),
I6-terraform (a `fmt`/`validate` CI gate).

**Backlog**: C3 (per-tenant session quota — gated on UNTRUSTED multi-tenancy; a global emergency
ceiling is a cheap subset worth pulling forward), C9 (webhook per-tenant fairness — same gating),
C5 (concurrent uploads defeat desync pinning — one blob, narrow), T3-main (richer sparse reconnect
state — real design work; the "hang" is really a delayed self-healing window-close), C11/C12
(trivial, honest caller never triggers), MSRV CI leg, and the reviewer's structural takeaway (a
mesh-session transport adapter + session-lifecycle owner — the "right" long shape; the A-batch
point-fixes cover the concrete instances).

**No action**: T4 (path-MTU race — common outcome is by-design recovery, lossy outcome unreachable
at real turn sizes), I3 (dev-beacon — dev-only, in no shipped image), I4 mesh-auth/region-count half
(unsubstantiated — doc matches code), C7 tenant-entry half (already `deny_unknown_fields`).

### Hardening follow-ups (filed, non-blocking)

- **Mesh/relay follow-ups from the review passes**: driver-layer tenant scoping (the `joined`
  map + mesh control/report/ack frames carry a bare session id; a colliding session id across
  tenants is *refused*, never cross-wired — serving both needs a broad wire change);
  admit-first slot homed elsewhere isn't disconnected on descriptor apply; no revocation of
  established mesh links on fleet change (fingerprint pin is single-shot at accept); the
  per-session peer allowlist on top of mesh auth remains a Travis call.
- `UnackedWindowExhausted` stays terminal by design; genuine recovery needs trend-based
  hysteresis re-arm — real design work if ever wanted.
- rp2 accept PKCS#8 v1 signing keys (`from_pkcs8_maybe_unchecked`) — dev ergonomics; openssl and
  node both emit v1 and ring demands v2 (keygen.mjs hand-assembles v2 today).
- SB per-client address-family selection (dual-stack relays advertise both families; clients
  currently take what resolves — deliberate deferral).
- Confirm the untrusted-dev loopback truly never touches a shared coordinator/fleet.
- Loopback ProcessProvisioner pass — the ECS path is live-proven, so this is an AWS-free
  regression option, not a gate.

### SB-side small backlog

- **Localized region display names** — UNPARKED now that the prod region list exists (11 regions
  incl. kr/ca-east/sa-east/eu-north/hk/sg/au/mx). Approach decided: client-side
  `t('gameServerRegions.name.' + id, region.displayName)` with an extraction-hint file —
  coordinator config and wire stay language-free.
- **/netstat: mark departed players' rows** (the climbing `age` column is the only signal today).
- Drop `netcodeV2` naming from public surfaces (only user-visible instance is the admin game-page
  debug title; needs a target-naming decision).
- Client desync-report hook (VOID-only games).
- Post-promotion desync-ordinal PK collision (authority epoch, if revisited); observer quit
  classifies as drop rather than clean leave (no scoring impact); scrollable chat-history box
  decision (verify SC:R's box renders in-game at all first); replay-playback chat renders into
  `.rep` but not visibly during playback (low); TR8-feel emulation for UMS remains a future idea.

---

## 3. Settled by design — do not re-chase

Recorded so future reviews/sessions don't re-litigate (reasoning in rp2 commit messages +
`architecture.md`):
- **The two-directional tenant credential design is FINAL.** The tenant's request-signing key
  (SB-held private) and the coordinator's per-tenant signing key (coordinator-held private) are
  mirror images on purpose — a literal single credential would let either party forge as the
  other — and the coordinator's key also MINTS THE PLAYER TOKENS relays verify (same keypair as
  webhook signing, domain-separated). Do not re-chase a merge; "one credential" = one tenant
  identity, one keygen run, one tenants.json entry.
- **Client pubkeys are per-queue-episode, submitted at queue/lobby-join.** The app holds a
  pending keypair COPIED (never moved) onto each launched game — matchmaking requeue reuses the
  join-time pubkey with no new client request, so the private half must survive the episode;
  orphaned pending keys are deliberately never cleaned up (harmless by construction). **No
  long-lived client keypair without a security review.** A multi-human load missing a pubkey
  fails fast by design (never waits).
- **`mx` (Querétaro) ships with NO GameLift beacon, deliberately, zero code:** clients rank it by
  TCP-connect fallback; backbone mx pairs fill one-directional from mx relays' outbound sweeps
  (served value = average of present directions; coverage counts either); the formulaic dead
  hostname auto-upgrades to UDP if AWS ever ships the beacon. Invariant documented in
  `infra/terraform/README.md`.
- **Monitoring shape:** coordinator `/metrics` is plaintext on a second listener reachable ONLY
  via the box's tailscale sidecar (never published; public listener untouched); relays are never
  scrape targets (scale-to-zero) — fleet health exports coordinator-side; no alerting until prod
  baselines exist.
- **No auto-drop** of disconnected players; holds decided only by survivor `RequestDrop` (30s
  floor) or the 45s abandoned-session force-decide.
- **Game clients never talk to the coordinator** — re-home is app-server-mediated
  (results2-style auth), locked.
- **Nothing sits in front of the coordinator or the relays** — no proxy, LB, or NAT anywhere:
  the enrollment ledger gates on transport peer addresses, and the coordinator resolves relay
  addresses from the task ENI. A proxy would replace every peer with itself; re-design the gate
  before ever adding one. (This also settled ECS-metadata self-discovery: provisioned relays
  never self-advertise at all.)
- **Relay IPs are stable per task and fresh per launch** — no per-game rotation machinery; DDoS
  baseline = natural per-task churn + Shield Standard.
- **Coordinator HA is a single restart-tolerant instance** (docker restart policy) — running
  games survive an outage (relays run the live game); create/re-home/presence pause until
  restart and relays re-enroll. Hot standby stays a documented future option.
- **A 1v1 checksum divergence voids** (no-majority by construction; deliberately unattributable
  — a loss-dodger could self-desync); team games discard the diverged minority and resolve from
  the majority. `forceUnsyncedLeave` on the caller's own slot is an ordinary drop (scores
  normally); `forceDesync(gameId)` is THE desync trigger — testing tools, never a way to end a
  game that needs a scored result.
- **Presence fail-open** (35s TTL): locking players out on infra flap is worse than the status
  quo.
- **B1 lobby half scoped out**: lobby commands have no dedup identity, so a same-relay-resume
  replay would double-apply; the oversize-turn half is handled.
- **Unbounded relay-side coordinator-notice buffer** is a deliberate, weighed choice (delivery
  over memory) — the coordinator's own per-session webhook queues are bounded (128) with a
  drop counter exposed on `/metrics`; **relay-ref webhook precedence** is by-design for restart
  survival; μs-seeded session ids stay in JS safe-int range until ~2255.
- **Home-relay fail-open for unknown sessions** (empty homed set = unenforced) preserves the
  descriptor-arrival race's admit-first behavior; the fleet-amplification angle is closed by
  mesh peer auth.
- **Never-started sessions** keep the immediate emptied-roster close (nothing force-decides
  their holds, so deferral would be unbounded); their holds still survive a quick re-dial.
- **Finite player tokens** (default 6h) are checked only at (re)connect; mid-game expiry is
  harmless; never-started sessions are held ~the token lifetime before reaping. Escape hatch if
  marathon games matter: mint fresh tokens on the rehome response (noted, not built).

## 4. Open questions (genuinely open)

- **The rollout rollback gate** (§2 item 3) — the one undefined thing on the path.
- **DDoS without anycast** — baseline decided (per-task churn + Shield Standard on raw Fargate
  IPs). Open half: the trigger for Shield Advanced/Spectrum — revisit if targeted attacks
  materialize.
- **Recovery-window vs downlink-coalescing byte budget** — define when implementing coalescing
  (low-stakes: the window is small and coalescing is weak-downlink-only).

---

*rev 8 synthesized 2026-07-17 after launch-path items 1–5 closed: statuses verified against rp2
`f517e80` / SB `rp2-integration` `3c22ade35` and the live staging fleet. The items' closure
records (what shipped, verification evidence, commits) live in rev 7's text in git history and in
the rp2/SB commit messages.*
