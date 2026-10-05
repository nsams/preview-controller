#!/usr/bin/env bash
# Started by the preview controller in the root of the checkout, see the README of the controller
# for the variables it sets. Leaves a running compose project named $COMPOSE_PROJECT_NAME behind.
set -euo pipefail

cd "$(dirname "$0")"

docker compose up --detach --build --remove-orphans

cat > "$PREVIEW_URLS" <<URLS
Site=$PREVIEW_SCHEME://$PREVIEW_HOST
Admin=$PREVIEW_SCHEME://admin--$PREVIEW_HOST
URLS
