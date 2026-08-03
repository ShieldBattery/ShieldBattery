#!/bin/bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
cd ../..

# Prefer the compiled server tree (what the production image ships); fall back to running the
# TypeScript source through babel-register for development checkouts that haven't built it.
if [ -f "./server-dist/server/testing/fake-google-cloud.js" ]; then
  node -r "core-js/proposals/reflect-metadata" -r "dotenv-expand/config" "./server-dist/server/testing/fake-google-cloud.js" || exit 1
else
  node -r "./babel-register" -r "core-js/proposals/reflect-metadata" -r "dotenv-expand/config" "./server/testing/fake-google-cloud.ts" || exit 1
fi
