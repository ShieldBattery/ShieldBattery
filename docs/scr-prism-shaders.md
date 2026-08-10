# SC:R Prism Renderer Shaders

Reference for the shader system in StarCraft: Remastered's renderer ("prism"), and how
ShieldBattery's game DLL interacts with it. Derived from reverse engineering
`StarCraft 1.23.10.12409` (x86) plus ShieldBattery's own renderer hooks; the *structure*
(shader ids, names, constant layout) is stable across nearby builds, but any raw addresses
noted at the bottom are specific to that build.

## How rendering works, briefly

Each frame, game code fills a `DrawCommands` buffer with `DrawCommand` entries (see
`bw_dat`'s `structs.rs`; ShieldBattery re-exports them in `game/src/bw_scr/scr.rs`). Each
command carries:

- `shader_id` — index into the pixel shader table below
- `texture_ids[7]` — up to 7 textures, bound as `t0..t6`
- `shader_constants: [f32; 0x14]` — 80 bytes uploaded verbatim as pixel-shader `cb0`
  (5 × float4 registers)
- vertex/index buffer offsets, blend mode, render target id, sub-commands (scissor etc.)

The renderer (`Renderer::draw` vtable method) sorts and executes them. ShieldBattery hooks
this method in `game/src/bw_scr.rs` (`rendering_patches`) — that hook is where we inject
egui overlay draw commands and rewrite shader constants (e.g. the fog mask's), and it is
the last writer before constants reach the GPU.

### Shader storage and creation

Compiled shaders are embedded in the exe as `PrismShaderSet { count, shaders }` — each set
holds the same shader compiled for multiple backends, tagged by `PrismShader.api_type`:

| api_type | backend |
| -------- | ------- |
| 0x0      | D3D SM4, as a level-9 container (`ps_2_0` + `ps_4_0`) |
| 0x4      | D3D SM5 (`ps_5_0`) |
| 0x1a     | Metal (`MTLB` library; irrelevant on Windows) |

`shader_type` is 0 for vertex, 6 for pixel. The blob is a 0x38-byte prism wrapper header
followed by a standard DXBC container (`compile-shaders`' `wrap_prism_shader` produces
this). The embedded DXBC is reflection-stripped (no RDEF chunk), so constant/texture
names below came from prism's own name tables in the exe and the Metal blobs.

Shaders too complex for SM4 — all the `Deferred*` ones — ship only SM5 + Metal
(`count == 2`); the rest have `count == 3`.

**Pixel shaders are selected by numeric id, vertex shaders by name string.** The
per-id pixel table is not a static array; it's materialized on the stack inside the
renderer's `CreateShader` path. `CreateShader(this, shader, text, vertex_path,
pixel_path, arg5)` receives the vertex/pixel shader *names*, and `Shader.id` picks the
pixel set. ShieldBattery hooks `CreateShader` to capture these arguments so it can
re-create shaders after hot-reloading a replacement (`game/src/bw_scr.rs`,
`Renderer_CreateShader`).

## Pixel shader table (43 ids)

Names are the game's own (`ShaderType_*` strings in the exe, index == id). "Team color"
marks shaders that apply the per-draw team color constant (see below).

| id   | name                   | reads                                     | purpose |
| ---- | ---------------------- | ----------------------------------------- | ------- |
| 0x00 | Texture                | c0 solidColor; t0                         | Plain textured blit (UI, backgrounds): `tex * solidColor` |
| 0x01 | TextureBicubic         | c3 dims/invRes; t0                        | Bicubic-filtered blit (upscaled UI/console art) |
| 0x02 | FlatColor              | c1 multiplyColor                          | Untextured flat fill |
| 0x03 | FBOCloak               | c3; t0, t1                                | Screen-space cloak distortion composite of an offscreen target |
| 0x04 | VertexColored          | c0 solidColor; t0                         | Textured + per-vertex color (`colored_vert`, 5-float verts x,y,u,v,color). **Used by ShieldBattery's egui overlay** |
| 0x05 | VertexColoredGradient  | t0, t1                                    | Textured + vertex color with gradient/mask second texture |
| 0x06 | Font                   | c0, c3, c4; t0                            | SDF font rendering (distance decode + shadow) |
| 0x07 | Video444               | c0; t0-t2                                 | 444 video plane blit |
| 0x08 | VideoYCbCr             | c0; t0-t3                                 | YCbCr video blit |
| 0x09 | PaletteColor           | c0 solidColor; t0 index, t1 palette       | **SD sprites**: `palette[index] * solidColor`, index 0 transparent. Player color is baked into the palette texture |
| 0x0a | BlackAndWhite          | c0; t0                                    | Desaturating blit |
| 0x0b | DeferredBlit           | c3, c4; t0-t5                             | Deferred lighting resolve (reads the whole G-buffer) |
| 0x0c | Sprite                 | c0, **c2 teamColor**, c4; t0, t2          | **HD sprite, non-deferred.** Main unit shader with deferred lighting off. Team color |
| 0x0d | SpriteForward          | c0, **c2**, c3, c4; CB1[16] lights; t0, t2-t6 | **HD sprite + forward lighting.** Team color; only shader with a second cbuffer (light array — not from `shader_constants`) |
| 0x0e | SpriteTile             | t0                                        | Terrain tile blit |
| 0x0f | SpriteTileEffect       | t0                                        | Terrain tile with effect/blend term |
| 0x10 | SpriteSolid            | c0.w, c1 multiplyColor; t0                | Solid-color sprite silhouette (selection/solid overlays) |
| 0x11 | DeferredSpriteSolid    | c0.w, c1; t0                              | Deferred variant of SpriteSolid |
| 0x12 | SpriteShadow           | c0; t0                                    | Sprite shadows (alpha only) |
| 0x13 | SpriteCloaked          | t0                                        | Cloaked sprite (alpha modulation) |
| 0x14 | SpriteWarped           | t0                                        | Warp-in effect sprite |
| 0x15 | DeferredCloakMask      | t0                                        | Deferred cloak mask write |
| 0x16 | SpriteMapped           | c0; t0, t1                                | Sprite drawn through a second mapping texture |
| 0x17 | SpritePartSolid        | c0.w, **c2 teamColor**; t0, t2            | HD sprite with luma-threshold discard. Team color |
| 0x18 | DeferredPartSolid      | c0.w, **c2**, c4; t0, t2-t6               | Deferred variant of SpritePartSolid. Team color |
| 0x19 | DeferredSprite         | c0.w, **c2**, c4; t0, t2-t6               | **HD sprite, deferred.** Main unit shader with deferred lighting on; writes 6 render targets. Team color |
| 0x1a | DeferredSpriteEffect   | c0.w, **c2**, c4; t0, t2-t6               | Deferred sprite with extra effect channel. Team color |
| 0x1b | Blur                   | c0.xy; t0                                 | Separable blur |
| 0x1c | Mask                   | t0                                        | **Fog of war mask** — samples t0, outputs `(0,0,0,mask)`. **Replaced by ShieldBattery** (`shader_replaces.rs`, `mask.hlsl`) |
| 0x1d | Bloom                  | t0, t1                                    | Bloom combine |
| 0x1e | EffectMask             | t0, t1                                    | Effect mask blend |
| 0x1f | DeferredEffectMask     | t0, t1, t3, t4, t6                        | Deferred effect mask |
| 0x20 | Water                  | c4; t0-t4                                 | Water surface (normal-map animated) |
| 0x21 | DeferredWater          | c4; t0-t4                                 | Deferred water |
| 0x22 | HeatDistortion         | c3, c4.z time; t0, t1                     | Heat shimmer (animated UV offset) |
| 0x23 | DeferredHeatDistortion | c3, c4.z; t0, t1                          | Deferred heat shimmer |
| 0x24 | BrightenDown           | c0.w; t0                                  | Brighten-down overlay |
| 0x25 | DeferredBrightenDown   | c0.w; t0                                  | Deferred variant |
| 0x26 | HPBar                  | c0.xy, c1, **c2**                         | Procedural HP bar (two colors picked by thresholds; no textures) |
| 0x27 | DeferredHPBar          | c0.xy, c1, **c2**                         | Deferred variant |
| 0x28 | FishColor              | t0                                        | "Fish" idle-screen critter color pass |
| 0x29 | FishAlpha              | t0                                        | "Fish" critter alpha pass |
| 0x2a | PylonPower             | c0; t0                                    | Pylon power field overlay |

## Vertex shaders (6, selected by name)

| name                 | inputs                        | notes |
| -------------------- | ----------------------------- | ----- |
| `vert_uv1`           | pos + 1 UV set                | |
| `vert_uv2`           | pos + 2 UV sets               | |
| `vert_uv3`           | pos + 3 UV sets               | |
| `flat_color_vert`    | pos only                      | pairs with FlatColor |
| `colored_vert`       | pos, UV, color (5 floats)     | pairs with VertexColored; the layout `draw_inject.rs` emits |
| `deferred_blit_vert` | pos + 2 UV sets (SM5 only)    | fullscreen G-buffer resolve |

## Constant buffer layout

`DrawCommand.shader_constants[0x14]` is uploaded as `cb0` (5 × float4). Identical layout
on SM4 and SM5 (the level-9 containers map `cb0` registers to the same values), so a
replacement shader compiles once for both — `compile-shaders` already does this.

| register  | `shader_constants[]` | meaning |
| --------- | -------------------- | ------- |
| `cb0[0]`  | `[0..=3]`            | `solidColor` — global RGBA multiply / alpha |
| `cb0[1]`  | `[4..=7]`            | `multiplyColor` — flat/solid fill RGBA |
| `cb0[2]`  | `[8..=10]`           | `teamColor` RGB (`[11]` is unused padding) |
| `cb0[3]`  | `[12..=13]`          | sprite/texture width, height |
|           | `[14..=15]`          | `invResolution` (1/w, 1/h) — `draw_inject.rs` sets these on every injected command |
| `cb0[4]`  | `[16..=19]`          | per-effect params: `.x` "detected" blue-tint blend, `.y` normal/specular scale, `.z` animation time, `.w` light intensity (member names uncertain; roles read from shader math) |

`SpriteForward`'s light array (`lightPositions`/`lightColors`/`lightData`) lives in a
separate `CB1[16]` that does *not* come from `shader_constants`.

## Texture slots (HD sprites)

`DrawCommand.texture_ids[7]` maps 1:1 onto the HD anim layers and prism's texture names:

| slot | anim layer | prism name     |
| ---- | ---------- | -------------- |
| t0   | Diffuse    | `spriteTex`    |
| t1   | Bright     | `textureMap`   |
| t2   | TeamColor  | `teamcolorTex` |
| t3   | Emissive   | `emissiveTex`  |
| t4   | Normal     | `normalTex`    |
| t5   | Specular   | `specularTex`  |
| t6   | AO_Depth   | `ao_depthTex`  |

## How unit team color works

**HD** (shader ids 0x0c, 0x0d, 0x17, 0x18, 0x19, 0x1a): the artist-authored `teamcolor`
anim layer (bound at `t2`) masks a multiplicative tint:

```
result.rgb = lerp(diffuse.rgb, diffuse.rgb * teamColor.rgb, teamcolorMask)
```

with `teamColor` = `shader_constants[8..=10]`. The game fills that constant per draw from
its `rgb_colors: [[f32; 4]; 8]` global when `use_rgb_colors` is set (melee/ladder MP
always is) — which is exactly what ShieldBattery's custom team colors feature
(`game/src/team_colors.rs`) writes. Which shader of the six gets picked depends on
graphics settings (deferred lighting on/off) and per-image draw modes.

**SD** (shader id 0x09 `PaletteColor`): no team-color constant, no mask — player color is
baked into the palette texture (`t1`) via the classic BW per-player remap ranges. Changing
SD unit colors means changing palette data (`main_palette`) before upload, or forcing
`use_rgb_colors` (which `team_colors.rs` already does for its non-Standard modes).

### Options for adjusting unit colors, in order of preference

1. **Per-player color choice → write `rgb_colors`** (shipping today in
   `team_colors.rs`). Upstream of the HD constants, the minimap, and the palette path.
   Limits: one RGB per player, multiplicative only, only affects mask-covered pixels.
2. **Global player-independent transform (saturation, accessibility, clamping) →
   rewrite `shader_constants[8..=10]`** for the six team-color shader ids inside the
   `Renderer::draw` hook — the same pattern the hook already uses to set the mask
   shader's constants. Caveat: a `DrawCommand` carries no player id, so per-player logic
   would require fragile reverse-mapping of the RGB value.
3. **Changing the tint *math* (additive, outlines, second mask channel, recoloring
   outside the mask) → replace the sprite pixel shader sets**, same mechanism as the
   mask shader (`shader_replaces.rs`). Real friction, see below.

### Sprite shader replacement caveats

Replacing the unit shaders is mechanically identical to the existing 0x1c mask
replacement (add entries to `PATCHED_SHADERS` + HLSL files), but:

- The hot-reload path asserts the replacement set has the same entry count as the stock
  set. Stock counts differ per id: **3** (SM4+SM5+Metal) for 0x0c/0x17, **2** (SM5+Metal)
  for 0x0d/0x18/0x19/0x1a. The mask's count-2 coincidence doesn't generalize — per-id
  counts (or relaxing the assert) are needed.
- All six ids need consistent replacements, or units recolor differently depending on
  the user's graphics settings.
- The deferred variants write a 6-target G-buffer whose encoding must exactly match what
  `DeferredBlit` (0x0b) expects (normal `(x+1)/2` remap, `cb0[4].y` scale on specular,
  `cb0[4].z` in AO/depth, etc.) — reproduce it from the stock disassembly.
- A count-3 replacement needs its SM4 entry compiled as a level-9 container
  (`ps_4_0_level_9_x`) to match `api_type == 0`.

## ShieldBattery's current shader integrations

- **Mask (0x1c) replacement** — `game/src/bw_scr/shader_replaces.rs` +
  `shaders/mask.hlsl`. Transparent-fog rendering and the network-stall tint; constants
  `[0]`/`[1]` written per frame in the `Renderer::draw` hook. Debug builds hot-reload the
  HLSL on save.
- **egui overlay** — `game/src/bw_scr/draw_inject.rs` builds `DrawCommand`s with
  shader id 4 (`VertexColored`), textures created through the renderer vtable's
  `create_texture`.
- **Team colors** — `game/src/team_colors.rs` writes `rgb_colors` (no shader changes).

