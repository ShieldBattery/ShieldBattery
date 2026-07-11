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

Current pins: SB `rally-point-client` at `28765d5477e5…` (rp2 `main` tip, pushed); ALPN `rp2/5`
(client) / `rp2-mesh/4` (mesh). Standing rules: consume rp2's re-exported quinn/rustls/proto (never
direct deps); any rp2 change = push rp2 → bump the SB `rev` pin → rebuild via `game\build.bat`;
relay stays PII-free; wire changes additive only; no drift toward a standard reliable-ordered
protocol (rationale in `architecture.md`).

**Nothing runs in the cloud yet** — Fargate, regions, prod/staging fleets, DDoS posture,
coordinator HA are all unbuilt. That is §2.

**Worth doing soon:** a live loopback matrix run (two relays, mid-game relay kill, same-relay blip)
on the **current** pinned build — the 6c fixes (13 commits, including the emptied-session-close and
driver-loop reworks) have unit/integration coverage but no live game behind them yet.

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

### Phase 4 — Region selection *(not started)*
- GameLift ping beacons (D7) → cached latency map → home region; verify beacon coverage against
  lit regions; logical regions.
- A **beacon-independent fallback** for coverage gaps / rate limits / the service going away
  (D7 said "ICMP-to-relay-region", but scale-to-zero means there may be nothing of ours in-region
  to ping — mechanism TBD: a tiny always-on per-region UDP echo we run (measures the real
  protocol path, doubles as reachability), TCP-connect RTT to AWS regional endpoints, or
  unprivileged ICMP via `IcmpSendEcho` if a region-stable target exists).
- Today's placeholder: app-server-supplied region.

### Phase 5 — AWS orchestration *(not started, two contracts pre-built)*
- Fargate task def (dual-stack ENI, IPv4 egress for ECR pull), scratch image, lobby-time
  provisioning, scale-to-zero, warm-pool fallback; cold-start budget measurement.
- Pre-built on the rp2 side: **dual-stack advertise** (`relay_addrs`, `d26aaf1`) and **coordinated
  relay drain** (SIGTERM → `Draining`/`DrainAck`, 90s bound, `5d0ea11`). Remaining here: address
  discovery via ECS metadata (still explicit `--advertise-addr` flags) + SB-side per-client
  address-family selection.
- **Flight-recorder durable sink + read path** (DO Spaces, 14-day lifecycle rules) — the dev
  `--flight-dir` file sink exists; production needs the S3-compatible sink and a way to fetch
  blobs by `<tenant>/<session>/<relay_id>.json`.
- Reconcile D3's per-game IP rotation vs stable enroll addresses.
- Load/scale test: N games/relay + RunTask-rate provisioning at realistic SB peak; cost model
  (NAT, cross-AZ mesh, telemetry egress).

### Phase 6 — Hardening + production rollout

**Security/tenancy blockers before anything non-loopback:**
- **Mesh `S===S` auth** — accept side trusts the dialer's self-asserted `MeshHello.relay_id`
  (server-TLS-only). Bind id to authenticated identity (mTLS/internal CA or coordinator-issued
  mesh credential); reject unexpected/duplicate ids before link registration. Fold in the
  **coordinator-pushed assigned-session allowlist** (closes the shadow-slot amplification angle on
  the deliberate home-relay fail-open) and **mesh session-id tenant scoping** (`MeshPacket` carries
  a bare `session: u64`; driver fail-closes on collision but the wire can't disambiguate).
- **Tenant lifecycle** — enrollment, key rotation/revocation (active/suspended/revoked per
  request), staging access story; consolidate `/session/create` inbound auth + webhook signing
  into one per-tenant credential; move client pubkey submission to queue/lobby time (today it
  rides game load; no long-lived keypair without a security review).
- **Finite token lifetimes** — API player tokens still use the `ExpiresAt(u64::MAX)` dev
  placeholder.
- Confirm the untrusted-dev loopback truly never touches a shared coordinator/fleet.

**Coordinator HA** — the one unbuilt platform feature. RTO, registry in a shared store,
hot-standby. Running games survive a coordinator outage (relays run the live game), but session
creation and re-home don't.

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
- Initial buffer directive at session start; rate-limited control-law logging (D9 leftovers).
- Live loopback matrix on the current pinned build (see §0).

### SB-side small backlog (carried from the deleted tracker)
Persist the rp2 session id on the game record (required to look up flight-recorder blobs — a
prefix list of `<tenant>/<session>/` recovers the relays), plus relay history (home at create +
each rehome dead→new + timestamps; SB mediates all these moments) for relay-centric incident
queries; drop `netcodeV2` naming from public surfaces; client desync-report hook (VOID-only);
relay forward-channel byte budget (oversize amplification); self-desync-void rate-limit;
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
- **DDoS without anycast** — validate Shield Standard on raw Fargate IPs; when is Shield
  Advanced/Spectrum required (likely near-term); interacts with the IP-rotation question (§2 P5).
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
