---
name: maestro:transplant
description: Generate a bespoke issue-workflow for any target project. Phase 1 — a Claude Opus analyst reads the project deeply and produces a disposition report. Phase 2 — on approval, parallel writer agents transplant every Maestro workflow component, adapted to the target project's actual stack, test runner, dev environment, and conventions. Use when a project needs its own self-contained issue-workflow without taking a direct dependency on Maestro.
---

# Transplant — Bespoke Issue Workflow Generator

Transplants the full Maestro issue-workflow into a target project as a self-contained, project-specific workflow. WP-specific steps are stripped for non-WP projects; everything is rewritten for the target's actual stack. The output lives entirely in the target project's `.claude/` directory and `bin/` — no Maestro dependency at runtime.

## Usage

```
/maestro:transplant <target-project-path>
```

`<target-project-path>` may be absolute or relative to the current working directory.

---

## Step 0 — Setup

Resolve paths:

```bash
MAESTRO_ROOT="$(pwd)"
TARGET_ROOT="$(cd "<target-project-path>" 2>/dev/null && pwd)"
```

If the target path does not exist, stop:
> `Error: target path does not exist — <path>`

**Detect mode** — check for an existing transplant manifest:

```bash
MANIFEST="$TARGET_ROOT/.claude/transplant-manifest.json"
if [ -f "$MANIFEST" ]; then
  MODE="upgrade"
  MAESTRO_COMMIT_AT_TRANSPLANT="$(jq -r '.maestro_commit' "$MANIFEST")"
  TRANSPLANTED_AT="$(jq -r '.transplanted_at' "$MANIFEST")"
else
  MODE="fresh"
fi
```

**Fresh mode** — if `.claude/` already contains files (but no manifest), warn:
> `.claude/ already exists in the target project and will be overwritten. Reply "proceed" to continue or "cancel" to abort.`
> Wait for confirmation before continuing.

**Upgrade mode** — if manifest found, print:
> `Transplant manifest found (last run: {TRANSPLANTED_AT}, Maestro commit: {MAESTRO_COMMIT_AT_TRANSPLANT}).`
> `Running in upgrade mode — team customizations will be preserved, only new Maestro changes will be merged in.`
> No confirmation needed; proceed automatically.

---

## Phase 1 — Deep Analysis (Claude Opus)

Spawn the `transplant-analyst` agent with model **opus**:

**Prompt to pass:**
```
Analyse the project at {TARGET_ROOT} for transplanting the Maestro issue-workflow.

maestro_root: {MAESTRO_ROOT}
target_root: {TARGET_ROOT}

Produce transplant-context.md at {TARGET_ROOT}/.claude/transplant-context.md and return the JSON summary.
```

When the analyst returns, print:

```
─────────────────────────────────────────
Transplant Analysis Complete
─────────────────────────────────────────
Project:  {analyst.project_name} ({analyst.project_type})
Language: {derived from context}
Repo:     {analyst.repo}

Component disposition:
  KEEP_AS_IS  {analyst.keep_count}
  ADAPT       {analyst.adapt_count}
  REWRITE     {analyst.rewrite_count}
  DROP        {analyst.drop_count}

Dropped:  {analyst.drops | join(", ") or "none"}

Context doc: {analyst.context_path}
─────────────────────────────────────────
```

Then ask the user:

> "Review the context doc at `{analyst.context_path}` and confirm to generate the workflow — or describe what needs correcting."

**Wait for explicit confirmation before continuing.**

If the user requests corrections: update `{TARGET_ROOT}/.claude/transplant-context.md` directly (or re-run the analyst with the correction as additional context), then ask again.

---

## Phase 2 — Directory Setup

Create the target structure:

```bash
mkdir -p "$TARGET_ROOT/.claude/agents"
mkdir -p "$TARGET_ROOT/.claude/commands/issue-workflow/scripts"
mkdir -p "$TARGET_ROOT/.claude/commands/issue-workflow/refs"
mkdir -p "$TARGET_ROOT/bin"
```

---

