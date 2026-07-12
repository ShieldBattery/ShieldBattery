# Netcode v2 Region Selection — Design

Phase 4 of the netcode v2 production arc (build plan §2). How players get matched to and homed on
relays that are actually near them, replacing the v1 rally-point ping pipeline's role in both
matchmaking quality and game-time placement.

## Decisions

- **Per-player home relays from day one.** A session's slots each home on a relay in the region the
  player asked for; slots sharing a region share a relay; cross-region sessions use the existing
  mesh (the same machinery `dev_relay_split` exercises today). There is no "pick one region per
  game" step anywhere.
- **The coordinator owns the region registry.** Regions have their own opaque naming scheme (not
  AWS region names — non-AWS regions must stay possible). Config file, not CLI flags.
- **Clients never talk to the coordinator.** The SB server fetches the region list (tenant-signed),
  caches it, and forwards it to clients — the same trust shape as everything else in v2.
- **Clients measure their own latency** (GameLift UDP ping beacons primary, TCP-connect fallback),
  keep the full region→RTT table locally, and report only `(desiredRegion, rttMs)` when they queue
  for matchmaking or join a lobby.
- **The SB server picks nothing.** It passes each slot's desired region through to the coordinator
  at session create; the coordinator maps regions to live relays.
- **Matchmaking latency model:** a candidate match's estimated latency is
  `rtt(p1 → regionA) + backbone(regionA → regionB) + rtt(p2 → regionB)`, using a static
  region-to-region backbone RTT table in server config. (Later the table could come from live mesh
  RTT measurements — the relays have those numbers — but static is fine to start.)
- **Settings:** an advanced "Server region" setting, default **Auto**. Auto displays what it
  resolved to (region + measured ping); the manual options are the server-provided region list. A
  manual pick that later disappears from the region list is treated as Auto.

## rp2 side

### Region config

`--regions <path>` on the coordinator: a JSON file listing the regions it allows (JSON because
serde_json is already in rp2's dependency-lean workspace; no new crate for config parsing). Per
entry:

- `id` — opaque string, the wire name everywhere (`"us-east"`, not `us-east-1`)
- `display_name` — what clients show in settings
- `beacon` — `host:port` of the region's GameLift UDP ping beacon (primary measurement target)
- `fallback` — `host:port` of an always-up TCP endpoint in the region (e.g. an AWS regional API
  endpoint); clients measure TCP-connect time when the beacon path fails

Ping targets live here — one registry — so the region ids and their measurement targets can never
disagree across configs. No config file (dev loopback) means no regions: everything degrades to
today's region-blind behavior.

How the file gets set/deployed in production is deliberately out of scope here (Phase 5/6
territory, alongside tenant enrollment).

### `GET /regions`

Coordinator endpoint returning the configured list (ids, display names, ping targets).
Unauthenticated GET, following the `GET /tenant/:tenant/pubkey` precedent — the request-signature
scheme covers body-carrying mutations, and this data is client-public by design (SB forwards it to
every client). The SB server is the only intended caller.

### Relay enrollment

Relays gain a `--region <id>` flag, carried in `RelayHello` as a new optional field (additive; the
hello has an explicit extensibility note for exactly this). The coordinator validates the id
against its region config at enroll and refuses unknown ids (a typo'd region silently serving
nobody is worse than a failed enroll). A relay with no region is legal (dev) and is used only as
the no-region/fallback pick.

### Placement

`SessionRequest.players[]` gains an optional per-slot `region` (additive JSON). `assign_relays`
becomes per-slot:

- Slot has a region and a live relay serves it → home there (deterministic: lowest relay id within
  the region).
- Slot has no region, or no live relay in the region → fall back to the global lowest-id available
  relay (today's exact behavior). Pre-provisioning (Phase 5), an unlit region simply falls back;
  a per-region fallback *ordering* is punted to Phase 5 alongside provisioning.

Slots sharing a region share a relay, so a same-region game stays single-relay. Distinct regions
produce the multi-relay `slot_homes` shape the dev split already produces — mesh, descriptors,
tokens, and lifecycle are unchanged.

The **rehome replacement pick** becomes region-aware with the same policy: prefer a live relay in
the region the dead relay's slots were homed in, else any available. (Noted as a known
region-blind spot during the failover review.)

`dev_relay_split` is fully generalized by per-slot regions (forcing a cross-relay session = give
the slots different regions) and can be deleted once SB's dev tooling drives regions instead —
cleanup, not part of this arc.

### Local dev / testing

Loopback keeps working with zero config: no `--regions`, region-less relay, region-less requests.

But region behavior must be *exercisable* locally, not just compile — the dev stack grows:

- A **dev beacon** binary: a tiny UDP echo (the same send-bytes-get-bytes-back shape as a real
  GameLift beacon) that also accepts TCP connects on the same port (serving as the region's
  fallback target), with a configurable **artificial response delay per listener**. Fake regions
  then have genuinely different RTTs on loopback, so client auto-ranking, the settings display,
  and the matchmaker's latency inputs are all end-to-end testable without AWS. (The delay applies
  to the UDP echo only — a TCP handshake completes in the kernel before `accept()`, so
  connect-time measurement on loopback can't be artificially delayed; the TCP listener exists so
  the fallback path has something real to connect to, and fallback *ranking* isn't exercisable on
  loopback.)
