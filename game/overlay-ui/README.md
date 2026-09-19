# overlay-ui

The presentation layer for ShieldBattery's in-game overlays, plus a native host to preview it
without launching StarCraft.

The **library** is what the injected game DLL links against: view-model types and pure egui render
functions over plain data (`disconnect`, `game_menu`, `netstat`, `chat_history`, `transport`,
`observer`), the
color ramps
(`colors`), the
font families (`fonts`), `install_fonts_and_style`, which installs the overlay's faces and base style
on an `egui::Context`, the UI kit (`kit`) every screen is drawn from, the translations (`i18n`) every
string goes through, and the `shell` that decides which of those screens is up and what the frame
does with the player's input. It has no BW, samase or Windows dependency, which is what makes it
host-compilable. Nothing here may depend on the preview host, and the host's own dependencies
(eframe, image) are optional and gated behind the `preview` feature, so the DLL never pulls them in.

## Fonts

Four faces are embedded in the binary, and three of them are variable fonts registered once per
weight the design uses (`FontTweak::coords` pins the `wght` axis, and `FontData` holds a `Cow`, so
the extra registrations borrow the same bytes):

| Family                                | Faces                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `Proportional`                        | Inter 400                                                                  |
| `inter-500`, `inter-550`, `inter-600` | Inter at that weight                                                       |
| `display`                             | Sofia Sans 600 — titles, player names, button labels                       |
| `condensed`                           | Sofia Sans Condensed 400 — every numeral, then Inter 400 for anything else |

Every family then falls back to Do Hyeon (Korean), the dynamic Korean and Simplified Chinese faces,
and finally egui's own faces, so a string of mixed scripts resolves rather than showing boxes. Ask
for a family through `fonts::body()`, `body_medium()`, `body_strong()`, `body_semibold()`,
`display()` and `condensed()` rather than naming one, and prefer a `kit::text` style over building a
`FontId` by hand.

**Dynamic fonts.** The full Korean syllabary and the GB 2312 hanzi are megabytes each, so they are
not embedded: `load_dynamic_fonts(dir)` reads `NotoSansKR-Hangul.ttf` and `NotoSansSC-GB2312.ttf`
out of a directory and hands them to `install_fonts_and_style`. A missing file is not an error, it
is simply a face that is not registered. Both hosts follow the same rule for where that directory
is: **the `fonts` directory beside the binary**. The game DLL resolves its own module path and looks
in `<dll directory>/fonts`, which `game/build.bat` populates from `game/files/fonts/dynamic`; the
preview reads `game/files/fonts/dynamic` straight out of the checkout.

## Translations

Every string a screen shows goes through a macro, never a literal:

```rust
tr!("disconnect.waitingTitle", "Waiting for players")
tr!("disconnect.dropCountdown", "Drop in {{time}}", time = mmss(remaining))
tr_plural!("netstat.bufferTurns", turns, one = "{{count}} turn", other = "{{count}} turns")
```

The key and the default text must be literals, and further `name = expr` arguments fill the
`{{name}}` placeholders (`{{count}}` is always available to `tr_plural!`). That is the exact shape
`tools/i18next-rust-plugin.mjs` parses: `pnpm gen-translations` scans `game/**/*.rs` for these calls
and writes the defaults into `server/public/locales/en/game.json`, the `game` namespace beside the
app's own `global` one. The other four languages are filled in by `pnpm run i18n --ns game` and land
beside it. Keys are relative to the namespace, so they carry no `game.` prefix, and the nesting in
the JSON is the key's dotted path.

`build.rs` embeds whichever of the five catalogs exist at build time; a language nobody has
translated yet is simply not embedded. A lookup tries the active language, then English, then the
default written at the call site, so a missing key always renders a sentence. Plural forms are the
`_one` / `_few` / `_many` / `_other` sibling keys i18next writes, picked by the CLDR cardinal rules
for our five languages (hand-written in `i18n.rs`, tested there).

`i18n::set_locale` picks the language. The game DLL calls it from its settings handler with the tag
the app sends; the preview has a _Language_ knob. The preview also has a **pseudolocale** toggle,
which draws every string accented, bracketed and padded to roughly 135% of its English length: a
layout that survives it survives the translations, and anything not yet wrapped in `tr!` stays
conspicuously plain. Offline renders include one pseudolocale pass per translated screen.

