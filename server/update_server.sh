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
  node -r "./babel-register" -r "core-js/proposals/reflect-metadata" -r "dotenv/config" "$f" || exit 1
done

echo "Syncing public assets to the cloud"
ACCESS_KEY=$(echo $SB_FILE_STORE | jq '.doSpaces.accessKeyId')
SECRET_KEY=$(echo $SB_FILE_STORE | jq '.doSpaces.secretAccessKey')
HOST_BASE=$(echo $SB_FILE_STORE | jq '.doSpaces.endpoint')
HOST_BUCKET="%(bucket)s.${HOST_BASE}"
SPACE_NAME=$(echo $SB_FILE_STORE | jq '.doSpaces.bucket')

s3cmd sync \
  --access_key=${ACCESS_KEY} \
  --secret_key=${SECRET_KEY} \
  --host=${HOST_BASE} \
  --host-bucket=${HOST_BUCKET} \
  --recursive \
  --delete-removed \
  --skip-existing \
  server/public/ s3://${SPACE_NAME}/public/

echo "Updating completed successfully"