- A dev regions file (e.g. `local-a` at ~10ms, `local-b` at ~80ms) pointing at dev-beacon
  listeners, plus two relays enrolled with `--region local-a` / `--region local-b`. Giving players
  different desired regions then produces a real meshed cross-relay session — the same shape
  `dev_relay_split` forces today, but through the production path.

At some point we'll want to *simulate* provisioning (a region with no relay that gains one on
demand) for rp2 testing — noted for the Phase 5 design, not built here.

## SB side

### Region list distribution

The server fetches `GET /regions` from the coordinator at startup, caches it (refresh on an
interval, serve stale on coordinator error — the list changes rarely and games must not depend on
the coordinator being reachable at that moment), and publishes it to clients the same way the v1
rally-point server list was published: a subscription pushed at client connect, plus deltas if it
ever changes mid-session.

### Measurement (app side)

A region ping manager in `app/` (successor to `rally-point-manager.ts`, same shape):

- **Primary:** UDP pings to each region's beacon — several attempts spaced to respect the beacon
  rate limit (3 TPS/sender), take the median. All regions in parallel; a full sweep is ~2s.
- **Fallback (per region):** median TCP-connect time to the region's `fallback` endpoint. Only
  used to *rank* regions, so TCP-vs-UDP skew is acceptable; a mixed table (beacon for some regions,
  TCP for others) is fine for the same reason.
- **When:** at app start, on network change (watch the default-route/interface fingerprint), and
  every few hours while running. The last table is persisted only so settings can display
  something before the first sweep finishes; freshness comes from re-measuring, not cache
  lifetime.
- **Total failure** (beacon and fallback both dead for every region): surface the manual region
  picker — the user can always tell us where they are.

### Desired region

`desiredRegion` = the manual setting if set and still present in the region list, else the
lowest-RTT region in the measured table. Reported with its measured `rttMs` (null if manual with
no measurement — tolerated downstream as "no latency signal", like an empty `serverPings` today).

### Queue / lobby plumbing

Matchmaking queue requests and lobby joins gain `(desiredRegion, rttMs)`; the server stores it on
the queue entry / lobby member. Queueing keeps v1's gate: wait for a first measurement (the
`waitForPingResult` analog — it's ~2s, and only cold). This is also the natural vehicle for the
Phase 6 backlog item "submit client pubkey at queue/lobby time instead of game load" — same
request surfaces, same lifetime — but that's sequenced separately.

### Matchmaking

`RsQueueRequest.serverPings` is replaced by `(desiredRegion, rttMs)`; the Rust matchmaker's
latency estimate for a candidate match becomes the three-term sum above, with the backbone table
supplied via server-rs config. Everything downstream (`maxLatency` on formations, quality math)
keeps its shape — only the estimate's derivation changes.

### Session create

The game loader already builds the per-slot roster for `createSessionForGame`; each slot gains the
player's desired region (from the queue entry / lobby member state), forwarded to the coordinator
in `SessionRequest.players[]`. Lobby members who somehow have no region (shouldn't happen given
the join-time gate) are sent region-less and fall back at the coordinator.

### Settings UI

Advanced setting "Server region": Auto (default) + one entry per server-provided region. Auto
renders its resolution, e.g. "Auto — US East (24ms)". Manual entries can show the measured ping
alongside. Stored in local app settings.

## Punted / open

- **No-relay-in-region fallback ordering + provisioning** — Phase 5, alongside lobby-time
  provisioning and its local-dev simulation story.
- **Backbone table sourcing** — static config now; possibly derived from live mesh RTTs later.
- **Region config deployment/admin story** — with Phase 5/6 infra work.
- **Beacon coverage verification** — when the real region list exists, verify every listed AWS
  region actually has a GameLift beacon (no China; some regions may lack one) and pick fallback
  endpoints; until then the config format just makes both targets explicit per region.
