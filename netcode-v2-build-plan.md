# ShieldBattery Netcode v2 — Build Plan (rev 7)

> **Purpose.** Originally the sequenced task breakdown for building netcode v2 end-to-end. The
> integration arc landed long ago (v2 IS the netcode) and, as of 2026-07-15, **the staging cloud
> substrate is live and the full relay lifecycle is proven with a real game** — this doc is now
> the plan for what remains: **the road to production launch** plus the hardening/polish backlog.
> Done-work detail deliberately lives elsewhere: **design in
> [`rally-point2/docs/architecture.md`](../rally-point2/docs/architecture.md)**, **ops runbooks in
> `rally-point2/infra/terraform/README.md` and `deployment/coordinator/README.md`**, the
> finding-level review record in rp2 commit messages, and prior revisions of this file in git
> history.
>
> **Rev history:** rev 2 (2026-06-23) six-lens adversarial review; rev 3 (2026-06-24) shared
> `transport` crate + D12; rev 4 (2026-06-28) per-slot origin seq model; rev 5 (2026-07-10)
> post-landing synthesis; rev 6 (2026-07-11) re-synthesis after the review passes closed;
> **rev 7 (2026-07-15)** re-synthesis after the staging standup — the provisioning/config arcs'
> build detail pruned to pointers, remaining work regrouped as a launch path.

---

## 0. Where it stands (2026-07-15)

**The arc landed on master 2026-07-09; v2 IS the netcode** (v1 rally-point path, Storm UDP, and
ClientReady/startWhenReady deleted, ~4000 lines; no native-transport fallback by design).
Live-proven on loopback across the full acceptance matrix (every game mode, chat, synced leaves,
manual-drop UX, reconnect blips, mid-game relay-death re-home, results → signed webhooks →
scoring, desync detection), and three adversarial review passes are fully closed (rev-2, Codex
6b, Codex 6c — per-finding rationale in rp2 commit messages).

**Staging runs in the cloud and scales itself (2026-07-15).** The staging coordinator
(https://staging-rp2-coordinator.shieldbattery.net, DO box, in-process ACME TLS, direct-exposed
by rule) provisions Fargate relays on demand across us-east-1/us-west-2/eu-central-1. The full
hands-off lifecycle is live-proven end to end: matchmaking queue join → warm signal → coordinator
mints `(relay_id, one-time token)` → RunTask → **enroll 22s after launch** (PoP + ledger token +
ENI source-address gate + tenant-key push) → real 1v1 served **over the relay's IPv6 address**
(dual-stack chain proven; `games.netcode_v2_relays` recorded it) → clean lockstep → session close
→ webhook delivered + recorded → idle 600s → coordinated drain → task stopped, id retired. An
idle fleet runs zero tasks; the desync chain (comparator → event → webhook → no-majority void)
was also validated live, courtesy of a debug tool that diverges simulations by design (renamed
`forceUnsyncedLeave` accordingly).

**Configuration is one-spot by design (ratified + shipped 2026-07-14/15).** Every operational
fact is declared in exactly one place; everything else is a generated file, a naming convention,
or a control-plane push:
1. **`rally-point2/infra/terraform/region-catalog.json`** — the only region declaration
   (per-region facts + per-environment membership/CIDRs; staging and prod run different sets).
   Both terraform stacks derive from it; the fleet stack *generates* the coordinator's
   `ecs.json` AND `regions.json` as outputs; the promote workflow reads its region list from the
   ECR replication config at run time. *Add a region = one catalog edit → two applies → copy two
   generated files → restart.*
2. **Coordinator box `config/tenants.json` + `.env`** — the only place a tenant exists. Relays
   receive tenant verifying keys over the control connection (`TenantKeys` frame, pushed at
   enroll before any descriptor), so no tenant material exists in AWS. *Add a tenant =
   `keygen.mjs <id>` → paste the printed entry → set the printed env var → restart. No AWS.*
3. **SB app server `.env`** — the tenant's own credential (`SB_RP2_CLIENT_KEY`), coordinator
   URL, and (until the backbone leg below lands) `SB_REGION_BACKBONE_RTT_JSON`.

