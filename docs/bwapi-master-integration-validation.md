# Local BWAPI/master integration

This local integration combines current master, the BWAPI feature branch, and the
release-practice enablement PR. It does not update any remote branch or approve
catalog publication.

## Permission and source inputs

GitHub repository metadata for authenticated account `coin-au-carre` reports
`pull: true`, `push: false`, `maintain: false`, and `admin: false` on
`ShieldBattery/ShieldBattery`. The fork reports admin/push access. Public MIT
source and local fork work permit this preparation and verification; upstream
merge/publication authority remains with maintainers. The collaborator-permission
endpoint was unavailable to the integration; repository permission metadata
provided the access check instead.

Fresh fetches established these inputs:

| Input | Revision |
| --- | --- |
| Upstream master | `ba42d75fa6a94a8ff8192a177b3dae6a6c00c01c` |
| Upstream feature/bwapi-compat | `8cd2630dd5b370d76b892fd53686e6c7cdd22730` |
| Fork release-practice PR #1838 | `1af63093a95ef0a8b55f268582ce5e5fe6fc9c44` |

Worktree: `ShieldBattery-bwapi-master-local`, branch `test/bwapi-master-local`.
Existing checkouts and their uncommitted files were preserved. Only local merge
commits were created; no push, PR update, upstream branch rewrite, release upload,
workflow dispatch, signing, or production promotion was performed.

## Conflict resolutions

Local merge `cda6e77ae` resolves five textual conflicts:

- `app/app.ts`: preserve game-window minimization and local-game/library IPC setup.
- `app/game/active-game-manager.ts`: combine local control-pipe/background settings
  handling with process lifecycle events and GPU-preference release.
- `client/settings/app/system-settings.tsx`: preserve master's settings sections
  and append Java runtime settings.
- `game/src/bw_scr.rs`: retain master's centralized sync-probe formatting rather
  than restoring the feature branch's expanded diagnostic dump.
- `server/public/locales/en/global.json`: regenerate with `pnpm gen-translations`
  after resolving source; no manual translation edits.

Local merge `2e35a9c57` incorporates PR #1838 without further textual conflicts.
Its local-session/instance-token requirements, tracked/relay rejection, fixed
production catalog trust, and development-only raw launch API remain intact.

Typecheck exposed a semantic conflict after the textual merge: practice ratings
passed numeric bonus points to the versioned division-context API introduced on
master. Local commit `85497f3bd` passes `{ bonusPool: 0 }`, using current solo
division bounds. Regressions cover rating boundaries and background process
lifecycle/GPU cleanup.

Verified code revision: `85497f3bdc2c4bb2fbfa2457f43a81a9e768a60d`.
Subsequent validation-document updates do not change compiled source.

Review patches are saved under ignored `.claude-scratch/integration/`:
`conflict-resolutions.patch` is Git's remerge diff, and
`semantic-integration.patch` contains the additional integration fix/tests.

## Static and application builds

- Frozen-lockfile root/app dependency installation passed with lifecycle scripts
  disabled. Electron native dependencies were prepared separately with the
  repository's electron-builder dependency command.
- Full TypeScript check passed.
- Full lint and formatting checks passed.
- All 344 JavaScript test files passed: 5,596 tests.
- Production Electron renderer/main bundles built successfully, then were rebuilt
  after the rating-context correction.
- Node was 24.19.0 and the bundled pnpm used for installation/builds/tests was
  11.25.0. Repository-pinned pnpm 12.14.0 subsequently validated both frozen
  lockfiles offline; no dependency or lockfile changes resulted. Windows Rust
  tooling used the existing 1.99.1 toolchain with incremental compilation disabled
  and checkout-local targets.
- Full release preflight fails with `Release build requires a valid companion
  configuration.` No companion configuration was invented and no gate was removed.
  These results therefore cover public-source production bundles/release DLLs in
  an unsigned Electron host, not the signed packaged release or companion behavior.

## Runtime evidence

Fresh task-owned profile and Documents directories live under ignored
`.claude-scratch/integration/private-state/`. No account/session/learning profile
was copied. StarCraft launches use the existing separate test game copy.

