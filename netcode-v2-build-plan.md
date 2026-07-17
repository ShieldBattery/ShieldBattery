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

**The arc completed 2026-07-09 and lives on the SB `rp2-integration` branch — not yet on master
(an accidental early merge there was rolled back; Travis lands master himself); v2 IS the
netcode** (v1 rally-point path, Storm UDP, and ClientReady/startWhenReady deleted, ~4000 lines;
no native-transport fallback by design).
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

Current pins: SB `rally-point-client` at rp2 `2f43f20…` (= main tip, 2026-07-16: backbone-RTT
arc + beacon-port fix + per-direction pair store); ALPN `rp2/5` / `rp2-mesh/5`. Coordinator image channel `:stable`
(promote workflow), relay image channel `:latest` on staging / `:stable` on prod (ECR, OIDC
publish, per-region retag promote). Standing rules: consume rp2's re-exported
quinn/rustls/proto (never direct deps); any rp2 change = push rp2 → bump the SB `rev` pin →
rebuild via `game\build.bat`; **coordinator deploys before relay images** (relays need its
tenant-key push); relay stays PII-free; wire changes additive only; no drift toward a standard
reliable-ordered protocol (rationale in `architecture.md`).

## 1. Decisions ledger (compact)

D1 (QUIC in DLL, three-hook seam), D4 (defer spectator; in-session observers ARE built), D8
(observability: logs, desync ordinals, `/netstat`, flight recorder — durable sink + read path
built 2026-07-16, staging setup remains, §2), D9 (relay-owned buffer control law + computed initial depth), D10 (validating relay,
fuzzed), D11 (app-server-mediated re-home; no auto-drop), D12 (Storm replaced wholesale):
**built as designed**. D3 (Fargate + scale-to-zero + dual-stack) and D7 (GameLift beacon region
selection): **built AND live on staging**. D2 (multi-tenant coordinator) / D5 (env-isolated
fleets): **software built; staging deployment live; prod not stood up**. D6
(tokens/keys/challenge-binding): **built** — launch-minted identity closed the offline-takeover
class; the tenant-credential consolidation half remains (§2).

---

## 2. Remaining work — the road to launch

### The launch path (rough order)

1. **Relay-measured backbone RTTs** *(BUILT 2026-07-15; landing steps remain).* The backbone
   table is telemetry: relays ping other regions' always-up GameLift beacons (median-of-5
   nonce-matched echoes, ≥400ms spacing, one sweep at startup + 6h backstop — task churn
   re-measures naturally), report medians on the existing heartbeat, and the coordinator
   aggregates per pair (canonical a<b, last-write-wins beyond a 5ms noise dead-band,
   generation-fenced ingest) with last-known retention in a ledger v2 table, serving
   `backbone_rtts` on `GET /regions` (field omitted while empty). The provisioning loop
   bootstraps coverage: a region with unmeasured pairs gets a transient target of 1 (max-merged
   with warm demand, 5min hold, exponential backoff 10min→6h against dead beacons), so standup /
   add-a-region / lost-ledger all self-seed. SB consumes the served table both sides —
   `GameServerRegionsService` caches it beside the region list (deliberately outside the
   client-publish diff) and server-rs polls `/regions` into an ArcSwap table each 5min —
   with `SB_REGION_BACKBONE_RTT_JSON` demoted to a per-pair override that wins where it names a
   pair. rp2 `4bc6ec5..2f43f20` PUSHED; SB `9440588dd`+`a1f6364bf`, pin at `2f43f20`
   (`6bae4a1b0`; client crate untouched across the arc). **DONE — STAGING LIVE-VERIFIED
   2026-07-16 on rp2 `2f43f20`:** coverage bootstrap launched all three regions on boot, relays
   enrolled in 14–22s (nine cold-start datapoints across three boots, vs the old single 22s
   point), all six pair *directions* measured and served within ~40s of restart, and the table
   held steady thereafter (us-east|us-west 59 = avg(62,55); eu-central|us-east 91;
   eu-central|us-west 149 — verified stable over sampled heartbeat cycles, change-log silent
   after the initial fills). Two live findings were found and fixed during the standup:
   (1) **GameLift beacons echo on UDP :7770, not :443** (`e495f79`; the wrong port had every
   beacon consumer silently degraded — game clients included, which had been TCP-falling-back
   for region pings; they now get true UDP measurements with no SB change). (2) **Directional
   asymmetry is real** (us-east↔us-west: 62 from one end, 55 from the other, persistent), so
   `2f43f20` stores per-direction slots and serves the round-half-up average (wire shape
   unchanged; ledger schema v3, one row per pair+origin). `SB_REGION_BACKBONE_RTT_JSON` is now
   an emergency per-pair override only. Nothing remains on this item.
