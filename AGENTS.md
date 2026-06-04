# AI Coding & Architecture Guidelines

This file defines NON-NEGOTIABLE rules for any AI-assisted work
(Claude Code, ChatGPT, JetBrains AI Assistant, Cursor, etc.)
in this repository.

Skills define behavioral guidance.
AGENTS.md defines mandatory guardrails.
If a conflict exists, AGENTS.md prevails.

This is the **Maestro base**. Each project copies this file and extends it with a
**Project Overview** section and a **Session Learnings** section at the bottom.
The Maestro plugin never overwrites `AGENTS.md`.

---

## Operating Principles

These five rules apply to every agent, in every phase, before any skill-specific guidance loads.

1. **Surface assumptions before building.** If the spec or codebase leaves something ambiguous, state the assumption explicitly before acting on it — don't silently guess.
2. **Stop when requirements conflict.** If the issue, the spec, and the codebase contradict each other, stop and surface the conflict. Proceeding on a guess produces bugs that are hard to trace.
3. **Push back when warranted.** If the simplest correct solution differs from the plan, say so. Prefer boring, obvious solutions over clever ones. An elegant approach that introduces risk is worse than a dull one that doesn't.
4. **Touch only what you are asked to touch.** Scope discipline is the single biggest determinant of whether a PR is mergeable. Do not refactor adjacent code, rename unrelated identifiers, or "clean up while you're in the area."
5. **Verification is not optional.** "Seems right" never closes a task. Every change must be confirmed by running tests, tools, or a manual scenario — not by reading the code and inferring it should work.

---

The objective is to keep this project:

- WordPress.org compliant
- Architecturally consistent
- Secure
- Maintainable
- Review-friendly

This document applies to ALL automated or AI-generated changes.

---

# 1. Project Overview

> **Per-project section.** Replace with the specific project's architecture summary:
> framework, namespace, DI container, module structure, key patterns.
> Keep it concise — link to code rather than duplicating it.

---

# 2. Coding Standards & Static Analysis

Source of truth:

- Composer scripts (`composer.json`)
- PHPCS rulesets (`phpcs.xml` / `phpcs.xml.dist` / `phpcs.baseline.xml`)
- PHPStan / Psalm configs if present (`phpstan.neon`, `phpstan-baseline.neon`)
- WordPress Plugin Check: https://github.com/WordPress/plugin-check/
- CI pipeline rules

This project must remain compatible with WordPress.org validation rules.

Any change affecting public APIs, output, security, metadata, or plugin bootstrap
behavior must be evaluated against WordPress Plugin Check expectations.

AI MUST:

- Read `composer.json` first and use defined scripts (e.g. `lint`, `phpcs`, `phpcbf`, `test`, `phpstan`) instead of inventing commands.
- Auto-discover PHPCS configuration and follow it as the single source of truth.

## 2.1 Tooling Auto-Discovery (MANDATORY)

Before making changes that affect standards or formatting, the agent MUST locate and
respect the repository configuration files.

### Required reads (in this order)
1) `composer.json`
    - Use scripts defined in `"scripts"` whenever possible.
    - Prefer the exact commands used by CI.
    - Do not invent lint/test commands.

2) PHPCS ruleset / baseline (first match wins, but consider all if referenced):
    - `phpcs.xml`
    - `phpcs.xml.dist`
    - `phpcs.baseline.xml`
    - Any PHPCS file referenced by composer scripts or CI

3) Static analysis configs (if present / referenced):
    - `phpstan.neon`, `phpstan.neon.dist`
    - `phpstan-baseline.neon`

### Execution rules
- Do NOT hardcode PHPCS standards.
- Do NOT assume WordPress-Core or WordPress-Extra unless defined in the ruleset.
- If multiple PHPCS files exist, follow what is referenced by:
  a) Composer scripts, then
  b) CI configuration, then
  c) Root-level `phpcs.xml(.dist)`

If no PHPCS configuration exists, stop and ask.

---

# 3. Architectural Integrity

AI must NOT:

* Introduce global state.
* Add new singletons without discussion.
* Bypass the dependency injection patterns used in the project.
* Couple UI logic to infrastructure logic.
* Modify vendored dependencies without explicit instruction.
* Use `add_action` / `add_filter` directly where the project uses a Subscriber pattern.

Follow existing patterns — read the project's architecture skill
(`.claude/commands/<slug>-architecture.md`) before making structural changes.

---

# 4. Testing & Validation

Follow **Test-Driven Development**. Write tests before or alongside new code, not after.

- Read `composer.json` to discover test commands.
- Test files must mirror the source structure.
- Do not delete tests unless clearly obsolete.

For every change:

1. Run the PHPCS check on changed files first (fast), then on all files before committing.
2. Run static analysis — satisfy all project-defined rules.
3. Run the relevant test suite; no regressions.