Current pins: SB `rally-point-client` at rp2 `f4aa417f…` (main tip is `3a02fca`, log-ANSI fix —
next pin bump picks it up); ALPN `rp2/5` / `rp2-mesh/5`. Coordinator image channel `:stable`
(promote workflow), relay image channel `:latest` on staging / `:stable` on prod (ECR, OIDC
publish, per-region retag promote). Standing rules: consume rp2's re-exported
quinn/rustls/proto (never direct deps); any rp2 change = push rp2 → bump the SB `rev` pin →
rebuild via `game\build.bat`; **coordinator deploys before relay images** (relays need its
tenant-key push); relay stays PII-free; wire changes additive only; no drift toward a standard
reliable-ordered protocol (rationale in `architecture.md`).

## 1. Decisions ledger (compact)

D1 (QUIC in DLL, three-hook seam), D4 (defer spectator; in-session observers ARE built), D8
(observability: logs, desync ordinals, `/netstat`, flight recorder — durable sink still owed,
§2), D9 (relay-owned buffer control law + computed initial depth), D10 (validating relay,
fuzzed), D11 (app-server-mediated re-home; no auto-drop), D12 (Storm replaced wholesale):
**built as designed**. D3 (Fargate + scale-to-zero + dual-stack) and D7 (GameLift beacon region
selection): **built AND live on staging**. D2 (multi-tenant coordinator) / D5 (env-isolated
fleets): **software built; staging deployment live; prod not stood up**. D6
(tokens/keys/challenge-binding): **built** — launch-minted identity closed the offline-takeover
class; the tenant-credential consolidation half remains (§2).

---

## 2. Remaining work — the road to launch

### The launch path (rough order)

