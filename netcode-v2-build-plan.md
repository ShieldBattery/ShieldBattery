# ShieldBattery Netcode v2 — Build Plan (rev 3)

> **Purpose.** A high-level, sequenced task breakdown for building netcode v2 end-to-end: from
> the in-game seam to a shippable, full-architecture relay platform. Synthesizes the two source
> docs and the build decisions made 2026-06-23.
>
> **rev 2 (2026-06-23):** hardened by a six-lens adversarial review (transport, game-seam,
> mesh/failure-modes, AWS/cost, security, plan-coherence). Its findings are folded into the
> decisions, workstreams, and phases below; the few still-open items live in §6. Two findings
> reversed earlier choices: GA custom routing is a dead-end (now dropped, §D3) and the multi-tenant
> coordinator now isolates production (§D2).
>
> **rev 3 (2026-06-24):** folds in rally-point2 Phase-0 build decisions. Added the shared
> **`transport` crate** (§5) and decision **D12** (replace Storm's UDP transport wholesale).
> Clarified that the transport keys delivery on a per-link `seq` (Storm's own model), distinct from
> any game-frame coordinate a higher layer (D9, open) might use. *(Superseded by rev 4 — the
> per-link restamp was replaced with a client-assigned origin identity preserved end-to-end.)*
>
> **rev 4 (2026-06-28):** reverses the rev-3 per-link seq model. The payload `seq` is now the
> turn's **origin identity** — assigned once by the sending client (the sole authority for its
> own slot's production order) and preserved end-to-end across every hop, never restamped per
> link. Each slot carries its own monotonic seq space starting at 0, so the dedup/ack/retirement
> key is `(slot, seq)`, not `seq` alone. Rationale: restamping at the relay would require holding
> out-of-order turns until contiguous to stamp a game-order seq — violating the
> forward-immediately invariant (a turn is fanned out the moment it validates, never buffered to
> reorder first). Only the sending client knows production order; the relay only sees arrival
> order. The ack-beacon frame correspondingly carries a `(slot, cursor)` pair. ALPN bumped
> `rp2/3 → rp2/4`. D12 updated to reflect the new model.
>
> - **Game seam** — [`scr-netcode-replacement-guide.md`](scr-netcode-replacement-guide.md)
>   (corrected against the binary 2026-06-23; ⚠️ markers flag the fixes).
> - **Infrastructure brief** — the "Netcode v2 Architecture Brief."
>
> Altitude: workstreams, phases, milestones — not file-level steps. Each phase ends in something
> demonstrable.

---

## 0. Decisions

D1–D8 settled first; D9–D11 added by the rev-2 review; D12 by rev-3 build work.

| # | Decision | Consequence |
|---|---|---|
| **D1** | **QUIC turn data-plane lives in the game DLL.** BW's three hooks run on the **game/sync thread**; the quinn QUIC client runs on the DLL's **Tokio thread**; they are joined by a **bounded lock-free handoff** with an explicit turn-buffer ownership model. | "No IPC on the hot path" means no cross-*process* IPC (the Electron app stays control-plane only) — there *is* an in-process cross-thread boundary, and it carries buffer-lifetime + hook-reentrancy hazards that are first-class design work. |
| **D2** | **Coordinator is a standalone Rust service; production is isolated.** Prod runs its **own** coordinator + signing key + relay fleet. **One shared** coordinator (+ fleet) serves **staging + developers only**. | Matchmaking/lobby stays in the per-tenant app server (Node `server/`); the coordinator only finds/spins up relays. Per-tenant signing keys throughout (D6). Prod never shares fate with external devs. |
| **D3** | **v1 substrate = AWS Fargate + scale-to-zero + region beacons, with DIRECT dual-stack relay public IPs. No Global Accelerator.** | GA custom routing is IPv4-only *and* EC2-only — incompatible with Fargate/IPv6, so it's dropped. Backbone benefit is on the `S===S` hop only (no anycast last-mile). IPv6-primary client ingress is now viable. Per-game relay IP rotation becomes a real DDoS lever. |
| **D4** | **Design for observation; defer the spectator client.** Whether the relay persists (and replicates) a per-game turn log is **open, not settled** (cost unmodeled). | The relay is command-aware (it parses turns to validate, D10), so a turn log is *feasible* — but persisting one from day one and replicating it across the mesh is **not assumed**: the per-concurrent-game storage + replication cost needs a real model first (this is the failover question, D11). *If* such a log exists, failover and observer catch-up would share one "replay from cursor X" primitive — contingent on the failover design, not a given. No spectator/late-join UI this effort. |
| **D5** | **Environment-isolated relay fleets.** Prod fleet isolated (own coordinator, D2). Shared **staging** fleet serves SB staging + trusted devs (scale-to-zero ≈ free). Untrusted devs run a **fully local** coordinator+relay loopback (never touches the shared coordinator/fleet). | Coordinator provisions per fleet; the local-dev path is a self-contained mini-coordinator (not "no coordinator"), so the dev config still exercises tokens/leaves/consensus. |
| **D6** | **Per-tenant signing keys + authenticated relay enrollment.** Each app server has a keypair registered with its coordinator; **each tenant has its own signing key** (not one global key); tokens carry a `kid` and are **bound to the client's QUIC connection**. The **app (Electron) generates the client's per-session Ed25519 keypair** and requests a token embedding the public key *before* the game launches — the game DLL receives `{token, private_key, relay_addr}` at launch handoff and proves key possession to the relay via a challenge-response **bound to the connection's TLS channel** (an RFC 5705 keying-material exporter folded into the signed challenge) after QUIC connect. Relays authenticate at phone-home via a coordinator-injected bootstrap secret. | Authorize/revoke/attribute per tenant; key compromise is contained to one tenant; a stolen bearer token is useless off its connection (no private key); the channel binding stops a relay the client trusts but that is malicious or mis-selected from forwarding the token and replaying the client's signature onto a different session it holds; a rogue relay can't register and MITM. App-driven keypair generation avoids a game-startup→coordinator round-trip on the load-time path. |
| **D7** | **Region selection uses GameLift's public UDP ping beacons** — with ICMP-to-relay-region as a **first-class** fallback. | Free and independent of scale-to-zero relays, but newer (GA'd 2025-06), rate-limited (3 TPS/sender), no China, and beacon coverage must be verified against lit regions. Cache aggressively; don't hard-depend. |
| **D8** | **Observability is first-class, built from day one.** Per-game **flight recorder** (turn stream + per-link health + events) keyed by `tenant/session/slot/turn`; the command-aware relay is the server-side vantage point. | Diagnostic data exists even when the client can't report it. Caveats: the correlation key isn't fully populated until the coordinator exists (Phase 3) — earlier phases use a placeholder; and the **flush-to-durable-store before scale-to-zero teardown** is a *design* requirement, not an afterthought. |
| **D9** | **Runtime latency-buffer authority = the relays, NOT the coordinator.** The coordinator sets *bounds* at setup; a relay decides the live buffer size and adjusts it as conditions change. | The relays sit in a fixed priority order; the highest still in the game (serving live players) is the decision-maker — it picks the buffer and broadcasts a "set buffer size" command all clients obey, authority falling to the next relay as ones drop. It needs the **whole game's** network conditions but only sees its own home clients' links (loss/RTT, which QUIC measures per connection), so each relay attaches those conditions to the turns it forwards across the mesh; the decision-maker combines them, and the conditions also reach clients for an in-game netgraph/debug. No per-decision coordinator round-trip, so running games survive a coordinator outage. Distinct from *transport* identity — delivery/dedup keys on a per-slot origin `seq`, not a frame coordinate. The **consensus coordinate is now defined:** each `Payload` carries an `optional uint32 game_frame_count` naming which simulated step the turn belongs to, distinct from the transport-identity `(slot, seq)`; the relay preserves it verbatim across the seam (like `seq`), and lobby turns carry no frame (absent, not zero). The **sync mechanism keyed on it remains open (Phase 3):** no "set buffer size" proto message, broadcast, max-frame tracking, or future-turn scheduling exists yet — the coordinate is the input the mechanism will key on, not the mechanism itself. (Player-leave consensus is a separate, still-open decision.) (Current detail: `rally-point2/docs/architecture.md`.) |
| **D10** | **The relay is a VALIDATING relay, not a dumb forwarder.** It binds each submitted turn to the token's slot, bounds-checks every command against `command_lengths` + var-length rules, allowlists live command ids, and **strips client-originated control commands** (`0x55`/`0x66`/`0x5f`/`0x57`/replay cmds). | It already paid the command-aware cost — so it must capture the defensive upside. Prevents slot-spoofing, control-command griefing that bypasses D9, and parser-crash desyncs. Parser is attacker-facing → fuzzed. |
| **D11** | **Relay death mid-game is an unrecoverable lockstep stall**, and the substrate (scale-to-zero/Spot) makes relay churn routine — so failover needs a real answer, but the **mechanism is open** (not a settled Phase-2 deliverable). | Moving affected clients to another relay and recovering their missed turns at an affordable storage/replication cost is **not yet designed**. Likely ingredients — a backup relay in the token, a client reconnect+resync path, and *some* source for the missed turns — but persisting/replicating a full per-game turn log is **not assumed** (cost unmodeled). Client reconnect infrastructure (also useful for a client's own transient drops) is desirable but unplanned. **Spot is forbidden for in-flight games** regardless. |
| **D12** | **Replace Storm's UDP transport wholesale; don't tunnel it.** The game hooks at the turn/command layer (`send_turn_message`/`storm_receive_turns`), so Storm's 12-byte UDP header (Seq1/Seq2/CLS/PlayerID/resend/checksum) sits *below* the seam and is removed. rally-point2's `Packet` + QUIC own sequencing, acks, integrity, and recovery; the wire `Payload` is `seq` + `slot` + `game_frame_count` (optional, the consensus coordinate) + raw command bytes. | Kills the old double-reliability overhead (Storm's reliability layered under the relay's). Transport keys on a **per-slot origin `seq` assigned by the sending client and preserved end-to-end** (Storm's own sender-assigned model, not a per-link restamp); each slot carries its own seq space starting at 0, so the dedup/ack/retirement key is `(slot, seq)`. `game_frame_count` rides as a read-only consensus annotation — the transport ignores it for delivery/dedup/retirement, and the relay preserves it verbatim (like `seq`), so latency-buffer and leave decisions can name the turn they apply to. `ack_bits` extends Storm's single-ack `Seq2`. Lobby commands ride the same seam today (may later move to a reliable side-channel driven by the app server); lobby turns carry no frame (absent, not zero). |

**Inherited (load-bearing):** three-hook seam; QUIC datagrams for turns + reliable streams for
control; app-level forward recovery (recovery is **ours**, not QUIC's — see §4); relay mesh +
topological dedup (degrade-to-single-relay is **open**, D11); determinism invariants (guide §5.4) as
acceptance criteria.

---

## 1. The system in one picture

```
   prod app server ─tenant─▶ ┌───────────────────┐        shared coordinator ◀─tenant─ staging app server
                             │ PROD coordinator   │        ┌───────────────────┐      ◀─tenant─ dev app servers
                             │ (own key + fleet)  │        │ STAGING+DEV coord  │
                             └─────────┬──────────┘        │ (own key + fleet)  │      [untrusted dev: fully
   policy (latency/leave bounds),      │ provisioning      └────────┬──────────┘       local loopback coord+relay]
   tokens(kid, conn-bound),            │ (RunTask, scale-0)         │
   session descriptors,                ▼                            ▼
   per-tenant quotas             ┌──────────────┐  phone-home (authn'd)   ┌──────────────┐
                                 │ AWS Fargate  │◀───────registry────────▶│ AWS Fargate  │
                                 │ relay (v4+v6 │                          │ relay        │
                                 │ direct IP)   │                          │              │
   ┌─────────┐  token+region     └──────┬───────┘                          └──────────────┘
   │ app/    │◀── (control plane) ──────┘
   │Electron │
   └────┬────┘
        │ launch handoff (token, client privkey, home + backup relay addr)
        ▼
   ┌─────────────────────┐  QUIC datagrams (turns)   ┌──────────────────────────┐ backbone ┌────────┐
   │ game/ DLL           │═════════════════════════▶ │ RELAY (home)             │◀══S===S═▶│ RELAY  │
   │ sync hooks ⇄ Tokio  │  reliable streams         │ VALIDATES (D10) · mesh   │          │ (peer) │
   │ (lock-free handoff) │  (chat/control/resync)    │ dedup · sets buffer (D9) │          │        │
   └─────────────────────┘                           │ (failover/log: D11, open)│          │        │
                                                      └──────────────────────────┘          └────────┘
        client ──▶ home relay's DIRECT public IP (no anycast).  Region chosen via GameLift beacons.
```
| **B** | **Client transport** | `rally-point2:client` | quinn client; datagram turns + reliable streams; **per-slot origin payload seq** assigned by the client and preserved end-to-end (transport identity, *not* a game-frame coordinate); forward recovery (datagram-refusal-aware); PIPE counter (real monotonic count); **home-unreachable → reconnect+resync** path *(open, D11)*. |
The transport *below* the OUT/IN hooks **is** the relay mesh. The relay — not the coordinator —
owns the latency-buffer decision, validation, and the flight recorder (a replicated turn log is open, D4/D11).

---

## 2. Workstreams

| WS | Track | Lives in | Scope |
|---|---|---|---|
| **A** | **Game integration** | `shieldbattery:game/` | The 3 hooks (IN hook on `storm_receive_turns`, guide §5.1) + samase offsets + write `player_turns[]` + synced leave pass; SC:R-specific glue; depends on `rally-point2:client`. |
| **B** | **Client transport** | `rally-point2:client` | quinn client; datagram turns + reliable streams; **per-slot origin payload seq** assigned by the client and preserved end-to-end (transport identity, *not* a game-frame coordinate); forward recovery (datagram-refusal-aware); PIPE counter (real monotonic count); **home-unreachable → reconnect+resync** path *(open, D11)*. |
| **C** | **Relay** | `rally-point2:relay` | quinn server; slot→relay table; mesh `S===S`; topological dedup; per-link recovery; **command validation (D10)**; **latency-buffer decision + network-condition propagation (D9)**; turn-log store *(open, D4/D11)*; flight recorder (D8). |
| **D** | **Coordinator** | `rally-point2:coordinator` | Multi-tenant control: registry (authn'd phone-home), region assignment, **per-tenant token issuance + quotas**, session-descriptor push (incl. backup relay), provisioning. Sets the latency-buffer **bounds**, not the live decision. **Active-player presence:** relays report opaque `(tenant, session, slot)` liveness periodically; the coordinator resolves to users via the `(tenant, session, slot)→user` map it already holds from session setup, and exposes an "is user U in a game" query so the app server can block re-queueing while a player is live. |
| **E** | **App-server integration** | `shieldbattery:server/` | Coordinator tenant: lobby formation requests a session; relays tokens + home/backup relay to clients; enforces **client-version homogeneity** at lobby. |
| **F** | **Client control plane** | `shieldbattery:app/` | Region beacons (+ ICMP fallback) → home region; **generate per-session Ed25519 client keypair**; token/relay fetch (pubkey embedded in token); **launch handoff** (`{token, private_key, relay_addr}` → game DLL). |
| **G** | **Cloud / ops** | `rally-point2:infra` | Fargate task def (dual-stack, IPv4 egress for ECR pull via NAT/IGW); scratch image; **warm-pool fallback** for cold start; scale-to-zero; per-game IP rotation. **No GA.** |
| **H** | **Observation foundations** | `rally-point2:relay`+`:coordinator` | *Design-for (D4):* a turn-log store + backlog API for observation/catch-up — **open** (D4/D11), storage/replication cost unmodeled; would share the store with D11 failover. No spectator client. |
| **I** | **Observability & diagnostics** | all components | Structured metrics/events/traces keyed by `tenant/session/slot/turn`; per-link health; flight recorder + **flush-before-teardown** + pull-by-game post-mortem. |
| **J** | **Resilience & failover** | `rally-point2:relay`+`:coordinator`+`:client` | *(Failover/reconnect mechanism open, D11.)* Relay-death detection + client reassignment; `S===S` partition detection + coordinated response; coordinator HA / running-games-survive-coordinator-outage; reconnect/migration; **end-to-end turn-delivery tracking** (§6). |
| **K** | **Release engineering** | both repos + `infra` | Protocol/schema **versioning** + negotiation; cross-repo CI for `game/`→`rally-point2:client`; **SC:R-patch resilience** (hook-resolution CI + startup plausibility gates + native fallback); cutover/migration + canary (rollback on v2 health thresholds); load/scale testing. |

### How the source docs map onto the workstreams

| Guide § / Brief § | WS | Integration point |
|---|---|---|
| guide §5.1 OUT `send_turn_message` | A→B→C | Native turn bytes → wire codec → home relay datagram. |
| guide §5.1 IN — **`storm_receive_turns` (0x7b1150)**, *not* the trivial `receive_storm_turns` wrapper | C→B→A | Relay datagrams → fill `player_turns[]`, set ready flags, run synced leave pass. |
| guide §5.1 PIPE `get_outstanding_turn_count` | B | Real monotonic `sent − executed`; or replace the flush loop outright. |
| guide §5.3 latency / §5.8 leaves | C + D | **Relay** decision-maker sets the latency buffer from game-wide conditions; coordinator sets bounds (D9). |
| guide §5.6/§5.7 command-aware | C + H + (D10 validation) | Relay parses native bytes to validate/index/store; forwards native bytes unchanged. |
| guide §5.9 forward recovery | B + C | Bundle unacked turns; per-link ack bitfield — recovery is ours (see §4). |
| brief §2.1 mesh/dedup | C | Slot→relay map drives fan-out + dedup. |
| brief §3/§5/§6 cloud | D + G + F | Provisioning, direct-IP ingress, beacons. (GA removed.) |
| (new) failover == catch-up | J + H | A turn log *could* serve both relay failover and observer catch-up — open (D4/D11). |

---

## 3. Build order (phases → milestones)

Sequenced so the riskiest novel work (seam + transport + mesh + failover) is proven before
cloud-plumbing toil. Transport/mesh **logic** is proven locally under emulation (`tc`/netem,
toxiproxy); real-WAN/backbone on the AWS substrate itself (direct relay IPs — no anycast to add).
GA is gone, so there is no GA phase.

### Phase 0 — Contracts, scaffolding & baseline
*Freeze interfaces; establish the baseline you'll measure v2 against.*
- `rally-point2` repo (Rust workspace). Shared `proto` crate: wire framing (turn datagram layout —
  per-slot origin payload seq + slot + commands, ack bitfield; **no game-frame coordinate in the turn
  framing**), **protocol version + negotiation**, coordinator↔relay control, coordinator↔app-server
  API, token format (per-tenant key, `kid`, connection-binding claim).
- Port `command_lengths` + var-length rules into shared code (for D10 validation + parsing).
- Confirm samase resolves every symbol incl. `storm_receive_turns` and **`pending_leave_reason`**
  (not currently exposed — must be added, and **not** via a fixed-delta from `net_players`). Define
  **startup plausibility gates** for resolved offsets.
- **Cross-repo dependency + CI strategy (decided 2026-06-25):** `rally-point2` lives in its own
  GitHub repo; `game/` depends on `rally-point2:client` as a **git dependency pinned to a SHA** (no
  crates.io — not worth a publish pipeline for a single internal consumer). Build out and test the
  transport/relay/coordinator as far as **internal + loopback tests** allow *before* integrating into
  the game, then integrate; the game's pin is bumped only at integration. The cross-repo integration
  build (a `proto`/`client` change → rebuild the `game/` DLL) lands **with** that integration — the
  dependency edge doesn't exist until WS-A wires it, so there's nothing to guard before then.
- **Spike (parallel):** confirm Fargate task dual-stack ENI gets routable v4+v6 with direct ingress,
  and the ECR-pull egress path (NAT/IGW) cost.
- **Milestone:** interfaces compile + reviewed.

### Phase 1 — Seam + transport, single relay (keystone)
- WS-A: OUT/IN/PIPE hooks + native↔wire codec; **IN seam on `storm_receive_turns`**; honor §5.4
  invariants; define the **async(Tokio)→sync(game-thread) handoff** + buffer ownership; add a
  **hook-fired self-test** before committing a game to the new transport.
- WS-B: quinn client; datagram turns + reliable control; **per-slot origin payload seq** assigned by
  the client and preserved end-to-end (transport identity, not a game-frame number); forward
  recovery that **treats datagram-send refusal as a loss event** and sizes the bundle to the live
  `max_datagram_size()`; reliable-stream **ack-beacon fallback** when the
  unacked window would overflow under sustained loss.
- WS-C: minimal validating relay — one game, `C–S–C`, no mesh.
- WS-I: instrument from the first line (placeholder session key until Phase 3); per-game flight
  recorder with a **defined durable-store target + flush protocol**.
- Run under netem/toxiproxy.
- **Milestone:** a real 1v1 SC:R game runs over the new transport via a single validating relay,
  rally-point bypassed, no desync, latency knob adjustable, flight recorder captured. *Highest-risk
  gate.* (Consider splitting into 1a hooks+loopback / 1b single-relay if scope demands.)

### Phase 2 — Mesh, dedup, degradation **+ failover (D11)**
> **Scope caveat (revised):** the **settled** Phase-2 core is the mesh — relay↔relay links, topological
> fan-out + dedup, per-link recovery — plus carrying per-client network conditions across it (for the
> latency-buffer decision, D9). The **failover, replicated turn log, degrade-to-single-relay, and
> resync** items below depend on D4/D11, which are now **open** (mechanism + storage/replication cost
> unsettled). Treat them as design work to settle *before* committing to build, not as fixed
> deliverables. Current design detail: `rally-point2/docs/architecture.md`.
- WS-C: relay↔relay QUIC links (**one connection per relay-pair**, §6); topological fan-out + dedup;
  per-link recovery; carry per-client network conditions across the mesh (D9). *Open (D4/D11):* degrade
  to `C–S–C`; a **replicated turn log**; a real **capacity model** + in-RAM turn-log bound + flush.
- WS-J *(open, pending the D11 failover design)*: **relay-death detection + client reassignment +
  resync-from-cursor**; `S===S` **partition** detection + coordinated (never client-independent)
  response; reconnect path.
- Prove logic locally under netem; prove real-WAN + backbone on **two AWS boxes in two regions,
  direct IPs**. Same-region `C–S–C` measured as a **budget vs rally-point** (added crypto+parse+
  telemetry under load), not a binary "no worse."
- **Milestone:** cross-region 2v2 over `C–S===S–C` on AWS; dedup confirmed; **kill a relay
  mid-game → game survives via reassignment**; partition one `S===S` link → deterministic outcome on
  all clients.

### Phase 3 — Coordinator MVP (multi-tenant, prod-isolated) **+ latency-buffer authority on the relays (D9)**
- WS-D: standalone Rust service; authn'd relay phone-home registry; app-server API (session for N
  players/regions); **per-tenant** token issuance + **quotas/rate-limits/provisioning budget**;
  session-descriptor push incl. **backup relay**; **prod = separate deployment** (D2).
- WS-C/J: the relay decision-maker runs the live latency-buffer decision from game-wide network
  conditions (D9); coordinator pushes *bounds*; **running games survive coordinator outage**;
  coordinator HA story. (Player-leave consensus is a separate, still-open decision.)
- WS-E: Node `server/` becomes a tenant; enforces client-version homogeneity at lobby.
- The decision-maker's buffer **control law**: asymmetric (raise fast, lower slow), hysteresis, min
  dwell, schedule the change at an agreed future turn + anti-flap test.
- **Milestone:** game stood up end-to-end through the coordinator from the dev app server; **staging
  + a developer share the shared coordinator** while **prod runs its own**; induced WAN oscillation
  does not flap the latency knob.

### Phase 4 — Region selection
- WS-F: ping GameLift beacons (D7) + **first-class ICMP fallback** → latency map → home region
  (cached); verify beacon coverage maps to lit regions; logical regions.
- **Milestone:** clients auto-select home region by measured RTT. (Phase 3 used app-server-supplied
  region as placeholder.)

### Phase 5 — AWS orchestration (Fargate, scale-to-zero, direct IP)
- WS-G: Fargate task def (dual-stack, **IPv6-primary client ingress now viable** since GA is gone;
  IPv4 egress for ECR pull); scratch image; lobby-time provisioning; scale-to-zero; **warm-pool
  fallback** if the lobby doesn't hide cold start; per-game IP rotation (DDoS).
- WS-K: load/scale test — N concurrent games per relay + simultaneous provisioning (RunTask rate
  limits) at a realistic SB peak; cost model incl. NAT, cross-AZ `S===S`, telemetry egress,
  1-min-from-image-pull minimum.
- **Milestone:** relays spin up per-game on Fargate during lobby, scale to zero, **warm pool covers
  the cold-start tail**, load test passes.

### Phase 6 — Hardening, observation/observability finish, cutover
- WS-J: reconnect/migration — QUIC migration handles the client's own path changes (Wi-Fi↔cellular);
  **relay change / failover is an app-level resync, not QUIC migration**. **0-RTT is dropped** —
  marginal benefit against replay surface + maintenance; reconnect uses a 1-RTT handshake.
- WS-K: protocol-version negotiation verified across independently-deployed components; **SC:R-patch
  runbook** (hook-resolution CI + native fallback on resolution failure); **cutover** — version-gated
  cohorts, parallel-run vs rally-point, **rollback criteria from v2's own health thresholds**
  (stall/desync/drop/reconnect/connection-success, via the flight recorder — not a rally-point
  comparison), decommission gate.
- Security: fuzz the command parser (D10); validate per-tenant key rotation + connection binding;
  DDoS posture **without GA** (Shield Standard covers AWS L3/4 but no anycast dispersion — lean on
  per-game IP rotation + app-layer rate limits; Shield Advanced/Spectrum as a near-term option).
- WS-H/I: turn-log sufficiency validated (if a turn log is adopted); flight recorder egress + pull-by-game post-mortem +
  alerting; **tenant-scoped authz on every backlog/recorder read**.
- **Milestone:** v2 is default for migrated cohorts on a measured improvement vs baseline; support
  can pull any recent game's recorder; rally-point retired once the decommission gate is met.

---

## 4. Cross-cutting concerns

- **Determinism invariants (guide §5.4) are acceptance criteria.** Turn-per-slot-per-turn; sync
  command verbatim; local commands delayed; `player_turns[slot]` valid through dispatch.
- **The latency-buffer decision runs on the relays (D9), not the coordinator.** A priority-ordered
  relay decision-maker sets the live buffer from the game-wide network conditions (gathered from each
  relay's home clients and carried across the mesh with the turns); the coordinator only sets bounds. No
  per-decision runtime path blocks on the coordinator. (The cross-client sync mechanism is open: each
  `Payload` now carries its `game_frame_count` consensus coordinate, but the "set buffer size" command,
  broadcast, max-frame tracking, and future-turn scheduling that key on it are unbuilt — Phase 3.)
- **The relay validates (D10).** "Control commands originate only from the coordinator-driven synced
  path" is an invariant alongside the determinism invariants.
- **Resilience (D11/WS-J) — partly open.** Whatever response relay death and `S===S` partition get must
  be *coordinated*, never independent per-client decisions — but those responses themselves are **not
  yet designed** (D11). Coordinator outage is already survivable: the relays, not the coordinator, run
  the live game.
- **Observability is instrument-as-you-build (D8).** Correlation by `tenant/session/slot/turn`;
  server-side relay is the vantage point; per-link attribution is the headline capability; sample/
  aggregate transport stats (don't bloat the datagrams); **flush before scale-to-zero teardown**.
- **Multi-tenancy (D2/D6).** Prod isolated; per-tenant signing keys, quotas, connection-bound
  tokens; authn'd relay enrollment; tenant-scoped data access.
- **Versioning & patch resilience (WS-K).** Independently-deployed components negotiate a protocol
  version; offset resolution has startup plausibility gates and a native fallback on SC:R patch day.
- **Transport hygiene.** Recovery is **ours**, not QUIC's — app-level redundancy + ack bitfield over
  unreliable datagrams (QUIC gives encryption/CC/migration/loss-signal). Cap the unacked window and
  force-advance it with a reliable-stream ack-beacon under sustained loss; check `send_datagram`
  returns as loss events; size bundles to the live `max_datagram_size()` (truncate, never drop the
  current turn). **One QUIC connection per relay-pair** (streams don't isolate datagram congestion).
  Pin the congestion controller explicitly (loss-based to start; BBR on the backbone if queueing
  shows up). No 0-RTT.

### 4.1 Transport design rationale — this is *not* a standard reliable-ordered protocol

> Read this before "fixing" the transport. Reviewers (human and automated) repeatedly pattern-match
> the data plane against a standard reliable-ordered protocol (TCP/QUIC-streams) and flag intentional
> choices — out-of-order delivery, no relay-side reassembly, no retransmit-timeout, ack-only handling —
> as bugs, pushing the design back toward something that *looks* correct but breaks lockstep. It is a
> latency-first lockstep relay by design. The load-bearing model:

- **Payloads are the unit of meaning; packets are just containers.** A `Payload` is one slot's commands
  for one turn. A `Packet` is a transport envelope. A packet's `seq` is **only an ack handle** — it
  identifies which payloads a packet carried so an incoming ack can retire them. It orders nothing and
  requires no in-order delivery; packets may arrive in any order and that is fine.
- **Loss recovery is redundancy, not retransmit-on-timeout.** Each packet carries a fresh payload plus
  still-unacked recent ones up to the datagram budget. A dropped packet's payloads ride the *next*
  packets automatically — no waiting a round-trip to detect loss and resend. Turns are tiny, so the
  bandwidth cost is negligible; the latency saved is a whole RTT per loss, which lockstep cannot spend.
- **Send flow.** The game says "send this turn"; the client packages that turn + any still-unacked
  payloads into one packet (monotonic packet seq) and sends it. The relay **buffers each peer's unacked
  payloads** (bounded per client) and builds its **own** packets — multiple payloads, its own packet
  seqs — re-carrying them for redundancy.
- **The relay forwards ASAP, with no inbound reordering.** A turn is validated and fanned out the
  moment it arrives, because a peer must hold a turn *before* it simulates that turn. Buffering incoming
  turns to put them back in order before forwarding would add exactly the latency the relay exists to
  remove.
- **Game ordering is a client concern, restored per slot above the transport.** Each slot's origin
  `seq` IS that slot's authoritative game order — assigned by the sending client (the sole authority
  for production order) and preserved end-to-end, so the client reorders by it per slot: it buffers
  received turns by `(slot, seq)` and releases only the contiguous prefix per slot. The packet `seq`
  is a separate, per-link ack handle that orders nothing. Because the origin seq is never restamped, a
  datagram reorder that slips past redundancy does not scramble game order — the client's per-slot
  reorder buffer reconstructs the sender's true order from whatever arrival order the datagrams took.
  What redundancy cannot cover is a pure-loss gap (a turn dropped on every packet that carried it), and
  that is the only remaining edge a higher-layer resync would close (still being designed, see D11) —
  not reorder, and not something a perfectly-ordered per-hop transport is added to fix.

**Why standard reliable-ordered streams are wrong here:** head-of-line blocking (one lost packet stalls
every later turn on that stream) and retransmit-on-timeout (a round-trip to recover each loss) each
freeze lockstep, where every client advances only as fast as the slowest turn. The whole point of the
redundancy + forward-ASAP design is to pay a little bandwidth to never pay that latency.

---

## 5. Repo / project layout

Two repos. Netcode-v2 services + portable client transport live in the **new all-Rust
`rally-point2/`** (replacing `../rally-point/`, decommissioned in Phase 6). SC:R glue + app/UI stay
in **`shieldbattery/`**.

**`rally-point2/`** — Rust workspace: `proto` (wire/control/token/version + `command_lengths`),
`transport` (per-link reliable delivery over unreliable QUIC datagrams — ack/redundancy + sequence
buffer, ported from `game/src/netcode/`; shared by client + relay), `client` (portable client
endpoint, consumed by `game/`), `relay` (validating relay, mesh, flight
recorder), `coordinator` (multi-tenant control), `infra` (Fargate/beacon IaC, no GA). Prod vs
shared-staging/dev coordinators are the **same code, separate deployments + keys** (D2).

**`shieldbattery/`** — `game/` (WS-A, depends on `rally-point2:client`), `server/` (WS-E), `app/`
(WS-F).

Cross-repo dependency pinning + CI is a **Phase-0 contract decision**, not an afterthought.

---

## 6. Open questions & unresolved risks

**Netcode / transport:**
- [ ] **End-to-end turn delivery has no bound.** Per-link recovery localizes cost, but a turn can
  clear one link and be lost on the next; three chained per-link stalls can blow the latency budget
  without any single link looking bad. Add end-to-end completion tracking (the authoritative relay
  tracks per-destination final delivery, not just next-hop ack) and have the latency-buffer decision factor
  hop count. — *WS-J.*
- [ ] **Recovery-window vs downlink-coalescing byte budget** on a datagram — define it when
  implementing coalescing (low-stakes: the window is small and coalescing is weak-downlink-only).
- [ ] `S===S` inter-relay auth (mutual certs vs coordinator-issued secret). *(Connection model is
  decided — one QUIC connection per relay-pair.)* **Deferred from coordinator-driven mesh-Join
  wiring:** the accept side labels each link with the peer id from a *self-asserted* `MeshHello`
  (`relay/src/mesh_edge.rs::run_mesh_accept`), and `MeshControl` registers the link under that id with
  no auth binding. Since the mesh edge is server-TLS-only (no client auth), any peer that completes the
  mesh ALPN can claim another relay's id and receive that peer's targeted session `Join`s — and replace
  the real peer's sender under the same id. When this lands: bind the `MeshHello` `relay_id` to
  authenticated relay identity (cert subject or coordinator-issued mesh credential), and reject
  unexpected / duplicate ids *before* `links.send` registers the link.
- [ ] **Mesh session-id tenant scoping.** `MeshPacket` carries a bare `session: u64`; ids are unique
  only within a tenant, so the driver keys per-session state on `SessionKey` and fail-closed refuses a
  colliding id across tenants (the wire can't disambiguate them). Settle whether a mesh link
  authenticates for a single tenant (making the collision unreachable) or many — likely folded into
  `S===S` auth above, the natural place to bind a link to its tenant. One benign gap remains until then:
  `MeshControl` marks a `Join` delivered when *enqueued*, not when the driver accepts it, so a refused
  colliding `Join` silently never forms and isn't retried on the occupier's leave. The *dangerous* half
  (a refused tenant's later `Leave` evicting the legitimate holder) is already fixed — the driver's
  `Leave` matches the full `SessionKey`. Close the rest with the tenant-binding decision, or by mirroring
  the driver's collision rule in `MeshControl`.
- [ ] **Active-player presence tracking.** The app server needs to block re-queueing for users already
  in a game. Both directions of the control connection are built — descriptors down, a relay-level
  liveness heartbeat up (already driving deregister-on-drop). What remains: extend that heartbeat to
  carry opaque `(tenant, session, slot)` presence, add a coordinator-side presence store, and expose an
  "is user U in a game" query (the coordinator resolves slot→user from the map it already holds at
  session setup). Reporting is periodic (off the hot path); a connection drop is the prompt signal (that
  relay's users become queueable at once), a heartbeat TTL covers a connected-but-silent relay. **No
  user identity in the token** — the relay stays PII-free (its parser is attacker-facing and fuzzed,
  D10); only the coordinator sees user ids, and any relay-side user identity rides the descriptor push,
  never the client token. Open: heartbeat TTL multiple, and fail-open vs fail-closed when the presence
  store is unavailable.
- [ ] **Coordinated relay drain (scale-to-zero).** A relay with no clients should shut down (Phase 5),
  but a bare exit races the coordinator assigning it a fresh session. Before shutting down, a draining
  relay should signal the coordinator up the control connection and await an ack that it has been marked
  ineligible for new assignments — closing the window where the coordinator otherwise only learns it is
  gone from the connection dropping (deregister-on-drop, now settled). Builds on the liveness channel;
  pairs with presence tracking. (A relay *moving* mid-session drops its sessions — seamless continuity
  across that is failover/D11, not the dialer's retarget, which handles the between-session case.)

**Game seam / determinism:**
- [ ] **Synced player-leave determinism.** Agreeing the turn isn't sufficient — every client must
  apply the leave in the same per-slot order with the same RNG state, including clients that never
  detected the drop locally. Prove it, don't assert (guide §5.8).

**Substrate / cloud:**
- [ ] Cold-start budget: measure Fargate launch + image pull; confirm warm-pool size per lit region.
- [ ] DDoS without anycast: validate Shield Standard coverage on raw Fargate public IPs; decide when
  Shield Advanced / Spectrum is required (likely near-term).
- [ ] GameLift beacon coverage maps to lit regions; rate-limit caching; ICMP-fallback parity.
- [ ] **Dual-stack advertise address (follow-up to relay enroll).** A relay serves clients on both
  IPv4 and IPv6 (D3 direct dual-stack IPs), but enroll today carries a single `relay_addr` — the relay
  asserts one address via `--advertise-addr` (defaulting to `--listen`, else loopback for dev). The
  next pass models **both families**: `RelayHello`/`RelayEntry`/`RelayPeer` carry a v4 *and* a v6
  endpoint, and the consumers gain family selection (which a client dials, which a mesh peer dials).
  Note this is a real contract reshape, not a bolt-on optional field, which is why it's separated from
  the enroll loop. `RelayHello` is already `#[non_exhaustive]`, so the second family is additive.
  Address discovery stays an explicit flag until the Fargate/ECS-metadata integration derives it
  (observing the connection's source IP was rejected: the relay reaches the coordinator over only one
  family but must advertise both). Stable per relay — no per-game IP rotation, so enroll addresses
  don't churn.
- [ ] **Coordinator↔relay control-protocol skew (part of WS-K versioning).** The control endpoint
  (`/relay/control`) and the `RelayToCoordinator`/`CoordinatorToRelay` frames are a contract between two
  **independently deployed** components, so a rolling deploy can run a newer coordinator against older
  relays (or vice versa). Today both sides predate any release, so there is nothing to be skew-compatible
  *with* — but before v2 ships, this needs the WS-K negotiation story: the frames already carry
  `ProtocolVersion` and skip `Unknown` message kinds, so the path is version-gate the endpoint (or
  negotiate at the `Hello`) and add explicit old-relay/new-coordinator and new-relay/old-coordinator
  skew tests. Don't bolt on a legacy-path shim for the *current* unreleased endpoint — that would be dead
  code.

**Security / tenancy:**
- [ ] Tenant enrollment + key rotation/revocation flow (states: active/suspended/revoked, checked
  per request); how a developer is granted/revoked staging access.
- [ ] Untrusted-dev local loopback: confirm it truly never touches the shared coordinator/fleet.

**Observability / data:**
- [ ] Flight-recorder durable-store target + flush protocol within Fargate `stopTimeout` (≤120s);
  format + retention + PII policy for `session↔user`.

**Coordinator HA:** RTO, registry in shared store, hot-standby — gates the multi-tenant claim.

**Settled (was open — short record; detail in `rally-point2/docs/architecture.md`):**
- **Deregister-on-drop / connection-lifetime enrollment** — a dropped or silent (missed-heartbeat)
  control connection deregisters the relay; a generation fencing token closes the reconnect race.
- **Token connection-binding** — the client signs the relay's nonce *plus* a TLS channel binding (RFC
  5705 exporter) with its per-session key, defeating a mis-selected/malicious relay relaying the proof,
  with no client TLS cert.
- **On-demand mesh dialing** — the dial side is driven by the coordinator's descriptors (the Join
  source's desired-peer set): one supervisor per peer, redialing on failure, retargeting on a peer's
  address change, cancelled on removal, with abort-safe forward-channel cleanup.

---

*rev 2 synthesized 2026-06-23 from `scr-netcode-replacement-guide.md` (game seam) + the Netcode v2
Architecture Brief, hardened by a six-lens adversarial review. Decisions D1–D11 are load-bearing.*
