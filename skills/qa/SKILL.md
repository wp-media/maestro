---
name: maestro:qa
description: Run QA validation on a pull request — boots the local environment, tests acceptance criteria, and optionally posts the report as a PR comment. Standalone entry point for the qa-engineer agent.
argument-hint: <PR-number-or-URL>
---

# QA

Standalone QA run for any PR. Boots the local environment, validates every acceptance
criterion, and produces a test report. Posting to GitHub is your choice — you are prompted
at the end.

## Step 1 — Resolve the PR

Use `$ARGUMENTS` as the PR number or URL. If empty, resolve from the current branch:

```bash
gh pr list --head "$(git branch --show-current)" --json number,url -q '.[0] | "\(.number) \(.url)"'
```

If no PR is found, tell the user and stop.

## Step 2 — Read config

Read `.claude/maestro.json`. Extract:
- `REPO` = `.ai.repo`
- `TEMP_ROOT` = `.ai.temp_root`

## Step 3 — Invoke the qa-engineer agent

Invoke the `qa-engineer` sub-agent with:
- PR number and PR URL
- Base branch (resolve with `gh pr view <PR_NUMBER> --json baseRefName -q .baseRefName`)

> **STANDALONE MODE** — two differences from the normal pipeline run:
> 1. **Skip Step 6 (posting the PR comment).** Instead, output the full QA report as
>    formatted Markdown in your response, in a section titled `## QA Report`. Use the same
>    format the pipeline would post (including the `<!-- ai-pipeline:qa-report -->` marker)
>    so it is ready to post as-is.
> 2. **Skip the StructuredOutput JSON return.** Output a short human-readable summary
>    instead: overall result, pass/fail per criterion, and any blockers.

All other steps run normally — the environment is booted, acceptance criteria are tested,
and the full validation is performed. The report is always complete regardless of posting.

## Step 4 — Offer to post

After the agent responds, display its `## QA Report` and ask:

> **Post this QA report to PR #\<PR_NUMBER\>?**
> Reply `yes` to post, `no` to finish here.

**If yes** — post using the dedup flow: check for an existing `<!-- ai-pipeline:qa-report -->`
comment, update it with PATCH if found, otherwise create a new comment. This means a
subsequent pipeline re-run will update the comment in place rather than duplicate it.

**If no** — confirm the QA run is complete and finish.