Official pinned staging trust verified catalog revision 12. Actual Electron
installation downloaded and verified `zzzkbot-sb-1`, archive SHA-256
`d581da5fbc409bdc9d7cb7259f3ede0b62535d8bc6832c74ac3d1d62128a0ffb`.
No ephemeral signing key or catalog-verification override was used. The subsequent
production-mode process reopens this installed package; that tests installed/offline
availability, not production catalog delivery.

The logged-out renderer redirects `/play/practice` to login. This is an observed
offline UI limitation, not a failed bot installation. Runtime tests therefore use
the production `practiceGameStart` IPC with installed catalog identity. They do
not establish authenticated Start-button navigation or renderer practice-history
updates. The development-only raw `localGameStart` path is not used.

### Initial shared-host x64 release and natural match

The first runtime pass used the existing shared Electron 43.1.1 executable. A
runtime audit found that the checkout requests 44.9.3. The matching runtime was
then installed into this worktree's own dependency tree without replacing the
shared binary. Matching-runtime evidence is recorded separately below.

`game/build.bat release x86_64` passed, including license-notice generation.
The copied DLL and actual loaded DLLs in both clients match SHA-256
`5dd44b2555c6272af07d46f36b444398be8bfb4d345721adfab05e6f252ba1f1`.

Installed ZZZKBot Zerg defeated a passive controlled Terran on Fighting Spirit 1.4.
The bot's natural `MatchEnd` reported winner=true at frame 4,250. Both native
clients reported the same winner before the supervisor requested result-screen
cleanup. Final counts: 7,885 accepted commands and two rejected commands. These
two rejections have no recorded encoder reason; their causes remain unclassified.
No zero-rejection or exhaustive command-conformance claim is made.

After graceful cleanup, the bot lease list was empty and neither owned game
process remained. The harness then timed out taking an optional post-game
screenshot; its original report retains that failure. Separate native-outcome and
runtime-summary records preserve the completed match, loaded-module hashes, and
successful cleanup without relabelling the screenshot check as passed.

No replay artifact was verified. Runtime reporting through native IPC does not
establish renderer practice-history updates when the route remains at login.

### Initial shared-host x86 release and natural match

`game/build.bat release x86` passed, including notices. Copied and loaded DLL
SHA-256 is
`3a26e97fb66a0d92b3b0388fd94e4b29a930d5c7e3aa2535861ce92435715292`.
Architecture-matched process inspection verified this module in both clients.

The installed bot won against passive controlled Terran, with `MatchEnd`
winner=true at frame 4,250. Both native clients reported the same winner before
cleanup. Counts: 8,228 accepted and six unclassified rejected commands. All
recorded runtime checks passed, the bot lease cleared, and both owned game
processes exited. The production process also rejected a raw `localGameStart`
request with its development-client restriction.

An earlier x86 attempt was deliberately stopped after 64-bit PowerShell failed
to enumerate the 32-bit DLL. It reached only frame 66 and is not a natural match.
Its failed report is preserved. The replacement uses 32-bit PowerShell for x86
module inspection and supplies the natural-result evidence above.

### Native checks

Both Windows targets passed the workspace/all-target test command, 994 tests per
target: 665 game tests and 329 other workspace tests. Workspace/all-target Clippy
passed on both targets in both debug and release profiles with warnings denied.
`cargo fmt --all -- --check` passed.

The final runtime-process audit found zero task-owned Electron, StarCraft, native
bot, or local bot-worker processes. Existing services and other clients were not
stopped. Original contribution checkout HEAD remains `a9c5913a9`; its existing
untracked prototype document was preserved. All three fetched input refs retain
the revisions listed above.

### Matching Electron runtime

Electron 44.9.3 was verified from `process.versions.electron` in the actual main
process. A second fresh isolated profile verified official staging revision 12
and downloaded/verified the same exact ZZZKBot release.

The x64 matching-runtime run passed. Its natural bot win occurred at frame 4,467,
with 9,982 accepted commands and one unclassified rejection. Both native result
messages agreed before cleanup; loaded DLL hashes matched the release build and
no bot leases or owned game processes remained.

Initial full-document automation navigation aborted a startup load and displayed
an `ERR_ABORTED` initialization dialog. Failed navigation attempts and optional
screenshot timeouts remain recorded. The replacement waits for startup completion
and uses SPA history navigation, leaving the app's startup load intact. This is
a harness correction, with no authentication or application-source changes. Only
the failed task-owned client was stopped; the user's normal client was preserved.

