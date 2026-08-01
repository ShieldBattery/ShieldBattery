#!/usr/bin/env python3
"""Finds old, no-longer-referenced script assets in cloud storage.

Reads `s3cmd ls` output for the scripts prefix on stdin and prints the URIs of objects that are
safe to delete: ones that are not part of the current build (i.e. not present in the local
scripts directory) AND were uploaded more than the given number of days ago. The age requirement
keeps recently-replaced builds available so clients with a session spanning a deploy can still
lazy-load their chunks; the local-presence requirement means the current build is never deleted,
regardless of how long ago it was uploaded.

Usage: s3cmd ls s3://bucket/public/scripts/ | find_stale_scripts.py <days> <local-scripts-dir>
"""

import datetime
import os
import sys


def main():
    cutoff_days = int(sys.argv[1])
    local_dir = sys.argv[2]
    cutoff = datetime.datetime.now() - datetime.timedelta(days=cutoff_days)
    local_files = set(os.listdir(local_dir))

    for line in sys.stdin:
        parts = line.split()
        # File lines look like: `<date> <time> <size> <uri>`. Anything else (e.g. DIR entries) is
        # skipped, which also means objects in subdirectories are conservatively left alone.
        if len(parts) != 4:
            continue
        date_str, time_str, _size, uri = parts
        if not uri.startswith('s3://'):
            continue
        if uri.rsplit('/', 1)[-1] in local_files:
            continue
        try:
            modified = datetime.datetime.strptime(f'{date_str} {time_str}', '%Y-%m-%d %H:%M')
        except ValueError:
            continue
        if modified < cutoff:
            print(uri)


if __name__ == '__main__':
    main()
