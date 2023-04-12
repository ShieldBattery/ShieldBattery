#!/bin/sh

crond -l 3 -f > /dev/stdout 2> /dev/stderr &

node ./server/index.js | \
  ./node_modules/.bin/pino-tee warn ./server/logs/errors.log | \
  tee ./server/logs/server.log