The replacement x86 matching-runtime run also recorded a natural bot win before
cleanup, at frame 4,777. Counts: 11,656 accepted commands and seven unclassified
rejections. Both native clients agreed on the winner, both loaded the matching
x86 release DLL, all leases cleared, and both owned game processes exited.

After those checks had been saved, the x86 harness finalizer called Playwright's
`ElectronApplication.process()` after `close()` disposed its backing object. The
original report/log preserve this automation failure; the separate runtime summary
derives only the recorded native results, hashes, and empty cleanup state. The
finalizer was corrected to retain the owned process handle before closing. A
separate Electron 44.9.3 launch/close check passed, validating that correction
without replaying or relabelling the completed game's evidence.

At this stage, unclassified command rejections, authenticated UI navigation,
renderer history, replay artifact/playback, signed packaged-app behavior, and
companion behavior remained outside the successful runtime claims. The runtime
audit found no task-owned clients, games, bots or workers remaining.

## Authenticated Practice and replay follow-up

The same combined production Electron bundles and x64 release DLL were exercised
on Electron 44.9.3 against an isolated local development backend. A fresh
PostgreSQL database was restored from the existing controlled-account test fixture;
18 repository migrations applied with their original checksums. Task-owned Redis
and Node services used separate ports. Existing databases and accounts were not
changed. The Node backend used its supported development configuration; these
checks do not establish production-backend deployment readiness or GraphQL flows.

Normal password login through the renderer returned HTTP 200 and displayed the
authenticated account. No copied JWT, injected auth state, or raw game-launch
fallback was used. The Practice tab, bot library, custom setup, and actual
`Start game` button were verified. Official signed staging revision 12 supplied
the same pinned ZZZKBot package verified above; gameplay then ran with the
Electron main process in production mode.

Two human-versus-ZZZKBot games ended naturally in defeat. Renderer practice
history recorded results and durations of 196,014 ms and 205,128 ms. Both native
clients loaded the expected x64 release DLL. The first automation attempt closed
the native result dialog before autosave, so that attempt does not establish
replay persistence. In the second match, the user dismissed the native defeat
dialog normally after the computer-use tool failed to attach across Windows/WSL.
StarCraft saved a genuine replay, and the renderer history acquired its path.

The saved replay is 77,250 bytes, SHA256
`f7433bd1939c57f05b3fbe039f50b55b21c79a0184f82782acdd951026689693`.
Parsing identified the original practice game ID, both players and races,
StarCraft build 13515, game logic version 6, and the ShieldBattery extension.
The replay contains 7,863 frames, including the time spent waiting at the native
defeat dialog after the recorded result.

The result page's enabled `Watch replay` button launched playback. Native replay
simulation advanced through frame 2,400; all 11 probes at 240-frame intervals,
including frame zero, matched the original live game's complete sync-probe data.
The loaded playback DLL hash matched the release build. Replay Library also
indexed an unchanged copy of this newly saved file and launched it by normal row
double-click; playback through frame 1,440 matched all seven live probes.
These checks cover saving, parsing, indexing, UI launch, and initial playback;
they do not establish full-length playback or seek-control behavior.

Original automation failures remain in ignored evidence. A replay log uses the
session log basename, while a local practice client uses a game-specific basename;
the initial verifier looked in the wrong file. Its separate summary derives
playback success from the actual native log and matching session-start marker.
A later cleanup attempt used an IPC handler unavailable in production; the
replacement relies on normal application close. No application source or
production guard was changed for these corrections.

Bot installation twice failed with Windows `EPERM` on directory promotion when
the profile lived inside the checkout watched by the development server. A shorter
path inside the checkout failed too. Installation succeeded with the disposable
profile outside the watched checkout. This bounds the observed environment issue;
it does not prove a general installer failure in normal user profiles.

