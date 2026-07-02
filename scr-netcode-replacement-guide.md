# SC:R Turn / Command Networking — Reverse-Engineering Reference

**Purpose.** A self-contained map of StarCraft: Remastered's in-game turn/command
networking, for two audiences:

- **samase_scarf analyzer authors** — which functions/globals matter, how to anchor
  them version-independently, and which already ship in the offset dumps.
- **ShieldBattery netcode implementers** — the exact seam to interpose a custom
  (e.g. QUIC) transport + latency model, the data contracts, and what must stay native.

**Binary this was traced against.** `StarCraft.1.23.10.12409.exe` (32-bit x86), open in
Binary Ninja as `StarCraft.1.23.10.12409.exe.bndb`. All names/comments referenced below
exist in that BNDB. This describes hooking the **real SC:R client** (ShieldBattery-style
DLL injection) — it is unrelated to neobrood's clean-room reimplementation, and lives here
only because that's where the SC:R RE work has been tracked.

> **Corrections (2026-06-23).** An adversarial verification pass against the binary and
> `game/src/bw/commands.rs` fixed several items, marked with ⚠️ below: the inbound hook target
> (§2 / §5.1 — the fill/readiness logic is in `storm_receive_turns` `0x7b1150`, *not* the trivial
> `receive_storm_turns` `0x73f4e0` wrapper), `pending_leave_reason` not being exposed by
> samase_scarf (§5.8 / §6), the replay command ids (§5.7), and the variable-length command rules
> (§3). Two follow-ups still need samase work — see §6.

> **⚠️ Addresses are build-specific. Do not hard-code them as runtime hooks.**
> Every hex address in this doc is a navigation aid for the 12409 BNDB only. SC:R relocates
> on every patch. **Runtime instrumentation must resolve these through samase_scarf**, which
> produces version-independent offsets. Every symbol this doc needs is exposed there — see §6 for
> the list; resolve them at runtime, don't bake in an address.

---

## 1. The model: lockstep turns

SC:R multiplayer (and replay playback, which uses the same path) is **deterministic
lockstep**. The unit of networking is a **turn**, and in SC:R **one network turn == one
simulation frame == one command flush**. There is no "multiple frames per turn"; the turn
rate *is* the simulation frame rate.

Each turn the engine:

1. **Collects** the local player's commands into a buffer (`send_command`).
2. **Flushes** that buffer as this turn's command packet and broadcasts it (`flush_outgoing_command_turn` → `send_turn_message` → Storm/SNP).
3. **Receives** every player's turn packet for the *executable* turn (`storm_receive_turns`).
4. **Dispatches** each player's commands into the simulation (`process_commands`), inside the synced-RNG window.
5. **Steps** the simulation one frame.

**Latency is the gap between send and execute**, expressed in turns, and it is **enforced on
the send side** (see §4), not by Storm. The send cursor runs `latency` turns ahead of the
execute cursor; a command issued on turn N executes on turn N+latency for *everyone,
including the issuer*. (That's why your own units react with the same delay as everything
else — local input is not special-cased.)

```
 send cursor   ─────────────────────────▶  turn N  (just flushed)
                          │  gap = latency turns (built-in + user)  │
 exec cursor   ───────────▶  turn N-latency  ──process_commands──▶  sim step
```

---

## 2. Data-flow map (12409 symbols)

### Functions

| Address | Symbol | Role |
|---|---|---|
| `0x749380` | `send_command` | Append one `[cmd_id,payload]` record to the local buffer. ~80 `issue_*_command` callers funnel through it. |
| `0x748800` | `flush_local_turns_to_latency_depth` | **The latency engine.** Flush until `outstanding >= builtin_turn_latency + (sync? net_user_latency)`. Called by `step_network` each turn. |
| `0x74c420` | `flush_outgoing_command_turn` | One turn's flush: empty-turn keep-alive seed, `send_turn_message`, reset length, append sync command. |
| `0x740de0` | `send_turn_message` | Send-turn wrapper → `sub_7b22d0` (broadcast to `snet_player_list`). **Outbound hook point.** |
| `0x7afb00` | `get_outstanding_turn_count` | `outstanding = sent_seq − executed_seq` (the in-flight pipe depth). |
| `0x73f4e0` | `receive_storm_turns` | ⚠️ **Thin wrapper, NOT the buffer-fill site.** Calls `storm_receive_turns`; on success runs the synced player-leave pass inside the `set_rng_enable` window, then hardcodes `return 1` (`0x73f51c`); `return 0` on failure. Contains no array/readiness logic itself. |
| `0x7b1150` | `storm_receive_turns` | ⚠️ **The real inbound work (and the IN hook target).** `_memset`s then fills the 3 per-slot arrays (`player_turns[]` `0x7b1627` / `player_turns_size[]` `0x7b1647` / `net_player_flags[]` `0x7b133d`–`0x7b1399`), the readiness gate (`0x7b12d0`/`0x7b1369`, checked `0x7b1583`), and drop detection. |
| `0x749060` | `step_network` | Per-turn driver: receive → dispatch each ready slot → `flush_local_turns_to_latency_depth`. |
| `0x747cf0` | `process_commands` | Parse + dispatch one slot's command stream. Records to replay (`add_to_replay_data`). |
| `0x7507c0` | `apply_pending_player_leaves` | Per-slot disconnect application, in the synced-RNG window. |
| `0x74e410` | `apply_player_leave_if_pending` | Single-slot leave apply. |
| `0x6cdff0` | `advance_turn_timer_and_step_network` | Wall-clock turn pacing (drives `step_network`). |
| `0x6ed290` | `recompute_turn_durations` | `game_data.turn_rate` → `turn_duration_by_speed[]`. |
| `0x74be50` | `set_user_latency_command` | Cmd `0x55` handler: writes `net_user_latency`, **clamped to [0,2]**. |
| `0x73b210` | `cmd_set_turn_rate` | Cmd `0x5f`: set turn rate → `recompute_turn_durations`. |
| `0x738240` | `cmd_dynamic_turn_rate` | Cmd `0x66`: set turn rate **and** re-issue a `0x55` latency command. |
| `0x7ae9a0` / `0x7b16b0` | `snet_send_packets` / `snet_recv_packets` | SNP packet I/O. **Entirely below the seam — bypassed, not hooked.** |

