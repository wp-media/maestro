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
> `Stack recorded at last transplant: {manifest.interview.project_type} · {manifest.interview.languages} · tests: {manifest.interview.test_runners}`
> `Has your tech stack changed since then? (y/n — if yes, describe what changed)`

Wait for the answer. If **no**: proceed automatically. If **yes**: re-run Step 0b with a note that this is a stack update, then pass the updated interview context block to the analyst prompt.

---

## Step 0b — Project Interview (fresh mode only)

Skip this step entirely in upgrade mode — the context already exists in `transplant-context.md`.

In fresh mode, collect ground truth from the user **before** spawning the analyst. Ask all questions at once in a single message — do not ask one by one.

Present this intake form:

```
Before analysing the project, I need a few answers to make the transplant as accurate as possible.

Skip anything you don't know — the analyst will read the codebase and fill it in.
There are no wrong answers. Partial answers are fine.

1. Project type (pick one):
   a) WordPress plugin or theme
   b) Website / web app (React, Vue, Next.js, static, etc.)
   c) Backend API (REST, GraphQL — no browser UI)
   d) CLI tool or automation script
   e) Monorepo (multiple apps)
   f) Other — describe briefly

2. Primary language(s):
   e.g. PHP, TypeScript, Python, Go, Ruby — list all that apply
   (skip if unsure)

3. Test runner(s):
   e.g. PHPUnit, Jest, Vitest, Pytest, RSpec, Mocha, none yet
   (skip if unsure)

4. Local dev environment:
   a) Yes — Docker / docker compose
   b) Yes — custom shell script (what command?)
   c) Yes — other (describe)
   d) No local dev environment
   (skip if unsure)
   If yes: what URL does it run on? e.g. http://localhost:3000

5. Does the project have a browser-testable UI?
   Admin panel, web app pages, settings page, etc. — yes / no / unsure

6. CI setup:
   a) GitHub Actions
   b) Other CI (name it)
   c) No CI yet
   (skip if unsure)

Anything else I should know? (framework conventions, monorepo structure, unusual tooling, etc.)
```

Wait for the user's answers.

**Handling skipped or uncertain answers:**

| User response | What to put in the context block | What the analyst does |
|---|---|---|
| A clear answer | The answer verbatim | Treat as authoritative — do not override from codebase |
| Skipped / blank | `"infer"` | Read the codebase and derive the value; record the inferred value in the context doc |
| "I don't know" / "unsure" | `"infer"` | Same as skipped |
| "none" / "not set up yet" | `"none"` | Accept as-is — do not look for it in the codebase |
| Contradicts the codebase | Keep user answer | Trust the user; note the discrepancy in the context doc |

When the analyst cannot determine a field from either the user answer or the codebase (e.g. `"infer"` and no evidence in the codebase), it writes `"FIXME: <what is needed>"` for that field and surfaces it as a manual step in the final summary.

Once answers are received, build the **interview context block**:

```
## Project interview (user-provided ground truth — trust over codebase inference)

project_type: <answer or "infer">
languages: <answer or "infer">
test_runners: <answer or "infer">
local_dev_cmd: <boot command or "none" or "infer">
local_url: <URL or "none" or "infer">
has_browser_ui: <yes / no / infer>
ci: <answer or "infer">
notes: <free-text answer to "anything else" or empty>
```

This block is injected into the analyst prompt as the first section. It overrides any conflicting inference the analyst makes from reading the codebase.

---

## Phase 1 — Deep Analysis (Claude Opus)

Spawn the `transplant-analyst` agent with model **opus**:

**Prompt to pass (fresh mode):**
```
Analyse the project at {TARGET_ROOT} for transplanting the Maestro issue-workflow.

mode: fresh
maestro_root: {MAESTRO_ROOT}
target_root: {TARGET_ROOT}

{INTERVIEW_CONTEXT_BLOCK}

Interview field rules:
- Field value is a real answer → authoritative. Do not override from codebase even if they conflict. Note any discrepancy in the context doc.
- Field value is `"infer"` → unknown. Read the codebase and derive the value. Record the inferred value (not `"infer"`) in the context doc.
- Field value is `"none"` → user confirmed the thing does not exist. Do not look for it.
- Field value is `"FIXME: ..."` → neither the user nor the codebase supplied it. Leave it as FIXME and surface it as a manual step in your return JSON.

Use interview answers to drive disposition decisions: non-PHP projects should have PHP-specific checks rewritten or dropped; projects with no browser UI should have e2e-qa-tester dropped; test runner answers directly determine what replaces PHPUnit in DOD Check 2 and implementation agents.

Produce transplant-context.md at {TARGET_ROOT}/.claude/transplant-context.md and return the JSON summary.
```

