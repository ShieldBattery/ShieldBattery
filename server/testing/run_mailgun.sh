#!/bin/bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
cd ../..

node -r "core-js/proposals/reflect-metadata" -r "dotenv-expand/config" "./server/testing/fake-mailgun.js" || exit 1
