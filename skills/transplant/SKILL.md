---
name: maestro:transplant
description: Generate a bespoke issue-workflow for any target project. Phase 1 — a Claude Opus analyst reads the project deeply and produces a disposition report. Phase 2 — on approval, parallel writer agents transplant every Maestro workflow component, adapted to the target project's actual stack, test runner, dev environment, and conventions. Use when a project needs its own self-contained issue-workflow without taking a direct dependency on Maestro.
disable-model-invocation: true
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

7. Agents' working temp directory:
   Agents write issue-tracking files, logs, and locks here.
   Default: `.ai` — or type a custom name (e.g. `.TemporaryItems`, `.work`)
   Leave blank to accept the default.

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
temp_root: <custom name, or ".ai" if left blank>
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
manifest_path: {TARGET_ROOT}/.claude/transplant-manifest.json

The manifest (version 2) contains a `components` array with `{ maestro_source, output_path, sha256 }` per written file — use this for team-change detection instead of a refs directory. Use `git -C {MAESTRO_ROOT} show {maestro_commit}:{maestro_source}` to reconstruct Maestro baselines.

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

**Spawn the `transplant-analyst-reviewer` agent with model opus** (fresh mode only — skip in upgrade mode):

```
Review the transplant context doc at {TARGET_ROOT}/.claude/transplant-context.md.

context_path: {TARGET_ROOT}/.claude/transplant-context.md
maestro_root: {MAESTRO_ROOT}
```

The reviewer applies unambiguous auto-fixes directly to the context doc (wrong DROP/KEEP dispositions, missing TEMP_ROOT default, etc.) and returns a verdict JSON.

**If reviewer returns `auto_fixed` entries:** note each correction.

**If reviewer returns `findings` with `severity: FAIL`:** these need user attention.

Then ask the user (combining the analyst summary + reviewer outcome):

**Fresh mode:**

If reviewer returned `NEEDS_REVISION` or any findings:
> "Reviewer flagged {N} item(s):
> {for each finding: `• [FAIL|WARN] {component}: {description}`}
>
> {if auto_fixed non-empty: `Auto-corrected {M} disposition(s) in the context doc: {list}.`}
>
> Review the context doc at `{analyst.context_path}` and confirm to proceed — or describe what needs correcting."

If reviewer returned `APPROVED`:
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
mkdir -p "$TARGET_ROOT/.claude/skills/issue-workflow/scripts"
mkdir -p "$TARGET_ROOT/.claude/skills/issue-workflow/refs"
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
| `skills/orchestrator/SKILL.md` | `{M}/skills/orchestrator/SKILL.md` | `{T}/.claude/skills/orchestrator/SKILL.md` |
| `skills/issue-workflow/SKILL.md` | `{M}/skills/issue-workflow/SKILL.md` | `{T}/.claude/skills/issue-workflow/SKILL.md` |
| `skills/dod/SKILL.md` | `{M}/skills/dod/SKILL.md` | `{T}/.claude/skills/dod/SKILL.md` |
| `skills/e2e/SKILL.md` | `{M}/skills/e2e/SKILL.md` | `{T}/.claude/skills/e2e/SKILL.md` |
| `skills/docs/SKILL.md` | `{M}/skills/docs/SKILL.md` | `{T}/.claude/skills/docs/SKILL.md` |
| `skills/compliance/SKILL.md` | `{M}/skills/compliance/SKILL.md` | `{T}/.claude/skills/compliance/SKILL.md` |
| `skills/knowledge-graph/SKILL.md` | `{M}/skills/knowledge-graph/SKILL.md` | `{T}/.claude/skills/knowledge-graph/SKILL.md` |
| `scripts/issue-sync.sh` | `{M}/skills/issue-workflow/scripts/issue-sync.sh` | `{T}/.claude/skills/issue-workflow/scripts/issue-sync.sh` |
| `scripts/make-issue-branch.sh` | `{M}/skills/issue-workflow/scripts/make-issue-branch.sh` | `{T}/.claude/skills/issue-workflow/scripts/make-issue-branch.sh` |
| `scripts/init-pr-draft.sh` | `{M}/skills/issue-workflow/scripts/init-pr-draft.sh` | `{T}/.claude/skills/issue-workflow/scripts/init-pr-draft.sh` |
| `refs/pr-template.md` | `{M}/skills/issue-workflow/refs/pr-template.md` | `{T}/.claude/skills/issue-workflow/refs/pr-template.md` |
| `bin/dev-start.sh` | `{M}/bin/dev-up.sh` | `{T}/bin/dev-start.sh` |
| `bin/dev-seed.sh` | — (generated from scratch) | `{T}/bin/dev-seed.sh` |
| `bin/dev-down.sh` | `{M}/bin/dev-down.sh` | `{T}/bin/dev-down.sh` |

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
      "output_path": "/absolute/output/path"
    }
  ]
}
```

For **MERGE** components in upgrade mode, add three extra fields so the writer can reconstruct the Maestro baseline from git without a refs directory:

```json
{
  "name": "backend-agent",
  "disposition": "MERGE",
  "source_path": "/absolute/maestro/agents/backend-agent.md",
  "output_path": "/absolute/target/.claude/agents/backend-agent.md",
  "maestro_root": "{MAESTRO_ROOT}",
  "maestro_commit": "{MAESTRO_COMMIT_AT_TRANSPLANT}",
  "maestro_source": "agents/backend-agent.md"
}
```

`maestro_commit` is the `maestro_commit` value read from the existing manifest (Step 0). `maestro_source` is the Maestro-relative path for this component.

In upgrade mode, `disposition` values come from the context doc's **Section 10 — Upgrade Plan** (SKIP / PRESERVE / APPLY / MERGE) rather than Section 8. Writers handle each disposition differently — see `transplant-writer.md`.

**Cluster groupings:**

| Cluster | Components |
|---|---|
| `orchestration` | `skills/orchestrator/SKILL.md`, `skills/issue-workflow/SKILL.md` |
| `grooming` | `agents/grooming-agent.md`, `agents/challenger.md` |
| `implementation` | `agents/backend-agent.md`, `agents/frontend-agent.md` |
| `quality` | `agents/lead-reviewer.md`, `agents/qa-engineer.md`, `agents/e2e-qa-tester.md` |
| `release` | `agents/release-agent.md`, `agents/ticket-writer.md` |
| `skills` | `skills/dod/SKILL.md`, `skills/e2e/SKILL.md`, `skills/docs/SKILL.md`, `skills/knowledge-graph/SKILL.md`, `skills/compliance/SKILL.md` |
| `scripts` | `bin/dev-start.sh`, `bin/dev-seed.sh`, `bin/dev-down.sh`, `scripts/issue-sync.sh`, `scripts/make-issue-branch.sh`, `scripts/init-pr-draft.sh`, `refs/pr-template.md` |

---

## Phase 2 — Spawn Writers

Spawn all 7 `transplant-writer` agents **simultaneously**, each receiving its dispatch plan as prompt input.

Each prompt must be self-contained — writers are isolated agents with no access to this conversation:

```
You are a transplant-writer agent. Here is your dispatch plan:

{dispatch plan JSON for this cluster}

Read the context doc at {TARGET_ROOT}/.claude/transplant-context.md, then process each component per its disposition. Return the JSON result when done.
```

---

## Phase 2 — Collect Results + Finalize

After all writers complete, collect their return JSON. Aggregate `files_written`, `file_hashes`, `files_merged`, `files_skipped`, and `fixme_values`.

**Run consistency pass** — spawn the `transplant-consistency` agent:

```
Run a cross-cluster consistency check on the transplanted workflow.

context_path: {TARGET_ROOT}/.claude/transplant-context.md
target_root: {TARGET_ROOT}
files_written: {JSON array of all files_written from aggregated writer results}
```

The consistency agent applies fixes directly to the written files. Collect its `fixes_applied` and `warnings` for the final summary. Do not block on warnings — proceed regardless of consistency findings.

**Write transplant manifest** (after consistency pass):

The manifest uses per-file SHA256 hashes (from the `file_hashes` arrays collected from writer results) instead of a refs directory. This lets the upgrade analyst detect Maestro drift via `git show` and team modifications via hash comparison — with no file copies needed.

Build the `components` array by iterating the aggregated `file_hashes`:

```bash
MAESTRO_COMMIT="$(git -C "$MAESTRO_ROOT" rev-parse HEAD 2>/dev/null || echo 'unknown')"
```

Write `{TARGET_ROOT}/.claude/transplant-manifest.json` with this structure:

```json
{
  "version": "2",
  "transplanted_at": "{ISO 8601 UTC timestamp}",
  "maestro_commit": "{MAESTRO_COMMIT}",
  "project_type": "{analyst.project_type}",
  "context_path": ".claude/transplant-context.md",
  "interview": {
    "project_type": "{interview.project_type}",
    "languages": "{interview.languages}",
    "test_runners": "{interview.test_runners}",
    "local_dev_cmd": "{interview.local_dev_cmd}",
    "local_url": "{interview.local_url}",
    "has_browser_ui": "{interview.has_browser_ui}",
    "ci": "{interview.ci}",
    "temp_root": "{interview.temp_root}",
    "notes": "{interview.notes}"
  },
  "components": [
    {
      "maestro_source": "agents/backend-agent.md",
      "output_path": ".claude/agents/backend-agent.md",
      "disposition": "ADAPT",
      "sha256": "{sha256 from file_hashes}"
    }
  ]
}
```

One entry per file in the aggregated `file_hashes`. DROPped/SKIPped/PREServed components are absent (they have no output file or no new sha256).

---

## Phase 3 — QA Pass (Claude Opus)

After the consistency pass and manifest are written, spawn the `transplant-qa` agent with model **opus**:

**Prompt:**
```
Audit the transplanted workflow for the project at {TARGET_ROOT}.

