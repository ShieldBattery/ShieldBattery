# Custom team colors — design

> **Status: design, not built.** Written 2026-07-05 from a design discussion with Travis on branch
> `rp2-integration` (deliberately left uncommitted — another dev is active on this branch; commit or
> move it wherever it should live). This picks up the team-colors "bones" already shipped in
> `common/settings/local-settings.ts` (`MinimapColorMode` + `ColorPreset`) and defines the system
> that actually applies user-customized colors in game. All binary claims in §6 were verified by
> reverse engineering SC:R 1.23.10.12409 (x86) in Binary Ninja; the named functions/globals are
> saved in the bndb.
>
> **Amendment (2026-07-19, post-implementation):** a `teamSelfColor` override was added — an
> optional own-color pick. When unset, self is the pool's head color, and with shuffle on it is
> drawn from the combined friendly-pool shuffle like anyone else; Custom behaves this way too
> (its authored self color is just the pool head, not pinned). Legacy diplomacy is the sole
> preset with a fixed, always-pinned self. When the override is set, it is used verbatim, and a
> matching allies-pool entry is consumed (first match, skipped if the pool would empty), so the
> "consume is FFA-only" principle in §2 no longer holds for this one case.
>
> **The one-line thesis:** SC:R melee already renders every player from a single RGBA array
> (`rgb_colors`) that nothing touches after game init — so custom team colors are "compute a
> player→color assignment from user-defined color pools, write the array, keep BW's own
> diplomacy recolor switched off." The interesting design is the *assignment*, not the rendering.

## 1. What exists today (the bones)

- `MinimapColorMode` (Standard / PresetOnMinimapOnly / Preset) is fully plumbed: settings UI →
  `LocalSettings` → game DLL, which restores it into SC:R's `minimap_color_mode` global at game
  start and saves in-game Shift+Tab changes back on exit (`bw_scr.rs` `restore_minimap_settings` /
  `read_minimap_color_mode`).
- `ColorPreset` is a stub: one built-in preset (`LegacyDiplomacy`), a settings dropdown, and a
  self/allies/enemies preview card. **The game never reads it.** Today the non-Standard modes just
  show BW's built-in teal/yellow/red diplomacy colors.

## 2. The model: a color pool per alliance state

Color configuration has **two independent preset axes** — team colors and FFA colors — each with
its own built-in presets and its own Custom slot. (One unified preset enum would force shipping
the cross-product of every team scheme × every FFA scheme to make users happy; two axes need only
the sum, and users mix freely — "cool/warm teams, pastel FFAs".)

```ts
teamColorPreset: TeamColorPreset  // LegacyDiplomacy | CoolVsWarm | ColorblindSafe | Custom | ...
ffaColorPreset: FfaColorPreset    // Classic | Pastel | ColorblindSafe | Custom | ...
customTeamColors: {
  self: string      // exactly one color
  allies: string[]  // ordered pool, team contexts
  enemies: string[] // ordered pool, team contexts
}
customFfaColors: string[]  // ordered pool, non-team contexts; also the obs >2-sets fallback (§3b)
```

`self` is **part of the team scheme and applies only when team semantics apply** (a bright legacy
teal dropped into a pastel FFA scheme is exactly what nobody wants). In FFA contexts you draw
from the FFA pool like everyone else — vanilla BW behavior — unless the optional `ffaSelfColor`
is set: then you always get that color, and if it appears in the active FFA pool it is
**consumed** (skipped when assigning others). Distinctness survives: pool ≥ 8, you + at most 7
others. The consume rule is FFA-only on principle — the FFA pool has a distinctness *contract*
(that's why it doesn't wrap) so collisions must be resolved, while team pools wrap by design, so
a self-vs-team-pool collision is a user's aesthetic choice, not a bug to fix.

The FFA axis defaults to `Classic` — the standard BW player colors — so out of the box, FFAs look
like vanilla BW and only team semantics change.

