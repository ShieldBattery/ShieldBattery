#!/bin/bash
set -e

# Runs everything necessary when updating an existing server installation to a
# new version (or directly after initializing a fresh installation).

cd "$(dirname "${BASH_SOURCE[0]}")"
cd ..

echo "Running DB migrations"
yarn run migrate-up || exit 1

echo "Running redis migrations"
for f in server/redis-migrations/*.js; do
  echo "> $f"
  node -r "./babel-register" -r "dotenv/config" "$f" || exit 1
done

echo "Updating completed successfully"
