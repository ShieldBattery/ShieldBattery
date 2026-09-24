#!/bin/bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
cd ../..

# Prefer the compiled server tree (what the production image ships); fall back to running the
# TypeScript source through the dev register hook for development checkouts that haven't built it.
if [ -f "./server-dist/server/testing/fake-google-cloud.js" ]; then
  node --env-file-if-exists=.env -r "core-js/proposals/reflect-metadata" "./server-dist/server/testing/fake-google-cloud.js" || exit 1
else
  node --env-file-if-exists=.env -r "@swc-node/register" -r "core-js/proposals/reflect-metadata" "./server/testing/fake-google-cloud.ts" || exit 1
fi