## The kit

| Module         | What lives there                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kit::theme`   | Every token: colors per tier, text colors, player colors, spacing, radii, hit targets, motion durations, interaction overlays. One unit of the design is one egui point, so these are plain point values — never scale them again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `kit::text`    | The type styles (`dialog_title`, `panel_title`, `numeral`, `player_name`, `body`, `column_label`, `button_label`) as `TextSpec`s that hand out a `TextFormat`, a `LayoutJob` or a laid-out galley. `caps` uppercases only what has a case, so Korean and Chinese labels stay as written. Nothing renders below 11 points. `bw_chat_colors` is BW's inline color-code table and `bw_colored_job` lays text out through it.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `kit::tiers`   | The three surfaces: `tier0_panel` (ambient), `tier1_panel` (gradient, bevel, parameterised corners), `tier2_dialog` (scrim, double stroke, glow, inset shadow), plus the `gradient_round_rect` and chrome shapes they are built from. A dialog is a stack of bands rather than one padded box — `dialog_header` (ruled off below it), `dialog_body` and `dialog_footer` — so every dialog wears the same padding, and `dialog_content_width` / `dialog_outer_width` convert between the chrome and the room inside it. `dialog_title` paints the glowing title wherever the caller's layout puts it.                                                                                                                                                                                                                                                             |
| `kit::motion`  | `enter_exit` / `presence_area` (150 ms fade and slide, `None` once a surface is gone) and the pulse phase.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `kit::widgets` | Buttons (`Tier1`, `Tier2`, `Tier2Primary`, `Ghost`), `plate_button` with its `ButtonPlate` (the double-rect button a modal's stack of choices is built from: primary, standard, quiet, destructive, destructive-lit, locked), `chip_button`, `hold_to_confirm`, `segmented`, `tab_strip` (with `tab_strip_width` for a caller reserving room for one), `switch`, `slider`, `scrub_track`, `kbd`, `panel_header`, `stat_row`, `tag` / `tag_sized` / `tag_exact`, `status_dot`, `pulsing_dots`, `centered_paragraph`, `line_plot`, `sparkline`, `progress_bar`, `share_bar`, `paint_resource_glyph` (the mineral / gas / supply glyphs, drawn from paths so they render in a host that cannot reach BW's icon atlases), and `set_disabled`. Each takes a `&mut Ui`, allocates its own space and paints itself from the theme. The `_exact` and `_sized` variants are for cells in a fixed layout, which must not resize with what they hold. |

## The shell

`shell::Shell` is the state machine above the screens, and both hosts drive it once per frame:
`shell.frame(ctx, &HostFrame, &mut Views) -> FrameOutput`. `HostFrame` is what the host knows about
the game (the `Mode` the client is watching from, whether the game has started, whether BW's chat box
is open, whether one of BW's own dialogs is on top, how far into the game the simulation has got); `Views` holds the view-models the host built
this frame; `FrameOutput` carries the intents the shell wants carried out, the screen rects it owns
and the input capture it has taken. A rect is a `HitRect` rather than a bare one, because a surface
that scrolls has to ask for the mouse wheel as well as the pointer: the wheel is the game's by
default (SC:R zooms the map with it), so a host that does not hand it over leaves a long list
movable only by dragging its scrollbar.

Every policy lives here rather than in a host, so the game DLL and the preview can't drift and the
rules are testable without a game or a window.

A `Views` field is only filled on the frames its screen is up. The chat log in particular is a copy
of every line said this game, so both hosts build it only while `ModalId::ChatHistory` is on the
stack, and the DLL reuses the last one until its store's generation counter or the player colors
move.

A frame has three layers, drawn so each covers the one before it. **Ambient** (tier 0/1) panels sit
over live gameplay; the observer panel set belongs to `Observing`/`Replay`, while the `/netstat`
diagnostic panel is deliberately available in every mode, since only an explicit chat command puts it
on screen. **Hero** carries the match's identity, and the replay transport plate is drawn in it — at the
ambient tier's own chrome, since the plate sits in the corner of a live game rather than over it.
**Modal** (tier 2) is a stack, of which only the top is drawn.

**The observer panels** (`observer`) are what a watcher is told about a game they are not playing,
and a host builds all of them into one `ObserverView` for every frame it is observing or watching a
replay — again whether or not any of them is on screen. The **matchup bar** is the tier-1 surface
hanging off the top edge: two mirrored halves about a middle block holding the clock and a
`REPLAY`/`LIVE` tag, each half carrying a player's race chip, name, bank, supply and APM. A click on
a half is `Intent::ToggleVision`, which is how a watcher takes a player's vision; a player whose
vision is off is dimmed rather than dropped.

The bar has three forms, and `MatchupView::form()` picks the one a game's own shape calls for from
the `team` every player carries — which the game DLL takes from BW's own team numbers where the
game type has them, and otherwise derives from who has mutually allied whom, since a melee map
leaves every one of those numbers at zero however the players lined up. One player a side is the design's duel. Two a side stacks them,
one over the other, in a bar that is wider and half again as tall; the row is the same row in both
forms, and the wider bar's slack is spread across its cells rather than dropped into the name. Any
other shape gives the halves up entirely: the bar keeps its middle block alone and the game is read
from the **team cards** instead, a tier-1 card in each top corner carrying its side's supply, a row
per player with bank, supply and APM, and the side's own income, army, workers and unit trade along
the bottom — which is the number a team game is actually about, and one four columns of per-player
values answer only after the watcher has added them up themselves. Two cards at most, because the
design gives them the screen's two top corners and nothing else, so a free-for-all of three or more
sides keeps the clock alone.

Nothing here is placed at the absolute height the design card draws it at. The cards are as tall as
the side they carry and every stats wing is as tall as the players it has rows for, so the shell
stacks them: each surface is placed under the bottom edge the one above it actually came out at,
never above the design's own grid. That is what keeps a 4v4's economy table from being drawn through
its timeline, and the same rule puts the control groups above whatever height the production panel
reached.

Under it hang four **stats wings**, tier-0 panels placed against the screen's own edges rather than
at absolute coordinates, so other aspect ratios keep them out of the middle. **Economy** (left) and
**military** (right) are tables of fixed-width columns, one row per player: income per minute in each
resource, worker count with how many are idle, and resources gathered per worker per minute; army
value in each resource, and the unit and worker kill-and-loss pairs. **Graphs** (right, under
military) plots one measurement of the whole game through the kit's `line_plot`, with a strip of
tabs under its header naming the five it could plot: `G` walks that strip forward and `Shift+G`
back, and a tab can be clicked instead. In a game with sides worth telling apart from the players on
them, two more chips at the right end of the same row switch between the sides and the players; it
plots the sides by default, since the question a team game poses is which side is ahead. Both tables split their rows the same
way, with a rule naming each side under the first, and a game with one player a side gets no rules
at all — a divider between every pair of rows would be a divider for nothing. **Timeline** (left, under economy) is a fixed six rows of `m:ss` plus
what happened, newest at the top, naming the thing it is about with the game's own icon rather than
with a word — the game hands out no readable names for two hundred units, upgrades and technologies.
The wings on the right stop short of the dock's collapsed column, so a control never covers a number;
the rail the dock expands into is allowed to sit over them, because that is a surface the watcher has
just opened. The **map-control bar** is the strip under the matchup bar, and is the one surface drawn
from a measurement the game does not keep: a host with none reports `None`, and then the bar is not
drawn, its dock row is not offered and its key is not consumed. It is also not drawn where the wings
leave no room for it, which is every screen narrower than the design's.

The **production panel** is the tier-0 strip above the console band: a row per player of the things
they are making, with a count and a progress bar per tile, and a click on a tile is
`Intent::SelectProduction`, which the host turns into a selection of whatever is making it (asking
again walks to the next one). A tile is the one place these panels draw one of the game's own icons,
so the view carries both the texture id the host mapped and the atlas frame it is;
a host with no atlas draws the number instead — the timeline's and the control groups' icons follow
the same rule. The **control groups panel** is the strip above production: a row per player of the
ten number keys, in the order a keyboard reads them, each slot carrying its digit, the icon of
whatever the group is mostly made of and how many units are in it. All ten are drawn whether or not
there is anything on them, because a row that only showed the groups a player happens to have would
move its slots every time one was made or lost; an empty slot and a group nobody has recalled in a
minute are both drawn dim, which is what the panel is read for. The
**obs dock** is the tier-0 strip on the right edge, in two forms of one list: collapsed, a column of
keycaps lit for the surfaces that are on;
expanded, the control rail, with the names spelled out. Its list is `Panel::ALL` rather than a list
of its own, so a panel built later appears there the day its toggle does.

The DLL fills the wings from `game_stats.rs`, a sampler that runs inside BW's own simulation step
once per second of game time and keeps two hours of per-player history, a timeline of what changed
between two samples, and what each player has on their number keys — read out of the game's own
table of unique unit ids, so a group's count is what recalling it would actually select, and stamped
stale from the frame the game last wrote the group on. It lives there rather than in the draw path because a replay seeking
backwards re-runs every frame at full speed with nothing drawn: a sampler that only saw drawn frames
would come back to a game it had missed most of. The preview has no game, so its wings come from the
fake game's own measurements evaluated backwards over the clock, which keeps an offline render of the
same second the same image every time.

**The replay transport** (`transport`) is the one screen that acts on the game rather than reporting
on it. A host builds its view-model for every frame of a replay, whether or not the plate is on
screen, so the transport keys keep working with it hidden; the shell decides what is drawn and turns
both the plate's controls and those keys into `Intent::Seek` and `Intent::SetSpeed`, which a host
sends as the game's own replay commands. Two rules live in the shell rather than in either host: at
most one seek is in flight (a second sent while the first is pending is refused outright by the
game), and a dragged playhead is coalesced to its latest target a few times a second, since every
backward seek restarts the simulation from frame zero. `FrameOutput::transport_shown` is how a host
knows to hide SC:R's own plate, which does the same job in the same corner; it stays true through the
plate's exit, so the two never overlap.

**Input capture.** With no modal up, the pointer is decided by hit rects alone — a click that misses
every rect the frame reported is the game's — and the keyboard by whether an egui widget has focus or
a hotkey is bound. A capturing modal takes both outright: unit selection, drag-select and
move/attack commands all ride the same messages, so taking them all is what makes a modal behave like
a pause. Two carve-outs survive a full capture. While BW's chat box is open the player is typing, so
every key belongs to that box (backspace, the arrows, Escape to close it) and the keyboard passes
straight through however modal the screen is. And typed _characters_ are never part of the capture at
all: SC:R opens and submits its chat box from the Enter character rather than from a virtual key, so
swallowing characters while the box is closed would swallow the keystroke that opens it and the box
could never be reported open again. `Key::Enter` is let through for the same reason.

**The disconnect surface** (`disconnect`) has two forms of one view-model. While this client's own
link is fine it is the game's whole roster, one boxed row per other player: a dot and the player's
own color, their name, whether they are a teammate, what their connection is doing, and — for a
player the simulation is waiting on — the manual drop, outlined and inert until the relay would
honor it and lit red after. Everyone is listed, not only the players in trouble, because a list of
two names says nothing about how much of the game is still there. When our own link is the one that
is down there is nothing to report about anyone else, and the dialog becomes a single notice: how
long the attempt has been running, and the hold that gives up on it (`Intent::AbandonGame`, which no
host carries out yet).

**The in-game menu** (`game_menu`) stands in for SC:R's own: the wordmark and the game's clock over
the stack of things that can be done from here. Only _return to game_ reports itself today; the rest
are drawn because a menu missing half its entries is not the menu it replaces.

A modal the game's own state raises (the disconnect surface) is not dismissible — it is up exactly
while its condition holds — and takes input only once the connection problem is real: a passing stall
must never lock a player out of their own game. `Esc` and a click on the scrim close a dismissible
modal.

**Hotkeys** (`shell::hotkeys`) are one action-to-chord table, so making them user-customizable later
is settings plumbing rather than a shell change. They are consumed only while observing or watching a
replay, never while a modal of ours, one of BW's dialogs or the chat box owns the keyboard, and never
with Ctrl or Alt held (SC:R binds nearly every modified chord in game: `Alt+M` is its menu, `Ctrl+M`
its music). Shift is allowed through, since it scales an action rather than selecting a different
one. **A binding the shell cannot act on yet is not consumed**, so a key whose surface has not been
built leaves the game's own behavior alone.

| Action                               | Key       | Action                    | Key     |
| ------------------------------------ | --------- | ------------------------- | ------- |
| Pause / resume                       | `P`       | Transport plate           | `Y`     |
| Speed up / down                      | `U` / `D` | Military                  | `M`     |
| Seek back / forward (Shift: further) | `,` / `.` | Graphs (Shift: backwards) | `G`     |
| All panels                           | `A`       | Timeline                  | `T`     |
| Economy                              | `E`       | Control groups            | `H`     |
| Production                           | `F`       | Map control               | `N`     |
| Console                              | `W`       | Cycle vision              | `V`     |
| Side panel (matchup bar)             | `R`       | Spoiler-free              | `L`     |
| Minimap                              | `Q`       | Edge dock (Shift: form)   | `` ` `` |