### Globals

| Address | Symbol | Meaning |
|---|---|---|
| `0x11ce090` | `outgoing_command_buffer` | Local command accumulation buffer. |
| `0x11ce08c` | `outgoing_command_length` | Bytes currently in the buffer. |
| `0x11cc7c4` | `outgoing_command_capacity` | Overflow-flush threshold for the buffer. |
| `0x11ce29c` | `player_turns[12]` | Per-slot pointer to that slot's command bytes for the turn. |
| `0x11ce2cc` | `player_turns_size[12]` | Per-slot byte length. |
| `0x11cc7d8` | `net_player_flags[12]` | Per-slot state bits: `0x10000` present, `0x20000` **turn-ready** (dispatch gate), `0x40000` throttled. |
| `0x11cc7c8` | `builtin_turn_latency` | Built-in/proto latency (= 2). The pipe-depth floor. |
| `0x11ce298` | `net_user_latency` | Added user latency (Low/High/ExtraHigh = 0/1/2). |
| `0x11ce294` | `sync_active` | Whether `net_user_latency` and the sync checksum apply. |
| `0x11cc7c0` | `game_frame_count` | Global frame/tick counter, read across the whole sim; `step_network` increments it once per executed turn, so it == the executable-turn index (1 turn = 1 frame). |
| `0x11cc7cc` | `is_multiplayer` | Frame-advance gate: `advance_turn_timer` steps one sim frame this tick only when set. (Earlier mislabeled `turns_ready_this_step`; it's the multiplayer flag, not a per-step "turns received" flag — there's no separate global.) |
| `0x11a44e0` | `turn_timer_accumulator` | Drains 1000 µs/tick; tops up `turn_duration_by_speed[speed]` per turn. |
| `0x11a44c4` | `turn_duration_by_speed[7]` | µs per turn, indexed by game speed. |
| `0x11a4598` / `0x11a459c` / `0x11a45bc` | `next_game_step_tick` / `network_waiting_for_turns` / `network_stall_timer` | Pacing + stall tracking. |
| `0xf5db04` | `snet_player_list` | SNP player list (iterated by send/recv). |
| `0x11df110` | `storm_provider_ready` | SNP provider initialized gate. |
| `0x11df108` | `storm_turn_base` | Absolute turn number → ring-buffer index base. |
| `0xf5daf4` / `0xf5dafc` | `storm_turn_min_interval` / `storm_turn_lag_threshold` | Inter-turn throttle / lag thresholds. |

Long-form "how it works" comments live on `flush_outgoing_command_turn`,
`flush_local_turns_to_latency_depth`, `receive_storm_turns`, `storm_receive_turns`, and
`recompute_turn_durations` in the BNDB.

---

## 3. Wire/buffer contracts

### Command stream (per slot, per turn)

`player_turns[slot]` points at a flat concatenation of command records:

```
[cmd_id:u8][payload ...][cmd_id:u8][payload ...] ...
```

- **No per-command length prefix and no frame stamp.** Each command's length is either fixed by
  its id (`command_lengths` table — samase-provided, indexed directly by `cmd_id`, spans the id
  range up through `0x66`) or computed for variable-length commands. ⚠️ The authoritative
  variable-length rules (per SB's own parser, `game/src/bw/commands.rs`) are: **save/load**
  (`0x6`/`0x7`) = null-terminated string starting at offset 5; **old selection** (`0x9`/`0xa`/`0xb`)
  = `2 + data[1]*2`; **new selection** (`0x63`/`0x64`/`0x65` — the SC:R ones) = `2 + data[1]*4`.
  `process_commands` walks the buffer record-by-record using these lengths. (Earlier text gave only
  `select = 2 + data[1]*2` and a `text = 2 + data[1]` rule that isn't in the parser; a
  command-aware relay must use the full set above, esp. the `*4` new-selection case.)
- **The frame is implicit** — it's whatever turn is being dispatched. (The *replay file*
  format adds `[frame:u32][len:u8][player+cmd...]` framing around this; the live per-turn
  buffer does not.)
