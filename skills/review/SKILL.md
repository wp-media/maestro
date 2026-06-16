---
name: maestro:review
description: Run a lead code review on the current branch or a given PR. Standalone entry point for the lead-reviewer agent.
argument-hint: [PR-number-or-URL]
---

# Review

Standalone code review for any PR. Runs the full lead-reviewer analysis against the spec
and project standards. Posting inline comments and the summary to GitHub is your choice —
you are prompted at the end.

## Step 1 — Resolve the PR

If `$ARGUMENTS` is provided, use it as the PR number or URL.

Otherwise resolve from the current branch:
```bash
gh pr list --head "$(git branch --show-current)" --json number,url -q '.[0] | "\(.number) \(.url)"'
```

If no PR is found, tell the user and stop.

## Step 2 — Read config and gather context

Read `.claude/maestro.json`. Extract:
- `TEMP_ROOT` = `.ai.temp_root`
- `REPO` = `.ai.repo`

Then gather from the PR:
```bash
gh pr view <PR_NUMBER> --json baseRefName,body -q '{base: .baseRefName, body: .body}'
```

Extract the base branch and the linked issue number (look for `Fixes #N`, `Closes #N`, or
a GitHub issue URL in the PR body).

## Step 3 — Locate the spec

If a linked issue number was found, check for a spec at:
`{TEMP_ROOT}/issues/<N>/spec.md`

If the spec exists, pass its path to the agent.
If it does not exist, inform the user: "No grooming spec found — the review will check
against project standards only (spec compliance section will be skipped)."

## Step 4 — Invoke the lead-reviewer agent

Invoke the `lead-reviewer` sub-agent with:
- Issue number (if known) and spec path (if found, else omit)
- Base branch from Step 2
- PR number
- `CURRENT_MODEL`: "standalone"
- `session_learnings`: read Section 13 of `AGENTS.md` if it exists, else pass empty string

> **STANDALONE MODE** — two differences from the normal pipeline run:
> 1. **Skip Step 5 (inline PR comments) and Step 5b (summary PR comment).** Instead, output
>    the full review report — findings table, blockers, nice-to-haves — as formatted Markdown
>    in your response, in a section titled `## Review Report`.
> 2. **Skip Step 6 (StructuredOutput JSON).** Return a short human-readable verdict summary
>    instead: overall verdict, blocker count, and any open questions.

## Step 5 — Offer to post

After the agent responds, display its `## Review Report` and ask:

> **Post this review to PR #\<PR_NUMBER\>?**
> Reply `yes` to post inline comments + summary, `no` to finish here.

**If yes** — the agent posts inline comments (Step 5) and the summary comment (Step 5b)
using the normal dedup flow. Both respect the `<!-- ai-pipeline:lead-review -->` marker so
a re-run later (via the pipeline) will update in place rather than duplicate.

**If no** — confirm the review is complete and finish.
