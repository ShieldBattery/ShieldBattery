---
name: rollback-soak
description: Soak-test the rollback engine against production replays - play prod games plainly and under randomized rollback-harness settings (forced depth, per-player late commands, snapshot spacing, vision, x64/x86) and check every confirmed frame's state hash against plain playback, then triage any divergence or crash down to the unsnapshotted state behind it. Use when asked to soak/stress-test rollback, hunt rollback desyncs, validate a snapshot-range change, or reproduce a rollback divergence from a replay.
---

# Rollback soak testing

Rollback bugs (desyncs, crashes) almost always reproduce from a replay: re-simulating frames from a
restored snapshot must give exactly the state plain playback gives. The soak plays many prod
replays both ways and compares, frame by frame, the fingerprint the harness and the probe already
log (RNG words, minerals/gas, trigger timer, player types, `state_hash`).

It exercises the snapshot/restore/re-simulate engine (`game/src/rollback/`) through the replay
harness (`rollback_harness.rs`). It does **not** exercise live-only paths: `rollback_live` pacing,
prediction, the relay, live leave timing. A replay also has no local player, so code that depends on
the local player only runs when a run sets `SB_ROLLBACK_HARNESS_VISION` (the runner randomizes it).

Everything here lives in this skill's directory; data goes to `.claude-scratch/rollback-soak/`.

| File | Purpose |
| --- | --- |
| `soak.mjs` | The runner (queue → plain run → K harness runs → compare → keep failures) |
| `triage.py` | Outcome counts + each failure's config and nearest `player_types` change |
| `cmds.mjs` | `node cmds.mjs <rep> <from> <to>` — a replay's commands in a frame range |
| `clean-stop.sh` | After killing a runner: kill its Electron/games (only those), rerun unfinished games |
| `pin-dlls.sh` | Build both arches (`bench-dll` profile) and pin them for the soak |
| `diff-dumps.py` | Diff two processes' `SB_ROLLBACK_DUMP_FRAME` dumps, pointers normalized |

## Setup

1. **A branch with the harness tooling.** Needs `SB_ROLLBACK_SOAK` (`game/src/rollback_soak.rs`:
   unpaced playback, writes a done-file and exits at the replay's end) and the app's dev-only
   `SB_GAME_DLL_DIR` (`app/game/active-game-manager.ts`). All of it is debug-assertions only.
2. **Dev stack**: Node server, Rust server, renderer dev server (`pnpm run dev`). See the
   **dev-env** skill. Then `pnpm run build-app-main`: the Electron main process runs a prebuilt
   bundle, so app TS edits do nothing until it's rebuilt.
3. **Pin the DLLs**: `bash .claude/skills/rollback-soak/pin-dlls.sh`. Re-pin after any game change
   you want soaked, and restart the runner, which only reads the DLLs at launch.
4. **Accounts/settings**: runs log in as `claude-1`/`shieldbattery` and copy settings (StarCraft path)
   from `session1` (`--settings-from <session>` to change). Each worker gets `SB_SESSION=soak-N` and
   CDP port `9300+N`.
5. **Prod access**: replays come from `http://sb-prod/internal/games/:id/artifacts` (tailnet). The
   queue comes from the prod DB MCP.

Launches already keep out of the user's way. The app gets `--hidden` (no window; CDP still drives
it), and games get `SB_APP_BACKGROUND=1`/`SB_GAME_BACKGROUND=1` (opens behind other windows, never
takes focus or touches the cursor).

## Building a queue

`queue.tsv` in the data dir: `gameId<TAB>source<TAB>type<TAB>seconds<TAB>players`, one game per
line. The runner skips games already finished in `results.jsonl`, so appending is safe. The DB MCP
returns at most 100 rows per query, so add batches. Exclude UMS. Prefer variety:

- **Games with computer players**: AI state is simulation state the snapshot must cover, and
  human-only games never exercise it. Computers are `config->'teams'[*][*].isComputer`.
- **Long team games** (matchmaking `topVBottom`, 4-6 players) for volume of commands and leaves.
- **Older games** (45-120 days) for map variety.