- **`cmd_id == 5` (length 1) is the empty-turn keep-alive.** Every player must emit a turn
  every turn even with no input, or the lockstep stalls waiting on them. `flush_outgoing_command_turn`
  seeds this automatically when the buffer is empty.
- **The sync command rides inline.** When `sync_active`, `flush_outgoing_command_turn`
  appends a desync-detection checksum command (computed for turn T, carried in turn T+1's
  buffer; verified downstream in `process_commands`).

### `storm_receive_turns` output

For the executable turn it writes three parallel 12-entry arrays:

- `player_turns[slot]    = storm_turn_buffer + 0xC`  (skips a 12-byte header; `*(buf+2)` = total length)
- `player_turns_size[slot] = *(storm_turn_buffer + 2) − 0xC`
- `net_player_flags[slot] = 0x10000 present | 0x20000 ready | 0x40000 throttled`

**Buffer ownership:** `player_turns[]` point into **Storm-owned** receive memory, valid only
through the immediate dispatch. A replacement must supply its own buffers with at least that
lifetime (until the next `receive_storm_turns`).

**Return value = the gate:** `1` only when *every required slot* provided its turn; `0`
stalls (`step_network` returns 0 → `advance_turn_timer` sets `network_waiting_for_turns` and
shows the lag dialog). This is where the all-players-present / latency decision is made.

### Slots

12 slots = players + observers. Observer ids carry bit `0x80`; code masks `& 0xFFFFFF7F` and
maps observers into a `+0xC` region. `storm_player_to_game_id` / `storm_player_to_unique_id`
convert slot → game/unique id.

---

## 4. Latency — where it actually lives

**Latency is game-side, not in Storm.** `flush_local_turns_to_latency_depth` (called by
`step_network` every turn) maintains a pipe-depth invariant:

```c
outstanding = get_outstanding_turn_count();              // sent_seq - executed_seq
target = builtin_turn_latency;                           // proto latency, = 2
if (sync_active) target += net_user_latency;             // + user latency, 0/1/2
while (outstanding < target)
    flush_outgoing_command_turn(++outstanding);          // send another turn ahead
```

So total dispatch latency = `builtin_turn_latency + net_user_latency` turns, realized as
"keep that many turns in flight ahead of the execute cursor." `storm_receive_turns` just
releases turns in order as they become all-present; the *delay* comes from the send side
running ahead. **`net_user_latency` is the only knob with a cap, and the cap is in the command
handler** (`set_user_latency_command` clamps to `[0,2]`) — **the pipe loop itself has no
cap.**

**Mid-game latency changes must be synchronized.** Changing the pipe depth on one peer but not
others diverges their buffers → stall or desync. SC:R makes this safe by routing latency
changes through an **in-stream command** (`0x55`, optionally bundled in `0x66`): every peer
executes it on the same turn and updates `net_user_latency` together. Any custom auto-latency
logic must do the same — transport stats are local, but the *application* of a new latency
must be a synced turn event.

---

## 5. For ShieldBattery: the replacement plan

### 5.1 The seam — three hooks

The cleanest interposition is the symmetric send/receive pair, plus one hook to feed the native
latency loop. Everything above and below stays correct:

| Direction | Hook | What you do |
|---|---|---|
| OUT | `send_turn_message` (`0x740de0`) | Receive the fully-assembled local turn `(buffer_ptr, length)` — keep-alive + sync already baked in — tag it with your turn number and ship via QUIC. |
| IN | ✅ **Fully replace `receive_storm_turns` (`0x73f4e0`)** — decided 2026-07-01, verified against the 12409 BNDB | **Full replacement of the wrapper (do *not* call orig).** Earlier revs of this guide leaned toward hooking the inner `storm_receive_turns` (`0x7b1150`) and reproducing the leave pass in the `0x73f4e0` wrapper. The cleaner choice — confirmed against the binary during integration — is to **replace the `0x73f4e0` wrapper wholesale and never call the original**, so the obfuscated inner `0x7b1150` (which `_memset`s the three arrays) never runs. The wrapper's prologue is *not* anti-tamper-obfuscated and its args are clean: `receive_storm_turns(0, 12, &player_turns, &player_turns_size, &net_player_flags)`. In the replacement: fill `player_turns[]` / `player_turns_size[]` / `net_player_flags[]` from your QUIC buffers (set `0x10000 present \| 0x20000 ready` on ready slots), reproduce the synced-leave pass `set_rng_enable(1)` → `apply_pending_player_leaves` → `set_rng_enable(orig)` (§5.8), and **return readiness** (1 = all required slots present, 0 = stall). This one replacement covers **both** callers — `step_network` (`0x7490d6`) and the receive-only lobby-init sibling `sub_747250` (`0x7472a4`) — since both pass the same three global arrays. (The old warning "hooking only `0x73f4e0` doesn't work" applied to *wrapping* it, i.e. still calling orig; a full replacement is exactly what sidesteps that.) |
| PIPE | `get_outstanding_turn_count` (`0x7afb00`) | Return your own `turns_sent − turns_executed`. Bypassing Storm doesn't just leave this count *stale*: `0x7afb00` gates on `storm_provider_ready`/`data_f5db1c` and calls `sub_7abb00`, which can return null → the function returns a **degenerate `0`**, making `flush_local_turns_to_latency_depth` flush **unboundedly**. So this is mandatory, not optional — and **replacing the trivial flush loop outright is the safer primary choice** (it also reads `builtin_turn_latency`/`sync_active`/`net_user_latency`, which you overwrite anyway). |

