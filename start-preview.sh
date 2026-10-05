#!/usr/bin/env bash
# Makes this repository itself previewable: the controller only looks for a start script in the
# root of a checkout, so this hands over to the example project in example/.
set -euo pipefail

exec "$(dirname "$0")/example/start-preview.sh"