Behavior options live *outside* the preset, applying to whichever preset is active (switching
presets changes colors, never behavior):

```ts
shuffle: boolean  // per-game random permutation of each pool (default off)
// When team semantics apply (§3a). 'never' = pure identity colors from the ffa pool in every
// game type, alliance changes never recolor anything (also the escape hatch for players who
// want custom colors but no mid-game recolors). 'exceptIn1v1' keys off ANY 2-player game,
// including matchmaking 1v1s — "how do my 1v1s look" is the question, not lobby structure.
teamColorUsage: 'always' | 'exceptIn1v1' | 'never'  // default 'always'
ffaSelfColor?: string  // optional fixed self color in FFA contexts (see below); unset = none
```

Players draw **distinct colors from their pool** (in pool order, or a per-game shuffle of it if
that option is on), so you can tell teams apart *and* individuals within a team — e.g. "my team is
cool colors, enemies are warm, I'm blue." The pools generalize every behavior discussed:

| Behavior | Encoding |
| --- | --- |
| Legacy diplomacy (teal/yellow/red) | pools of size 1; wrap-around duplicates |
| Team games, per-player team palettes | multi-color pools |
| 1v1 "opponent is always red" | enemy pool of size 1 |
| FFA identity colors | everyone draws from a pool; no relationship semantics |