**Hook at the transport, not at command buffering.** It's tempting to capture at
`send_command` and replace the whole flush — don't. The empty-turn keep-alive and the sync
checksum are generated *inside* `flush_outgoing_command_turn`; hooking `send_turn_message`
one level down hands you the assembled turn with both already in place, so you don't have to
reproduce them. (`xrefs(send_turn_message)` = just `flush_outgoing_command_turn` and its
anti-tamper alias, so it's the sole in-game turn-send.)

**Turn numbering.** For tagging outbound turns and matching inbound, use your own monotonic
counter (one per `send_turn_message`) — you don't need a game global. `game_frame_count`
(`0x11cc7c0`) is the native executable-turn index (incremented per turn by `step_network`,
1 turn = 1 frame) if you ever need to align the execute cursor, e.g. for observation/replay.

### 5.2 What stays native (and stays correct for free)

- **Command buffering + flush + keep-alive + sync append** (`send_command`,
  `flush_outgoing_command_turn`).
- **The latency pipe** (`flush_local_turns_to_latency_depth`) — stays native and maintains
  whatever depth you configure, **with one caveat**: it reads the in-flight count from
  `get_outstanding_turn_count`, which is Storm-derived (local SNP send/ack sequence counters,
  gated on `storm_provider_ready` / `data_f5db1c`). You bypass Storm's send/recv, so those won't
  advance — and the function can then return a **degenerate `0`** (not just a stale value) →
  unbounded flush, so **hook `get_outstanding_turn_count`** to return your own
  `turns_sent − turns_executed`. That third hook (§5.1) is what keeps the native latency loop
  working. Better still, **replace the loop outright** — it's trivial and avoids the degenerate-0
  trap (§5.1 PIPE).
- **Dispatch + synced-RNG window + simulation** (`step_network`, `process_commands`,
  `set_rng_enable`). Determinism is untouched because you only change *transport* and *when
  turns are released*. (Their internal sequencing flags — dispatch-active, deferred-targeting,
  replay-restricted counters — are native bookkeeping you never touch.)
- **Turn pacing** (`advance_turn_timer_and_step_network`) — pin `game_data.turn_rate = 24`
  for send-every-turn (TR24); 1 turn = 1 frame already.
- **Replay recording** — `add_to_replay_data` runs inside `process_commands`, downstream of
  the seam, so replays keep working regardless of transport.
- **Synced player-leave handling** (`apply_pending_player_leaves`) — but you must *feed* and
  *call* it (§5.8).

### 5.3 Controlling latency (the "one knob")

- **Built-in floor:** write `builtin_turn_latency` (set to 1 for a 1-turn built-in).
- **Added latency, widened range:** write `net_user_latency` directly to `0..N` (bypassing
  the `set_user_latency_command` `[0,2]` clamp), or patch the clamp. The pipe loop (`0x748800`) is
  index-free so it honors any depth — **but** `set_user_latency_command` indexes a latency-label
  string table by `net_user_latency * 7` (`0x74c092`), so any path that refreshes the latency label
  with a widened value **reads out of bounds**. Suppress that label path or extend the table if you
  go past 2.
- **Auto-adjust:** decide a target from QUIC stats, then apply it via a **synced in-stream
  command** (reuse `0x55` without the clamp, or your own command) so all peers change on the
  same turn. QUIC gives you the measurement; it does **not** give you consensus — you still
  need an agreement step. In the server-relay topology (§5.7) the relay/host server is the
  natural authority for this: it aggregates every player's path RTT and issues the change.
- **Watch the native turn-rate commands.** `0x5f` (set turn rate) and `0x66` (dynamic turn rate,
  which *also* re-issues a `0x55` latency command) are still native and processed by
  `process_commands` → `recompute_turn_durations`, which **rewrites the `turn_rate`/latency globals
  you pinned (§5.2) mid-game.** Decide explicitly whether to suppress them, own them via the
  coordinator, or pass them through — and if passed through, re-apply your overrides **identically
  on every client on the same turn** (same synced mechanism as latency/leaves), or you desync.

### 5.4 Invariants you must preserve

1. **A turn from every player every turn** — including idle players. Either transport the
   native `cmd 5` keep-alive, or synthesize an equivalent empty turn into `player_turns[slot]`
   on receive. (You may compress empty turns on the wire, but the game must still *see* a turn
   per slot per turn.)
2. **Transport the sync command faithfully** — it rides inline; `process_commands` verifies
   it. Don't regenerate it. (Or set `sync_active = 0` and knowingly forfeit native desync
   detection.)
