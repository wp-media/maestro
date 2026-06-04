---
name: po-changelog
description: Generate a PO-ready grouped changelog from merged PRs since the last release. Produces four groups — New features / Improvements / User-facing fixes / Engineering — with linked PR and issue references, plus a changelog.txt draft for copy-pasting to the website. Invoke with `/maestro:po-changelog` (auto-detect baseline) or `/maestro:po-changelog v3.x.x` (since a specific tag). Exports to {TEMP_ROOT}/changelog/.
---

# PO Changelog

Generates a PO-ready changelog from all merged PRs since the last release, grouped by user impact.
Includes a `changelog.txt Draft` section at the end with condensed, website-ready copy.

## Config loading

Read `.claude/maestro.json`:
- `{REPO}` = `.ai.repo`
- `{TEMP_ROOT}` = `.ai.temp_root`
- `{DISPLAY_NAME}` = `.ai.display_name`

## Steps

1. **Parse the argument** (if any):
   - No argument → `baseline = "auto"` (auto-detect from last "Release X.Y.Z" commit or latest tag)
   - `v3.5.0` → `baseline = "v3.5.0"`

2. **Spawn `changelog-agent`** as a sub-agent, passing `baseline` and the project config above.

3. **Return** the output file path and a one-line summary (baseline used, PR count, category breakdown).