## Phase 2 — Build Dispatch Plans

Read `{TARGET_ROOT}/.claude/transplant-context.md` to extract the disposition table (Section 8). Cross-reference it with the component paths below to build one dispatch plan per cluster.

**Component path reference:**

| Component | Maestro source path | Target output path |
|---|---|---|
| `agents/grooming-agent.md` | `{M}/agents/grooming-agent.md` | `{T}/.claude/agents/grooming-agent.md` |
| `agents/challenger.md` | `{M}/agents/challenger.md` | `{T}/.claude/agents/challenger.md` |
| `agents/backend-agent.md` | `{M}/agents/backend-agent.md` | `{T}/.claude/agents/backend-agent.md` |
| `agents/frontend-agent.md` | `{M}/agents/frontend-agent.md` | `{T}/.claude/agents/frontend-agent.md` |
| `agents/lead-reviewer.md` | `{M}/agents/lead-reviewer.md` | `{T}/.claude/agents/lead-reviewer.md` |
| `agents/qa-engineer.md` | `{M}/agents/qa-engineer.md` | `{T}/.claude/agents/qa-engineer.md` |
| `agents/e2e-qa-tester.md` | `{M}/agents/e2e-qa-tester.md` | `{T}/.claude/agents/e2e-qa-tester.md` |
| `agents/release-agent.md` | `{M}/agents/release-agent.md` | `{T}/.claude/agents/release-agent.md` |
| `agents/ticket-writer.md` | `{M}/agents/ticket-writer.md` | `{T}/.claude/agents/ticket-writer.md` |
| `agents/test-writer.md` | `{M}/agents/test-writer.md` | `{T}/.claude/agents/test-writer.md` |
| `agents/pr-agent.md` | `{M}/agents/pr-agent.md` | `{T}/.claude/agents/pr-agent.md` |
| `commands/orchestrator.md` | `{M}/commands/orchestrator.md` | `{T}/.claude/commands/orchestrator.md` |
| `commands/issue-workflow.md` | `{M}/commands/issue-workflow.md` | `{T}/.claude/commands/issue-workflow.md` |
| `commands/dod.md` | `{M}/commands/dod.md` | `{T}/.claude/commands/dod.md` |
| `commands/e2e.md` | `{M}/commands/e2e.md` | `{T}/.claude/commands/e2e.md` |
| `commands/docs.md` | `{M}/commands/docs.md` | `{T}/.claude/commands/docs.md` |
| `commands/compliance.md` | `{M}/commands/compliance.md` | `{T}/.claude/commands/compliance.md` |
| `commands/knowledge-graph.md` | `{M}/commands/knowledge-graph.md` | `{T}/.claude/commands/knowledge-graph.md` |
| `scripts/issue-sync.sh` | `{M}/commands/issue-workflow/scripts/issue-sync.sh` | `{T}/.claude/commands/issue-workflow/scripts/issue-sync.sh` |
| `scripts/make-issue-branch.sh` | `{M}/commands/issue-workflow/scripts/make-issue-branch.sh` | `{T}/.claude/commands/issue-workflow/scripts/make-issue-branch.sh` |
| `scripts/init-pr-draft.sh` | `{M}/commands/issue-workflow/scripts/init-pr-draft.sh` | `{T}/.claude/commands/issue-workflow/scripts/init-pr-draft.sh` |
| `refs/pr-template.md` | `{M}/commands/issue-workflow/refs/pr-template.md` | `{T}/.claude/commands/issue-workflow/refs/pr-template.md` |
| `bin/dev-start.sh` | `{M}/bin/dev-up.sh` | `{T}/bin/dev-start.sh` |
| `bin/dev-seed.sh` | — (generated from scratch) | `{T}/bin/dev-seed.sh` |
| `bin/dev-down.sh` | `{M}/bin/dev-down.sh` | `{T}/bin/dev-down.sh` |
| `maestro.json` | `{M}/.template/maestro.json` | `{T}/.claude/maestro.json` |

`{M}` = `MAESTRO_ROOT`, `{T}` = `TARGET_ROOT`

