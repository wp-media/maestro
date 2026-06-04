#!/usr/bin/env bash
# Stop the wp-env Docker environment.
# Pass --destroy to also remove volumes and the database.
# Must be run from the project root.
set -euo pipefail

if [[ "${1:-}" == "--destroy" ]]; then
  echo "Destroying wp-env (volumes and DB will be removed)..."
  npx @wordpress/env destroy --yes
else
  echo "Stopping wp-env..."
  npx @wordpress/env stop
fi