3. **Delay local commands too** — lockstep requires the local player's commands to execute on
   the same turn as everyone else's. The native pipe already does this; preserve it.
4. **Buffer lifetime** — `player_turns[slot]` must stay valid through the `step_network`
   dispatch loop.

### 5.5 Gotchas

- **Anti-tamper obfuscation.** `send_command`, `flush_outgoing_command_turn`, and
  `send_turn_message` are wrapped in `rdtsc`/xor junk with a decoy crash path through
  `sub_58b420`. The real logic is the function head + tail; the BNDB comments mark the live
  instructions. (`storm_receive_turns` `0x7b1150`, which you must replace per §5.1, is itself a
  large obfuscated function — budget a startup self-test that a known turn round-trips before
  committing a game to the new transport, and keep an in-game fallback for when a future patch
  reshapes a hooked prologue.)
- **Sync-thread hooks, async transport — mind the boundary.** All three hooks fire on BW's
  game/sync thread, but the QUIC client runs on a separate (Tokio) thread. The OUT hook hands you
  bytes synchronously; the IN replacement must *return* filled buffers synchronously while the data
  arrives asynchronously — so you need an explicit per-turn rendezvous (who blocks, the stall
  timeout, how a stall surfaces) and a **cross-thread buffer-ownership model**: `player_turns[slot]`
  must stay valid through the whole `step_network` dispatch (§5.4 #4), so the async side must not
  free/reuse a turn buffer while the sync side is mid-dispatch (a use-after-free here is
  non-deterministic command-stream corruption → desync). Don't call into the async runtime while
  holding a BW lock the async side can re-enter (this codebase already ships a recurse-checked mutex
  because hooks reenter).
- **Stall UI.** Returning 0 from your receive triggers SC:R's native `run_timeout_dialog`
  waiting-for-players screen. Suppress/replace it if you want QUIC-aware UI.
- **Disconnect integration.** On a QUIC drop, signal the leave through the native synced pass —
  see §5.8 for the mechanism, the call requirement, and the determinism caveat.
- **Rollback is out of scope for this seam.** This is delay-based lockstep (a configurable
  delay buffer). Rollback would need local commands at depth 0 + state save/restore/resim,
  which the SC:R sim has no support for — a much larger, separate effort. The pipe-depth model
  here is the incremental step and leaves that door open.

### 5.6 The wire format is yours — and the one boundary that isn't

You own both ends of the connection, so **the bytes on the wire are entirely yours** — custom
framing, compression, empty-turn elision, whatever's most efficient. Stock-client compatibility
is a non-goal.

The constraint is narrow and worth stating precisely: **two boundaries speak native SC:R
command bytes**, because the code on the far side of each is native and you're keeping it:

- `send_turn_message` hands you the **assembled native turn** (concatenated `[cmd_id][payload]`
  records from the native `issue_*` / `send_command` path).
- `player_turns[slot]` is read by the native `process_commands`, so whatever you put there must
  be **valid native command bytes**.

So your codec is `native bytes → (your efficient wire format) → native bytes`. Re-encode and
compress freely *between* the hooks; you cannot change the command encoding *at* the hooks
without also replacing the command emitters and `process_commands` (a much larger sim-side job).
You do **not** reproduce Storm's 12-byte turn-buffer header — you allocate your own
`player_turns[slot]` buffers; they just need a valid pointer + length to native command bytes.

**Two transport designs — this project wants command-aware:**

- **Command-aware (the path here).** Parse individual commands (needs `command_lengths` + the
  variable-length rules in §3). Required for **async observation** — the relay/observation server
  has to understand, index, store, and serve turns (§5.7) — and useful for command-level
  packing/compression, routing, and validation. You still forward and store **native** command
  bytes; "understanding" means parsing the native stream, not re-encoding the commands themselves
  (the seam boundaries stay native — see the §5.6 intro).
- **Opaque blob (the minimal alternative).** Treat each turn's command buffer as opaque bytes:
  compress, ship, decompress, point `player_turns[slot]` at it. Simplest, but blind — no
  observation indexing, no per-command routing. Not the choice here; viable only if all you want
  is a transport swap.

**Efficiency yes, idle-turn elision no.** Real efficiency (command-aware packing/compression,
smart routing) is worth pursuing. The one thing specifically *not* worth it is **empty-turn
elision**: at TR24 you send a datagram per player per turn regardless — you need a turn signal
every turn to keep lockstep flowing — so eliding the keep-alive saves a few payload bytes against
~40-60 bytes of transport header, and a fully-idle player needs a periodic heartbeat anyway.
Don't spend complexity there.

The largest wins, though, are **behavioral** — but be precise about which layer delivers them.
Turns ride **unreliable** datagrams, so QUIC does *not* recover them: turn sequencing and loss
recovery stay in **your** app-level layer (redundancy + a packet ack bitfield — the approach SB's
current protocol already uses). QUIC contributes encryption, congestion control, connection
migration (client-initiated, for the client's own Wi-Fi↔cellular changes), a per-packet loss
*signal*, and **reliable streams on the same connection** for chat/control/observer-backlog/replay.
So QUIC replaces SC:R's *transport and framing* while **your redundancy layer — not QUIC — replaces
SC:R's turn resend**, and on top you get the adaptive latency model (§5.3) and clean reconnect. The
format being yours matters because it frees you from SC:R's turn/latency quirks and enables
observation/indexing — optimize for *latency, resilience, and observability*, not raw bytes.

Note: with `sync_active`, every turn carries a ~7-byte inline checksum, so turns are never
zero-payload — which keeps native `verify_peer_sync_slot` desync detection working for free as
long as you transport it.

### 5.7 Transport topology: server-relay, and async observation

The intended deployment is **not P2P**. Each player connects to a single home server and sends
all its turns there; servers relay to each other and to their directly-connected players. E.g.
P1→S1, P2→S2, P3→S1, P4→S4: P1's turn arrives at S1, which forwards it to S2 (for P2) and S4 (for
P4) and delivers it directly to P3 (same server). Most messages — game turns — are broadcast to
everyone in the game; the server decides routing.

**This does not change the in-game seam.** From the SC:R client's view, `send_turn_message` and
`receive_storm_turns` are identical regardless of topology — the client just speaks QUIC to its
home server instead of to peers. The relay mesh lives entirely below the two transport hooks
(`send_turn_message` / `receive_storm_turns`), and it cleans
up three things:

- **Reliability / resend — done right this time.** Because you replace `receive_storm_turns`
  wholesale, Storm's turn collection and its resend machinery are **out of the turn path
  entirely** — there are no resend requests to ignore (the old SB approach of letting Storm fire
  resend requests and dropping them goes away). Each player↔server QUIC leg is reliable; the
  server holds the authoritative turn copy and re-sends to any player or peer server that's
  behind, without bothering the originating client.
- **Latency consensus — the server is the authority.** §5.3 needs adaptive latency to be a
  synced, all-peers-agree-on-turn-T change, which QUIC's per-leg stats can't decide alone. The
  relay mesh *is* the agreement point: a server aggregates every player's path RTT and issues the
  synced latency-change command for everyone to apply on the same turn.
- **Async observation — the turn log is the product.** A server that parses and stores every
  turn already holds, in order, exactly what an observer needs. A client can start watching a game
  in progress by pulling the turn backlog from the server, fast-forwarding the deterministic sim
  to the live edge, then following the live stream. The stored log is essentially the replay.
  SC:R's own replay commands — ⚠️ `cmd_replay_set_speed` (`0x56`, `REPLAY_SPEED`) and
  `cmd_replay_seek` (`0x5d`, `REPLAY_SEEK`), both in `process_commands` — are the in-client
  machinery to drive fast-forward/seek inside the observer client. (Earlier this doc listed
  `0x32`/`0x37`; `0x37` is actually `SYNC` — verified against `game/src/bw/commands.rs`.)

Implication: the relay/observation server needs **command-level understanding** of the turn
stream (hence command-aware, §5.6) but forwards and stores **native command bytes**, so any
observer or late-joiner can hand them straight to `process_commands`.

### 5.8 Player disconnects (leaves / drops)

Apply disconnects through the native synced pass `apply_pending_player_leaves`. Each turn, in the
`set_rng_enable` window (entered once this step has turns to dispatch), it drains a per-slot reason from
**`pending_leave_reason`** — an `int32[12]` at `0x11CEF28` (stride 4, slots 0..0xB, immediately
before `net_players` @ `0x11CEF58`) — and runs `process_ingame_player_leave` / `handle_player_leave`
for any nonzero slot (`0x40000006` = dropped → `strPLAYER_WAS_DROPPED`, other nonzero = left →
`strPLAYER_LEFT`), then clears it. ⚠️ **`pending_leave_reason` is not exposed by samase_scarf
today** (§6) — resolve it via a dedicated analyzer anchored inside `apply_pending_player_leaves`
(base = its loop pointer, ~`0x7507e9`), **not** as a fixed delta from `net_players` (that violates
the §6 no-fixed-delta rule and would read/write the wrong live memory on a future patch).

**To drop a QUIC peer:** write the reason to `pending_leave_reason[slot]`. Because the drain runs
in the synced window, it's deterministic **as long as every client sets the same slot+reason on the
same turn, and applies it in the same per-slot order with the same synced-RNG state** (the leave
handlers can consume synced RNG) — the relay coordinates that ("player N leaves at turn T"), exactly
like latency consensus (§5.3).

- **You must call the pass yourself, with the synced RNG enabled.** `apply_pending_player_leaves`
  is invoked by *native* `receive_storm_turns` on success, wrapped in `set_rng_enable(1)` …
  `set_rng_enable(orig)` — it runs **inside the synced-RNG window on purpose**: leave handling can
  consume synced RNG, so it must execute with the same RNG state on every client or it desyncs. Your
  `receive_storm_turns` replacement must reproduce that exactly: after filling the arrays,
  `set_rng_enable(1)` → `apply_pending_player_leaves()` → `set_rng_enable(orig)`. Don't call it with
  RNG disabled, and don't call it outside that window.
- **The turn-stream leave command doesn't work live.** `cmd_replay_player_leave` (handler for the
  `0x57` leave marker) early-returns unless `is_replay`; it exists only so replays reproduce leaves.
  Use `pending_leave_reason`, not an injected `0x57`.

