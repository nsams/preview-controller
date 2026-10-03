#!/bin/sh
# Start script of the project the end-to-end tests preview. It does what a real one does, only
# against the fake docker of the tests: report the urls and leave a compose project behind.
set -eu

echo "building $(cat version.txt)"
echo "slug=$PREVIEW_SLUG project=$COMPOSE_PROJECT_NAME port=$PREVIEW_PORT host=$PREVIEW_HOST scheme=$PREVIEW_SCHEME"

cat > "$PREVIEW_URLS" <<URLS
Site=$PREVIEW_SCHEME://$PREVIEW_HOST
Admin=$PREVIEW_SCHEME://admin--$PREVIEW_HOST
Ignored=javascript:alert(1)
URLS

docker compose up -d
