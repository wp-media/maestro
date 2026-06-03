#!/usr/bin/env bash
# sync-pipeline.sh — Pull Maestro updates into a project's .claude/ directory.
#
# Usage (from a project root):
#   MAESTRO_DIR=/path/to/maestro bash /path/to/maestro/bin/sync-pipeline.sh [--dry-run]
#
# Idempotent and safe to re-run. NEVER overwrites:
#   - .claude/maestro.json                   (project identity and config)
#   - .claude/commands/*-architecture/       (project-specific architecture skills)
#   - .claude/graph/                         (auto-generated knowledge graph)
#   - AGENTS.md                              (project extends this with Session Learnings)
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
  esac
done

die() { echo "sync-pipeline: $*" >&2; exit 1; }

# ── Resolve directories ────────────────────────────────────────────────────────

if [ -z "${MAESTRO_DIR:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  MAESTRO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
[ -d "$MAESTRO_DIR/.claude" ] || die "MAESTRO_DIR ($MAESTRO_DIR) does not look like a Maestro clone — .claude/ not found."

PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)" || die "Not inside a git repository."
CONFIG_FILE="$PROJECT_DIR/.claude/maestro.json"
[ -f "$CONFIG_FILE" ] || die "No .claude/maestro.json found in $PROJECT_DIR. Copy .template/repo-map.json from Maestro to .claude/maestro.json and fill it in."

# Read project identity.
SLUG="$(jq -r '.ai.slug // .name // "unknown"' "$CONFIG_FILE" 2>/dev/null || echo "unknown")"
ARCH_SKILL="$(jq -r '.ai.architecture_skill // empty' "$CONFIG_FILE" 2>/dev/null || true)"
FRONTEND_SKILL="$(jq -r '.ai.frontend_skill // empty' "$CONFIG_FILE" 2>/dev/null || true)"

echo "sync-pipeline: syncing Maestro → $SLUG ($PROJECT_DIR)"
echo "  maestro: $MAESTRO_DIR"
[ "$DRY_RUN" = "1" ] && echo "  mode: DRY RUN — no files will be written"

# ── Helpers ───────────────────────────────────────────────────────────────────

copy() {
  local src="$1" dst="$2"
  if [ "$DRY_RUN" = "1" ]; then
    echo "  would copy: ${dst#"$PROJECT_DIR/"}"
  else
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "  copied: ${dst#"$PROJECT_DIR/"}"
  fi
}

copy_dir() {
  local src_dir="$1" dst_dir="$2"
  while IFS= read -r -d '' src_file; do
    local rel="${src_file#"$src_dir/"}"
    copy "$src_file" "$dst_dir/$rel"
  done < <(find "$src_dir" -type f -print0)
}

# ── Agents ────────────────────────────────────────────────────────────────────

echo ""
echo ".claude/agents/"
copy_dir "$MAESTRO_DIR/.claude/agents" "$PROJECT_DIR/.claude/agents"

# ── Commands (shared skills — never touch *-architecture directories) ──────────

echo ""
echo ".claude/commands/"
CMDS_SRC="$MAESTRO_DIR/.claude/commands"
CMDS_DST="$PROJECT_DIR/.claude/commands"

# Copy flat command .md files
for cmd_file in "$CMDS_SRC"/*.md; do
  [ -f "$cmd_file" ] || continue
  cmd_name="$(basename "$cmd_file" .md)"
  if [[ "$cmd_name" == *-architecture ]]; then
    echo "  skip (project-specific): commands/$cmd_name.md"
    continue
  fi
  copy "$cmd_file" "$CMDS_DST/$cmd_name.md"
done

# Copy command subdirectories (supporting files like scripts, refs, html)
for cmd_dir in "$CMDS_SRC"/*/; do
  dir_name="$(basename "$cmd_dir")"
  if [[ "$dir_name" == *-architecture ]]; then
    echo "  skip (project-specific): commands/$dir_name/"
    continue
  fi
  copy_dir "${cmd_dir%/}" "$CMDS_DST/$dir_name"
done

# ── Specs ─────────────────────────────────────────────────────────────────────

echo ""
echo ".claude/specs/"
copy_dir "$MAESTRO_DIR/.claude/specs" "$PROJECT_DIR/.claude/specs"

# ── Protected files (never overwrite) ─────────────────────────────────────────

echo ""
echo "protected (not touched):"
echo "  .claude/maestro.json"
echo "  .claude/graph/"
echo "  .claude/commands/*-architecture/"
echo "  AGENTS.md"

echo ""
if [ "$DRY_RUN" = "1" ]; then
  echo "sync-pipeline: dry run complete — no files written."
else
  echo "sync-pipeline: done."
  echo "  Review changes: git diff .claude/"
fi
