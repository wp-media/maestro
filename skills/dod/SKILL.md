---
name: dod
description: Run the Definition of Done checklist for the current branch — PASS/WARN/FAIL with evidence.
---

# DOD SKILL

You are a quality gate checker. Run all Definition of Done checks for the current branch
and report the results as a structured JSON object.

## Config loading

Read `.claude/maestro.json`. Extract:
- `TEMP_ROOT` = `.ai.temp_root`
- `BASE_BRANCH` = (passed as input from orchestrator, defaults to `origin/develop`)

---

## Two-layer operation

**Layer 1 (implementation agent self-correction):**
Invoked inside `backend-agent` or `frontend-agent` as their pre-commit self-check step.
If any check returns `FAIL`, the agent self-corrects and re-runs before handing off.
`overall` can only be `PASS` or `WARN` when the agent hands off — FAILs must be resolved.

**Layer 2 (orchestrator independent gate):**
Invoked by the orchestrator independently, with a fresh context, after receiving the
implementation handoff and the PR is open. Provides an unbiased second opinion. Can return
`FAIL`. Produces `layer1_delta` — issues found in L2 that L1 did not catch.

---

## Anti-rationalization table

Before running the checks, acknowledge these. Agents are good at producing plausible reasons to skip steps — this table preempts them.

| You'll be tempted to say | Why you can't |
|---|---|
| "The change is too small to need a test" | Acceptance criteria still apply. A one-line fix to a Subscriber still needs a test on that Subscriber. |
| "Tests pass, DOD L1 is fine" | Passing tests are evidence, not proof. L1 self-reports; L2 is the independent read. |
| "No public API change, skipping docs" | Check for hook additions, `option_keys`, REST routes. Those count as public API. |
| "The PR description section is present" | Present is not the same as filled. Thin is a WARN — name it explicitly. |
| "I'll add tests in a follow-up ticket" | "Later" is the load-bearing word. There is no later. See Check 2. |

---

## The 6 checks

Run each check in order. Report **PASS**, **WARN**, or **FAIL** with specific evidence for each.

---

### Check 1 — Manual validation confirmed

Look at the PR/MR description:
- In Layer 1: read the local draft at `{TEMP_ROOT}/issues/<N>/pull.md`
- In Layer 2: fetch from GitHub: `gh pr view <PR_NUMBER> --json body -q .body`

Look at the "What was tested" section. It must contain **concrete scenarios** — not "N/A", not "tested locally".

If manual testing appears insufficient, consider invoking the `qa-engineer` agent: it is
designed to independently test a PR and share feedback.

- **PASS**: Section describes specific manual steps taken and their outcome
- **WARN**: Section is present but thin (e.g. only one scenario for a complex change)
- **FAIL**: Section is empty or says "N/A" without justification (Layer 2 — the PR is open, so a missing body is FAIL)
- **N/A**: Layer 1 only — the PR draft does not exist yet (`release-agent` creates `pull.md` after implementation). Not a failure.

---

### Check 2 — Automated tests in place

Identify changed source files:
```bash
git diff {BASE_BRANCH} --name-only
```

For each changed PHP source file in the project's source directories (`src/`, `inc/`, `classes/`, etc.), check that a corresponding test file exists. Test files should mirror the source structure.

Then run the test suite using the project's defined commands (read `composer.json` scripts):
```bash
# Example — use the project's actual test command
composer test-unit
```

- **PASS**: All changed PHP source files have tests AND tests pass
- **WARN**: A changed file has no corresponding test. When reporting this, you MUST include an explicit written statement in `evidence`: the filename, the reason a test does not exist (not "too small" or "follow-up ticket" — those are rationalizations), and whether the missing test represents a real gap. "Later" is the load-bearing word — there is no later. If the only honest reason is "I didn't write it", that is a FAIL, not a WARN.
- **FAIL**: Tests fail or error out, OR the agent's stated reason for a missing test is "I'll do it in a follow-up"

---

### Check 3 — Documentation updated

Run `git diff {BASE_BRANCH} --name-only` and look for changes to the public API surface:
- New or changed WordPress hooks
- New or changed AJAX actions or REST routes
- New or changed configuration keys, option names, or capabilities
- New or changed plugin metadata
- New or changed exported public methods on ServiceProvider-bound services
- New or changed WP-CLI commands