**Prompt to pass (upgrade mode):**
```
Analyse the project at {TARGET_ROOT} for a Maestro workflow upgrade.

mode: upgrade
maestro_root: {MAESTRO_ROOT}
target_root: {TARGET_ROOT}
refs_path: {TARGET_ROOT}/.claude/transplant-refs
manifest_path: {TARGET_ROOT}/.claude/transplant-manifest.json

Produce an updated transplant-context.md and an upgrade plan. Return the JSON summary.
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

**Fresh mode:**
> "Review the context doc at `{analyst.context_path}` and confirm to generate the workflow — or describe what needs correcting."

**Upgrade mode:**
> "Here is the upgrade plan (Section 10 of the context doc). `MERGE` components will be semantically merged preserving team edits. `APPLY` components will be re-transplanted as-is (no team changes detected). `PRESERVE` and `SKIP` components will not be touched. Confirm to proceed — or describe what needs adjusting."

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
  "mode": "fresh | upgrade",
  "maestro_root": "{MAESTRO_ROOT}",
  "target_root": "{TARGET_ROOT}",
  "context_path": "{TARGET_ROOT}/.claude/transplant-context.md",
  "cluster": "cluster-name",
  "components": [
    {
      "name": "component-name",
      "disposition": "DISPOSITION-FROM-CONTEXT-DOC",
      "source_path": "/absolute/source/path (current Maestro)",
      "output_path": "/absolute/output/path",
      "ref_maestro_path": "/absolute/path/to/transplant-refs/maestro/{component} (upgrade mode only, null in fresh)",
      "ref_output_path": "/absolute/path/to/transplant-refs/output/{component} (upgrade mode only, null in fresh)"
    }
  ]
}
```

In upgrade mode, `disposition` values come from the context doc's **Section 10 — Upgrade Plan** (SKIP / PRESERVE / APPLY / MERGE) rather than Section 8. Writers handle each disposition differently — see `transplant-writer.md`.

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

## Phase 2 — Collect Results + Finalize

After all writers complete, collect their return JSON. Aggregate `files_written`, `files_skipped`, and `fixme_values`.

**Write reference snapshots** (run after writers complete, before manifest):

