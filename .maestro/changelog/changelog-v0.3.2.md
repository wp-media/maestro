## Proposed Changelog for Next Release (PO Draft)

Target version: 0.3.2 (to confirm)
Period covered: changes merged after v0.3.1.1 (2026-06-05T10:49:38+02:00)

> Note: All 5 changes since v0.3.1.1 are direct commits with no associated PRs or linked issues.
> All entries carry Issue: N/A | PR: N/A accordingly.

---

### New features

- New feature: QA and E2E agents now prevent duplicate report comments — re-runs post a delta-only follow-up instead of a full duplicate report; a branch guard aborts tests when the local branch does not match the PR head; headless/SSH environments return CANNOT_VERIFY instead of silently skipping browser tests; bug-fix PRs must reproduce the original failure before confirming the fix; licensed-feature tests are blocked with CANNOT_VERIFY when no license option key is configured; spec coverage enforcement requires every test block to have a matching criterion entry; DOD output is constrained to 400 words max with collapsed PASS tables. (Issue: N/A | PR: N/A)

- New feature: Orchestrator now enforces an anti-scope-creep gate before spawning implementation agents — a mandatory 4-point check (scope match, complexity ceiling, agent count, unnecessary additions) routes out-of-scope work back to grooming; after PR readiness is set, the orchestrator verifies the "Made by AI" label is present and transitions the linked issue from "In Progress" to "Ready for review". (Issue: N/A | PR: N/A)

- New feature: Grooming agent gains a CHECKPOINT block — a 6-item checklist the agent must complete before returning, with an explicit instruction to loop back if any step is skipped; AGENTS.md reading is now conditional so grooming works on repos without that file; backtick escaping in comment-posting commands is enforced via single-quoted heredocs; spec templates now require a "Test Command" section with risk-tiered test defaults (LOW / MEDIUM / HIGH); the same risk-tiered test table is carried into backend-agent and frontend-agent. (Issue: N/A | PR: N/A)

### Improvements and product enhancements

_(none in this release)_

### User-facing fixes

- Fix: AI-generated notice callouts in release-agent and ticket-writer now use a robot icon instead of a warning icon to reduce visual alarm in pipeline output. (Issue: N/A | PR: N/A)

- Fix: git commands in release-agent (log, show, rebase) now run with --no-pager and GIT_TERMINAL_PROMPT=0 to prevent interactive hangs and credential prompts blocking the pipeline. (Issue: N/A | PR: N/A)

### Engineering and maintainability

- Chore: Added `.pipeline-logs/` and `.playwright-mcp/` to `.gitignore` to prevent generated artefacts from being accidentally committed. (Issue: N/A | PR: N/A)

---

### Source PRs

N/A — all changes in this release are direct commits without associated pull requests.

### PR-Issue Mapping

| Commit | Subject | Issue | PR |
|--------|---------|-------|----|
| 0a3c148 | feat(qa-e2e): deduplication, branch guard, display check, regression proof, license check, spec coverage, DOD constraints | N/A | N/A |
| a095369 | feat(orchestrator): anti-scope-creep gate and issue label transition on finalize | N/A | N/A |
| 9eb6793 | feat(grooming): CHECKPOINT block, conditional AGENTS.md, backtick rule, risk-tiered tests | N/A | N/A |
| 2841008 | fix(release-agent,ticket-writer): replace warning notice with robot, add git --no-pager safety | N/A | N/A |
| 4199c44 | fix(pipeline-reliability): add .pipeline-logs/ and .playwright-mcp/ to .gitignore | N/A | N/A |

---

## changelog.txt Draft

```
= 0.3.2 =
Release date: June 5, 2026

* New feature: QA/E2E agents prevent duplicate report comments, enforce a branch guard, return CANNOT_VERIFY in headless environments, require bug-fix PRs to reproduce the original failure, block unlicensed feature tests, enforce spec coverage, and constrain DOD output format.
* New feature: Orchestrator enforces an anti-scope-creep gate before spawning implementation agents and transitions issue labels to "Ready for review" on finalize.
* New feature: Grooming agent gains a mandatory CHECKPOINT block, conditional AGENTS.md reading, backtick safety in heredocs, and risk-tiered test defaults in spec templates.
* Fix: AI-generated notices in release-agent and ticket-writer now use a robot icon instead of a warning icon.
* Fix: git commands in release-agent run with --no-pager and GIT_TERMINAL_PROMPT=0 to prevent pipeline hangs.
```
