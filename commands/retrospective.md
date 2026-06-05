---
name: retrospective
description: Analyse completed pipeline runs and surface DOD pass rates, loop-backs, and failure patterns.
---

# Retrospective

Closes the pipeline feedback loop. Scans completed issue runs, surfaces patterns the
team should act on, and proposes ready-to-paste Section 13 learnings for `AGENTS.md`.

## Config loading

Read `.claude/maestro.json`:
- `{TEMP_ROOT}` = `.ai.temp_root`
- `{REPO}` = `.ai.repo`
- `{DISPLAY_NAME}` = `.ai.display_name`

## Steps

1. **Parse arguments** (if any):
   - No argument → analyse all runs found in `{TEMP_ROOT}/issues/`
   - Two ISO dates (e.g. `2026-05-01 2026-05-31`) → filter runs by `tasks.json` creation date

2. **Spawn `retrospective-agent`** with `{TEMP_ROOT}`, `{REPO}`, `{DISPLAY_NAME}`, and the
   date range (or `"all"` if not specified).

3. **Return** the output file path and a one-paragraph summary of the top finding.
