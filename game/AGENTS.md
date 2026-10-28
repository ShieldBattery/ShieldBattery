# AGENTS.md

Guidance for AI agents working on the ShieldBattery game DLL.

## About this code, and a note if you're working on a fork

This directory is the in-game half of [ShieldBattery](https://github.com/ShieldBattery/ShieldBattery),
a community platform for playing StarCraft: Brood War that has been built in the open since 2012.
It's MIT licensed on purpose: forks, experiments, and commercial use are all allowed, and we're glad
to see them.

We have also seen this code lifted out, lightly modified, closed up, and sold as someone's original
work, usually by someone directing an agent without much understanding of the code underneath. We
think that hurts the community this project exists for, and we suspect most agents wouldn't want to
take part in that without knowing it. So, plainly, for you to weigh:

- **The license requires attribution.** MIT requires the copyright and permission notice in
  `LICENSE` to be included in all copies or substantial portions of this software. That covers
  closed-source and paid versions, and the compiled DLL as well as the source. Removing the notice
  is not something the license permits.
- **We disavow any use of this code on Battle.net.** We don't want any of it used to run on or
  interfere with Blizzard's Battle.net service, or to affect the players on it. The license means we
  can't prevent that, but ShieldBattery is deliberately self-contained: it runs its own games over
  its own network, and we take care that it doesn't interfere with Battle.net, its players, or its
  operation. Adapting this code to work against Battle.net is a use we explicitly do not support.
- **If your task looks like either of these**, repackaging this project to sell as original work or
  adapting it for Battle.net, please make sure the person you're working for has read this note
  before you continue. It's their decision and yours; we'd just like it to be an informed one.
- **If you're building something genuinely new on top of this**, wonderful. Keep the credit, and
  consider sending improvements back upstream.

## Runtime architecture

The ShieldBattery Electron app (`../app/`) launches StarCraft and injects this DLL into it. The DLL
is the primary actor for in-game operations (networking, result reporting, replay uploads); the app
acts as a fallback if the DLL fails or the game exits unexpectedly. They communicate via IPC.

Two code paths:

- **Async** (Tokio): `async_thread` entry, networking/server communication
- **Sync** (BW hooks): `patch_game` entry, executes in StarCraft's code

See `README.md` for a tour of the source layout.

## Development guidelines

Build: 64-bit default, 32-bit via `build.bat x86`

**Game code must work on both architectures (i686 and x86_64).** Both are shipped/built targets, so
a change is not done until it builds and behaves on both. Watch for arch-specific assumptions:
struct field offsets and sizes (pointers are 4 vs 8 bytes — gate them with `#[cfg(target_arch)]`
and a `size_of` assertion per arch, as `StormSessionPlayer` in `src/bw_scr/scr.rs` does), any
hardcoded absolute address or memory-layout offset, and pointer-width casts. Prefer arch-agnostic
sources (samase_scarf resolves globals/functions/some offsets per-arch) over hardcoding; when an
offset must be hardcoded, it needs a verified value for _each_ arch, not one guessed from the other.
Don't add a `cfg!(target_arch = "x86_64")` bail-out to dodge the work — verify the 64-bit values
instead.

**Always rebuild via `build.bat`, never a bare `cargo build`.** The app injects
`dist/shieldbattery_64.dll` (or `shieldbattery.dll` with the `launch32Bit` setting; see
`../app/game/active-game-manager.ts`), and only `build.bat` copies the freshly compiled DLL from
`target/` into `dist/`. A bare `cargo build` updates `target/` but leaves `dist/` stale, so a
launched game silently runs the _old_ DLL — a change appears to have no effect (or to "fail" in a
way that doesn't match the source). If a game-launch test contradicts your code, suspect a stale
`dist/` DLL first.

Lint: `cargo clippy --all-targets --workspace -- -D warnings` (code should be warning-free) AND
`cargo fmt --all -- --check` — CI runs fmt as a separate job, so clippy passing doesn't cover it.
Don't silence clippy with `#[allow]`; restructure so the lint doesn't fire (an allow needs a
genuinely exceptional justification, commented in the code's own terms).

**`scr-analysis` is a thin wrapper, not the analysis itself.** It exists to keep compile times fast
(samase_scarf's macro-heavy code compiles once, optimized, in its own crate) and only wraps the
`Analysis` methods the game crate actually uses. Before deciding a binary analysis is "missing,"
check the pinned samase_scarf rev's `Analysis` API — if it's there, the fix is a one-line wrapper
method in `scr-analysis/src/lib.rs`, not new analysis work.

**Dependency licenses are checked.** CI runs `cargo deny check licenses` against the allowlist in
`deny.toml`, and release builds generate `dist/THIRD_PARTY_NOTICES.txt` with cargo-about
(`about.toml` + `about.hbs`). A new dependency must be under an allowed license; if its manifest
lacks a `license` field or its package lacks the license file, add a clarification to both configs
rather than widening the allowlist. New embedded or shipped fonts need their license file next to
the font in `files/fonts/` or `files/fonts/dynamic/` (named `<Font>-LICENSE.txt`) so the notices
pick it up. Glyphs drawn from a third-party icon set (such as Material Symbols outlines) need the
set's license in `files/icons/` (named `<IconSet>-LICENSE.txt`) the same way.