**This is an improvement over native, not just parity.** SC:R sets `pending_leave_reason[slot]` from
an *async* leave message (`handle_player_leave_message`), initiated by whichever client first crosses
its *local* lag threshold (`storm_turn_lag_threshold`, GetTickCount-based, in
`storm_fill_player_turns_and_detect_drops`) and applied at that client's next turn — so the leave
registers at a different turn on each client. The drop message carries the laggard's last turn
sequence, so the simulation boundary (their last executed turn) is shared, and a dropped player's
commands simply stop (synced via the turn stream) — so this is usually cosmetic/progress-timing
rather than a hard desync. But it explains drops appearing at inconsistent points between clients,
and would become a real divergence if a leave ever drove a sim-affecting action (unit sharing,
vision/alliance). Setting `pending_leave_reason[slot]` on a **server-agreed turn** makes the
registration deterministic too. ⚠️ But agreeing the *turn* is necessary, not sufficient: because
the leave handlers run in the synced-RNG window and can consume RNG, every client must also apply
the leave in the **same per-slot order with the same RNG state — including clients that never
detected the drop locally** (the server injects it for them). So treat this as "parity +
determinism *if* you guarantee identical apply-order across all clients," not a free win.

### 5.9 Transport design notes

These are **transport-layer (below-the-seam) design decisions**, not RE findings — but they're
non-obvious enough that a future implementer would otherwise re-derive (or get wrong) the same
calls. The SC:R side is indifferent to all of it; it only ever sees valid turn bytes via the three
hooks.