```sql
SELECT g.id, g.config->>'gameSource' AS src, g.config->>'gameType' AS typ, g.game_length/1000 AS secs,
  (SELECT count(*) FROM jsonb_array_elements(g.config->'teams') t, jsonb_array_elements(t) p) AS slots
FROM adjutant_diagnostics.games g
WHERE g.start_time > now() - interval '120 days' AND g.game_length > 360000
  AND g.config->>'gameType' <> 'ums'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(g.config->'teams') t, jsonb_array_elements(t) p
              WHERE (p->>'isComputer')::boolean)              -- drop for human-only games
  AND EXISTS (SELECT 1 FROM adjutant_diagnostics.game_users gu
              WHERE gu.game_id = g.id AND gu.replay_file_id IS NOT NULL)
ORDER BY md5(g.id::text || 'batch-salt') LIMIT 100
```

Use the slot count as `players`. Delays and vision pick storm/player ids below it, and an id with no
commands just adds nothing.

## Running

```bash
D=.claude-scratch/rollback-soak; S=.claude/skills/rollback-soak
node $S/soak.mjs --workers 5 --configs 3 >> $D/soak.log 2>&1   # run_in_background
python $S/triage.py
touch $D/STOP          # finish current runs and stop; delete STOP before the next start
```

- Throughput with 5 workers: roughly 40-55 games/hour (about 250-300 game frames/s per instance, unpaced).
  The workstation copes with 5 soak workers plus about 3 repro instances. Beyond that, logins start
  timing out (`runner error: page.waitForFunction`).
- Watch with a Monitor on `soak.log` filtered to `FAIL|PLAIN|runner error|finished|retrying`. Pass
  lines are noise.
- To restart a runner (new DLLs, runner edits): stop its process, `bash $S/clean-stop.sh [ids to
  rerun]`, start again. The runner reads the queue once at start, so appended games also need a
  restart.
- Runs pause while the rollback bench lock (`.claude-scratch/rollback-bench/lock`) exists.
- Storage stays small. Passing runs delete their CSVs (about 300 bytes/frame) and passing games
  delete their replays; only `failures/` keeps artifacts.

## How a run is judged

- `pass`: every confirmed frame's fingerprint matched, and confirmed frames reached within 24 of
  the plain run's end.
- `mismatch`: the first differing confirmed frame, plus the fingerprint columns that differ.
  `state_hash` alone means a small divergence; RNG or `player_types` too means a large one.
- `crash` / `timeout`: the game log tail and a fresh `latest_crash.dmp` are kept. That dump file is
  shared by every session, so it's only trustworthy right after the crash.
- `error` (Electron/launch problems) and games that exit before simulating a frame are retried, not
  reported.
- Rows after the present first reaches the replay's last frame aren't compared. BW stops stepping
  an ended replay and that state isn't snapshotted, so later re-simulations stall a few frames
  short. This is harness-only.

## Triage