2. **Flight-recorder durable sink + read path** (D8's owed half) — **BUILT 2026-07-16; staging
   setup remains.** Relays stay credential-free: each flushed recording ships up the existing WSS
   control connection as an additive `RelayToCoordinator::FlightRecording` frame (tenant/session +
   relay-computed `desynced` flag + blob JSON as an opaque string, skew-proof; relay identity =
   the connection's enrolled id, never a frame field; own bounded pipe so blobs never delay
   webhook-bearing notices; drain flush fan-out capped below the queue depth). The coordinator is
   the sole Spaces credential holder (`--flight-store` JSON names env-var NAMES, fail-closed —
   tenants.json pattern; aws-sdk-s3 pinned =1.119.0 on the existing ring-only smithy stack):
   stores `flight/<tenant>/<session>/<relay_id>.json` vs `desync/...` — retention class is a key
   *prefix* because S3-compatible lifecycle rules filter by prefix, not tag (14d / 30d rules,
   paste-ready in `deployment/coordinator/README.md`). Pinning = relay's flag OR the coordinator's
   TTL'd desync mark (set in `handle_desync` before any webhook gate), plus a convergence sweep
   moving a session's earlier unpinned blobs when a pinned one lands — covers restart/reorder, so
   ALL relays' blobs of a desynced session end up pinned (why coordinator-mediated beat
   relay-direct-to-S3: only the coordinator sees every desync). Reads: tenant-signed
   `POST /flight/blobs` (list) / `POST /flight/blob` (fetch verbatim); tenant comes from the
   signature only — cross-tenant reads structurally impossible; ingest refuses non-key-safe tenant
   ids (an id with `/` would alias another tenant's key space). Ops: `deployment/coordinator/
   tools/fetch-flight.mjs` signs like the app server (game record's `netcode_v2_session` +
   `netcode_v2_relays` → blobs). rp2 local main `43ec857`+`ccdb566`+`7cb9349` (UNPUSHED — Travis's
   push gate; client crate untouched, pin bump is rev-only); SB `1d8a86fa4` (deployment surface).
   Gates green (fmt/clippy/test/rustdoc); startup smoke verified all three `--flight-store` paths
   against the real binary. **DONE — STAGING LIVE-VERIFIED 2026-07-17** (rp2 pushed `7cb9349`, SB
   pin `a7e1369bc`; bucket `staging-rp2-flight` + both lifecycle rules applied; the box's one
   misconfig — sample bucket name left in flight-store.json — fail-signaled as designed: 500s on
   reads, logged PUT losses, games/results untouched): normal leg = staging 1v1 (session
   1784266232751393, relay 13) produced a complete blob (11 events incl. the full
   connect→start→drop-hold→leave-decided→close story, 24 samples, ~3.5k turns/slot, 10 KB),
   listed + fetched via `fetch-flight.mjs` moments after close; desync leg = `forceDesync` 1v1
   (session …395) fired the comparator (`desync_detected` ordinal 1399 `no_majority:true` in the
   blob; both diverged clients reported "win" — the exact contradiction the void policy exists
   for) and the blob landed `pinned:true` under `desync/`. Verification also corrected the
   debug-tool lore: `forceUnsyncedLeave` on the caller's own slot is an ordinary drop (game
   scored normally, NO desync); `forceDesync(gameId)` is the reliable desync trigger — verify-app
   + verify-pr skills updated. Nothing remains on this item.
3. **Monitoring hookup for the rp2 infra** — **BUILT 2026-07-16; staging setup remains.**
   Shape ratified same day: sidecar-only exposure, new dedicated dashboard, panels only (no
   Alertmanager exists; alert thresholds want prod baselines — revisit at/after prod standup).
   Coordinator: `--metrics-listen`/`COORDINATOR_METRICS_LISTEN` brings up a second plaintext
   HTTP listener serving hand-rolled Prometheus text exposition (no new deps; scrape-time
   gauges over existing state + static counters at event sites; labels bounded to
   region/tenant/state/result/reason). ~20 `rp2_*` families: relays by region+state,
   launch/enroll/drain/reap counters, cold-start histogram (enroll−launch from ledger
   timestamps, FirstEnroll only), active sessions by tenant (loading/started), created/holds/
   closed/desyncs (desyncs counted behind the notice dedup so redelivery can't inflate; drains
   counted once at the relay's Draining announcement — scale-down stops the task which prompts
   that same announcement), webhook notices pending/dropped + delivery outcomes, flight
   recordings stored/refused/lost + pinned, per-direction backbone RTTs, beacon-backoff gauge
   (the reconcile loop publishes its loop-local coverage phase). Relays are NOT scrape targets
   (settled). SB side: coordinator box gains node_exporter + serve.json forwards 14911/9100
   (tailnet-only by shape — the port is never published; public listener untouched per the
   no-proxy rule); monitoring box gains the `rp2_coordinator` scrape job + provisioned
   `rally-point.json` dashboard (14 panels: fleet/sessions/delivery/backbone; stat panels
   red-threshold at nonzero). rp2 main `ce72cd9` PUSHED 2026-07-17; SB pin bumped `42936db79`
   (rev-only lock churn, DLL rebuilt via build.bat, 142 tests + clippy green). SB `0c6423aba`
   (deployment surfaces) + `670ac379a` (scrape targets: `staging-rp2-coordinator` is the
   staging box's tailnet name; `rp2-coordinator` is reserved for prod and pre-listed, so prod
   standup needs no monitoring change — it reads as a down target until then). Gates green;
   /metrics smoke-verified on the real binary. **Staging setup DEFERRED (Travis, 2026-07-17:
   not redeploying the monitoring VM for now):** promote coordinator image → box .env
   `COORDINATOR_METRICS_LISTEN=[::]:14911` + updated compose/serve.json → `docker compose
   up -d` → monitoring box: copy prometheus.yml + dashboard JSON, recreate the prometheus
   container → verify targets up + dashboard populates during a staging game.
4. **Tenant lifecycle, credential half** (the identity-ledger half is closed): consolidate
   `/session/create` inbound auth + webhook signing into one per-tenant credential; move client
   pubkey submission from game load to queue/lobby-join time (those requests already carry
   `(region, rttMs)` — same surfaces, same lifetime; no long-lived keypair without a security
   review).
5. **Prod region list** — **DONE 2026-07-17 (ratified + catalog committed, rp2 `f517e80`).**
   Eleven regions: us-east/us-west/eu-central (existing) + kr (Seoul), ca-east (Montreal),
   sa-east (São Paulo), eu-north (Stockholm), hk (Hong Kong), sg (Singapore), au (Sydney),
   mx (Querétaro). Prod CIDRs 10.84..10.94/22; staging set unchanged. Activation checklist
   worked: beacons live-probed (UDP :7770 nonce-echo 3/3) in all but mx-central-1, which has
   NO GameLift beacon (NXDOMAIN, absent from AWS's list). **mx ships anyway by design, zero
   code:** clients catch the failed beacon measurement and rank mx via TCP-connect fallback;
   backbone mx pairs fill one-directional from the mx relay's outbound sweeps (served value =
   average of present directions; coverage counts either) — and the formulaic hostname means
   AWS shipping the beacon later upgrades measurement to UDP with no config change (invariant
   documented in `infra/terraform/README.md`).
6. **Prod standup** — prod coordinator box (same deployment dir + runbook as staging) + prod
   fleet apply (`prod.tfvars`; task defs pull `:stable`, so promote a soaked relay sha first) +
   prod tenant minted via keygen. Runbooks: `infra/terraform/README.md`,
   `deployment/coordinator/README.md`. Inherited from item 5: **enable the ap-east-1 and
   mx-central-1 account opt-ins BEFORE any apply** (ECR replication errors otherwise); verify
   Fargate dual-stack works in mx-central-1 (new region). The prod box's tailnet name should be
   `rp2-coordinator` — the monitoring scrape config already lists it as a (currently down)
   target.
7. **Rollout execution**: ship a client version pointed at prod (platform enforces
   client-version currency, so no mixed-version games); keep the old rally-point *service*
   running only until the minimum supported client is v2-only, then decommission. Rollback =
   previous client version while the old service exists — **define that gate explicitly** (still
   undefined).
8. **Load/scale test + cost model** at realistic SB peak: N games/relay, RunTask-rate
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