- **QUIC: unreliable datagrams for the turn stream, reliable streams for control.** Do **not** put
  the turn stream on reliable QUIC streams. Reliable = reactive retransmit (a lost turn recovers ~1
  RTT *after* the loss is detected) and ordered = head-of-line blocking (a lost turn stalls every
  later turn behind it) — exactly what you're trying to avoid. Use **unreliable datagrams (RFC
  9221)** for turns and recover with your own redundancy (below); put chat, lobby/control, the
  observer catch-up backlog, and replay transfer on **reliable streams of the same connection**, so
  congestion control, encryption, and connection migration are shared across both. Caveats: a
  datagram must fit one packet (no fragmentation — size the redundancy bundle to the path MTU), and
  datagrams are congestion-controlled (good, but can be paced under real saturation; at ~24 tiny
  datagrams/sec you'll rarely be cwnd-limited).

- **Forward recovery, not retransmit: bundle unacked turns up to the MTU.** Every per-turn packet
  carries the current turn plus as many still-unacked recent turns as fit in the MTU, so a lost
  packet is recovered by the next one already in flight (~1 turn) instead of a detect-and-retransmit
  round trip. It's free in packet count (rides the per-turn packet you already send) and costs only
  bandwidth — the right trade for a latency-critical game. Because you now **introspect** the stream,
  pack at *turn* granularity: include whole turns, drop precisely the ones a destination has acked,
  and size the unacked window **per destination** (a lossy peer-server leg gets a deeper window than
  a clean one) instead of one-size-fits-all. ⚠️ **"Up to the MTU" is a cap, not a fill target** — in
  steady state the unacked window is a few small turns, so datagrams stay small. The one real hazard
  is *sustained bidirectional* loss (your **acks** dropping too): the window then can't drain and
  grows toward the cap. Bound it, and force-advance it with a periodic **reliable-stream "acked
  through turn X" beacon** when datagram acks aren't getting through; on the rare cap overflow,
  truncate the oldest redundancy but always send the current turn. Also check the datagram-send
  return and treat a refusal as a loss the redundancy already covers, and keep the sequence space
  wide / wrap-handled (a u16 turn counter wraps at ~45 min @ TR24).

- **Per-leg recovery (relay as recovery anchor).** Run the redundancy/ack loop independently on each
  leg (player↔server, server↔server), not end-to-end — the mechanical form of §5.7's reliability
  point. The server holds the authoritative copy and knows each destination's turn-ack state, so it
  re-sends only what *that* leg is missing, from a point closer to it, localizing the cost to the
  lossy leg instead of re-sending across healthy ones. Needs only turn-level framing (sequence
  numbers), which introspection already gives you.

- **Downlink coalescing: deadline-aware, not eager.** Bundling all players' turn-T into one packet
  per player cuts downlink pps, but it is **not free**: a bundle is one loss unit (lose it, lose
  every player's turn-T at once), and holding early turns to aggregate lengthens their ack/recovery
  loop. It does **not** cost execution latency (the player can't run turn T until the straggler's
  data arrives regardless), so the only safe wins come from coalescing **within the latency-buffer
  slack** — hold a turn that arrives with plenty of slack a few ms to coalesce; ship a turn under
  deadline pressure immediately. The server can size that window exactly because it knows the turn's
  sequence number (→ the player's execution deadline), and same-turn-rate arrivals cluster naturally,
  so a tiny window catches most of it for near-zero added latency. Only bother on **weak downlinks**;
  on a healthy one send each turn immediately. Per-connection adaptive knob, not a global policy.

---

## 6. For samase_scarf: the offsets, resolved at runtime

**Every hex address above is 12409-only navigation.** Resolve all of these through `samase_scarf`
at runtime — SC:R relocates on every patch, so never bake in an address, and never derive one
offset as a fixed delta from a neighbour (a layout shift then reads/writes the *wrong* live memory,
which is worse than a missing offset). samase resolves each global independently by signature, so it
is immune to that: e.g. BN's own 12409 database over-runs the 12-slot `net_player_to_game` table and
swallows `game_frame_count` / `outgoing_command_capacity` / `builtin_turn_latency` / `is_multiplayer`
as bogus `[4..7]` elements — samase lands on each correctly anyway.

⚠️ **Caveat: "immune" is true for signature-anchored *globals*, less so for some *function*
analyses that are pattern-heuristic.** E.g. `apply_pending_player_leaves` is found as "the call
right after a `set_rng_enable(1)` inside `receive_storm_turns`" — if a future patch reorders/inlines
that or adds another `set_rng_enable(1)` first, the analysis can silently return the **wrong**
function, and `set_rng_enable(1); call_wrong_thing(); set_rng_enable(orig)` desyncs every client. So
at startup, **plausibility-check** resolved symbols (e.g. `builtin_turn_latency == 2`;
`pending_leave_reason` sits just below `net_players`; the latency-loop target math is sane) and, on
any failure, **fall back to native/rally-point networking for that session** rather than risk a
desync. Treat a new SC:R patch as a samase-release dependency, not a checkbox.

### What's exposed

All of the following resolve via `samase_scarf::Analysis` on both 32- and 64-bit builds (a few of the
turn-pacing pieces are absent only on very old pre-~1.21 builds, which are out of scope). §2 says
what each one is.

| Role | Symbols |
|---|---|
| Local command buffer | `send_command`, `outgoing_command_buffer`, `outgoing_command_length` |
| Flush + send (OUT hook, §5.1) | `flush_outgoing_command_turn`, `send_turn_message`, `flush_local_turns_to_latency_depth` |
| Receive (IN hook, §5.1) | `receive_storm_turns`, `storm_receive_turns`, `apply_pending_player_leaves`, `player_turns`, `player_turns_size`, `net_player_flags` |
| Pipe depth (PIPE hook, §5.1) | `get_outstanding_turn_count`, `builtin_turn_latency`, `net_user_latency`, `sync_active` |
| Dispatch / step | `step_network`, `process_commands`, `command_lengths` table |
| Turn pacing (§5.2) | `advance_turn_timer_and_step_network`, `recompute_turn_durations`, `turn_duration_by_speed`, `turn_timer_accumulator`, `network_waiting_for_turns`, `next_game_step_tick`, `game_frame_count` |
| Storm readiness / SNP | `storm_turn_base`, `storm_turn_min_interval`, `storm_turn_lag_threshold`, `snet_send_packets`, `snet_recv_packets`, `snet_initialize_provider`, `choose_snp`, `init_storm_networking` |
| Player / slot | `command_user` / `storm_command_user` / `unique_command_user`, `local_storm_player_id`, `snet_player_list`, `net_players`, `is_multiplayer` |

The byte `advance_turn_timer` tests to advance a sim frame is `is_multiplayer` — earlier RE notes
called it `turns_ready_this_step`, but it is the same global (§2), not a separate per-step flag.

⚠️ **Gap status (updated 2026-07-01):**

1. **`pending_leave_reason` (§5.8) is not exposed by the samase_scarf fork** — STILL OPEN. It needs a
   dedicated analyzer (anchor inside `apply_pending_player_leaves`, base = its loop pointer
   ~`0x7507e9`). Do **not** resolve it as a fixed delta from `net_players`. Until it lands, the IN
   replacement can still call the native `apply_pending_player_leaves` inside the RNG window (parity
   with native drop handling); the *server-agreed* deterministic-leave write (`pending_leave_reason[slot]`
   on an agreed turn) is what's blocked on it.
2. ✅ **CLOSED (2026-07-01).** The turn-networking symbols are now wired through
   `game/scr-analysis/src/lib.rs`: `send_turn_message`, `receive_storm_turns`, `storm_receive_turns`,
   `get_outstanding_turn_count`, `flush_local_turns_to_latency_depth`, `flush_outgoing_command_turn`,
   `apply_pending_player_leaves`, `player_turns`, `player_turns_size`, `sync_active`,
   `builtin_turn_latency`, `game_frame_count` (plus `net_player_flags` / `step_network` / `enable_rng`,
   which were already exposed). They resolve via `samase_scarf::Analysis` on the pinned fork rev.

Aside from gap #1, the §5 hooks' symbols resolve via `samase_scarf::Analysis`.

---

*Traced and named in the 12409 BNDB. Treat addresses as 12409-only navigation; resolve everything at
runtime through samase_scarf.*
