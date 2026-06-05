#!/usr/bin/env bash
# Runs once per day at SessionStart. Skips when the install is a symlink (developer
# checkout), so the developer's local branch is never overwritten by the auto-updater.

PLUGIN_KEY="maestro@maestro"
INSTALLED_PLUGINS="$HOME/.claude/plugins/installed_plugins.json"
FLAG_FILE="$HOME/.claude/plugins/.maestro-update-check"
TODAY=$(date +%Y-%m-%d)

# Only check once per day to avoid slowing down every session start.
if [ -f "$FLAG_FILE" ] && [ "$(cat "$FLAG_FILE")" = "$TODAY" ]; then
  exit 0
fi
echo "$TODAY" > "$FLAG_FILE"

if [ ! -f "$INSTALLED_PLUGINS" ]; then
  exit 0
fi

# Resolve the active install path from installed_plugins.json.
INSTALL_PATH=$(python3 -c "
import json, sys
try:
    d = json.load(open('$INSTALLED_PLUGINS'))
    entries = d.get('plugins', {}).get('$PLUGIN_KEY', [])
    if entries:
        print(entries[0].get('installPath', ''))
except Exception:
    pass
" 2>/dev/null)

[ -z "$INSTALL_PATH" ] && exit 0

# Developer mode: install path is a symlink to a local checkout — skip.
[ -L "$INSTALL_PATH" ] && exit 0

claude plugin update maestro 2>/dev/null
