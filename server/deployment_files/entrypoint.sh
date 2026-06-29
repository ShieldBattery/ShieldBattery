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

node ./server/index.js | \
  ./node_modules/.bin/pino-tee warn ./server/logs/errors.log | \
  tee ./server/logs/server.log
