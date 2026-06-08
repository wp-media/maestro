---
name: maestro
description: Show the Maestro command map — a quick reference to all available skills.
---

Print the following organised command reference to the user. Do not run anything else.

---

# Maestro

**One baton. Any orchestra.**

## Deliver
| Command | What it does |
|---|---|
| `/maestro:deliver 42` | Run the full pipeline from a GitHub issue |
| `/maestro:orchestrator` | Jump into routing if the issue is already loaded |

## Review
| Command | What it does |
|---|---|
| `/maestro:dod` | Run the Definition of Done checklist |
| `/maestro:pr` | Generate a PR description |
| `/maestro:e2e` | Run E2E smoke tests |

## Release
| Command | What it does |
|---|---|
| `/maestro:changelog` | Generate a PO-ready grouped changelog |

## Plan
| Command | What it does |
|---|---|
| `/maestro:sprint` | Plan and estimate issues for a sprint |
| `/maestro:retrospective` | Analyse a completed pipeline run |

## Explore
| Command | What it does |
|---|---|
| `/maestro:knowledge-graph` | Map codebase dependencies |
| `/maestro:compliance` | Check a change against WordPress.org rules |
| `/maestro:docs` | Update developer documentation |
| `/maestro:test` | Write PHPUnit tests for PHP source files |

## Setup
| Command | What it does |
|---|---|
| `/maestro:onboard-project` | Wire a new project — writes maestro.json, scaffolds dirs |
| `/maestro:transplant <path>` | Generate a bespoke issue-workflow for any target project |

---
*Type any command directly to run it. Pair with [Podium](https://github.com/wp-media/podium) for real-time observability.*
