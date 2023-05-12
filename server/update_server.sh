#!/bin/bash

# Runs everything necessary when updating an existing server installation to a
# new version (or directly after initializing a fresh installation).

cd "$(dirname "${BASH_SOURCE[0]}")"
cd ..

echo "Running DB migrations"
yarn run migrate-up || exit 1
echo "DB migrations complete"
echo ""

echo "Running redis migrations"
for f in server/redis-migrations/*.js; do
  echo "> $f"
  node -r "./babel-register" -r "core-js/proposals/reflect-metadata" -r "dotenv-expand/config" "$f" || exit 1
done
echo "Redis migrations complete"
echo ""

ACCESS_KEY=$(echo $SB_FILE_STORE | jq '.doSpaces.accessKeyId' | cut -d '"' -f 2)
SECRET_KEY=$(echo $SB_FILE_STORE | jq '.doSpaces.secretAccessKey' | cut -d '"' -f 2)
HOST_BASE=$(echo $SB_FILE_STORE | jq '.doSpaces.endpoint' | cut -d '"' -f 2)
HOST_BUCKET="%(bucket)s.${HOST_BASE}"
SPACE_NAME=$(echo $SB_FILE_STORE | jq '.doSpaces.bucket' | cut -d '"' -f 2)

# TODO(2Pac): Generally these variables shouldn't be set when running integration tests (I think?),
# but maybe we should split this into a separate script, one which is not run in integration tests
# at all?

echo "DO Spaces Endpoint: $HOST_BASE"
echo "DO Spaces Bucket: $HOST_BUCKET"
echo "DO Spaces Name: $SPACE_NAME"

if [[ ! -z "$ACCESS_KEY" ]] && [[ ! -z "$SECRET_KEY" ]] && [[ ! -z "$HOST_BASE" ]] && [[ ! -z "$SPACE_NAME" ]]; then
  echo "Syncing public assets to the cloud"
  python3 ./tools/s3cmd/s3cmd sync \
    --access_key="$ACCESS_KEY" \
    --secret_key="$SECRET_KEY" \
    --host="$HOST_BASE" \
    --host-bucket="$HOST_BUCKET" \
    --acl-public \
    --recursive \
    server/public/ s3://${SPACE_NAME}/public/
else
  echo "Skipping public assets sync because DO Spaces credentials are not set"
fi

echo "Updating completed successfully"