Evidence is under ignored `.claude-scratch/practice-replays/`, including the
authenticated Practice screenshot, original attempt reports,
`first-watch-replay-summary.json`, native playback log, and
`completed-practice.rep`. The corrected `replay-saved-clean.json` run passed;
`verification-summary.json` records the combined findings. Practice result and
replay path persisted across application restarts. Final cleanup verified no
owned Windows processes, stopped only the task-owned database/cache/backend,
and restored the original native `LastReplay.rep` after matching both original
and task replay hashes. Disposable profiles were archived into ignored
`private-state/`. The genuine autosaved test replay remains available. No push or
remote change was performed.

## Full replay playback and seeking follow-up

The remaining public-source replay checks used the unchanged combined application
source and the exact release DLLs whose hashes are listed above. Both processes
ran on Electron 44.9.3 with the main process in production mode, isolated profiles,
normal password authentication against the disposable development backend, and
the original 77,250-byte practice replay. No debug DLL or scripted debug seek was
substituted for release behavior.

Both architectures played the entire 7,863-frame replay. Independent uninterrupted
1x baselines recorded all 33 sync probes from frame zero through frame 7,680;
every complete probe matched the original live game's data, including the period
after its reported result. The user confirmed the native replay end around 5:28
on both architectures. The native processes remained alive at replay end until
normal application cleanup. Architecture-matched module inspection verified the
actual x64 and x86 release DLL hashes in these fresh baseline processes.

Native timeline interaction was user-assisted because the computer-use helper
could not attach across Windows/WSL. Its requests and simulation were checked
independently in the game logs:

| Architecture | Logged forward/backward requests | Completed seeks | Outcome |
| --- | --- | --- | --- |
| x64 | 1 forward, 6 backward | 8, including native restart seeking after replay end | Every target reached exactly; recorded post-seek probes matched live state |
| x86 | 12 forward, 12 backward | 24 | Every target reached exactly; recorded post-seek probes matched live state |

Backward requests restored cached keyframes on both architectures. The x86 user
checks explicitly confirmed forward and backward seeking while paused, updated
pictures with the replay staying paused, resumed playback, return to frame zero,
and playback to the end. The native trace corroborates those seek targets and
subsequent frame progression. Timeline dragging can emit several requests, so the
table counts native requests rather than separate manual test cases.

Seek-phase logs were preserved before restarting the uninterrupted baselines.
An initial short x64 run was interrupted during a harness audit and is excluded
from full-playback claims. An initial concurrent x86 launch hit the production
singleton policy because both disposable user-data folders had the same basename;
using a distinct profile basename resolved that harness setup issue. The x86
baseline's final module inspection used a native 32-bit inspector. No application
source, security guard, game DLL, or installed game file changed for these checks.

Both baseline processes logged `Broken replay? Unable to read next frame` when
the final leave command was consumed at frame 4,841. This is a false-positive
end-of-command-stream diagnostic: an independent walk consumed all 260,223
command-section bytes as 2,401 complete records, and broodrep accepted all 26,374
commands with that leave as the last command. In `step_replay_commands`, consuming
the last record makes the next loop iteration call `replay_next_frame` with an
empty slice, which takes the warning path; the empty-stream check only precedes
the loop. That warning path also exists on the tested upstream master. No replay
bytes were missing, and all later probes through frame 7,680 matched live state.
The logging issue is recorded for a separate follow-up; it was not hidden or
changed to make these release-binary checks pass.

Detailed evidence is under ignored `.claude-scratch/replay-completion/`, including
separate seek-phase logs, uninterrupted baseline logs, loaded-module records, and
final per-architecture reports and command-section inspection. These results
complete full playback, seeking, paused-seek/resume, and x86 replay verification
for this one pinned practice replay. `verification-summary.json` records the
combined results and diagnostic classification. Final cleanup found zero owned
runtime processes, stopped only the task-owned backend/database/cache, confirmed
the original native LastReplay was unchanged, and archived disposable profiles
under ignored `private-state/`.
They do not establish compatibility with every replay, signed packaged-app
behavior, proprietary companion behavior, or production catalog delivery. No push
or upstream change was made for this follow-up.

## Publication boundary

Maintainers still need to integrate the branch and PR #1838, complete robotics
publication-gate PR #4, run approved CI, and publish/verify a new signed staging
revision before production promotion and desktop rollout. This local build does
not publish bots, calibrate human difficulty, or expand compatibility claims to
other bots, maps, races, or online lobbies.