Of these, `A`, `R`, `E`, `M`, `T`, `F`, `H`, `W`, `Q` and `Y` move panels, `` ` `` takes the dock on
and off screen while `` Shift+` `` changes which of its two forms it comes back in, `G` walks the
graphs panel through its measurements and then closes it and `Shift+G` walks the same line the other
way, `N` moves the map-control bar but only while a host is reporting one, and `P`, `U`, `D`, `,`, `.` and `L` drive a replay. `V` is still a binding
waiting for its surface. The transport keys are consumed only while a replay's view-model is being
fed, and `L` only in a replay, so anywhere else they stay the game's.

Panel visibility lives in `shell::PanelPrefs`, which is serde-serializable so a host can persist it
per profile. The console and the minimap are independent booleans there, because they are separate
surfaces in the game and observers routinely keep the minimap while hiding the console — which is
why the DLL's `console.rs` moves them with separate calls, `set_console_visible`,
`set_minimap_visible` and `set_command_panel_visible`, rather than one. `PanelPrefs` also carries
`spoiler_free`, which is a viewing preference rather than a panel: hiding every panel with `A` asks
for a clear screen, not for a replay's length to be given away; whether the dock is spelled out
as the control rail, which is one surface in two forms rather than two panels; and `graph_series`
and `graph_per_player`, which are what the one graphs panel is currently about rather than panels of
their own.

