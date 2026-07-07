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

### `apply_lobby_force_cmd` (`sub_736410`) @ 0x736410 (VERIFIED 2026-07-07 — **ANALYZER LANDED, option 2 is live**)

> **samase analyzer shipped (samase_scarf `5ddf3085`, 2026-07-07).** Public accessor
> `apply_lobby_force_cmd()` → `Option<VirtualAddress>`; internally resolved from
> `process_async_lobby_command` by walking the dispatcher switch to the class-`0x4A` case, steering
> onto the `len == 0x3F` branch, and taking the following call (switch shape + length check are the
> recompile-stable signature). **To consume: bump `game/scr-analysis/Cargo.toml` `rev` to
> `5ddf3085…`** and add the `apply_lobby_force_cmd` pass-through beside the existing ones
> (`storm_join_game` etc.), then resolve it into `NetcodeV2Bw`.

The 2026-07-07 Team Melee live test settled the force-command decision to **option 2**: the game
syncs but the surviving teammate still scores a LOSS, so the force/alliance/vision state must be
established by building the command record locally on every client and feeding it through this
native apply. Full RE below (one deep pass, 2026-07-07).

**Naming correction:** the wire class byte is **`0x4A`** ('J'), NOT `'?'`/0x3F — `0x3F` is the
record LENGTH (63 bytes), and earlier notes conflated the two. In
`process_async_lobby_command`'s dispatch (`lookup_table_736260[class - 0x3A]`), class `0x4A` →
case value 2 → this function; class `0x3F` maps to the default no-op case. (Related BN misnomer:
`is_observer_human_id` @ 0x75AD64 actually returns 1 iff `id ∈ [0x80..0x83]` — it is a
force-header-id test, not an observer test.)

- **Entry 0x736410 falls through (no ret) into `sub_736537`** — one logical routine; call
  0x736410, never 0x736537 directly.
- **`__cdecl`, 2 args:** `int apply(const void* record /* 63-byte body */, int guard /* pass 0 */)`.
  The dispatcher passes `storm_turn_base - 1` as `guard`; the body runs only when it's 0.
  `record[0]` (the class byte) is never read — the record just has to be the full 63-byte layout.
- **Preconditions:** `in_lobby_or_game` (u32 @ 0x11CDF88, read via `sub_7424C0`) must be 0 (i.e.
  pre-game lobby); the game struct must exist (accessed via the encrypted pointer
  `*(0xF333CC) ^ 0x307A98A3`); map/lobby force config must be loaded (the second pass reads it via
  `sub_6596F0`/`sub_658AD0`/`sub_659000`). No length/sender checks inside.
- **Side effects (complete):** writes `game+0xEC/+0xE4/+0xE6` (config words, from the record);
  `game+0xE4C0/+0xE4C4/+0xE4C8` (12 per-slot alliance/vision flag bytes); `data_11CC714` (8B) +
  `data_11CC71C` (4B) per-slot force/type block; `data_11D00B8` (8B via `sub_758160`); fully
  rebuilds the staging tables `data_11CF860` (12 slot entries, stride 0x24: `+0`=slot id,
  `+4`=-1, `+8`=rec[0x07+slot], `+9`=rec[0x13+slot], `+0xA`=rec[0x2B+slot]) and `data_11CFA10`
  (4 force headers, ids 0x80–0x83, `+8`=0x0C); zeroes flags `data_11CFF20/F80/FE0/11D0040`; and
  ends with **`set_lobby_state(3)`** — so sequence a direct call BEFORE hand-writing
  lobby_state 4/8, or re-assert after.
- **Staging consumers** (what the tables feed at start): `sub_754200`/`sub_7543A0`/`sub_754560`/
  `sub_757D50`/`sub_757E80`/`sub_757FD0`/`sub_758190` (the arranged player/force → final
  net-player record path), and `sub_736300` (re-derives `data_11CC714` from
  `data_11CFA10[force]+8`; called from `init_game_network` @ 0x741873).

