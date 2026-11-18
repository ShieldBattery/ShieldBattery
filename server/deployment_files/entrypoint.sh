#!/bin/sh

# Periodically rotate logs. We run logrotate directly on a daily loop rather than via a cron daemon,
# so it needs no extra services and works as the non-root `node` user. logrotate honors the per-file
# `daily`/`weekly`/`size` directives via its state file, so a daily tick is enough.
(
  while true; do
    sleep 86400
    logrotate -s /var/lib/logrotate.status /etc/logrotate.d/shieldbattery
  done
) &

# logrotate truncates server.log in place (`copytruncate`), so it has to be written in append mode:
# a writer that keeps its own offset would leave a hole the size of everything rotated so far.
node --enable-source-maps ./server-dist/server/app.js | \
  ./node_modules/.bin/pino-tee warn ./server/logs/errors.log | \
  tee -a ./server/logs/server.log
