# samase_scarf handoff — Storm session internals for native-lobby-over-rp2

This is slice 0 of the native-lobby-over-rp2 plan (see `netcode-v2-synced-leave-design.md` §
"Netcode v2 lobby setup — the native-lobby-over-rp2 plan (2c)"). It blocks slices 2–3 (the DLL
host/peer hooks). Everything below marked VERIFIED was read directly from the 12409 BNDB
(2026-07-06 RE pass); all addresses are 1.23.10.12409 navigation aids, never runtime values.

## Why these symbols

The DLL will keep native `storm_create_game` on the host, replace `storm_join_game`'s networking
on peers with a roster-driven "success tail", and seed `snet_player_list` on both sides from the
coordinator roster (replacing the async peer-admit that normally happens inside the SNP packet
pump). That requires resolving the Storm session-player machinery at runtime.

## Functions — required

### `storm_join_game` @ 0x7b0220 (VERIFIED)
cdecl, 8+ args: `arg2` = player-name string; `arg4` = int32 out-ptr (set to `storm_turn_base - 1`
at entry); `arg6`/`arg7` = expected game-id/version (compared to `data_11df2d8`/`data_11df2dc`);
`arg8` = pointer to the 12-byte host net key.
**Anchors:** entry guard `storm_local_player_slot != 0xff` → error `0x85100079`; distinctive STORM
error immediates `0x85100079`, `0x85100067`, `0x85100069`; sets join-in-progress flag
`data_11df1b4 = 1`; calls `storm_session_player_lookup_or_create(arg8)`; two-phase handshake via
`sub_7ae5b0` waiting msg type **2**, then types **9 and 0xa**.
**Verification signature:** takes a 12-byte net key + name, refuses if already in a session, runs
the 2→{9,10} StormMessage handshake, on success writes the assigned slot/name and drains the
deferred queue.