context_path: {TARGET_ROOT}/.claude/transplant-context.md
target_root: {TARGET_ROOT}
project_type: {analyst.project_type}
mode: {fresh | upgrade}
files_written: {JSON array of all files_written from aggregated writer results}
files_merged: {JSON array of all files_merged from aggregated writer results, empty array if fresh mode}
```

**On green verdict:** proceed to Phase 4.

**On red verdict:** run a targeted re-work pass:

1. Group findings by cluster (use the cluster groupings table from Phase 2).
2. For each cluster with FAIL findings, build a targeted dispatch plan containing only the flagged components. Append a `qa_feedback` array to the plan:
   ```json
   {
     "mode": "fresh",
     "maestro_root": "{MAESTRO_ROOT}",
     "target_root": "{TARGET_ROOT}",
     "context_path": "{TARGET_ROOT}/.claude/transplant-context.md",
     "cluster": "{cluster-name}",
     "qa_feedback": [
       {
         "file": "/absolute/path",
         "check": "A",
         "description": "...",
         "rework_instruction": "..."
       }
     ],
     "components": [...]
   }
   ```
3. Spawn targeted `transplant-writer` agents in parallel for each flagged cluster. Each writer's prompt includes: `"This is a QA re-work pass. Apply every item in qa_feedback to its file before re-writing."`
4. Re-run the QA agent. Maximum **2 re-spin rounds total**.
5. If still red after 2 rounds: print remaining findings as manual steps in the summary and proceed to Phase 4.

---

## Phase 4 — Cleanup Prompt

Ask:

> "`transplant-manifest.json` and `transplant-context.md` are only needed if you plan to run `/transplant` again to upgrade this workflow later. (No refs directory is created — the manifest is a single JSON file.)
>
> Keep upgrade artifacts? (y/n — default: y)"

**If no:**
```bash
rm -f "$TARGET_ROOT/.claude/transplant-manifest.json"
rm -f "$TARGET_ROOT/.claude/transplant-context.md"
```

**If yes (default):** keep both files.

---

Print the final summary:

**Fresh mode:**
```
─────────────────────────────────────────
Transplant Complete
─────────────────────────────────────────
Target: {TARGET_ROOT}

Files written ({total count}):
  Agents:   {list of .claude/agents/*.md written}
  Commands: {list of .claude/skills/*/SKILL.md written}
  Scripts:  {list of bin/ and scripts/ written}

Dropped: {list or "none"}

{if fixme_values non-empty:}
⚠️  Manual steps required:
  {each fixme_value}

{if consistency fixes non-empty:}
  Consistency fixes: {N fixes across M files}

{if consistency warnings non-empty:}
⚠️  Consistency warnings (review manually):
  {each warning}

{if writer errors:}
⚠️  Writer errors:
  {cluster}: {error}

{if upgrade artifacts removed:}
  Upgrade artifacts removed — workflow is self-contained.
{if upgrade artifacts kept:}
  Upgrade artifacts retained: .claude/transplant-manifest.json
─────────────────────────────────────────
Next steps:
  1. Review generated agents — especially orchestrator.md, backend-agent.md, and qa-engineer.md
  2. Run: chmod +x {TARGET_ROOT}/bin/*.sh
  3. Commit .claude/ and bin/ to the target repo
  4. Test: cd {TARGET_ROOT} && bash bin/dev-start.sh
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
| Writer returns no `file_hashes` | Compute hashes inline: `(sha256sum "$f" 2>/dev/null \|\| shasum -a 256 "$f") \| awk '{print $1}'` for each path in `files_written`. Use `maestro_source` from the dispatch plan for each file. |
| Reviewer agent fails or returns no JSON | Log and skip reviewer step — proceed to user review prompt without reviewer findings. |
| Consistency agent fails or returns no JSON | Log the failure in the summary as a warning. Do not block Phase 3. |
| MERGE writer cannot find `maestro_commit` in git history | Writer preserves the team's file unchanged and records a merge conflict. Surfaces in upgrade summary. |
| Target `.claude/` already exists and user confirmed | Proceed — writers use Write which overwrites. |
| Context doc missing a section | Proceed — writers will use FIXME markers for missing values. Flag in summary. |
| `analyst.repo == "FIXME"` | Note in summary: "Fill in `REPO=` in `.claude/skills/orchestrator/SKILL.md` constants block." |
