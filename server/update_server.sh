#!/bin/bash

# Runs everything necessary when updating an existing server installation to a
# new version (or directly after initializing a fresh installation).

cd "$(dirname "${BASH_SOURCE[0]}")"
cd ..

NODE_ENV=production
echo "Running DB migrations"
./tools/sqlx migrate run || exit 1
echo "DB migrations complete"
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
  S3CMD_ARGS=(
    --access_key="$ACCESS_KEY"
    --secret_key="$SECRET_KEY"
    --host="$HOST_BASE"
    --host-bucket="$HOST_BUCKET"
  )

  # Restarts usually don't change the on-disk assets, so we store a hash of the last-synced
  # contents in the bucket and skip the (slow, whole-bucket-listing) sync when nothing changed.
  # The marker is only written after a fully successful sync, so a failed sync will be retried on
  # the next run.
  CONTENT_HASH=$(cd server-dist/server/public && find . -type f | sort | xargs md5sum | md5sum | cut -d ' ' -f 1)
  MARKER_URI="s3://${SPACE_NAME}/deploy-markers/public-content-hash"
  REMOTE_HASH=$(s3cmd "${S3CMD_ARGS[@]}" --quiet get "$MARKER_URI" - 2>/dev/null || true)

  if [[ "$CONTENT_HASH" == "$REMOTE_HASH" ]]; then
    echo "Public assets unchanged, skipping sync"
  else
    echo "Syncing public assets to the cloud"
    # Script files have content-hashed names, so browsers and the CDN can cache them forever
    # without revalidating. Sourcemaps aren't uploaded: the bundles don't reference them (hidden
    # source maps), so nothing on the web can use them; they remain available in the server image
    # if ever needed
    s3cmd sync \
      "${S3CMD_ARGS[@]}" \
      --acl-public \
      --recursive \
      --exclude '*.map' \
      --add-header="Cache-Control: public, max-age=31536000, immutable" \
      server-dist/server/public/scripts/ s3://${SPACE_NAME}/public/scripts/ || exit 1
    # Everything else has stable filenames (with cache-busting query strings where needed), so it
    # keeps the CDN's default caching
    s3cmd sync \
      "${S3CMD_ARGS[@]}" \
      --acl-public \
      --recursive \
      --exclude 'scripts/*' \
      server-dist/server/public/ s3://${SPACE_NAME}/public/ || exit 1
    echo -n "$CONTENT_HASH" | s3cmd "${S3CMD_ARGS[@]}" put - "$MARKER_URI"
    echo "Public assets synced"

    # Old builds' script files accumulate in the bucket forever otherwise, slowing down the sync's
    # bucket listing. Deleting is restricted to objects that are BOTH absent from the current
    # build AND old, so the active build can never expire (even if no new version ships for a long
    # time), and clients whose session spans a recent deploy can still lazy-load chunks from the
    # build they're running. Best-effort: failures leave the stale files for the next deploy.
    echo "Cleaning up stale script assets"
    STALE_SCRIPTS=$(s3cmd "${S3CMD_ARGS[@]}" ls "s3://${SPACE_NAME}/public/scripts/" |
      python3 server/deployment_files/find_stale_scripts.py 180 server-dist/server/public/scripts) || true
    if [[ -n "$STALE_SCRIPTS" ]]; then
      echo "$STALE_SCRIPTS" | xargs -n 100 s3cmd "${S3CMD_ARGS[@]}" del ||
        echo "Stale script cleanup failed, will retry on next sync"
    else
      echo "No stale script assets found"
    fi
  fi
else
  echo "Skipping public assets sync because DO Spaces credentials are not set"
fi

echo "Updating completed successfully"
