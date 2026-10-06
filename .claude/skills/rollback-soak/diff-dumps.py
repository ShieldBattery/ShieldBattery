"""Diff two rollback harness snapshot dumps (SB_ROLLBACK_DUMP_FRAME) from different processes.

usage: diff-dumps.py <dump-a stem> <dump-b stem> [max lines]

Each stem names a `.bin` + `.csv` pair. Words that point into one of the dump's own ranges are
compared as (range index, offset); words pointing into the executable image as exe offsets; so
two processes' differing heap addresses don't register as differences.
"""
import collections
import struct
import sys

WORD = 8


def load(stem):
    lines = open(stem + '.csv').read().splitlines()
    exe_base = int(lines[0].split(',')[1], 16)
    ranges = []
    for line in lines[2:]:
        name, start, length = line.split(',')
        ranges.append((name, int(start, 16), int(length, 16)))
    data = open(stem + '.bin', 'rb').read()
    # Ranges come in address order, which differs between processes; reorder by name.
    chunks, pos = [], 0
    for r in ranges:
        chunks.append((r, data[pos:pos + r[2]]))
        pos += r[2]
    seen = collections.Counter()
    keyed = []
    for r, d in chunks:
        keyed.append(((r[0], seen[r[0]]), r, d))
        seen[r[0]] += 1
    keyed.sort(key=lambda x: x[0])
    return exe_base, [r for _, r, _ in keyed], b''.join(d for _, _, d in keyed)


def normalizer(exe_base, ranges):
    spans = sorted((start, start + length, i) for i, (_, start, length) in enumerate(ranges))

    def norm(v):
        lo, hi = 0, len(spans)
        while lo < hi:
            mid = (lo + hi) // 2
            if spans[mid][0] <= v:
                lo = mid + 1
            else:
                hi = mid
        if lo and spans[lo - 1][0] <= v < spans[lo - 1][1]:
            s, _, i = spans[lo - 1]
            return ('R', i, v - s)
        if exe_base <= v < exe_base + 0x3000000:
            return ('E', v - exe_base)
        return v
    return norm


a_base, a_ranges, a_data = load(sys.argv[1])
b_base, b_ranges, b_data = load(sys.argv[2])
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 200
# A run with SB_ROLLBACK_EXTRA_RANGES appends its extras after the analysed ranges; compare the
# shared prefix and ignore the rest.
shared = min(len(a_ranges), len(b_ranges))
a_ranges, b_ranges = a_ranges[:shared], b_ranges[:shared]
assert [(n, l) for n, _, l in a_ranges] == [(n, l) for n, _, l in b_ranges], 'layouts differ'
na, nb = normalizer(a_base, a_ranges), normalizer(b_base, b_ranges)

diffs = []
pos = 0
for i, (name, _, length) in enumerate(a_ranges):
    for off in range(0, length - WORD + 1, WORD):
        wa = struct.unpack_from('<Q', a_data, pos + off)[0]
        wb = struct.unpack_from('<Q', b_data, pos + off)[0]
        if wa != wb and na(wa) != nb(wb):
            diffs.append((i, name, off, wa, wb, na(wa), nb(wb)))
    pos += length

by_range = collections.Counter((i, name) for i, name, *_ in diffs)
print(f'{len(diffs)} differing words')
for (i, name), n in sorted(by_range.items()):
    print(f'  range {i} {name}: {n}')
raw_heap = sum(1 for d in diffs if isinstance(d[5], int) and isinstance(d[6], int)
               and d[3] > 0x10000000000 and d[4] > 0x10000000000)
print(f'  ({raw_heap} of them look like unmapped heap pointers on both sides)')
print()
for i, name, off, wa, wb, xa, xb in diffs[:limit]:
    print(f'{i:3} {name:32} +{off:06x}  {wa:016x}  {wb:016x}  {xa} | {xb}')
