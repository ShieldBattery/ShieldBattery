#!/usr/bin/env bash
# Cleans up after a soak runner was killed mid-run (stop the runner's own process first): kills the
# Electron instances and games that runner launched, drops result rows of games that never
# finished (they rerun on the next start), and deletes the killed runs' CSVs and done files. Only
# processes and files recorded in this data dir's runs/*.pids (one per worker) are touched,
# so another runner, a repro, or anyone's own game keeps running.
#
# usage: clean-stop.sh [game id...]   (data dir: $SOAK_DATA, default .claude-scratch/rollback-soak)
# Game ids given as arguments are dropped from the results too, so they rerun.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
DATA=${SOAK_DATA:-$ROOT/.claude-scratch/rollback-soak}
cd "$DATA" || exit 1
LOGS="$APPDATA/ShieldBattery-Local/logs"
for pids in runs/*.pids; do
  [ -f "$pids" ] || continue
  while read -r kind pid; do
    [ -z "$pid" ] && continue
    taskkill //PID "$pid" //T //F > /dev/null 2>&1
    # A finished run's CSVs were deleted or moved into failures/, so any still in the logs dir for
    # one of these games belong to a run that was killed.
    [ "$kind" = game ] && rm -f "$LOGS"/rollback-harness-*-"$pid".csv "$LOGS"/rollback-probe-*-"$pid".csv
  done < "$pids"
  rm -f "$pids"
done
[ -f results.jsonl ] && python - "$@" <<'PY'
import json, sys
rows = [json.loads(l) for l in open('results.jsonl') if l.strip()]
rerun = set(sys.argv[1:])
done = {r['game'] for r in rows if r['kind'] == 'game' and r['outcome'] != 'runner-error'} - rerun
keep = [r for r in rows if r['game'] in done]
open('results.jsonl', 'w').write(''.join(json.dumps(r) + '\n' for r in keep))
print(f'results: {len(rows)} -> {len(keep)} rows')
PY
rm -f runs/*.done.json runs/*.partial
echo cleaned