### `sub_7ad3a0` — deferred SNET queue drain (VERIFIED; **new analyzer — a replacement hook MUST call it**)
cdecl, zero args, returns a value (becomes join's return). Mutex-protected drain of the linked
list headed at `data_f5db28` (mutex object `0x11df0e8`): lock → pop/unlink one node → unlock, then
per node: **`node[3] += storm_turn_base`** (rebases a queued turn number relative→absolute),
`sub_960690(0x534e4554 /* 'SNET' */, 1, node[2], &node[2])` (dispatch into the SNET provider),
free the node's buffer + the node; loop until empty.
**Why it's load-bearing:** SNET packets arriving during join, before `storm_turn_base`/local slot
are known, are queued here; skipping the drain drops those early turns and leaks the queue. It's a
zero-arg call — resolve it and call it, don't replicate.
**Anchors:** the `'SNET'` immediate `0x534e4554`, mutex `0x11df0e8`, queue head `data_f5db28`, the
`+= storm_turn_base` rebase.

### `storm_session_player_lookup_or_create` (`sub_7ab9d0`) @ 0x7ab9d0 (VERIFIED)
cdecl, 1 arg = pointer to a 12-byte net key. Traverses the session-player list (next @ `node+4`,
MSVC low-bit/null sentinel) comparing 3 dwords at `node+0x108`; on miss allocates via
`sub_7aca10(&snet_player_list, …, 2)` and initializes: `+0x108` = key, `+0x21a` = word `0xffff`
(unassigned), `+0x11c` = `GetTickCount()`, bumps `storm_session_player_count`.
**Verification signature:** 3-dword key compare at +0x108 with insert-on-miss + count bump.

### `get_local_storm_session_player` (`sub_7abb00`) @ 0x7abb00 (VERIFIED)
Returns the existing local node (single-element local list at `data_f5db10`) or creates one via
`sub_7aca10(&data_f5db10, …, 2)`: key region at +0x108 zeroed, `+0x21a = 0xffff`, `+0x11c =
GetTickCount()`.

### `storm_register_slot_name` (`sub_7ac8c0`) @ 0x7ac8c0 (VERIFIED)
cdecl, 2 args: slot (rejected `>= 0x100` with ERROR_INVALID_PARAMETER), name. Grows
`slot_name_count` (zero-filling new 0x80-byte entries) then `string_concat`s the name (max 0x7f
chars + null) into **`slot_name_registry + (slot << 7)`** — 128-byte stride, matching the plan's
`data_11df0fc[slot<<7]`. Skipping it makes `net_cmd_lobby_slot_setup`'s per-slot name lookups
resolve empty.
**Verification signature:** `slot < 0x100` guard, 127-char copy into `base + slot*128`.

### `find_storm_session_player` @ 0x7aba90 (VERIFIED)
cdecl, 1 arg = slot byte; returns null for `0xff`, else linear-scans the session-player list for
the node whose **byte at +0x21a** equals the slot.

## Functions — conditional

### `sub_7ae5b0` — blocking wait / message pump @ 0x7ae5b0 (VERIFIED; **DROPPED from the analyzer list** — 2026-07-06)
Samase-dev report: inlined on 64-bit builds, so no standalone analyzer is possible there — and none
is needed. It was listed only for the wrap-join fallback; the committed full replacement of
`storm_join_game` skips both waits, and a full-function replacement swallows any inlined copies.
If the primitive is ever wanted, reimplement it from `snet_recv_packets` + `snet_send_packets` +
a `GetTickCount` deadline, checking the receipt table (`snet_msg_receipt_table`, 0x11df388 on
12409) — i.e. the fallback samase ask would be that table's global, not this function.
`int sub_7ae5b0(int count, uint32_t* msgTypeArray, int arg3, uint32_t timeoutMs, void* callback)`,
cdecl. Loop: `memset(&data_11df388, 0, 0x40)` (16-dword receipt table indexed by msg type),
optional callback, `snet_recv_packets()` + `snet_send_packets()`; succeeds when every requested
type (bounds `u< 0x10`, index `type<<2`) is nonzero in the table; times out via `GetTickCount()`
against `timeoutMs` (join passes `data_f5daf0`).

### `process_async_lobby_command` @ 0x735ba0 / `sub_73f490` @ 0x73f490
**Likely NOT needed.** The `?`-command verdict landed on option 1 (drop; the `game+0xE4C8` writes
have no reader anywhere in the init/alliance surface and `lobby_state=3` has no consumer), with
option 2 (build the record locally + call `sub_736410` — no wire, no transport tap) as the
fallback if the staging-table effect proves live. Option 3 (hooking this path) is ruled out
either way. `sub_736410` @ 0x736410 would need an analyzer only under option 2. See the design
doc's Open decision section for the evidence + settling experiment.

## The join success tail (0x7b04e4 → end) — the peer replacement's reproduction target (VERIFIED, exact order)

1. `data_11df1b4 = 0` (clear join-in-progress) — **SKIP, no samase symbol needed** (see below)
2. `sub_7b0670(<netkey temp>)` — release the net-key temp buffer (pairs with the earlier
   `sub_7b0670(arg8)`) — only relevant if the replacement reuses native's temp
3. guard: `storm_local_player_slot != 0xff` (must be assigned; ours comes from the roster)
4. `data_11df120 = <join arg>` — stash a join parameter global — **SKIP, no samase symbol needed**
   (see below)
5. `get_local_storm_session_player()`, then on that node:
   `+0x21a = storm_local_player_slot` (byte); name into `+0x08` (≤0x7f + null); second string into
   `+0x88` (≤0x7f + null); `storm_register_slot_name(storm_local_player_slot, name)`
6. `*out_player_id = storm_local_player_slot + storm_turn_base`
7. **`sub_7ad3a0()`** — deferred-queue drain; its return is the join return value
8. host session-player node `+0x20c = 0` (state byte, was set 1 during join setup)
9. `data_11df1b4 = 0` again
10. return TRUE if `storm_local_player_slot != 0xff`

Plus roster seeding (replacing the async peer-admit): for every roster member,
`storm_session_player_lookup_or_create(net key)` → `+0x21a = slot`, admitted flags (see the +0x118
gap below), `storm_register_slot_name(slot, name)`.

### Steps 1/4/9's globals — deliberately NOT samase symbols (RE-verified 2026-07-06)

The tail writes two globals the symbol list omits, and both are dead under a **full** replacement:

- **`data_11df1b4` ("join in progress"): leave it unwritten.** Its only writers are inside
  `storm_join_game` itself (set 1 at entry 0x7b02c5, cleared on every exit) — `storm_create_game`
  and all callers never touch it, so a hosted game runs with it at 0 always. Its ONE reader is
  `snet_recv_packets` (0x7b179d): flag==1 merely *relaxes* the per-packet sender-identity check
  (advertised sender slot must resolve via `find_storm_session_player`, else the packet is dropped)
  during the handshake window when the mapping isn't final. The roster-driven replacement seeds the
  mapping before any packet flows, so the strict flag==0 behavior is exactly what we want. (Also
  refuted: the deferred queue is NOT gated on this flag — `sub_7ae490` enqueues unconditionally;
  the tail's `snet_drain_deferred_queue` call flushes it.)
- **`data_11df120` (session-advertise value): leave it unwritten.** It's `storm_join_game`'s 9th
  and last argument (`retn 0x24` = 9 dwords; the same value the host passes as `storm_create_game`
  arg4 — distinct from arg4-of-join, which is the playerID out-ptr). Its ONE reader is the
  game-advertise routine `sub_7ac950` (0x7ac9b1), which passes it verbatim into the network
  provider's advertise callback (provider vtable+0x1c) on the lobby-listing heartbeat — no Storm
  logic branches on it, and nothing in turn/gameplay processing reads it. SB's provider does its
  own discovery, so the value is inert; expose join-arg9 later only if byte-parity in that
  advertise call ever matters.

Both verdicts assume FULL replacement (native join never runs). If join were ever *wrapped*
instead, step 1/9's clear of `data_11df1b4` becomes mandatory again (native set it at entry).

## Globals (VERIFIED)

- `storm_local_player_slot` @ **0xf5db1c** — single byte, init `0xff`
- `storm_turn_base` @ **0x11df108** — int32
- **Session-player list container @ 0xf5db04** (`snet_player_list`), 3 dwords (VERIFIED):
  `+0x0` (0xf5db04) = intrusive link-offset control word (NOT a count); `+0x4` (0xf5db08) = TAIL
  (sentinel.prev, updated by push_back); `+0x8` (0xf5db0c) = **HEAD** (= the
  `storm_session_player_list` traversal start). The count is a **separate global @ 0xf5dab0**
  (`lock inc`/`dec` on create/destroy).
- **Local-player list container @ 0xf5db10**, same shape (VERIFIED): `+0x4` (0xf5db14) = TAIL,
  `+0x8` (0xf5db18) = HEAD; `storm_local_player_slot` sits right after at 0xf5db1c.
- Allocator `sub_7aca10` is **thiscall** (container base in ECX); mode 1 = push_front (updates
  head), mode 2 = push_back (updates tail) — both known call sites use mode 2. Node links: prev @
  +0x0, next @ +0x4; low-bit-tagged pointer (`ptr & 1`) = sentinel/end.
- `data_11df1b4` join-in-progress flag; `data_11df388` receipt table; `data_f5daf0` join timeout;
  `data_11df2d8`/`data_11df2dc` expected game-id/version; `data_11df120` join-param stash;
  `data_f5db28` + mutex `0x11df0e8` deferred SNET queue

**Container layout:** both lists are MSVC std::list-style doubly-linked (prev @ node+0x0, next @
node+0x4; "end" = low-bit-tagged sentinel or null), inserted via `sub_7aca10(container, …, 2)`.

## Session-player struct (goes into bw_dat, like Game/Player)

**Allocation size = 0x21c (540 bytes), memset-0 on create** — so a hand-seeded entry only needs
the explicitly-set fields; everything else is correctly zero:

| offset | field | status |
| --- | --- | --- |
| `+0x00`/`+0x04` | prev/next list links (wired by `sub_7aca10`) | VERIFIED |
| `+0x08` | name buffer (≤0x7f + null) | VERIFIED |
| `+0x88` | second string buffer (≤0x7f + null) | VERIFIED |
| `+0x108` | 12-byte net key | VERIFIED |
| `+0x11c` | `GetTickCount()` timestamp at create | VERIFIED |
| `+0x20c` | state byte: 1 during join setup, 0 on success | VERIFIED |
| `+0x21a` | slot — created as word `0xffff`; readers compare the byte; join writes the byte | VERIFIED |
| `+0x118` | flags; bit `0x4` = present/turn-expected — **THE barrier gate** | **Semantics VERIFIED from the consumer:** `storm_receive_turns` (0x7b1150) awaits a turn from a member iff `+0x21a != 0xff` AND `(+0x118 & 4) != 0`; bit clear ⇒ stamped state `0x10000` (excluded). Its first loop also **clears** bit 0x4 per round for members whose turn-seq `+0x1e0` matches the local turn — i.e. the bit is consumed as turns collect and re-set by the (unlocated) admit/turn-arrival writer. **Seeding must set bit 0x4**; the native WRITER is still unconfirmed (ruled out: the whole recv/join path — it lives in an SNET-event listener registered via `sub_960690('SNET',…)`, untraced). Bit `0x8` modifies state (`|= 0x40000` with `0x20000`). |
| `+0x1e0` | member's turn-seq, compared against the local player's (`local+0x1e0`-region, read as `[0x1e]` dword) in the barrier | VERIFIED (consumer side) |
| `+0x1c8` | nested per-member list (head +0x1cc, tail +0x1d0), manipulated by `sub_7ac2a0` | VERIFIED |

## Already resolved (reuse, no new work)

`storm_create_game` (0x7aee60), `single_player_start`, `send_turn_message` (0x740de0),
`receive_storm_turns` (0x73f4e0).

## Remaining gaps (both LOW priority now; MCP crash triggers to avoid: large `get_xrefs_to`
dumps, `get_data_decl` on 0xF5DB10)

1. **The native `+0x118` bit-0x4 WRITER.** The consumer semantics are verified (see the struct
   table — seeding must set bit 0x4), so this only matters for completeness. Ruled out: the entire
   recv path (`snet_recv_packets` 0x7b16b0, `sub_7ae320`), the join driver, and the plausible
   helpers (`sub_7abb80` teardown, `sub_7ae490` enqueue, `sub_7ac520` unlink, `sub_7ac2a0` splice).
   By elimination it's in an SNET-event listener registered via `sub_960690('SNET', …)` for the
   admit/roster messages (types 9/0xa, or host-side type 7) — walking that event registry is the
   remaining (crash-risky) trace.
2. Only if the `?` decision's fallback (option 2) is ever needed: locate the `?` SENDER (the 0x3F
   record builder on the async send path). Inferred from the dispatcher's uniform handling (no
   local special-case): the host self-applies via async loopback; unverified.

Handshake map for reference (VERIFIED): join sends type **1** (join req) → waits **2** (accept) →
sends **7** (player info) → waits **9**/**0xa** (admitted list / start), receipts recorded by
`sub_7ae320` into `snet_msg_receipt_table` and control messages re-dispatched via
`sub_960690('SNET', 2, type, …)`. Packet fields: message type @ +9, category @ +8, flags @ +0xb.