**1. Make sure it's the engine, not the harness.** The harness models live netcode from a
replay, and wherever the model differs from live it can produce divergences no live game would.
- **Check what the run's inputs were doing near the frame** with
  `node $S/cmds.mjs <rep> <from> <to>`. Leaves are worth a close look: a leave is irreversible (the
  engine drops older snapshots), so if the harness applies one at a different point than live does
  (live waits until every slot's earlier turns are known; see `InputTable::take_due_leaves`), late
  commands from before it are stranded. Observer leaves don't change `player_types`, so triage's
  nearest-leave column misses them.
- **Work out the effective config.** Delays on a storm id that issues no commands are no-ops. A
  mismatch with only no-op delays means pure forced-depth re-simulation diverged: a snapshot hole
  with no late input involved, which is the clearest case of a real engine bug.
- **Compare arches.** Rerun the same config on the other architecture (`--arch`). A divergence on
  only one points at a range whose analysis or size differs per arch.

**2. Reproduce fast.** Rerun the failure's config from shortly before the frame, ending soon after,
against the saved baseline:

```bash
node $S/soak.mjs --workers 1 --configs 1 --replay-file $D/failures/<dir>/replay.rep \
  --baseline "$(ls $D/failures/<game>-baseline/*.csv)" --arch x64 --worker-base 30 \
  --fixed-env "SB_ROLLBACK_HARNESS=8,SB_ROLLBACK_SNAPSHOT_SPACING=1,SB_ROLLBACK_HARNESS_FROM=<f-120>,SB_ROLLBACK_SOAK_UNTIL=<f+80>" \
  --results $D/investigate/repro.jsonl
```

`;` stands in for `,` inside a value (`SB_ROLLBACK_DELAY=0:2;3:6`). This takes about 20 s, versus
minutes for a full replay. A run with `SB_ROLLBACK_SOAK_UNTIL` is judged up to that frame, so
`pass` means it stayed clean that far.
Repeat it a few times to tell a deterministic failure from a flaky one. Use a distinct
`--worker-base` per parallel repro.

**3. See what diverged.** Add `--env SB_ROLLBACK_DUMP_FRAME=<f-2>-<f>`, which dumps both the plain
and the harness run, then compare them with
`python $S/diff-dumps.py <plain stem> <harness stem> 100000` (stems are `%APPDATA%/ShieldBattery-Local/logs/rollback-dump-<frame>-<pid>`).
- **Cross-process noise to ignore**, already present at frames that still match: `images`,
  `sprites`, `fow_sprites`, `ai_regions`, `unit_query_scratch_marks`, `sync_data`, map tile ranges,
  and words whose only difference is the upper dword (each process's heap address high bits,
  left in struct padding).
- **What matters** is what's new at the mismatch frame: units, orders, paths, unit query results.
  BWAPI's order list decodes order ids.

**4. Find the hole.**
- `SB_ROLLBACK_AUDIT_FRAME=<f>` writes the static `.data` words outside the snapshot that differ
  between the first and the last simulation of `f`. Run it at a control frame too, well before the
  divergence, and keep only the offsets unique to `f`.
- Then bisect with `SB_ROLLBACK_EXTRA_RANGES=<hexoff>+<hexlen>,...` (exe offsets): all candidates,
  then halves, then pairs. **A hole can need several pieces together**: a cache and the key it
  was computed for, say, where restoring either alone still fails.
- Some static state is render or heap bookkeeping that crashes the game when restored. If a
  candidate set crashes, bisect the crasher out rather than giving up on the set.

**5. Identify and fix it.**
- Hand the confirmed offsets to an Opus subagent with the BinaryNinja MCP. Have it confirm first
  that the open database is the build the game ran (offsets only line up with the same build).
  Ask for: names, the whole object's extent, writers/readers (is it
  simulation?), the mechanism, and how samase_scarf can locate it on both arches.
- **Check the pinned samase_scarf rev's `Analysis` first.** Its compare dumps
  (`tests/compare/<build>-{32,64}.txt` in the cargo checkout) list every analysis result, so the
  global may already be found. Then the fix is a wrapper in `game/scr-analysis/src/lib.rs` plus a
  range in `game/src/rollback/ranges.rs` (`RangeKind::Block { offset, len }` handles an object the
  analysis resolves only part of).
- Verify on **both** arches with the fixed DLL and no extra ranges, then rerun the failed games in
  the soak at full length.

**Validating the pipeline itself.** After changing the runner or the harness, rebuild with a range
that's known to matter removed from `ranges.rs` (one added for a past divergence, with the replay
that showed it) and confirm the soak reports a mismatch.

## Winding down

Stop the runner (or `touch STOP` and let it finish), `bash $S/clean-stop.sh`, stop the dev servers
you started, and delete `rollback-dump-*` / `rollback-audit-*` files your investigations left in
`%APPDATA%/ShieldBattery-Local/logs` (dumps are about 5 MB each). Keep `failures/` and
`results.jsonl` until the findings are written up.

## Gotchas

- Python text-mode writes turn LF into CRLF on this machine, and rustfmt then fails with "Incorrect
  newline style". Read and write files as bytes.
- Git Bash mangles `rev:path` arguments (`git show origin/master:path`). Use a worktree, or
  `MSYS_NO_PATHCONV=1`.
- `rm -rf` after a `cd` with a relative glob is blocked by the safety check. Use absolute paths.
- Don't run `node -e "import('./soak.mjs')"` as a syntax check on an old copy. It used to start a
  second runner on the same sessions. The runner now only starts when executed directly; use
  `node --check`.
