# `/netstat` overlay — design

What the in-game network-stats overlay should show, for whom, and why. Covers the rework of the
existing overlay (`game/overlay-ui/src/netstat.rs` + `game/src/netcode_v2/net_stats.rs`).

## Who reads it, and for what

**A player mid-game** asks one question: *"is the lag me, the server, or someone else?"* They need
a glanceable answer, not a debugging session — a small number of values with color language
(quiet = fine, amber = look here), readable in a two-second glance during play. The existing
per-slot table (arrival age / interval / gap / stall attribution) already answers "someone else";
what's missing is the *me vs. server* half: own-link quality over time, and what the latency
buffer has been doing.

**An operator almost never sees `/netstat` live.** Operators see it as a **screenshot in a bug
report**, hours or days later. That reframes the operator value entirely: the overlay is the
*courier* of the identifiers and recent history that turn a vague report ("it lagged around the
20-minute mark") into a direct lookup — the rp2 session id and relay id key straight into the
admin game page's relay history and the flight-recorder blobs (`<tenant>/<session>/<relay_id>`).
Every pixel of operator value is "would this screenshot let me find and reconstruct the incident
without asking the player anything else?"

So: one overlay, two jobs — *live triage* for players, *incident courier* for operators. Both are
served by the same principle the current overlay already follows: calm when healthy, specific when
not.

## Changes

### 1. Identity header (operator courier)

Replace the "Turn rate 24/s" line (a constant under netcode v2 — pure noise) with the identity
line an incident lookup needs:

```
session 1783817817540254 · relay 2 (local-b)
```

- Session id and current relay id are already known to the DLL (credentials + the driver-owned
  relay id, which advances on re-home — so the header is live truth, not launch-time state).
- The relay's *region* comes from the game setup payload (see §4); omitted when unknown.
- Buffer line stays (`buffer 3 turns · changed 2×, last 41s ago`), as does the own-link state
  line. Both are live-triage and courier value at once.

### 2. Time-sampled history strips (player triage + courier)

The buffer-history sparkline only gains a point when the buffer *changes*, so a healthy game draws
nothing and an unhealthy one draws a shape with no time axis. Replace change-driven plotting with
**1 Hz sampling into fixed ring buffers** (120 samples ≈ the last 2 minutes) in `NetStats`:

- **buffer depth** (step-line; the directive changes remain visible as steps, but now *when* they
  happened is legible because x is wall time),
- **own-link round-trip time** if the client crate exposes it (the driver publishes link
  conditions for the buffer control law; if that surface isn't reachable from the DLL today, the
  strip is omitted rather than faked — implementer verifies),
- **worst per-slot arrival gap in the sample window** (the "someone else" signal over time).

Strips share the x-axis and render as compact labelled sparklines (painter primitives, no new
deps). Sampling at 1 Hz into fixed rings is negligible cost and gives screenshots a real
time-series to read. A strip labels its current value on the right edge (e.g. `buffer 3t`,
`rtt 34ms`) so the graph and the number never need cross-referencing.

### 3. Recent-events ticker (courier)

A 5-entry ring of one-line events with in-game timestamps (`mm:ss` since game start):

```
12:41  re-homed relay 2 → 1
09:03  buffer 2 → 3 turns
07:58  link lost (2.1s)
```

Sources already instrumented or trivially instrumentable: buffer directive changes, own-link
transitions (with outage duration on restore), re-home (dead → new relay id). This is the single
highest-value courier addition: a screenshot then carries not just "state now" but the last few
minutes of *what happened*, aligned with the strips' time axis.

### 4. Per-player home region/relay (player + courier)

New column in the per-slot table: each player's **home relay at session create** (`r1 local-a`
style, region omitted when the setup carried none). Honesty rule: peers' re-homes are not
observable client-side (re-home is app-server-mediated per client group), so peer rows show the
*create-time* home; only the header's own-relay is live. That is still genuinely useful — in a
cross-region game it answers "which players share my relay" (whose problems correlate with mine)
and gives operators the full relay set to pull blobs for.

Plumbing (additive): the SB server already holds each slot's assigned relay + region
(`slot_homes` in the coordinator response + the requested regions); include
`{ relayId, region? }` per slot in the netcode-v2 game setup payload, thread through the launch
config into the DLL, and resolve rows the same way names resolve today. Slots without the data
render an em-dash (old server / region-less dev).

### 5. Removals

- **"Turn rate 24/s"** — constant by design under v2; replaced by the identity header.
- Nothing else: the age/intv/gap/stall table earns its place (it is the "someone else" answer).

## Non-goals

- **Live peer re-home tracking** — not client-observable; would require new wire surface for
  marginal value. The admin page + flight recorder own that truth.
- **Peer link-quality columns** (their loss/rtt at their relay) — the mesh carries per-client
  conditions for the buffer law, but surfacing another player's connection quality to opponents
  is information they can weaponize socially ("your fault") faster than it helps; stall
  attribution already identifies the blocking slot without exposing raw connection quality.
- **Interactivity** — stays render-only, input-transparent.
- **Plotting dependency** — painter primitives suffice for sparklines.

## Verification

Renderable states (healthy, degraded, post-rehome, cold-start) exercised in `overlay-preview`
(knobs + `--smoke`); live check = one loopback game with `/netstat` up through a relay blip,
screenshotted via the debug surface.