**Native dialog replacements** (`shell::native_dialogs`) are the list of SC:R dialogs the overlay
stands in for: `TimeOut`, `ChatHistory` and `GameMenu`. A host matches a spawning dialog with
`replacement_for(runtime_name)` (case-insensitive), hides it, swallows its events, and tells the shell
with `native_dialog_spawned` / `native_dialog_closed`. Matching is on the name SC:R gives a dialog at
runtime, which is not its template's file name: only `TimeOut` has been captured, so
`CHAT_HISTORY_DIALOG_NAME` and `GAME_MENU_DIALOG_NAME` are `None` and the registry never matches
those two. Filling them in means opening the dialog in a live game and reading the name off that
session's `spawn_dialog:` log line. Until the chat log's name is one of them, the only way to put
that screen in front of a real game is the _Open chat history_ button in the DLL's debug window,
which raises the modal directly (`Shell::open_modal`) with no native dialog behind it.

Dismissing a replacement is not just a matter of leaving the native dialog hidden. SC:R's in-game
menus put the game into a modal state — single-player pause, suspended cursor updates, a restricted
hotkey context — before the dialog spawns, and leave it only when the dialog closes through its own
path. So the shell answers a dismissal with `Intent::CloseNativeDialog`, and the host drives the
dialog's return control (`RETURN_CONTROL_ID`, id -3) the way a click on it would. `TimeOut` is the
exception that raises no modal of its own: the surface standing in for it is the disconnect modal,
which the disconnect status raises and lowers on its own schedule.