---

# 5. AI Working Protocol

AI must work in small, incremental changes.

After each logical change set:
- explain what changed
- explain why
- list potential edge cases

AI must NOT:

* Perform massive automated refactors without approval.
* Reorganize files without explicit instruction.
* Rewrite entire classes when a minimal fix is sufficient.

## 5.1 Git Commit & Push Policy

By default, AI may only **suggest** commit messages and must not run `git commit` or `git push`.

**Exception — Issue Workflow:** When operating under the issue-workflow skill (triggered by `/task <number>`, `issue <number>`, or `#<number>`), the agent MAY:

1. Run atomic `git commit` calls — one commit per logical, self-contained change set.
2. Run `git push` exactly once after all commits are ready, to publish the branch.
3. Create a GitHub Pull Request using the prepared PR draft.
4. Monitor PR CI status checks until all pass or a failure is detected.

Atomic commit rules:
- Each commit must pass PHPCS and static analysis before being committed.
- Commit message format: `type(scope): short description` (Conventional Commits).
- Do not squash unrelated changes into a single commit.
- Do not amend commits that have already been pushed.

---

# 6. PR Hygiene

Changes must:

* Be minimal.
* Be scoped.
* Have clear intent.
* Avoid noise in diff.
* Avoid unrelated formatting changes.

### Branch Naming Convention

Branches MUST follow these patterns:

- **Bug fixes**: `fix/{GitHub-issue-ID}-{description}`
- **Enhancements**: `enhancement/{GitHub-issue-ID}-{GitHub-issue-title}`
- **Tests**: `test/{GitHub-issue-ID}-{GitHub-issue-title}`

Rules:
- Lowercase letters, hyphens for spaces.
- Always include the GitHub issue ID.
- Keep descriptions concise (first 4 words max).

---

# 7. Security First

Always assume:

* User input is untrusted.
* Remote API responses are untrusted.
* Stored values may be tampered with.

Never:

* Store sensitive values in plain text without review.
* Introduce unsafe serialization.
* Echo unescaped dynamic data.

---

# 8. When in Doubt

Stop.
Explain the ambiguity.
Ask for clarification.

Architectural integrity is more important than speed.

---

# 9. QA Agent

The `qa-engineer` sub-agent validates PRs automatically as part of the issue workflow.
It reads the PR spec, selects a validation strategy (API / Browser / Analysis), and produces
a structured test report.

Agent definition: `.claude/agents/qa-engineer.md`.

The local WordPress environment at `http://localhost:8888` (admin / password) is used for
browser validation via Playwright MCP.

---

# 10. Skills Activation

The repository defines AI Skills under `.claude/commands`.

Agents MUST activate the relevant skill depending on the task:

- Template or UI changes → WordPress Compliance Skill
- Structural or architectural changes → Architecture Skill (project-specific)
- Core service modifications → Both skills
- Codebase exploration / dependency tracing → Knowledge Graph Skill

## 10.1 Knowledge Graph

A pre-built dependency graph is available at `.claude/graph/dependency-graph.json`.

Before exploring the codebase structure (finding a class, tracing dependencies, checking
namespace boundaries), **read this file first**. It contains:
- `nodes`: per-file namespace, declared symbols, and imports.
- `symbol_index`: maps every fully-qualified PHP class/interface/trait/enum to its file.

Run `node bin/build-knowledge-graph.js` to refresh after structural changes (`--full` to force full rebuild, `--dry-run` to preview without writing).

---

# 11. Repository Identity

The canonical GitHub repository is defined in `.claude/maestro.json` under
`ai.repo`. Agents read that file at startup — never hardcode repo names.

---

# 12. Repository Specs

The repository may define task-specific implementation specs under:

`.claude/specs/`

Specs provide detailed guidance for recurring technical problems
(e.g. PHPCS warnings, architecture migrations, WordPress compliance patterns).

When a relevant spec exists, agents must follow it in addition to AGENTS.md and applicable skills.

---

# AI Task Priority

When executing tasks, agents must prioritize:

1. Security
2. WordPress.org compliance
3. Architectural integrity
4. Backward compatibility
5. Minimal diffs
6. Performance

AGENTS.md remains the final authority.

---

# 13. Session Learnings

**Human-curated only.** Never regenerate this section with an LLM — doing so degrades
agent success rates. After each pipeline run, a human adds entries for findings that were
surprising and are not already derivable from the code or other sections of this file.

Format per entry:
```
- **[YYYY-MM-DD] [module or area]**: What was surprising. What the correct approach is.
```

Agents MUST read this section. It takes precedence over any assumption derived from the
spec or skill files when there is a conflict.

---

_No entries yet. Add one after the first surprising pipeline finding._
