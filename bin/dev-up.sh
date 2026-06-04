#!/usr/bin/env bash
# Generic wp-env boot script for Maestro-managed projects.
# Reads the plugin slug from .claude/maestro.json — must be run from the project root.
# Usage: bash dev-up.sh [--no-seed]
set -euo pipefail

SEED="${1:-}"

# Resolve plugin slug from maestro.json (node is a guaranteed Maestro dependency).
PLUGIN_SLUG=$(node -e "const c=require(process.cwd()+'/.claude/maestro.json');console.log(c.ai.slug)" 2>/dev/null || true)

if [[ -z "${PLUGIN_SLUG:-}" ]]; then
  echo "Error: could not read ai.slug from .claude/maestro.json — run from the project root." >&2
  exit 1
fi

echo "Starting wp-env..."
npx @wordpress/env start

echo "Activating plugin: $PLUGIN_SLUG"
npx @wordpress/env run cli wp plugin activate "$PLUGIN_SLUG"

if [[ "$SEED" != "--no-seed" ]] && [[ -f ".maestro/bin/dev-seed.sh" ]]; then
  bash .maestro/bin/dev-seed.sh
fi

echo "Done. WordPress is available at http://localhost:8888"
echo "Admin: http://localhost:8888/wp-admin  (admin / password)"
