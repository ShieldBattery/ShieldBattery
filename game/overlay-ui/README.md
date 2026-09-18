# overlay-ui

The presentation layer for ShieldBattery's in-game overlays, plus a native host to preview it
without launching StarCraft.

The **library** is what the injected game DLL links against: view-model types and pure egui render
functions over plain data (`disconnect`, `netstat`), the color ramps (`colors`), the font family
names (`fonts`) and `install_fonts_and_style`, which installs the overlay's faces and base style on
an `egui::Context`. It has no BW, samase or Windows dependency, which is what makes it host-
compilable. Nothing here may depend on the preview host, and the host's dependencies (eframe,
image, serde) are optional and gated behind the `preview` feature, so the DLL never pulls them in.

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

| Flag              | Effect                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--backdrop <png>` | Sets the image drawn behind the overlay (also persisted into the knobs).                                                                                |
| `--render <dir>`  | Renders every scenario preset at 1280x720 and 1920x1080 into `<dir>`, prints each path, exits 0. No window is opened.                                    |
| `--smoke`         | The same renders into a temp directory, printing one summary line. Exits 0 on success and non-zero on any failure, so CI can prove the pipeline runs.    |

`--render` and `--smoke` go through a small CPU rasterizer over the tessellated meshes, so they need
neither a GPU nor a window. File names are `<scenario>-<preset>-<width>x<height>.png`.

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
- _Backdrop_ — a PNG path drawn behind the overlay, stretched to the emulated screen. Blank leaves a
  solid dark fill.

**Scenario** — exactly one overlay is up at a time, matching the game. Each scenario has one-click
presets and then per-field knobs: the disconnect overlay's rows (add/remove, name, tier, elapsed
seconds, drop unlocked/requested), its self-reconnecting notice and a live counter tick; the network
stats overlay's identity header, per-slot rows, history strip shapes and event ticker. Clicks the
overlay reports back (the disconnect Drop buttons) are logged under the knobs.

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
