#!/usr/bin/env bash
# sync-pipeline.sh — Pull Maestro updates into a project's .aiassistant/ directory
#                    and wire up .claude/ symlinks for Claude Code.
#
# Usage (from a project root):
#   MAESTRO_DIR=/path/to/maestro bash /path/to/maestro/bin/sync-pipeline.sh [--dry-run]
#
# Idempotent and safe to re-run. NEVER overwrites:
#   - .aiassistant/config/               (project identity)
#   - .aiassistant/skills/*-architecture/ (project-specific architecture skills)
#   - .aiassistant/graph/                (auto-generated)
#   - AGENTS.md                          (project extends this with Session Learnings)
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
[ -d "$MAESTRO_DIR/.aiassistant" ] || die "MAESTRO_DIR ($MAESTRO_DIR) does not look like a Maestro clone — .aiassistant/ not found."

PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)" || die "Not inside a git repository."
CONFIG_FILE="$PROJECT_DIR/.aiassistant/config/repo-map.json"
[ -f "$CONFIG_FILE" ] || die "No .aiassistant/config/repo-map.json found in $PROJECT_DIR. Copy .template/repo-map.json from Maestro and fill it in."

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

make_symlink() {
  local target="$1" link="$2" label="$3"
  if [ "$DRY_RUN" = "1" ]; then
    echo "  would symlink: $label → $target"
  else
    mkdir -p "$(dirname "$link")"
    # Force-recreate so the link is always up to date.
    ln -sf "$target" "$link"
    echo "  symlinked: $label → $target"
  fi
}

# ── Agents ────────────────────────────────────────────────────────────────────

echo ""
echo "agents/"
copy_dir "$MAESTRO_DIR/.aiassistant/agents" "$PROJECT_DIR/.aiassistant/agents"

# ── Skills (shared only — never touch *-architecture directories) ─────────────

echo ""
echo "skills/"
SKILLS_SRC="$MAESTRO_DIR/.aiassistant/skills"
SKILLS_DST="$PROJECT_DIR/.aiassistant/skills"

for skill_dir in "$SKILLS_SRC"/*/; do
  skill_name="$(basename "$skill_dir")"
  if [[ "$skill_name" == *-architecture ]]; then
    echo "  skip (project-specific): skills/$skill_name/"
    continue
  fi
  copy_dir "$skill_dir" "$SKILLS_DST/$skill_name"
done

# ── Specs ─────────────────────────────────────────────────────────────────────

echo ""
echo "specs/"
copy_dir "$MAESTRO_DIR/.aiassistant/specs" "$PROJECT_DIR/.aiassistant/specs"

# ── .claude/ symlinks (Claude Code integration) ───────────────────────────────
#
# .claude/agents          → ../.aiassistant/agents        (whole directory)
# .claude/commands/*.md   → ../../.aiassistant/skills/*/SKILL.md  (per skill)
#
# Architecture skills are project-specific — their symlinks point to the local
# .aiassistant/skills/<slug>-architecture/ directory, not to Maestro.

echo ""
echo ".claude/ symlinks"

# agents directory
make_symlink "../.aiassistant/agents" \
  "$PROJECT_DIR/.claude/agents" \
  ".claude/agents"

# shared skills from Maestro
SHARED_SKILLS=(
  "orchestrator"
  "issue-workflow"
  "dod"
  "docs"
  "e2e"
  "knowledge-graph"
  "wordpress-compliance"
)

for skill in "${SHARED_SKILLS[@]}"; do
  make_symlink "../../.aiassistant/skills/${skill}/SKILL.md" \
    "$PROJECT_DIR/.claude/commands/${skill}.md" \
    ".claude/commands/${skill}.md"
done

# project-specific architecture skill(s)
if [ -n "$ARCH_SKILL" ]; then
  if [ -d "$PROJECT_DIR/.aiassistant/skills/$ARCH_SKILL" ]; then
    make_symlink "../../.aiassistant/skills/${ARCH_SKILL}/SKILL.md" \
      "$PROJECT_DIR/.claude/commands/${ARCH_SKILL}.md" \
      ".claude/commands/${ARCH_SKILL}.md"
  else
    echo "  note: .aiassistant/skills/$ARCH_SKILL/ not found — create it first, then re-run sync"
  fi
fi

if [ -n "$FRONTEND_SKILL" ]; then
  if [ -d "$PROJECT_DIR/.aiassistant/skills/$FRONTEND_SKILL" ]; then
    make_symlink "../../.aiassistant/skills/${FRONTEND_SKILL}/SKILL.md" \
      "$PROJECT_DIR/.claude/commands/${FRONTEND_SKILL}.md" \
      ".claude/commands/${FRONTEND_SKILL}.md"
  else
    echo "  note: .aiassistant/skills/$FRONTEND_SKILL/ not found — skipping frontend skill symlink"
  fi
fi

# ── Protected files (never overwrite) ─────────────────────────────────────────

echo ""
echo "protected (not touched):"
echo "  .aiassistant/config/"
echo "  .aiassistant/graph/"
echo "  .aiassistant/skills/*-architecture/"
echo "  AGENTS.md"

echo ""
if [ "$DRY_RUN" = "1" ]; then
  echo "sync-pipeline: dry run complete — no files written."
else
  echo "sync-pipeline: done."
  echo "  Review changes: git diff .aiassistant/"
  echo "  Verify links:   ls -la .claude/ .claude/commands/"
fi