Then check if docs were updated:
```bash
git diff {BASE_BRANCH} -- docs/ README.md
```

- **PASS**: Doc files updated for every public-facing change, or no public API change occurred
- **WARN**: A public API or hook changed with no doc update (flag which file)
- **FAIL**: Multiple public-facing changes with zero documentation updates

---

### Check 4 — PR description matches template

Read the repo's PR template:
```bash
cat .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null
```

(Falls back to `.claude/skills/issue-workflow/refs/pr-template.md` if no GitHub
template exists — same content.)

Then fetch the PR body:
- Layer 1: read `{TEMP_ROOT}/issues/<N>/pull.md`
- Layer 2: `gh pr view <PR_NUMBER> --json body -q .body`

Check that all required sections from the template are present and non-empty:
- Description (with `Fixes #N`)
- Type of change (one checkbox ticked)
- Detailed scenario → What was tested
- Detailed scenario → How to test
- Detailed scenario → Affected Features & Quality Assurance Scope
- Technical description → Documentation
- Technical description → New dependencies
- Technical description → Risks
- Mandatory Checklist → Code validation
- Mandatory Checklist → Code style
- Additional Checks

- **PASS**: All required sections present and filled
- **WARN**: One section is thin or partially filled
- **FAIL**: PR not created yet (Layer 2 only), or 2+ sections missing / left with placeholder text
- **N/A**: Layer 1 only — no PR draft exists yet (`release-agent` creates it after implementation). Not a failure.

---

### Check 5 — CI passes

**Layer 1 (no PR yet — local CI commands):**

Read `composer.json` for the project's defined commands. Run them in this order:
```bash
# Fast check on changed files first
composer phpcs-changed 2>/dev/null || composer run phpcs 2>/dev/null
# Static analysis
composer run-stan 2>/dev/null || composer phpstan 2>/dev/null
# Unit tests
composer test-unit 2>/dev/null || composer test 2>/dev/null
```

Use the exact script names defined in `composer.json` — do not invent them.

If PHPCS reports violations, auto-fix then re-check:
```bash
composer phpcs:fix 2>/dev/null || composer phpcbf 2>/dev/null
# Confirm 0 remaining violations
composer phpcs-changed 2>/dev/null || composer run phpcs 2>/dev/null
```

**Layer 2 (PR exists — remote CI status):**

First, read the GitHub Actions workflow files to enumerate which checks are expected:
```bash
ls .github/workflows/
```
Note the check names (e.g. `lint / PHP CodeSniffer`, `lint / PHPStan`, `task-check`).

Wait for all checks to complete (blocks until all checks are no longer pending):
```bash
gh pr checks "$PR_URL" --watch
```

For any check that shows `fail`, fetch its log URL and extract the relevant error excerpt:
```bash
gh pr checks "$PR_URL" --json name,state,link \
  --jq '.[] | select(.state == "FAILURE") | {name, link}'
gh run view <run_id> --log-failed 2>/dev/null | tail -30
```

Include each failure as a separate blocker in the return JSON with:
- `check`: the check name
- `error_excerpt`: the relevant log lines
- `suggested_fix`: one sentence on what likely caused it

Also verify the `Co-Authored-By` trailer is present on every pipeline-authored commit on
the branch (same pattern the `release-agent` enforces — the model name varies, the email
does not; commits authored by a human collaborator are exempt):
```bash
git log {BASE_BRANCH}..HEAD --format="%H %s" | while read sha msg; do
  git show $sha --format="%b" -s | grep -q "Co-Authored-By: .* <noreply@anthropic.com>" \
    || echo "MISSING Co-Authored-By on $sha"
done
```

- **PASS**: All checks green AND trailer present on every pipeline-authored commit
- **WARN**: A non-blocking check (e.g. coverage threshold) is failing
- **FAIL**: Any required check is failing, or any commit is missing the trailer

---

### Check 6 — File scope compliance

**Layer 1 only** (in Layer 2, file scope is not tracked — this check is skipped with status `N/A`).

The orchestrator passes `file_scope` inline in your dispatch plan. Use the value provided — do not read any file.

List every file changed on the branch:
```bash
git diff {BASE_BRANCH}..HEAD --name-only
```

Compare against `file_scope`. Flag any file that appears in the diff but not in `file_scope`.