Each dispatch plan follows this structure (replace placeholders with resolved absolute paths):

```json
{
  "maestro_root": "{MAESTRO_ROOT}",
  "target_root": "{TARGET_ROOT}",
  "context_path": "{TARGET_ROOT}/.claude/transplant-context.md",
  "cluster": "cluster-name",
  "components": [
    {
      "name": "component-name",
      "disposition": "DISPOSITION-FROM-CONTEXT-DOC",
      "source_path": "/absolute/source/path",
      "output_path": "/absolute/output/path"
    }
  ]
}
```

**Cluster groupings:**

| Cluster | Components |
|---|---|
| `config` | `maestro.json` (always GENERATE) |
| `orchestration` | `commands/orchestrator.md`, `commands/issue-workflow.md` |
| `grooming` | `agents/grooming-agent.md`, `agents/challenger.md` |
| `implementation` | `agents/backend-agent.md`, `agents/frontend-agent.md`, `agents/test-writer.md` |
| `quality` | `agents/lead-reviewer.md`, `agents/qa-engineer.md`, `agents/e2e-qa-tester.md` |
| `release` | `agents/release-agent.md`, `agents/ticket-writer.md`, `agents/pr-agent.md` |
| `skills` | `commands/dod.md`, `commands/e2e.md`, `commands/docs.md`, `commands/knowledge-graph.md`, `commands/compliance.md` |
| `scripts` | `bin/dev-start.sh`, `bin/dev-seed.sh`, `bin/dev-down.sh`, `scripts/issue-sync.sh`, `scripts/make-issue-branch.sh`, `scripts/init-pr-draft.sh`, `refs/pr-template.md` |

---

## Phase 2 — Spawn Writers

Spawn all 8 `transplant-writer` agents **simultaneously**, each receiving its dispatch plan as prompt input.

Each prompt must be self-contained — writers are isolated agents with no access to this conversation:

```
You are a transplant-writer agent. Here is your dispatch plan:

{dispatch plan JSON for this cluster}

Read the context doc at {TARGET_ROOT}/.claude/transplant-context.md, then process each component per its disposition. Return the JSON result when done.
```

---

## Phase 2 — Collect Results

After all writers complete, collect their return JSON. Aggregate `files_written`, `files_skipped`, and `fixme_values`.

Print the final summary:

```
─────────────────────────────────────────
Transplant Complete
─────────────────────────────────────────
Target: {TARGET_ROOT}

Files written ({total count}):
  Agents ({count}):
    {list of .claude/agents/*.md written}
  Commands ({count}):
    {list of .claude/commands/*.md written}
  Scripts ({count}):
    {list of bin/ and scripts/ written}
  Config:
    .claude/maestro.json

Dropped ({count}):
  {list — or "none"}

{if fixme_values is non-empty:}
⚠️  Manual steps required:
  {each fixme_value on its own line}

{if any writer reported errors:}
⚠️  Writer errors:
  {cluster}: {error description}
─────────────────────────────────────────
Next steps:
  1. Fill any FIXME values in .claude/maestro.json
  2. Review generated agents — especially backend-agent.md and qa-engineer.md
  3. Run: chmod +x {TARGET_ROOT}/bin/*.sh
  4. Commit .claude/ and bin/ to the target repo
  5. Test: cd {TARGET_ROOT} && bash bin/dev-start.sh
─────────────────────────────────────────
```

---

## Error handling

| Situation | Action |
|---|---|
| Analyst returns no JSON | Re-spawn with a note to return JSON. If it fails twice, ask user to run the analyst manually and provide the context doc. |
| Writer returns no JSON | Log the cluster as failed, continue collecting other results. List it in the error summary. |
| Target `.claude/` already exists and user confirmed | Proceed — writers use Write which overwrites. |
| Context doc missing a section | Proceed — writers will use FIXME markers for missing values. Flag in summary. |
| `analyst.repo == "FIXME"` | Note in summary: "Fill in `.ai.repo` and `repo` in `.claude/maestro.json`." |