```bash
# Maestro sources at this point in time — used for future upgrade diffs
mkdir -p "$TARGET_ROOT/.claude/transplant-refs/maestro/agents"
mkdir -p "$TARGET_ROOT/.claude/transplant-refs/maestro/commands/issue-workflow/scripts"
mkdir -p "$TARGET_ROOT/.claude/transplant-refs/maestro/commands/issue-workflow/refs"
mkdir -p "$TARGET_ROOT/.claude/transplant-refs/maestro/bin"

cp "$MAESTRO_ROOT/agents/"*.md "$TARGET_ROOT/.claude/transplant-refs/maestro/agents/" 2>/dev/null || true
for cmd in orchestrator issue-workflow dod e2e docs compliance knowledge-graph; do
  cp "$MAESTRO_ROOT/commands/$cmd.md" "$TARGET_ROOT/.claude/transplant-refs/maestro/commands/" 2>/dev/null || true
done
cp "$MAESTRO_ROOT/commands/issue-workflow/scripts/"*.sh "$TARGET_ROOT/.claude/transplant-refs/maestro/commands/issue-workflow/scripts/" 2>/dev/null || true
cp "$MAESTRO_ROOT/commands/issue-workflow/refs/"*.md "$TARGET_ROOT/.claude/transplant-refs/maestro/commands/issue-workflow/refs/" 2>/dev/null || true
cp "$MAESTRO_ROOT/bin/"*.sh "$TARGET_ROOT/.claude/transplant-refs/maestro/bin/" 2>/dev/null || true

# Output files as written — used to detect team modifications on next upgrade
mkdir -p "$TARGET_ROOT/.claude/transplant-refs/output/agents"
mkdir -p "$TARGET_ROOT/.claude/transplant-refs/output/commands/issue-workflow/scripts"
mkdir -p "$TARGET_ROOT/.claude/transplant-refs/output/commands/issue-workflow/refs"
mkdir -p "$TARGET_ROOT/.claude/transplant-refs/output/bin"

cp "$TARGET_ROOT/.claude/agents/"*.md "$TARGET_ROOT/.claude/transplant-refs/output/agents/" 2>/dev/null || true
cp "$TARGET_ROOT/.claude/commands/"*.md "$TARGET_ROOT/.claude/transplant-refs/output/commands/" 2>/dev/null || true
cp "$TARGET_ROOT/.claude/commands/issue-workflow/scripts/"*.sh "$TARGET_ROOT/.claude/transplant-refs/output/commands/issue-workflow/scripts/" 2>/dev/null || true
cp "$TARGET_ROOT/.claude/commands/issue-workflow/refs/"*.md "$TARGET_ROOT/.claude/transplant-refs/output/commands/issue-workflow/refs/" 2>/dev/null || true
cp "$TARGET_ROOT/bin/"*.sh "$TARGET_ROOT/.claude/transplant-refs/output/bin/" 2>/dev/null || true
```

**Write transplant manifest:**

```bash
MAESTRO_COMMIT="$(git -C "$MAESTRO_ROOT" rev-parse HEAD 2>/dev/null || echo 'unknown')"
cat > "$TARGET_ROOT/.claude/transplant-manifest.json" << EOF
{
  "version": "1",
  "transplanted_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "maestro_commit": "$MAESTRO_COMMIT",
  "project_type": "{analyst.project_type}",
  "context_path": ".claude/transplant-context.md",
  "refs_path": ".claude/transplant-refs",
  "interview": {
    "project_type": "{interview.project_type}",
    "languages": "{interview.languages}",
    "test_runners": "{interview.test_runners}",
    "local_dev_cmd": "{interview.local_dev_cmd}",
    "local_url": "{interview.local_url}",
    "has_browser_ui": "{interview.has_browser_ui}",
    "ci": "{interview.ci}",
    "notes": "{interview.notes}"
  }
}
EOF
```

Print the final summary:

**Fresh mode:**
```
─────────────────────────────────────────
Transplant Complete
─────────────────────────────────────────
Target: {TARGET_ROOT}

Files written ({total count}):
  Agents:   {list of .claude/agents/*.md written}
  Commands: {list of .claude/commands/*.md written}
  Scripts:  {list of bin/ and scripts/ written}
  Config:   .claude/maestro.json

Dropped: {list or "none"}

{if fixme_values non-empty:}
⚠️  Manual steps required:
  {each fixme_value}

{if writer errors:}
⚠️  Writer errors:
  {cluster}: {error}
─────────────────────────────────────────
Next steps:
  1. Fill any FIXME values in .claude/maestro.json
  2. Review generated agents — especially backend-agent.md and qa-engineer.md
  3. Run: chmod +x {TARGET_ROOT}/bin/*.sh
  4. Commit .claude/ and bin/ to the target repo
  5. Test: cd {TARGET_ROOT} && bash bin/dev-start.sh
─────────────────────────────────────────
```

**Upgrade mode:**
```
─────────────────────────────────────────
Transplant Upgrade Complete
─────────────────────────────────────────
Target: {TARGET_ROOT}

  MERGED   ({count}): {list — team edits preserved, Maestro delta applied}
  APPLIED  ({count}): {list — re-transplanted, no team edits detected}
  PRESERVED({count}): {list — team-only changes, Maestro unchanged, not touched}
  SKIPPED  ({count}): {list — no changes on either side}

{if fixme_values non-empty:}
⚠️  Manual review needed:
  {each fixme_value}

{if merge_conflicts non-empty:}
⚠️  Merge conflicts (manual resolution required):
  {component}: {description of conflict}
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
