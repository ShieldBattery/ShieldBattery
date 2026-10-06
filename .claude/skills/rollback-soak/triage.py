"""Summarizes soak results: per-outcome counts, and for each mismatch the nearest player leave
(player_types change in the baseline) to the first mismatching frame.

usage: python triage.py [results.jsonl]   (default: .claude-scratch/rollback-soak/results.jsonl)
"""
import csv
import glob
import json
import os
import sys
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SOAK = os.path.join(ROOT, '.claude-scratch', 'rollback-soak')
results_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SOAK, 'results.jsonl')
failures_dir = os.path.join(os.path.dirname(os.path.abspath(results_path)), 'failures')
rows = [json.loads(l) for l in open(results_path) if l.strip()]
runs = [r for r in rows if r['kind'] == 'run' and r['label'] != 'plain']
games = [r for r in rows if r['kind'] == 'game']
print(f"games done: {len(games)} {dict(Counter(g['outcome'] for g in games))}")
print(f"harness runs: {len(runs)} {dict(Counter(r['outcome'] for r in runs))}")

leave_cache = {}


def leaves(game):
    if game in leave_cache:
        return leave_cache[game]
    out = []
    for f in glob.glob(os.path.join(failures_dir, f'{game}-baseline', '*.csv')):
        prev = None
        for r in csv.DictReader(open(f)):
            if not r['frame'].isdigit():
                continue
            if prev is not None and r['player_types'] != prev:
                out.append(int(r['frame']))
            prev = r['player_types']
    leave_cache[game] = out
    return out


for r in runs:
    if r['outcome'] == 'pass':
        continue
    line = (
        f"{r['game'][:8]} {r['label']} {r['outcome']:<10} {r.get('arch')} d{r.get('depth')} "
        f"delays={r.get('delays', '-')} sp{r.get('spacing')} vis={r.get('vision', '-')}"
    )
    if r['outcome'] == 'mismatch':
        m = r['mismatchFrame']
        ls = leaves(r['game'])
        near = min(ls, key=lambda x: abs(x - m)) if ls else None
        line += f" @ {m} {','.join(r['columns'])}"
        line += f" | nearest leave {near} ({m - near:+d})" if near else ' | no leaves'
    print(line)
