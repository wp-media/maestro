#!/usr/bin/env bash
# Stop the wp-env Docker environment.
# Pass --destroy to also remove volumes and the database.
# Must be run from the project root.
set -euo pipefail

if [[ "${1:-}" == "--destroy" ]]; then
  echo "Destroying wp-env (volumes and DB will be removed)..."
  npx @wordpress/env destroy --yes
else
  # Guard: wp-env stop exits non-zero when already stopped, which would abort CI cleanup.
  if ! npx @wordpress/env status 2>/dev/null | grep -q running; then
    echo "wp-env is not running — nothing to stop."
    exit 0
  fi
  echo "Stopping wp-env..."
  npx @wordpress/env stop
fi
