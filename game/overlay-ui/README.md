# overlay-ui

The presentation layer for ShieldBattery's in-game overlays, plus a native host to preview it
without launching StarCraft.

The **library** is what the injected game DLL links against: view-model types and pure egui render
functions over plain data (`disconnect`, `netstat`), the color ramps (`colors`), the font families
(`fonts`), `install_fonts_and_style`, which installs the overlay's faces and base style on an
`egui::Context`, the UI kit (`kit`) every screen is drawn from, and the translations (`i18n`) every
string goes through. It has no BW, samase or Windows dependency, which is what makes it
host-compilable. Nothing here may depend on the preview host, and the host's dependencies (eframe,
image, serde) are optional and gated behind the `preview` feature, so the DLL never pulls them in.

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

| Module         | What lives there                                                                                                                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kit::theme`   | Every token: colors per tier, text colors, player colors, spacing, radii, hit targets, motion durations, interaction overlays. One unit of the design is one egui point, so these are plain point values — never scale them again.                                                                                              |
| `kit::text`    | The type styles (`dialog_title`, `panel_title`, `numeral`, `player_name`, `body`, `column_label`, `button_label`) as `TextSpec`s that hand out a `TextFormat`, a `LayoutJob` or a laid-out galley. `caps` uppercases only what has a case, so Korean and Chinese labels stay as written. Nothing renders below 11 points.       |
| `kit::tiers`   | The three surfaces: `tier0_panel` (ambient), `tier1_panel` (gradient, bevel, parameterised corners), `tier2_dialog` (scrim, double stroke, glow, glowing title), plus the `gradient_round_rect` and chrome shapes they are built from.                                                                                          |
| `kit::motion`  | `enter_exit` / `presence_area` (150 ms fade and slide, `None` once a surface is gone) and the pulse phase.                                                                                                                                                                                                                      |
| `kit::widgets` | Buttons (`Tier1`, `Tier2`, `Tier2Primary`, `Ghost`), `hold_to_confirm`, `segmented`, `switch`, `slider`, `kbd`, `panel_header`, `stat_row`, `tag`, `pulsing_dots`, `line_plot`, `sparkline`, `progress_bar`, `share_bar`, and `set_disabled`. Each takes a `&mut Ui`, allocates its own space and paints itself from the theme. |

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

**Scenario** — exactly one overlay is up at a time, matching the game. Each scenario has one-click
presets and then per-field knobs: the disconnect overlay's rows (add/remove, name, tier, elapsed
seconds, drop unlocked/requested), its self-reconnecting notice and a live counter tick; the network
stats overlay's identity header, per-slot rows, history strip shapes and event ticker. Clicks the
overlay reports back (the disconnect Drop buttons) are logged under the knobs.

The **kitchen sink** is not a screen the game shows. It lays the whole kit out at once — a tier-0
panel, a tier-1 panel, a tier-2 dialog, every type style with Korean, Simplified Chinese and Russian
samples, the color swatches, the plots and bars, a hold-to-confirm with a live readout, and a panel
with entrance and exit motion — so a change to a token, a face or a widget can be judged against
everything it touches, at the resolutions the game runs at. Its knobs are the dialog, the disabled
state, the animated panel, and the emulated screen's compact ramp passed through for comparison.

A status line under the viewport reads out the preset, the resolved `pixels_per_point`, the logical
screen size in points, the blit scale, and whether the overlay's context wants pointer or keyboard
input this frame.

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
- Clipboard and IME events are never forwarded, matching the DLL, which translates neither.