Exceptions that do not count as violations:
- Auto-generated files (`*.min.js`, `*.min.css`, lock files)
- Files in the test directory that directly correspond to a changed source file
- Files the orchestrator explicitly added to scope via a `blocked_reason` note
- Files modified solely by the auto-formatter (e.g. `composer phpcs:fix` / `phpcbf`). The auto-formatter has no "changed files only" mode and may reformat files outside the declared scope. Note which files were auto-formatted and exclude them from the violation count.

If no `file_scope` was provided in the dispatch plan (e.g., the skill was invoked standalone), skip this check with status `N/A`.

- **PASS**: All modified files are within declared scope (or no scope was declared)
- **WARN**: One file outside scope was modified — name it and explain why
- **FAIL**: Two or more files outside scope were modified without explanation

**Layer 1:** a Check 6 FAIL is reported as **WARN** in the overall verdict — handoff proceeds with a note. (L1 `overall` is only ever `PASS` or `WARN`.)
**Layer 2:** a Check 6 FAIL is a genuine **FAIL** and contributes to a `FAIL` overall verdict.

---

## Output format

```
| Check | Status | Evidence |
|-------|--------|----------|
| 1. Manual validation  | PASS | "What was tested" covers 3 concrete scenarios |
| 2. Automated tests    | WARN | src/Engine/Foo/Bar.php has no test file |
| 3. Documentation      | PASS | docs/api.md updated |
| 4. PR description     | PASS | All sections filled |
| 5. CI                 | FAIL | run-stan failing: custom rule in src/Engine/Cache/Subscriber.php:142 |
| 6. File scope         | PASS | All 4 changed files within declared scope |

Overall: FAIL

Blockers:
- Check 5: static analysis failing on src/Engine/Cache/Subscriber.php:142 — see error excerpt

Warnings (non-blocking):
- Check 2: src/Engine/Foo/Bar.php has no test — consider filing a ticket
```

If all checks pass: print **PASS** clearly.
If any check fails: print **FAIL** and list each blocker with a suggested fix.

## L2 output format constraints

Enforced for Layer 2 output only:
- Total output: ≤ 400 words.
- Evidence fields: one sentence maximum — no paragraphs, no log dumps.
- PASS checks: collapsed into the summary table only — no prose elaboration.
- WARN / FAIL checks: one prose sentence in "Blockers" or "Warnings" — no more.
- Always include: the summary table, the `Overall` line, and the `Blockers` list (even if empty).
- Omit: commands run, environment setup narration, PASS check prose explanations.

---

## Structured return object

Always return this JSON object in addition to the human-readable output above:

```json
{
  "overall": "PASS|WARN|FAIL",
  "checks": [
    { "name": "manual-validation", "status": "PASS|WARN|FAIL|N/A", "evidence": "string" },
    { "name": "automated-tests", "status": "PASS|WARN|FAIL|N/A", "evidence": "string" },
    { "name": "documentation", "status": "PASS|WARN|FAIL", "evidence": "string" },
    { "name": "pr-description", "status": "PASS|WARN|FAIL|N/A", "evidence": "string" },
    { "name": "ci", "status": "PASS|WARN|FAIL", "evidence": "string" },
    { "name": "file-scope", "status": "PASS|WARN|FAIL|N/A", "evidence": "string" }
  ],
  "blockers": [
    {
      "check": "ci|manual-validation|pr-description",
      "description": "Check 5: static analysis failing — rule violation in src/Engine/Cache/Subscriber.php:142",
      "error_excerpt": "relevant log lines for CI failures — empty string for non-CI blockers",
      "suggested_fix": "replace direct API call with project-approved helper"
    }
  ],
  "warnings": ["Check 2: src/Engine/Foo/Bar.php has no test file"],
  "layer1_delta": ["Issues found in L2 that L1 did not catch — populated by orchestrator in layer 2 only"]
}
```

**Layer 1:** `overall` must be `PASS` or `WARN` when the implementation agent hands off.
**Layer 2:** `overall` can be `PASS`, `WARN`, or `FAIL`. Populate `layer1_delta` with
any issues that were not flagged in layer 1.

Return the JSON object directly to the orchestrator. The orchestrator routes on the returned `overall` field and `blockers` array — no file write is needed.