**The 63-byte record layout** (offsets from record[0]; builder fills every field from the same
location it's applied to, so host-side these are identity round-trips):

| off | size | applied to |
| --- | --- | --- |
| +0x00 | 1 | class byte `0x4A` (dispatcher-only, apply never reads it) |
| +0x01/+0x03/+0x05 | 2 each | `game+0xEC` / `game+0xE4` / `game+0xE6` |
| +0x07 | 12 | per-slot → staging `+8` |
| +0x13 | 12 | per-slot → staging `+9` |
| +0x1F | 8 | `data_11CC714` |
| +0x27 | 4 | `data_11CC71C` |
| +0x2B/+0x2F/+0x33 | 4 each | `game+0xE4C0/+0xE4C4/+0xE4C8` (also slots 0..7 → staging `+0xA`) |
| +0x37 | 8 | `data_11D00B8` (via `sub_758160`; builder fills via `sub_756A00`) |

**The builder/sender — FOUND: `sub_736D30` @ 0x736D30** (flows into BN's `sub_736E16`; one
routine). Builds the record on the stack from live host state (the table above, right column ==
left column) and sends it **unicast** via the async send primitive `sub_73F550(target, buf, 0x3F)`
(sibling of receive `sub_73F490`), followed by a 1-byte class-`0x50` marker send. Its single call
site is `sub_74FD16` @ 0x74FEC3 (dispatch-pointer-invoked lobby membership handler, no direct
xrefs): on a per-player lobby event with `lobby_state == 4` (post slot-setup), the host sends that
player `0x4B` (roster, via sibling builder `sub_736CD0`, carries a `0x79` byte) then `0x4A` (this
record). So natively it is a **per-joiner catch-up sync**, and **the host never self-applies** —
host-side state is maintained directly by the native lobby slot handlers, which is exactly the
path SB's `setup_slots` bypasses (⇒ under 2c the HOST is missing this state too, not just peers;
option 2's local build+apply must run on every client, host included).

**Analyzer anchors (build-stable):** dispatch case: switch on `byte - 0x3A` through a byte lookup
table (`[0x10]=2` → this case), `cmp len, 0x3F`, `push guard; push body; call; add esp, 8`.
Inside apply: the repeated `^ 0x307A98A3` game-struct access; the guard compare against
`in_lobby_or_game`; offsets `+0xEC/+0xE4/+0xE6` (words) and `+0xE4C0/4/8` (dwords); the four
force-header immediates `0x80..0x83` written with `+4=-1`, `+8=0x0C` at stride 0x24; terminal
`(*fp)(x,1,5)` + `set_lobby_state(3)`. Builder: immediate `0x4A` into buf[0] followed by the same
field sequence, ending in a 0x3F-length send + a 1-byte `0x50` send. Fragile: every raw address
and both XOR keys.

**Semantic gaps CLOSED (2026-07-07 second Opus pass) — and the verdict they force:**

- **`game+0xEC/0xE4/0xE6`:** three u16s in the encrypted CGame paralleling `BwGameData`'s
  game_type/subtype pair (0xE4/0xE6 adjacent, 0xEC separate) — the CGame-side game-type family
  words. Set by the game-info/CreateGame path independent of per-slot lobby handlers ⇒
  **already populated on every 2c client** (the `apply_game_type_template` fix covers the peer).
  Identity round-trip in the record; per-word semantic labels never pinned (moot, see verdict).
- **`game+0xE4C0..0xE4CB` (rec +0x2B..+0x36) decoded — TWO arrays, not 12 uniform bytes:**
  `+0xE4C0..E4C7` = 8 per-SLOT force numbers (1-4; staging `+0xA` copies, `net_cmd_lobby_slot_setup`
  compares them to force ids @0x731bf2, `setup_players_on_game_start` groups by them @0x75636f).
  `+0xE4C8..E4CB` = 4 per-FORCE flag bytes (forces 1-4) with the standard CHK FORC bits:
  0x01 random-start-location, 0x02 allied, 0x04 allied-victory, 0x08 shared-vision ⇒ **0x0E =
  fully-allied team force** (the old tactical note was right, but it's a per-FORCE byte, not
  per-slot; the "0x0E" similarity to `cmd_alliance`'s net-command opcode 0x0E was a red herring —
  `issue_alliance_command` @0x73C500 / `cmd_alliance` @0x73A4C0 use 2-bit-per-target payloads).
  Alliance matrix `game+0xE544` = 12×12 stride-0xC **2-bit cells** (0 enemy / 1 allied / 2
  allied-victory); vision `game+0xFC` = per-player u32 mask. The init-time expander that reads
  the force flags into 0xE544/0xFC was not pinned (it is NOT dialog-path `sub_6c0790`, which reads
  settings table `data_11a4280`), but live behavior proves it runs and reads `0xE4C8`.
  bw_dat already names these fields: `Game.player_forces[8]` / `Game.force_flags[4]`.
- **`data_11D00B8` (rec +0x37):** 8-byte per-slot participation flag array (`sub_756A00` is just a
  memmove of it; zeroed by `sub_7580f0`, `[slot]=1` by `sub_754540` from the map-load player-table
  init `sub_71cb90`; `setup_players_on_game_start` skips slot when 0).
- **Builder read-source table verified complete** — every record field reads exactly the location
  apply writes back (identity round-trip); no reads outside CGame + the staging/lobby globals.

**VERDICT — the 0x4A local build+apply is NOT implementable under 2c, superseded by a direct
force-byte write (implemented in `game_state.rs::setup_forces`).** The builder's inputs (staging
`data_11CF860` entries +8/+9, `data_11CC714/71C`, `data_11D00B8`) are populated only by the native
lobby machinery 2c bypasses, have **no samase analyzers** (and the live build is 13515 — 12409
addresses don't map), and +8/+9's semantics were never labeled. A zero-filled record would make
apply STOMP the map-load staging state today's sync-clean games depend on. Meanwhile the only
state whose absence causes the alliance bug is the 12 bytes at `game+0xE4C0` — which bw_dat
already exposes as named `Game` fields and whose encoding is now fully decoded. So every 2c
client writes `player_forces[slot] = team_id` + `force_flags[force-1] = 0x0E` directly after
`setup_slots` (deterministic from server-ordered slots ⇒ sync-safe) and native game init derives
alliances/vision from them, exactly as it would from a native 0x4A. The resolved
`apply_lobby_force_cmd` fn pointer stays in `NetcodeV2Bw` as groundwork should the full record
path ever be wanted (it would need analyzers for the four globals above first). UMS force flags
are a separate follow-up (SB's `MapForce` doesn't carry FORC flags yet).

### `process_async_lobby_command` @ 0x735ba0 / `sub_73f490` @ 0x73f490
Not needed as analyzers — option 3 (hooking the async transport) stays ruled out; they are
navigation context for the `0x4A` work above.

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
2. ~~Locate the `?` SENDER~~ — **DONE 2026-07-07** (see the `apply_lobby_force_cmd` section: the
   command class is `0x4A`, the builder is `sub_736D30`, it's a per-joiner unicast catch-up, and
   the host never self-applies — the earlier loopback inference was wrong).

Handshake map for reference (VERIFIED): join sends type **1** (join req) → waits **2** (accept) →
sends **7** (player info) → waits **9**/**0xa** (admitted list / start), receipts recorded by
`sub_7ae320` into `snet_msg_receipt_table` and control messages re-dispatched via
`sub_960690('SNET', 2, type, …)`. Packet fields: message type @ +9, category @ +8, flags @ +0xb.