**Team pools wrap; the FFA pool does not.** The asymmetry is principled: in `allies`/`enemies` a
duplicate communicates something true ("these two are on the same team" — "all team members one
color" *is* a size-1 pool; there is no separate legacy/per-player mode toggle anywhere), while in
the `ffa` pool color is identity and a duplicate is a lie. So team pools have no minimum size and
wrap when short (with an "N+ players will repeat colors" hint and honest preview); the `ffa` pool
**requires ≥ 8 colors** (8-slot worst case, including obs FFAs with no self) — the editor refuses
to go below 8, and shipped presets define 8+. A preset wanting legacy "everyone red" FFA behavior
lists red eight times; the count requirement stands, and all-same-color is unambiguous anyway.

All pools are **priority-ordered**: a game uses as many colors as it needs, from the top, so with
shuffle off the tail of a large pool is an intentional preference ranking, not a bug. Shuffle is
what makes the whole pool live.

Pools are stored as lists from day one (even while the UI might only expose small ones) so no
settings migration is needed when pool sizes grow.

## 3. Assignment semantics

### 3a. Playing: live alliance tracking with sticky assignment

Colors follow **live alliance state**, not just lobby setup, because pubs routinely host melee
mode and ally up after the game starts (rather than using top-vs-bottom). Matchmaking games have
`lockedAlliances: true` (`server/lib/matchmaking/matchmaking-service.ts`), so for ranked the live
tracking trivially never fires after init — but it must exist for custom lobbies.

**Context — team vs. FFA — is decided once, at game start:** a game that *starts* with
teams/allies (matchmaking, TvB forces, UMS forces) is team-context (enemies draw from the
`enemies` pool); a game that starts with no allies is FFA-context (everyone else draws from the
`ffa` pool — the FFA pool *is* the enemy pool of FFA games). A plain-melee 1v1 would be
FFA-context by this rule; the `teamColorsIn1v1` toggle (default on) promotes it to team context
for the "my opponent is always `enemies[0]`" consistency read. The context never changes
mid-game.

**In FFA context, the ally pool still overlays live** — this is how melee-ally-up games work
without violating stability: everyone starts on their FFA identity color; ally someone and *that
player* moves to the ally pool (append-at-end, below); unally them and they return to their
remembered FFA color. No context switch, no global recolor — only the player whose alliance
changed ever changes color.

**Classification predicate:** a player is ally-colored iff the **local player's outgoing alliance
row** marks them allied (`alliances[local][them]`), regardless of reciprocation. This exactly
matches BW's own diplomacy-mode predicate (§6, Q4/minimap), which every BW player's intuition was
trained on. Do not invent a mutual-alliance rule.

**Stability requirement (hard):** colors must never reshuffle for players whose alliance state
didn't change. That rules out recomputing the assignment as a pure function of current state.
Instead the assignment is **sticky, game-local state**:

1. At game start, players (sorted by slot) draw from their pool in order. Matchmaking/TvB games
   start with alliances already set, so teams are colored correctly from frame 0.
2. Each pool keeps an **append cursor**. A player *entering* a pool mid-game (you unally them →
   they enter the enemy pool) takes the color at the cursor — the end of the pool. Nobody already
   in the pool moves. Exhausted pool ⇒ cursor wraps (duplicate).
3. **Assignments are never revoked.** Keep the full player → (pool → color) history; a player
   re-entering a pool they were in before gets their *original* color back (flip-flopping an ally
   doesn't burn a new color each time).

Alliance changes are synced game commands, so this state is a deterministic function of the
command stream — replays reproduce the same color history. Detection can be a cheap per-frame diff
of the alliance matrix or a hook on the alliance-change path.

User actions are the escape hatch: cycling Shift+Tab or editing palettes mid-game may recolor
(expected — the user touched something), but mode cycling must not reset the cursor state
(Shift+Tab back and forth must not reshuffle).

### 3b. Replays / observing: static, derived from lobby forces

There is no "self," and live alliances are asymmetric (ill-defined from no seat), so obs/replay
coloring is **static from the game setup**:

- **Exactly 2 alliance sets** (matchmaking team games, TvB lobbies, 1v1): one side gets the
  friendly pool (self color prepended to the allies pool), the other gets the enemy pool. Which
  side is "friendly" is arbitrary — make it deterministic (team containing the lowest slot). This
  is the broadcast-friendly case: consistent colors every game.
- **Anything else** (FFA, 3+ forces, melee-ally-up games, UMS chaos): everyone draws from the
  `ffa` pool. No cleverness for weird force configs.
- `teamColorUsage` applies here too: a watched 1v1 uses team pools or the `ffa` pool per
  `exceptIn1v1`, and `never` means watched games always use the `ffa` pool — matching how the
  viewer's own games look.
- **If the local user was a participant** (watching your own replay — we know, since we launch
  it), use their seat as self and run the full §3a semantics from their perspective.

Possible later addition: "view colors from player X's perspective" in obs UI — same assignment
function with a designated self, needs only UI.

## 4. Customization UX

- **Full RGB picker with a preset swatch row.** Arbitrary RGB is verified to render correctly in
  both SD and HD (§6, Q2), so the picker is unconstrained. The swatch row is SC:R's own **22
  built-in selectable colors** — the game validates chosen-color indices `<= 0x15` with `0x16` =
  random (§6, Q1/Q4 globals), so the exact RGBA values can be extracted from the game's preset
  table rather than eyeballed; they're familiar and battle-tested for on-map legibility, and
  composing a pool from good starting points beats a blank hue wheel. (No color-picker component
  exists in `client/` yet — small build, or something like `react-colorful`: tiny, zero-dep,
  styled-components-friendly.)
- **Presets: an enum + one Custom slot, per axis (§2).** The existing `ColorPreset` becomes the
  team-axis enum (`TeamColorPreset`), joined by `FfaColorPreset`; each gains `Custom` (colors
  sourced from `customTeamColors` / `customFfaColors` in `LocalSettings`, as the existing doc
  comment in `local-settings.ts` anticipated). Team-axis built-ins: Legacy diplomacy,
  cool-vs-warm, and at least one colorblind-safe preset (deuteranopia/protanopia-friendly — the
  most common motivation for the feature shouldn't require manual color composition). FFA-axis
  built-ins: Classic (standard BW colors, the default), Pastel, colorblind-safe. Behavior
  settings (`shuffle`, `teamColorUsage`) are separate and apply to any preset combination. No
  named user-preset CRUD in v1; one custom slot per axis covers nearly everyone and doesn't
  preclude collections later.
- **Custom editors.** Each axis's settings section is a preset select + preview; picking Custom
  makes that section editable, seeded from the previously selected preset on that axis ("Legacy
  diplomacy, but pink enemies" is a one-click edit, not a from-scratch build). Team section: self
  swatch, allies pool, enemies pool, with repeats hints (§2) and a mock 4v4 assignment preview.
  FFA section: one pool (editor enforces the ≥8 minimum) with an 8-player mock preview. Pools are
  reorderable swatch rows with add/remove.
- **Storage:** `LocalSettings`, per-machine, like the rest of the bones. Purely a client-side
  rendering preference; the server never needs to know.
- Don't hard-validate silly choices (same color for allies and enemies); at most a gentle warning
  in the preview.

## 4a. Settings surface — designer handoff

Everything a UI design needs, consolidated. (A designer should read §1–§4 + §7; §5–§6 are
game-internals.) **Location:** Settings > Game > Gameplay, replacing today's "Team colors"
section (`client/settings/game/gameplay-settings.tsx`: a Mode select, a Preset select, and a
static self/allies/enemies preview card).

Complete control inventory:

| # | Control | Type / states | Notes |
| --- | --- | --- | --- |
| 1 | Mode | select: Standard / minimap only / everywhere | Existing `minimapColorMode`; also cycled in-game via Shift+Tab. Standard ⇒ all controls below are inert (today's disable pattern). |
| 2 | Team colors usage | select: Always / Except in 1v1 / Never | `teamColorUsage` §2. Never ⇒ team-axis controls (3–4) inert. |
| 3 | Team preset | select: Legacy diplomacy / Cool vs warm / Colorblind-safe / Custom | Custom seeds from previously selected preset. |
| 4 | Team editor + preview | self swatch; allies pool; enemies pool; mock 4v4 preview | Preview always renders the active preset; editable only when Custom. Pools = reorderable swatch rows, add/remove, repeat hints ("with more than N allies, colors repeat"). |
| 5 | FFA preset | select: Classic / Pastel / Colorblind-safe / Custom | Classic (standard BW colors) is the default. |
| 6 | FFA editor + preview | one pool; 8-player mock preview | ≥ 8 colors enforced: remove disabled at 8. No repeat hints (no wrap). |
| 7 | FFA self color | optional swatch, default None (clearable) | `ffaSelfColor` §2; consumed from the pool on collision. |
| 8 | Shuffle | toggle, default off | Applies to both axes. |
| 9 | Swatch popup | RGB picker + swatch row of SC:R's 22 colors | Opens from any pool/self swatch. |

Design deliverables that are *theirs to define* (not gaps in this doc): the shipped preset
palette values — cool-vs-warm and pastel are aesthetic choices, and the colorblind-safe palettes
must be verified against CVD simulation, not vibes; the preview's concrete form (swatch rows vs a
mock-minimap rendering); and the **in-game mode-cycle feedback** — today Shift+Tab recolors
silently, and with three modes plus custom schemes the player needs a cue for which mode they
just cycled into (the DLL has an egui overlay that could show a brief toast; needs a design).

### Concrete color values (extracted from the binary — exact bytes, not approximations)

SC:R's 22 selectable colors, dumped from `get_preset_player_color_rgba` (0x59abd7; they're
hardcoded switch immediates, not a data table — to re-extract after a game patch, find the
22-case switch over `sub_abd260` calls with a `> 0x15` guard, reachable from
`randomize_player_colors`). Index 0x16 = "random", 0x17 = "custom RGB" marker. **Names are the
community-standard lobby names, not from the exe** (official localized names live in the game's
CASC/locale data); the hex values are ground truth.

| Idx | Hex | Name | Idx | Hex | Name |
| --- | --- | --- | --- | --- | --- |
| 0x00 | `#F40404` | Red | 0x0B | `#4068D4` | Azure |
| 0x01 | `#0C48CC` | Blue | 0x0C | `#74A47C` | Pale Green |
| 0x02 | `#2CB494` | Teal | 0x0D | `#7290B8` | Blueish Grey |
| 0x03 | `#88409C` | Purple | 0x0E | `#00E4FC` | Cyan |
| 0x04 | `#F88C14` | Orange | 0x0F | `#FFC4E4` | Pink |
| 0x05 | `#703014` | Brown | 0x10 | `#808000` | Olive |
| 0x06 | `#CCE0D0` | White | 0x11 | `#D2F53C` | Lime |
| 0x07 | `#FCFC38` | Yellow | 0x12 | `#000080` | Navy |
| 0x08 | `#088008` | Green | 0x13 | `#F032E6` | Magenta |
| 0x09 | `#FCFC7C` | Pale Yellow | 0x14 | `#808080` | Grey |
| 0x0A | `#ECC4B0` | Tan | 0x15 | `#3C3C3C` | Black |

Indices **0x00–0x07 are the classic 8 map-default colors in classic slot order** (Red, Blue,
Teal, Purple, Orange, Brown, White, Yellow); 0x09–0x0A are 1.16-era extras, 0x0B–0x15 are SC:R
additions.

**A finding that affects the "Classic" FFA preset:** SC:R melee does *not* assign colors by slot
order at runtime. Everyone defaults to "random," and `randomize_player_colors` draws each player
from the **whole remaining 22-color pool** via synced RNG (consume-on-assign, so no duplicates).
So there are two defensible "Classic" presets: **1.16 Classic** (the 8 colors above, in order —
slot 0 is always Red, matching old-BW muscle memory) or **SC:R vanilla** (all 22 colors, which
only behaves authentically with shuffle on). Recommendation: ship "Classic" as the ordered
classic 8 (deterministic, matches what "classic colors" evokes) and note that true SC:R-vanilla
behavior is Classic-22 + shuffle; decide whether both are worth shipping.

## 5. Implementation sketch (game DLL)

The whole mechanism is: **keep SC:R's diplomacy recolor off, own the `rgb_colors` array.**

1. **Pin the real `minimap_color_mode` global to 0** and track a *virtual* Shift+Tab mode (the
   three-state cycle the user sees). Rationale: mode 2 makes `get_player_color` bypass
   `rgb_colors` entirely for its palette-index diplomacy colors, and the input handler *forces
   observers to mode 2* (§6, Q4) — either would stomp our colors. The DLL already owns this global
   (restore/save machinery); it repurposes it: intercept the cycle, keep the global at 0, cycle
   the virtual mode, persist the virtual mode in `minimapColorMode` as today.
2. **"Everywhere" mode:** after game init, write the computed player→color assignment into
   `rgb_colors[0..7]`. Melee already runs with `use_rgb_colors = 1` and nothing writes the color
   state mid-game (§6, Q1/Q3), so the write is sufficient and permanent; draw sites read the array
   per frame, so mid-game updates (sticky reassignment on alliance change) take effect
   immediately.
3. **"Minimap only" mode:** there is no per-player minimap color channel in RGB mode — dots read
   `rgb_colors[player]` directly at three small, structurally identical draw functions (§6, Q3).
   Hook the color selection at those three sites (or redirect their `rgb_colors` load to a shadow
   array) and leave unit colors untouched. This is the only new hook the feature needs.
4. **"Standard" mode:** touch nothing.
5. Settings flow: `colorPreset`/`customColors` ride the existing settings-into-DLL path
   (`bw_scr.rs` settings parsing, next to `minimapColorMode`).

The assignment logic itself (§3) is a pure-ish state machine over (game setup, palettes, optional
self, alliance-change events) — keep it isolated from BW plumbing and unit-test it directly.

## 6. RE findings (SC:R 1.23.10.12409 x86 — verified, saved in bndb)

Globals: `use_rgb_colors` = 0xfd0588 (session-global byte); `rgb_colors` = 0xfd05a0
(8×RGBA f32, players 0–7); per-player `uses_rgb` = 0xfd058c[8], `has_color` = 0xfd0594[8];
palette-mode minimap indices at `game+0x2ce6`; per-player chosen-color-index `game+0x1038a`
(0x16 = random); `minimap_color_mode` = 0x11abe78.

**Q1 — When is RGB mode on?** `should_use_rgb_colors` (0x59b7a0), called at game init
(0x6ca69d–0x6ca70a): replays → 1 iff replay data has any non-zero `rgb_colors`; non-UMS
multiplayer → **1 unconditionally**; UMS → whatever the CRGB chunk handler (`chk_handler_crgb`
0x71dda0 → `apply_crgb_player_colors` 0x59c260) set. So RGB mode is the *norm* in melee/ladder,
not a CRGB special case. `randomize_player_colors` (0x59a7b0, from `setup_players_on_game_start`)
backfills `rgb_colors` for every palette/random player, so by game start the array is fully
populated for all 8 slots.

**Q2 — SD rendering.** Team color is a **per-draw RGBA shader parameter**: `draw_image`
(0x579b60) calls `get_player_color` (0x59bee6) for team-colored images and stores the RGBA into
the draw descriptor handed to the renderer backend — same chokepoint for SD and HD, no remap
generation, no quantization. Arbitrary RGB renders exactly in SD.

**Q3 — Minimap.** Three dot-draw sites with identical color branches: `draw_minimap_units`
(0x7252e0), `draw_minimap_player_units` (0x7280e0), `draw_minimap_player_wireframe_or_buildings`
(0x728350). Mode 0 + RGB ⇒ they read `rgb_colors[player]` directly (no separate minimap array —
hence the hooks in §5.3). Modes 1/2 ⇒ these sites bypass `rgb_colors` for 3-color diplomacy from
palette-index globals (ally 0x11f8751, self 0x11f8752, enemy 0x11f8754; data-driven block, not
hardcoded immediates).

**Q4 — Diplomacy mode vs. rgb_colors.** `get_player_color` diverges only at mode 2, taking a
palette-index diplomacy branch that never consults `rgb_colors` (mode 1 is minimap-draw-only —
that's *why* it's "minimap only"). The minimap diplomacy branch classifies via the **local
player's outgoing alliance row** — the predicate §3a adopts. The Shift+Tab handler
(`minimap_dialog_event_handler` 0x7265be) cycles `mode = (mode+1) % 3` and **forces observers to
mode 2** — the reason §5.1 pins the global to 0.

**Timing:** color-state writers are map-select (`sub_93a6e0` resets flag), lobby-join (host
replicates the full color state to joiners in net message 0x69: `net_cmd_lobby_slot_setup`
0x732267 send / `net_cmd_recv_color_state` 0x731440 receive), and game-init only. **Nothing writes
during gameplay** — post-init writes by the DLL are stable for the session.

Minor unverified details (low impact): the three version/netcode gates inside
`should_use_rgb_colors`; renderer-backend internals consuming descriptor flag 0x10; the file
source of the 0x11f8740 diplomacy-color block.

## 7. Open product questions

- **UMS policy.** Map authors set colors intentionally (CRGB, forces); overriding them may break
  map-specific readability. Simplest v1: custom colors apply to melee-ish game types only, or the
  virtual modes stay available but default to Standard in UMS. Decide before shipping.
- Which shipped presets, exactly, on each axis (and the colorblind-safe palette values).
- Preview design details: static swatch rows vs. a mock-minimap preview.
- Later / explicitly parked: **per-enemy-team palettes** (a 2v2v2v2 can't distinguish enemy
  *teams* with one enemies pool — enemies are individually distinct but not grouped; a fifth
  config surface, not v1), obs "perspective of slot X," named preset collections, live-tracking
  indicator when someone changes alliance ("X is now hostile" recolor moment is information —
  consider a brief flash or nothing).
