# Java bot integration handoff

PurpleWave is the first Java catalog bot. The staging catalog offers
`purplewave-sb-2`, a Protoss 1v1 profile requiring Java 21 x64. Java is not bundled.
[Release and source review](https://github.com/ShieldBattery/robotics-facility/blob/purplewave-sb-2/docs/releases/purplewave-sb-2.md).

## App/runtime contract

- `runtime.jvmArguments` is optional and goes before `-jar`; normal bot arguments
  follow the JAR. PurpleWave uses `-Xms128m -Xmx1024m`. Preserve these options when
  reading catalog packages and adding/updating local builds.
- A Java bot may exit successfully immediately after its BWAPI MatchEnd callback.
  The app waits briefly for its associated SC:R result before deciding this is a
  premature exit. Supervisor exit following a reported bot exit is not a second
  failure.
- Hidden BWAPI clients close their completed victory/defeat UI through the native
  leave path. Normal shutdown keeps local transport and workers alive for native
  results and bot history writes before bounded forced cleanup.
- Local clean leaves carry an authenticated slot and final turn count to peers.
  A departed client cannot send more turns. Human resignation gives the remaining
  bot its proper victory result.
- JBWAPI's one-byte pipe request is accepted alongside native BWAPI's four-byte
  request. Its discovery-table patch uses `SB_BWAPI_INSTANCE` to isolate clients.

Rebuild Electron main and both game DLLs when integrating these backend changes:
`pnpm run build-app-main`, `game\build.bat`, and `game\build.bat x86`.

## Verification

PurpleWave completed a synchronized x64 game and defeated ZZZKBot. Java also
played with x86 SC:R. The actual installed CDN package launched with x86 SC:R,
stayed hidden, saved learning history, and finished normally; Reset learning
cleared that history. A separate installed launch succeeded with no available
catalog, using the cached map. This was a catalog-service outage test, not a
whole-machine network disconnect.

The signed staging catalog, immutable revision/receipt, and archive hashes were
independently verified. The bot library showed Ready and Java 21 installed; its
requirements panel identified the x64 runtime. The package includes original
licenses, patched source, rebuild inputs, and structured modification notices.

For test profiles, use normal app data or a temporary directory outside this
actively watched workspace: directory promotion reproducibly failed inside the
workspace, including outside the installer, while the same package installed
successfully outside it. No security-setting changes or rename workaround are
required for the normal profile.

## UI follow-ups for the UI owner

- `opponent-picker.tsx` currently passes `installed: readiness.state !==
  'notInstalled'` to library cards. An installation failure therefore shows both
  Download failed and Installed. Derive this from `bot.installed`/`bot.localBuild`.
- License access in `bot-details-dialog.tsx` is conditional on nonempty
  `modifications`. sb.2 supplies this field, but unmodified bots and older packages
  still need an independent license link.
- Editing an existing Java local build in `local-build-dialog.tsx` reconstructs
  runtime metadata without preserving `jvmArguments`. Keep existing values even
  if the dialog does not yet expose an editor for them.

- The modification list keys items only by modifier/date. PurpleWave has bot and
  dependency notices from the same modifier on the same date, producing duplicate
  React keys. Include scope and a stable unique discriminator.

No client UI files were changed as part of this Java integration.
