---
name: pr
description: Generate a PR description for the current branch using commits, diffs, and the project template.
---

# PR Description

Generates a complete PR description for the current branch by analyzing commits, diffs, and changed files.

## When to use this vs. release-agent

| | `maestro:pr` | `release-agent` |
|---|---|---|
| **Triggered by** | Developer (standalone) | Orchestrator (pipeline) |
| **Source of truth** | Git commits + diffs | Implementation spec |
| **Output** | Description file in `{TEMP_ROOT}/issues/<N>/` | Draft PR created in GitHub |
| **Pushes branch?** | No | Yes |

Use this skill when you coded manually outside the issue workflow and want help writing the PR description.

## Config loading

Read `.claude/maestro.json`:
- `{REPO}` = `.ai.repo`
- `{TEMP_ROOT}` = `.ai.temp_root`
- `{DISPLAY_NAME}` = `.ai.display_name`

## Steps

1. Confirm the user is on a feature branch (not `develop`, `main`, or `master`). If on a protected branch, warn and ask for confirmation before proceeding.

2. Spawn `pr-agent` as a sub-agent, passing the project config above.

3. Return the output file path to the user.