The **`overlay-preview` binary** (feature `preview`) is that host. It emulates the way the DLL hosts
egui rather than rendering the overlays into eframe's own context: the overlay gets its own
`egui::Context` at the game's scale, fed hand-built `RawInput`, tessellated, its texture deltas
copied into the host's texture store, and its meshes blitted as `Shape::mesh` into a viewport rect.
That is the pipeline `game/src/bw_scr/draw_overlay.rs` and `draw_inject.rs` run, so the preview also
exercises texture lifetimes, clip rects and draw order — and the knob panel beside it is ordinary
desktop chrome at the OS scale that can never overlap the overlay at any zoom.

## Running it

```bash
pnpm run overlay-preview:watch     # rebuild + relaunch on every save
```

or, from `game/` (so `game/.cargo/config.toml` applies):

```bash
cargo run -p overlay-ui --features preview --bin overlay-preview
```

Pass arguments through the watcher after a `--`, e.g.
`pnpm run overlay-preview:watch -- --backdrop shot.png`.

## Command line

| Flag               | Effect                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--backdrop <png>` | Draws this image behind the overlay instead of the gameplay frame in `backdrops/` (see the README there; also persisted into the knobs).              |
| `--render <dir>`   | Renders every scenario preset at 1280x720 and 1920x1080 into `<dir>`, prints each path, exits 0. No window is opened.                                 |
| `--smoke`          | The same renders into a temp directory, printing one summary line. Exits 0 on success and non-zero on any failure, so CI can prove the pipeline runs. |

`--render` and `--smoke` go through a small CPU rasterizer over the tessellated meshes, so they need
neither a GPU nor a window. File names are `<scenario>-<preset>-<width>x<height>.png`, plus a
`-pseudo` pass per translated screen.

## Knobs

The left panel holds everything; it is scrollable, resizable, and persisted to
`overlay-preview-knobs.json` next to the built binary on every change and on exit. Every field
defaults independently, so a file written by an older build still loads.

**Emulated screen**

- _Resolution_ — 1280x720, 1920x1080, 2560x1440, 3840x2160 (16:9) and 1024x768, 1600x1200 (4:3).
- _Scale mode_ — see below.
- _Compact ramp_ — the design's opt-in denser ramp, which divides the scale by 1.25 so the overlay
  takes less of a high-resolution screen.
- _Show reserve guides_ — outlines the regions BW's own HUD owns and overlays must stay out of: the
  348x348 unit minimap square in the bottom-left corner and the 200 unit console band across the
  rest of the bottom edge. A unit is 1px at 1080p, and the screen is 1080 units tall whatever the
  resolution, so the guides do not move with the scale ramp.
- _Backdrop_ — what is drawn behind the overlay, stretched to the emulated screen: the bundled
  gameplay frame (the default, so an overlay is always judged over a real scene), a solid dark fill,
  or a PNG from disk.

**Language**

- _Language_ — which of the five catalogs the overlay resolves its strings against, applied before
  every pass.
- _Pseudolocale_ — draws every string accented and expanded (see Translations above), whatever the
  language is set to.

**Emulated host** — everything the shell reads off the game, as switches: the mode (playing /
observing / replay), whether the game has started, whether BW's chat box is open, whether one of BW's
own dialogs is on top, and how far into the game the simulation is (a knob rather than a clock, so an
offline render of the menu is the same image every time). Under them, one row per registry entry with **spawn** and **close** buttons,
which is exactly what the DLL's dialog hook reports after hiding a dialog — so the modal a
replacement raises, the `Esc` that dismisses it and the close it asks for in return can all be walked
through here. The panel checkboxes and the hotkey listing show what `PanelPrefs` currently holds;
hotkeys typed over the emulated screen move the same state, and where they leave it is persisted.
_Show hit rects_ outlines the rects the shell claims this frame over the blit, so where a click stops
being the game's is visible.

**Scenario** — exactly one overlay is up at a time, matching the game. Each scenario builds the
view-models and the shell draws them, so what is on screen here is composed the way the game composes
it. Each has one-click presets and then per-field knobs: the disconnect overlay's rows (add/remove,
name, state, player color, teammate, elapsed seconds, drop unlocked/requested), its
self-reconnecting notice and how long that link has been down, whether the
problem is real enough to take the player's input, and a live counter tick; the network stats
overlay's identity header, per-slot rows, history strip shapes and event ticker. The **shell**
scenario has no screen of its own: it is a frame for walking the modal stack and the capture policy,
with the network-stats panel standing in as an ambient surface under it. The **chat
history** scenario is the log SC:R's own `=` dialog is replaced by: its knobs deal a synthetic game's
lines out by position (how many, whether the scopes are mixed, whether any are the local player's
own, system notices, a line long enough to wrap, a line carrying BW's color codes), and its _burst
new lines_ button appends five at the bottom, which is how the pinned scroll is judged — the list
follows them only if the reader had left it at the bottom. Selecting the scenario spawns the native
dialog it replaces, since that is what raises the modal. The **replay transport** scenario keeps a
fake replay behind the plate — a clock that runs at whatever speed the plate last asked for, that a
seek moves and a pause stops — because a seek that went nowhere would prove nothing about whether the
playhead follows the pointer; its knobs are the replay's length, where playback starts, the speed it
was recorded at, the rung it starts on, and whether the game reports a seek still in flight.
Selecting it moves the emulated host to replay mode, which is the only mode the plate exists in.
The **observer panels** scenario runs a fake game behind the panel set, because panels that report on
a game cannot be judged against numbers that never move: banks rise and fall, supply climbs and
production rows fill and restart, all as a pure function of game time, so an offline render of the
same second is the same image every time. In a replay it shares the transport's clock, since a bar
and a plate that disagreed about how far into the game it is would be reporting on two different
games. Its knobs are where the clock starts, how many players the game has (split down the middle
into two sides, which is what walks the matchup bar through its three forms), each player's race,
whether the left player is over their supply cap, whether they all carry the longest names the game
allows, how many entries each production row holds, how many of the ten number keys each player has
a group on, and whether the game reports map control at all — the real one does not yet, so that
switch is how the bar's absence is judged. Its presets are each of its three screens — minimal,
everything, and everything with the game's console hidden — at each of `1v1`, `2v2`, `3v3` and
`4v4`, and the panels answer a vision toggle and a production click the way the
game would. Production tiles draw their
atlas frame's number, since only the game DLL can reach the icons themselves. Clicks the overlay reports back (the disconnect Drop
buttons, the production selection) are logged under the knobs.

The **kitchen sink** is not a screen the game shows. It lays the whole kit out at once — a tier-0
panel, a tier-1 panel, a tier-2 dialog, every type style with Korean, Simplified Chinese and Russian
samples, the color swatches, the plots and bars, a hold-to-confirm with a live readout, and a panel
with entrance and exit motion — so a change to a token, a face or a widget can be judged against
everything it touches, at the resolutions the game runs at. Its knobs are the dialog, the disabled
state, the animated panel, and the emulated screen's compact ramp passed through for comparison.

A status line under the viewport reads out the preset, the resolved `pixels_per_point`, the logical
screen size in points, the blit scale, whether the overlay's context wants pointer or keyboard input
this frame, the shell's pointer and keyboard capture, and which modal owns the screen.

## Scale modes

The game derives `pixels_per_point` from its render target's pixel height against a 1080-line
baseline, clamped so it never drops below 1.0 — so one point is one design unit and the overlay
tracks the display rather than the OS DPI. Both preview modes reproduce that derivation and differ
only in which pixel height they feed it:

- **match window** (default) takes the on-screen viewport's own physical pixel height, so every
  glyph is rasterized once at exactly the size it is displayed at and the blit is a 1:1 pixel copy.
  The resolution preset then only fixes the aspect ratio. This is the mode to judge how text looks.
- **emulate resolution** takes the preset's pixel height, so layout is exactly what that resolution
  produces. The blit resamples to whatever size the window gives it, which softens text. This is the
  mode to check that a panel fits at 1280x720 or does not get lost at 4K. Offline renders always use
  it, since there is no window to match.

## Input

The host forwards its own frame events to the overlay's context, translated into the emulated
screen's coordinates:

- Pointer events go through while the pointer is over the emulated screen, and keep going through
  after it leaves as long as a primary press that started inside is still held, so a drag off the
  edge neither breaks nor leaves a button stuck down. Leaving without a held button sends one
  `PointerGone`.
- Keyboard, text and wheel events go through only while the emulated screen has focus, which it
  takes when a primary press lands inside it and loses when one lands outside. That keeps typing in
  a knob field out of the overlay.
- A keypress nothing focused wants is offered to the shell before the overlay's context sees it,
  the way the DLL's window proc offers it, and what the shell consumes never reaches the emulated
  game.
- Clipboard and IME events are never forwarded, matching the DLL, which translates neither.
