#!/bin/sh
# Start script of the project the end-to-end tests preview: reports its urls, then builds and
# starts a compose project on the given port. A non-empty file "fail" makes it fail.
set -eu

if [ -s fail ]; then
    cat fail >&2
    exit 1
fi

echo "building $(cat version.txt)"

cat > "$PREVIEW_URLS" <<URLS
Site=$PREVIEW_SCHEME://$PREVIEW_HOST
Admin=$PREVIEW_SCHEME://admin--$PREVIEW_HOST
URLS

docker compose up --detach --build --wait --wait-timeout 60