1. **Relay-measured backbone RTTs** *(ratified 2026-07-15 — wanted before launch; closes the
   last hand-maintained region-pair table).* The backbone table becomes telemetry instead of
   config. Mechanism: region B's GameLift beacon is always up regardless of our fleet and speaks
   the same UDP echo clients ping, so a relay in region A measures A→B by pinging B's beacon
   directly — no second relay required, no scale-to-zero chicken-and-egg. Legs:
   - **rp2**: coordinator pushes the region registry's beacon targets to relays over the control
     connection (additive frame, the TenantKeys/MeshPeers pattern); relays ping other regions'
     beacons on a slow cadence (median-of-N like the client measurement; beacons are third-party
     — be polite) and report per-region RTT in the existing heartbeat; coordinator aggregates per
     region *pair* with last-known retention (relays are ephemeral — values persist across a
     region's scale-to-zero gaps, e.g. alongside the ledger) and serves the pair table on the
     existing `GET /regions` response.
   - **SB**: consume the served table (the `/regions` fetch already exists), refresh with the
     region list, demote `SB_REGION_BACKBONE_RTT_JSON` to an explicit override. Unmeasured pairs
     keep the 150ms default, so bootstrap behavior is unchanged. Both the matchmaker (server-rs)
     and the Node latency-estimate util read the same source so they can't drift.
   - Until it lands, public inter-AWS-region latency data pasted into the env var once covers a
     launch (the 150ms default is fine for match quality but inflates cross-region initial
     buffers).
2. **Flight-recorder durable sink + read path** (D8's owed half). The dev `--flight-dir` file
   sink exists; production relays currently *discard* recordings at session close. Needs the
   S3-compatible sink (DO Spaces; policy ratified: 14-day lifecycle, 30-day desync pin) and a way
   to fetch blobs by `<tenant>/<session>/<relay_id>.json` (the game record's session id + relay
   history make them findable). This is prod incident forensics — want it before real traffic.
3. **Tenant lifecycle, credential half** (the identity-ledger half is closed): consolidate
   `/session/create` inbound auth + webhook signing into one per-tenant credential; move client
   pubkey submission from game load to queue/lobby-join time (those requests already carry
   `(region, rttMs)` — same surfaces, same lifetime; no long-lived keypair without a security
   review).
4. **Prod region list** — catalog entries whenever chosen, plus the activation checklist per
   region: verify a GameLift beacon actually exists there (no China; some regions lack one),
   pick the TCP fallback endpoint, distinct CIDRs per environment. List-building, not code.
5. **Prod standup** — prod coordinator box (same deployment dir + runbook as staging) + prod
   fleet apply (`prod.tfvars`; task defs pull `:stable`, so promote a soaked relay sha first) +
   prod tenant minted via keygen. Runbooks: `infra/terraform/README.md`,
   `deployment/coordinator/README.md`.
6. **Rollout execution**: ship a client version pointed at prod (platform enforces
   client-version currency, so no mixed-version games); keep the old rally-point *service*
   running only until the minimum supported client is v2-only, then decommission. Rollback =
   previous client version while the old service exists — **define that gate explicitly** (still
   undefined).
7. **Load/scale test + cost model** at realistic SB peak: N games/relay, RunTask-rate
   provisioning, egress cost (the one usage-scaling AWS line item; idle fleet ≈ $0, logs are
   noise). More cold-start datapoints accumulate free in the ledger as regions get used — 22s is
   a single point; recalibrate the 75s hold cap when there's a distribution.

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
- Loopback ProcessProvisioner pass — the ECS path is live-proven, so this is now an AWS-free
  regression option, not a gate.

### SB-side small backlog

- **/netstat: mark departed players' rows** (the climbing `age` column is the only signal
  today; a "left" marker makes it explicit — noted live 2026-07-15).
- **Localized region display names** (parked until the prod region list exists; approach
  decided: client-side `t('gameServerRegions.name.' + id, region.displayName)` with an
  extraction-hint file — coordinator config and wire stay language-free).
- Drop `netcodeV2` naming from public surfaces (only user-visible instance is the admin
  game-page debug title; needs a target-naming decision).
- Client desync-report hook (VOID-only games).
- Post-promotion desync-ordinal PK collision (authority epoch, if revisited); observer quit
  classifies as drop rather than clean leave (no scoring impact); scrollable chat-history box
  decision (verify SC:R's box renders in-game at all first); replay-playback chat renders into
  `.rep` but not visibly during playback (low); TR8-feel emulation for UMS remains a future idea.

### Phase 4 leftovers absorbed above

Region selection is built + e2e-proven (loopback dev recipe: `dev-beacon` with two delayed
listeners + a regions JSON + two `--region` relays → real meshed cross-relay sessions). Its three
production leftovers all live in the launch path now: backbone values (item 1), beacon
coverage/fallbacks (item 4), and the region config deployment story (solved — the catalog).

---

## 3. Settled by design — do not re-chase

Recorded so future reviews/sessions don't re-litigate (reasoning in rp2 commit messages +
`architecture.md`):
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
  the majority. `forceUnsyncedLeave` diverges simulations *by design* — it's a testing tool,
  never a way to end a game that needs a scored result.
- **Presence fail-open** (35s TTL): locking players out on infra flap is worse than the status
  quo.
- **B1 lobby half scoped out**: lobby commands have no dedup identity, so a same-relay-resume
  replay would double-apply; the oversize-turn half is handled.
- **Unbounded coordinator-notice buffer** is a deliberate, weighed choice (delivery over
  memory); **relay-ref webhook precedence** is by-design for restart survival; μs-seeded session
  ids stay in JS safe-int range until ~2255.
- **Home-relay fail-open for unknown sessions** (empty homed set = unenforced) preserves the
  descriptor-arrival race's admit-first behavior; the fleet-amplification angle is closed by
  mesh peer auth.
- **Never-started sessions** keep the immediate emptied-roster close (nothing force-decides
  their holds, so deferral would be unbounded); their holds still survive a quick re-dial.
- **Finite player tokens** (default 6h) are checked only at (re)connect; mid-game expiry is
  harmless; never-started sessions are held ~the token lifetime before reaping. Escape hatch if
  marathon games matter: mint fresh tokens on the rehome response (noted, not built).

## 4. Open questions (genuinely open)

- **DDoS without anycast** — baseline decided (per-task churn + Shield Standard on raw Fargate
  IPs). Open half: the trigger for Shield Advanced/Spectrum — revisit if targeted attacks
  materialize.
- **Recovery-window vs downlink-coalescing byte budget** — define when implementing coalescing
  (low-stakes: the window is small and coalescing is weak-downlink-only).
- **Coordinator↔relay control-protocol skew** — negotiation exists; becomes real the day the
  prod coordinator exists beside staging (deploy-order rule covers the current single
  deployment).

---

*rev 7 synthesized 2026-07-15 after the staging standup: statuses verified against rp2 `3a02fca`
/ SB `rp2-integration` `552bc3a03` and the live staging fleet, not carried forward on faith. The
provisioning/config-topology build record (per-leg rationale, gates, review trail) lives in rp2
commit messages `a1b8cc8`/`7e4fa9a`/`f4aa417` and this file's rev-6 text in git history.*
