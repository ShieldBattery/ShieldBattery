# Netcode v2 — external review triage detail (rp2 `f517e80`, 2026-07-17)

> **STATUS 2026-07-18: address-before-prod + opportunistic sets are all IMPLEMENTED** — ten
> commits on rp2 local main (`f517e80..9781527`), unpushed; see build plan §2's triage status
> note for the land/verify checklist. The per-finding detail below is now the *rationale record*
> for those commits (anchors describe the pre-fix code at `f517e80`).

Per-finding implementation detail for the external rp2 review, verified against code by four
adversarial agents. Companion to `netcode-v2-build-plan.md` §2 (which holds the categorization +
one-line verdicts); this file holds enough to fix each actionable finding WITHOUT the original
review — anchors, mechanism, existing mitigations, exact fix shape. All anchors are rp2 repo
(`../rally-point2`) paths at commit `f517e80`; verify each (may drift a few lines). Backlog
findings stay at build-plan granularity (they'd be re-explored when picked up); this file details
the **address-before-prod** and **opportunistic** sets.

Verdict legend: CONFIRMED / PARTLY (narrower than the review said) — with the narrowing noted.

---

## Address before prod

### Mesh-dedup seam — T1 + T2 + R1 + R8 (ONE coherent fix)

Shared root cause: the mesh **transport** receive-dedup (`SessionLink.dedup`) is the only receive
window in the system with **neither** an anchor (the client-edge `Link` has `anchor_receive_window`
/ `Dedup::anchor`, `transport/src/link.rs:272,289`) **nor** a forward-collapse (which even the
mesh's own *application* gate `MeshSeen` has, `relay/src/mesh.rs:70,96` `collapse_to_cap`). And
`observe_turn_frame` runs *before* the session-wide `mark_seen` dedup, unlike the desync comparator
which was deliberately placed *after* it (`relay/src/mesh.rs:1736-1743`). Fixing those two facts
closes all four.

**T1 — mesh redial permanently fails past seq 4096. CONFIRMED.**
- `transport/src/mesh_link.rs:311` `open_session` creates `SessionLink { dedup: Dedup::new() }` →
  `with_window(RECEIVE_WINDOW=4096)` (`link.rs:44,517`), empty per-slot map, delivered prefix
  `None`, window base **0**.
- `mesh_link.rs:628` `dedup.accept(slot, seq)` → `Dedup::accept` (`link.rs:551`):
  `base = delivered_through.map_or(0,|t|t+1)`; `if seq - base >= window { OutOfWindow }`. On a base-0
  window any `seq >= 4096` is rejected → `PayloadOutOfWindow` propagates out of `MeshLink::recv`.
- No anchoring exists on the mesh path: the Join handler (`mesh.rs:2035`) calls `open_session` +
  `reconcile_resume_cursors_on_join` but never anchors; `resume_replay_for_frame` /
  `send_resume_replay` (`mesh.rs:1378,1488`) only *send* replay turns, never seed the receiver
  window.
- Seq = origin client's per-slot per-network-turn counter from 0 (`transport/src/ack_manager.rs:18-21`),
  one turn = one seq; the code itself sizes `SPARSE_SEEN_CAP=4096` and comments that a game past
  ~4096 turns re-dials into out-of-window (`mesh.rs:80-86`, `client/src/driver.rs:1971`).
- Redial re-opens fresh base-0 sessions: recv error → `break MeshLinkExit::ConnectionFailed`
  (`mesh.rs:1765-1768`) → dial supervisor (`mesh_dialer.rs`) → fresh QUIC conn → fresh `MeshLink`
  → `run_mesh_link` with empty `joined`. Triggers: relay task restart/replacement, deploy,
  inter-relay blip. Consequence: multi-relay game past ~4096 turns loses the mesh permanently
  (cross-relay turn delivery stops → stall/desync/drop). Single-relay sessions never use the mesh.
- **Fix (M):** seed `SessionLink.dedup`'s per-slot base on open/resume — anchor it from the
  `MeshSeen` forward-gate's `forwarded_through` or the resume cursors — and/or give the transport
  dedup the same collapse-forward `MeshSeen` already has.

**T2 — oversize mesh turn poisons the datagram stream. CONFIRMED.**
- Sender: `send_turn_over_link` diverts `!payload_fits` turns to a `MeshControlFrame::OversizeTurn`
  on the reliable control stream (`mesh.rs:1422,1429-1451`); `link.send` is never called, so seq N
  never enters the sender's `AckManager`.
- Receiver: the `OversizeTurn` arm calls `deliver_turn_to_locals` directly (`mesh.rs:2282,2310`),
  never touching `SessionLink.dedup`. Contrast the client ingress path, which folds a
  stream-delivered oversize turn into the *same* `Dedup` via `link.deliver_external(slot, seq)`
  (`relay/src/routing.rs:1699`) — `MeshLink` has no `deliver_external`.
- `delivered_through` stalls at N-1; datagrams N+1… sit in `ahead` (`link.rs:583`); at `N+4096`,
  `accept` → `OutOfWindow` → recv error → `break ConnectionFailed` (`mesh.rs:1765`) resets the
  **whole relay-pair connection** (all sessions on it), then T1 makes it permanent.
- Reachability: gated on an oversize turn (divert threshold ≈ live `max_datagram_size()` minus
  wrapper, design supports up to `MAX_OVERSIZE_TURN_COMMANDS_LEN=8192` at `routing.rs:260`);
  normal BW turns are tens of bytes, so oversize is uncommon (high-latency turn aggregation / action
  bursts) but the divert path is deliberately built.
- **Fix (S–M):** add `deliver_external` to `MeshLink`/`SessionLink`, call it from the `OversizeTurn`
  dispatch (`mesh.rs:2282`) before `deliver_turn_to_locals`, mirroring `routing.rs:1699`.

**R1 — duplicate turns corrupt the leave-decision history. CONFIRMED (narrowed).**
- `DecisionMaker::observe_turn_frame` appends unconditionally: `state.frame_history.push_back((seq,
  frame.0))`, no seq-dedup (`consensus.rs:1832`), bounded `cap = max(bounds.max+4, 8)` = 10 in prod
  (`consensus.rs:1827,1833-1835`). Both mesh ingress calls (`mesh.rs:1727` datagram, `:2297`
  oversize) run it **before** `forward_turn`/`mark_seen`.
- The datagram path **refloods**: `forward_turn` → `fan_out_to_mesh` re-emits any fresh mesh-origin
  turn to *all* links, no link-id exclusion (`mesh.rs:690-712`), so in a 3-relay mesh the authority
  receives each remote turn twice (1-hop direct + a peer's 2-hop reflood). With cap 10 and 2×
  duplication only ~5 distinct seqs survive → `reachable_frame`'s `seq <= frontier-buffer_max`
  filter (`consensus.rs:1855`) goes empty → fallback to `frame_history.front()`
  (`consensus.rs:1874-1880`) returns a frame ~2 turns too high.
- **Masked in honest play:** `commit_leave` clamps `base.min(ceiling)` (`consensus.rs:2550-2551`);
  honest `base = slot_last <= ceiling`, so `min` picks the correct base. It only bites when the
  departing slot **inflates `game_frame_count`** (the exact cheater the clamp exists to stop) — then
  `min` picks the too-high fallback and survivors stall. Requires **3+ relays** (2-relay sessions get
  no cross-link survivor duplication) + an inflating client. Stall is bounded ~buffer_max.
- **Fix (S/M):** move the `observe_turn_frame` call into `deliver_turn_to_locals` (post-dedup),
  exactly as `observe_sync` already is; or dedup the append by seq.

**R8 — hop budget mistakes an intermediate relay for the origin home. CONFIRMED (transient).**
- `observe_origin` stamps home monotonically on strictly-fresher seq (`delivery.rs:127-138`), fed via
  `observe_turn_frame` with the ingress peer as home (`consensus.rs:4222`, `mesh.rs:1733`
  `DeliveryHome::Peer(peer_id)`) — before `mark_seen`. Because turns reflood, the same fresh seq of a
  B-homed slot can reach authority A both direct (home=Peer B) and via C's reflood (home=Peer C);
  first-arrival wins. `max_relay_hops` (`delivery.rs:198-216`): `hops = origin_home==dest_home ? 1 :
  2`; a mis-stamp makes a real 2-hop read as 1-hop → loses `EXTRA_HOP_CUSHION_TURNS=1`
  (`delivery.rs:61,225-239`). Self-corrects on the next direct-first fresh seq; ≤1-turn cushion
  under-budget for the window.
- **Fix (S):** same as R1 — only feed `observe_origin` for the copy that passes `mark_seen` (move the
  call after dedup), so home follows the true source.

### R2 — decided leaves not replayed to reconnecting clients. CONFIRMED (permanent hang).
- `fan_out_leave` pushes a leave only to currently-rostered survivors (`routing.rs:696-730`) via each
  `SlotEntry.leave_push`. `register` creates a **fresh empty** `leave_push` channel
  (`routing.rs:533,555`), never seeded from `decided_leaves`.
- The reconnect path (`run_slot_link`) delivers `reopen_close_report` (`routing.rs:1020`),
  presence/connectivity, lobby replay (`:1124`), and turn replay (`:1225` `turn_ring.replay`) — but
  no leave replay. Leaves are explicitly not stamped on turn envelopes (`mesh.rs:1309-1312`), so
  replayed turns can't carry them. The only decided-leave re-delivery on (re)join is
  `reconcile_leaves_on_join` — **mesh-link only** (`mesh.rs:2515`, `leave_reconcile`
  `consensus.rs:4156`).
- Trigger: a client's relay link blips; while gone, another player's leave is decided; the client
  reconnects, replays turns to the departed slot's last frame, then stalls forever at the next frame.
  Affects same-relay reconnect AND rehome. Reconnect machinery (resume cursors + turn replay) is
  fully implemented, so live where reconnect is exercised.
- **Fix (S/M):** in `run_slot_link` at the replay point, push `leave_reconcile`'s directives
  (SlotDeparted + LeaveDirective) down the new slot's control stream — a client-side twin of
  `reconcile_leaves_on_join`.

### C4 — draining relays satisfy the warm target. CONFIRMED.
- `reconcile.tick`: `let live = enrolled.iter().filter(|r| r.region == Some(region)).count()`
  (`provision/reconcile.rs:240-243`) over `enrolled_relays`, which **includes** draining relays
  (`registry.rs:322-334`, no filter). Placement `is_available` **excludes** draining
  (`registry.rs:283-285`). So a draining relay suppresses `scale_up` (`reconcile.rs:244`) while being
  unplaceable, until it disconnects (up to a full game's remaining length).
- **Fix (S):** filter `!r.draining` in the `live` count (or count `is_available`).

### C8 — historical relay outbox shells never retired. CONFIRMED.
- `RelayReaps.subscribe`/`.send` both `relays.entry(relay_id).or_default()`
  (`descriptors.rs:124,143`); `RelayDescriptors.record` `channels.entry(relay_id).or_insert_with`
  (`descriptors.rs:200`). No path removes a `relay_id` **key** on permanent retirement:
  `RelayReaps.retire` removes per-session entries but keeps keys (`descriptors.rs:170-175`);
  `RelayDescriptors.remove` drops a session's descriptor, keeps the channel (`descriptors.rs:208`);
  `registry::remove_if_current` touches only the registry.
- Every Fargate task enrolls under a fresh relay id (one-time ledger tokens, no reuse), so both maps
  grow one shell per task launched over coordinator uptime, and session cleanup —
  `reaps().retire` (`lifecycle.rs:683,948`) → `for state in relays.values_mut()`
  (`descriptors.rs:172`) — is O(all historical relays). Fast under scale-to-zero churn on a single
  long-uptime box.
- **Fix (M):** remove a relay's key from both maps on permanent retirement (dereg / ledger retire),
  or index reap-pending by relay so cleanup doesn't scan all history. Add a high-churn regression
  test.

### C2 — flight-upload unbounded memory backlog. CONFIRMED.
- `spawn_flight_upload` does `tokio::spawn(async move { let _permit =
  FLIGHT_UPLOAD_PERMITS.acquire().await … })` (`coordinator/src/api.rs:2275-2279`): the full payload
  is moved into the detached task **before** acquiring one of `MAX_CONCURRENT_FLIGHT_UPLOADS=8`
  permits (`api.rs:2151-2155`). Per-payload cap `MAX_FLIGHT_BLOB_BYTES=4 MiB` (`flight_store.rs:56`,
  enforced pre-spawn in `classify_ingest`). The semaphore bounds concurrent PUTs, not waiters — each
  waiter pins ≤4 MiB. A misbehaving relay streaming `FlightRecording` frames + slow S3 → unbounded
  4 MiB-holding tasks → OOM the single box.
- **Fix (S–M):** acquire the permit (or a bounded-queue slot / `try_acquire`-and-drop) **before**
  taking ownership of the payload, or cap total in-flight upload bytes / pending uploads per relay.

### C1 — heartbeats not ownership-validated. CONFIRMED (narrower than stated).
- The `Heartbeat` arm (`api.rs:2031-2069`) gates only on `registry::generation_is_current`
  (`api.rs:2042`), then `presence::apply_heartbeat` (`api.rs:2043`) + `lifecycle.on_presence_seen`
  for every roster session with a non-empty slot list (`api.rs:2053-2057`). **No**
  `relay_serves_session` check. `apply_heartbeat` keys entries on the **claimed**
  `(tenant,session,slot)` from the roster (`presence.rs:92-120,:103`). Sibling arms Departure
  (`api.rs:2076`), Desync (`:2096`), Result (`:2116`) each call `relay_serves_session` and reject a
  non-serving relay.
- A compromised enrolled relay can forge presence for a victim `(tenant,session,slot)` — session ids
  are a guessable sequential counter (`session.rs:998`). Effects: (1) forge `in_game=present`
  (`presence.rs:141` `fresh_slots`) → blocks the victim from re-queueing; (2)
  `on_presence_seen`→`mark_started` aborts the never-started reap timer (`lifecycle.rs:540-556`) for
  a tracked victim. **NOT** the review's "false results" — forged Result frames are already blocked;
  a forged SessionClosed inserts only the connection's own trusted relay_id so it can't retire a
  victim. Bounded: forger can only add false-present (replace touches only `e.relay == self`,
  `presence.rs:100`), and it self-heals at the 35s presence TTL.
- **Fix (M):** gate the heartbeat presence-apply + `on_presence_seen` per roster session with the
  existing `relay_serves_session` (`api.rs:2354`) / the `homes` map (`session.rs:96`
  `SessionRefs.homes: BTreeMap<SlotId, RelayId>`), preserving its fail-open-when-no-serving-set
  behavior for the post-restart tail.

### C6 — control-WebSocket admission underbounded. CONFIRMED (RTT sub-claim PARTLY).
- Bare `ws.on_upgrade(...)` (`api.rs:1160`) with no `.max_message_size()`/`.max_frame_size()` →
  axum 0.8.9 / tungstenite 0.29 defaults (64 MiB message, 16 MiB frame). Heartbeat
  `sessions`/`region_rtts` vectors applied with no length cap (`presence.rs:101-102`,
  `api.rs:1946`). Pre-Hello sockets: `timeout(HELLO_TIMEOUT=5s, read_hello)` (`api.rs:191,1228`),
  no cap on concurrent pre-Hello sockets. `control_auth_ok` (`api.rs:2459-2463`) gates on the shared
  bootstrap secret — bounds *who*, not *how many*.
- RTT-store sub-claim PARTLY: the store IS bounded (unconfigured regions dropped `api.rs:1947`,
  last-write-wins per pair) — what's uncapped is per-heartbeat vector length (CPU) + presence roster
  (memory), both bounded only by the 64 MiB ceiling.
- **Fix (M, small parts):** set `ws.max_message_size`/`max_frame_size` to sane values; length-cap the
  heartbeat roster + RTT vectors on ingest; add a semaphore capping concurrent pre-Hello sockets.

### R5 — mesh handshake semaphore doesn't bound queued unauth connections. CONFIRMED.
- `run_mesh_accept` loops `mesh_accept.recv()` and **spawns a task per connection**
  (`relay/src/mesh_edge.rs:357-362`); only inside the task does it acquire
  `MESH_ACCEPT_PERMITS.acquire().await` (`:368`, 8 permits `:131-134`). Upstream is ineffective as a
  total cap: the client-edge admission semaphore is dropped right after TLS for a mesh conn
  (`server.rs:259`), and the `mesh_accept` channel (cap-8, `main.rs:354`) is drained eagerly by
  spawning. A parked task holds a live `quinn::Connection` (memory + conn state).
- Pre-auth reachable: the endpoint accepts anonymous TLS (`RequestClientCert`, `quic.rs:227,252,333`)
  and the cert-fingerprint check is app-layer, after the hello (`mesh_edge.rs:300-312`). Relay is a
  direct-exposed public Fargate task. Mitigations: 5s `MESH_HELLO_TIMEOUT` (`mesh_edge.rs:96,184`),
  10s QUIC idle (`quic.rs:170`) — bound each connection in time, not the count.
- **Fix (S/M):** acquire the permit (or a bounded-queue slot) **before** `tokio::spawn` / before
  taking the connection off `mesh_accept`, so accept back-pressures; optionally require a client cert
  at the mesh TLS layer and/or cap total in-flight mesh connections per peer/IP.

### R6 — reliable stream writes can freeze shared link drivers. CONFIRMED.
- `run_mesh_link` is one driver per relay-pair link serving **all sessions** on it (`mesh.rs:1565`,
  `joined` map). The outbound control channel is `mpsc::unbounded_channel` (`mesh.rs:1605-1606`).
  Control frames are written **inline in the select loop**: the `control_forward_rx.recv()` arm
  awaits `send_mesh_control_frame(...).await` (`mesh.rs:1776-1788`); resume-replay + presence pushes
  are likewise inline (`:1811-1819,:1936`). While that write is suspended on QUIC per-stream flow
  control, the whole `select!` is suspended — no `link.recv()`, no turn fan-out, no presence — for
  every session on the link, while `fan_out_control` keeps enqueuing (memory grows).
- The 10s idle + 5s keepalive (`quic.rs:170,156-185`) only tear down a *silent* peer; a peer that
  keeps its connection alive (quinn auto-acks) but stops reading its control recv-half stalls the
  write **indefinitely**. Multi-relay only; needs a buggy/overloaded/compromised peer relay.
- **Fix (M):** bound `control_forward` and give the writes a deadline / offload them (per-session or
  dedicated writer task, or `timeout()` → `break ConnectionFailed` to reset+redial), mirroring how a
  full forward queue already signals `shutdown` (`mesh.rs:698-711`).

### C7 — config unknown fields + fatal zero interval. PARTLY.
- Tenant config: `TenantsFileRaw` (`tenant_config.rs:59-64`) lacks `deny_unknown_fields` but has one
  meaningful field → a typo yields an empty tenant list → fatal startup anyway; the **nested**
  `TenantEntryRaw` (`:70`) + `BoundsRaw` (`:92`) **do** deny. So tenant-field typos are already
  caught — that half of the review is REFUTED.
- ECS config REAL: neither `EcsConfig` (`provision/ecs.rs:66-67`) nor `EcsRegionConfig` (`:97`) has
  `deny_unknown_fields` → a misspelled security-group / public-IP setting silently defaults.
- Zero-interval REAL: `tick_interval = Duration::from_secs(cli.provision_tick_secs)` (`main.rs:528`),
  env-overridable (`main.rs:264-267`); `tokio::time::interval(Duration::ZERO)` panics at
  `reconcile.rs:207`. The loop is spawned detached (`main.rs:658`), so the panic kills only
  provisioning — the API stays healthy and provisioning silently stops.
- **Fix (S):** add `deny_unknown_fields` to `EcsConfig` + `EcsRegionConfig` (and `TenantsFileRaw` for
  good measure); reject/clamp `provision_tick_secs == 0` at startup.

### C10 — flight-store misconfig detected only on first use. CONFIRMED.
- `S3FlightStore::connect` only builds SDK clients — no `head_bucket`/list probe
  (`flight_store.rs:496-537`); startup logs "flight store configured" after `connect`
  (`main.rs:452-453`). Malformed config JSON / unset credential env DOES fail startup
  (`main.rs:445-459` `resolve_secrets`) — only bucket *reachability* is unverified. A failed PUT is a
  logged loss with no retry (`api.rs:2298-2308`); a failed read is a 500 (`api.rs:938-946`). This is
  the staging sample-bucket-name incident's class.
- **Fix (S):** add a bounded startup probe (head-bucket or bounded list) in `connect`, failing
  startup on error — same fail-closed posture as the tenant registry.

### I1 — promote-coordinator.yml shell injection. CONFIRMED.
- `.github/workflows/promote-coordinator.yml:30-34` interpolates `${{ inputs.sha }}` directly inside
  a `run:` block (no env indirection, no quoting) in a job with `packages: write`; GitHub substitutes
  textually, so metacharacters/newlines execute as runner commands. `workflow_dispatch` is triggerable
  by anyone with write access. **`promote-relay.yml` already uses the safe pattern** — `env: SHA:
  ${{ inputs.sha }}` then `"${SHA}"` quoted (lines 45-46,74,81).
- **Fix (S):** mirror `promote-relay.yml`'s env-var + quoting; add a `^[0-9a-f]{40}$` regex check as
  an early step.

### I2 — relay promotion non-atomic + unserialized. CONFIRMED.
- `promote-relay.yml:60-82` loops per region: `describe-images` (existence check) then *immediately*
  `imagetools create` (retag) for that one region before the next. If region 3 of N is missing the
  image, regions 1-2 are already retagged and the loop `exit 1`s → split fleet. **No `concurrency:`
  block** in either promote workflow (every other workflow has one) → two concurrent runs interleave.
- **Fix (M):** restructure into preflight-all-then-retag-all; add `concurrency: group: promote-relay`
  (and the coordinator equivalent) to both.

---

## Opportunistic (cheap, narrow — pre-prod if time, else fast-follow)

**R3 — empty-session teardown races reconnect. PARTLY.** `maybe_close_emptied_session` reads the
roster under a lock dropped at statement end (`routing.rs:2138`), then non-atomically
`claim_close_report` (`:2154`), `session_closed` (`:2157`), erases state (`:2161-2185`). Narrowed:
`session_closed` only fires the coordinator notice + flushes flight (`consensus.rs:4140-4150`), NOT
`deregister_maker` (`:4176`) — so a reconnect isn't left maker-less; `reopen_close_report`
(`routing.rs:1020`) re-arms the latch. Started sessions are guarded (close defers on a held drop
`:2144-2145`; reconnect for a departed+decided slot fast-fails `server.rs:347`). The real exposure is
**non-started** sessions: close runs immediately even with a held drop, the undecided hold survives
the sweep (`:2180-2181`), a re-dial passes the fast-fail and can register between `:2138` and the
erase → a premature `SessionClosed` to the coordinator + erased lobby log (`:2110-2111`). **Fix (M):**
hold the roster lock across check-and-teardown, or re-check the roster under the `claim_close_report`
latch, or have `register` abort an in-flight close.

**R4 — presence-stream reset leaves stale authority. CONFIRMED (narrow trigger).** The presence
reader ends on stream EOF/reset (`presence.rs:248-250`); the driver's `None` arm merely sets
`presence_alive = false` (`mesh.rs:2003`), no teardown. Presence is the authority-handoff signal
(`live_players`→`record_peer`→`recompute`/`set_authority`, `mesh.rs:1964-1985`,
`presence.rs:206-216`); with the reader dead but datagrams/control alive, this relay freezes its view
→ possible no-authority or competing authorities. No read-side healing (`reconcile_presence`
`mesh.rs:1936` is outbound-only). Asymmetric: the peer's presence *write* failure DOES tear its link
down (`mesh.rs:1940-1941`). Needs a single QUIC stream to die while the connection lives. **Fix (S):**
`break MeshLinkExit::ConnectionFailed` in the `None` arm (redial), or a presence-staleness watchdog.

**R7 — relay/client equal-seq directive tiebreak disagree. CONFIRMED (bounded QoS blip).** Client
tiebreaks equal `decision_seq` by `authority_relay_id` (`client/src/directive.rs:113-124`); relay
`observe_directive` adopts only strictly-greater seq, no tiebreak (`consensus.rs:1905-1910`), so a
peer latches whichever equal-seq copy it saw first. Source split is documented
(`consensus.rs:2293-2300`); on promotion `set_authority` re-affirms `self.buffer` at S+1
(`:2025,:2381-2383`). Impact bounded: `buffer_turns` is clamped 1-6, applied uniformly (no
inter-client divergence → no desync), and the next control-law decision overwrites it. **Fix (S):**
give `observe_directive` the same `(decision_seq, authority_relay_id)` tiebreak.

**R9 — consensus counter hygiene. CONFIRMED (low; debug-panic risk).** `loss_rate` uses
`saturating_sub` but doesn't clamp ≤1.0 (`consensus.rs:442-451`); `target_inputs` has unchecked u32
adds `eff_rtts[0]+eff_rtts[1]` (`:2238`) and `path_turns+loss_turns` (`:2259`), and `eff_rtt` can
saturate from a peer-reported `rtt_us` ingested unclamped (`:2163`). Any inflated target is clamped
by `bounds.clamp` in `decide` (`:2368`) ≤6, so no unbounded buffer / no desync; release wraps (no
`overflow-checks`, `Cargo.toml:247-251`) but **debug/test builds panic**. **Fix (S):** `saturating_add`
at `:2238`/`:2259`; clamp `loss_rate` to `[0,1]`; optionally clamp ingested `rtt_us`.

**I4 — stale `cert_der` doc. PARTLY (the cert_der half is real).** `docs/architecture.md:388` says
`cert_der` is hex-encoded, but `proto/src/control.rs:314-315` is `#[serde(with = "serde_bytes")]
Vec<u8>` → serializes as a JSON byte array under serde_json, and `api.rs:464-468`'s own doc says so
correctly. **Fix (S):** one-line correction to `architecture.md:388`. (The review's mesh-auth /
region-count "stale doc" half was NOT substantiated — the doc matches current code; no action.)

**I5 (slice) — non-hermetic builds.** Add a root `.dockerignore` (there is none anywhere; both
Dockerfiles `COPY . .` — `coordinator/Dockerfile:19`, `relay/Dockerfile:22` — shipping `target/`,
`.git/`), and add `--locked` to both `cargo build`s (`coordinator/Dockerfile:20`, `relay/Dockerfile:23`)
to match CI. **Fix (S).** (Base-image digest pinning + action-tag SHA-pinning are house-style — skip.)

**I6 (terraform) — no fmt/validate CI gate.** `infra/terraform/README.md:170-178` documents manual
`terraform fmt`/`validate`/`plan`; no CI workflow runs them. **Fix (S):** a workflow running
`terraform fmt -check` + `terraform validate` on PRs touching `infra/terraform/**` (no AWS creds
needed for those two). (The MSRV-CI-leg half is backlog.)

---

## Backlog (index only — re-explore when picked up; build plan §2 names the mechanism)

C3 (per-tenant session quota — gated on untrusted multi-tenancy; a **global emergency ceiling** is a
cheap subset worth pulling forward), C9 (webhook per-tenant fairness), C5 (concurrent uploads defeat
desync pinning — `api.rs:2245` snapshot + single sweep `flight_store.rs:226`), T3-main (richer sparse
reconnect state — the scalar `same_relay_anchor` at `driver.rs:1980-1982` can't express an internal
gap; real design work, and the "hang" is really a delayed self-healing window-close), C11
(`CreateFingerprint` omits `latency_estimate_ms`, `session.rs:157-176` — trivial, honest caller never
triggers), C12 (S3 read size cap, `flight_store.rs:566-575`), the MSRV CI leg, and the reviewer's
structural takeaway (a mesh-session transport adapter owning durable receive anchors + both turn
paths, plus a session-lifecycle owner for roster generations / reconnect state / cached directives /
close reporting — the "right" long shape the A-batch point-fixes approximate).

## No action

T4 (path-MTU race — the common outcome is by-design recoverable loss re-carried by the next bundle,
`routing.rs:2665-2678`; the lossy lone-turn outcome needs a near-MTU turn above QUIC's ~1200 B floor,
unreachable at real turn sizes), I3 (dev-beacon unrestricted task spawn `dev-beacon/src/main.rs:128` —
dev-only, in no shipped image), the mesh-auth/region-count half of I4 (unsubstantiated — matches
code), the tenant-entry half of C7 (already `deny_unknown_fields`).
