#!/bin/bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
cd ../..

node -r "./babel-register" -r "core-js/proposals/reflect-metadata" -r "dotenv-expand/config" "./server/testing/fake-mailgun.ts" || exit 1
