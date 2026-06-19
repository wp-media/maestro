# Design Spec — Stack-Agnostic Maestro via Two-Tier Profiles

**Branch:** `feat/stack-agnostic-profiles`
**Status:** APPROVED — implementation in progress
**Goal:** Make Maestro's delivery pipeline (groom → implement → review → QA → PR) work on
any stack (WordPress, React/Node, Python, unknown GroupOne stacks) instead of being welded
to WordPress — without regressing WordPress behavior for WP Media.

This document is the **frozen contract**. Every implementer edits *against* this spec; do not
invent field names or commands not listed here. If a field name must change, change it here
first and notify all owners.

---

## 0. Load-bearing decision

**Profiles are templates baked into per-project config at onboard time, NOT read live at
runtime.** Agents read one flat `stack` block from the project's own `maestro.json`. No agent
ever resolves "which profile / merge order / overrides" — that resolution happens once, in
`/onboard-project`, confirmed by a human, then it is just data. This is the only model that
survives the "a haiku-tier agent reads this 100 ways" test.

---

## 1. Profile schema

### Where profiles live
- **Authored profiles**: `profiles/*.json` in the Maestro base (e.g. `profiles/wordpress.json`).
  Hand-written; carry the un-inferrable knowledge (idioms, gates, variants, harness specifics).
- **Derived profiles**: not stored as files. `/onboard-project` synthesizes one in-memory by
  inspecting repo manifests, then bakes it into `maestro.json`.
- **Resolved profile**: flattened into `maestro.json` under a new top-level `stack` block.
  Agents read ONLY this.

### Profile file shape (authored) — `profiles/wordpress.json`
```json
{
  "profile": "wordpress",
  "kind": "authored",
  "detect": {
    "signals": [
      { "glob": "*.php", "header": "Plugin Name:", "weight": 10 },
      { "file": "composer.json", "weight": 3 },
      { "file": "wp-content", "weight": 2 }
    ],
    "min_score": 10
  },
  "verification": {
    "lint":      { "cmd": "composer phpcs-changed", "fallback": "composer run phpcs", "autofix": "composer phpcs:fix" },
    "typecheck": { "cmd": "composer run-stan", "fallback": "composer phpstan" },
    "test_unit": { "cmd": "composer test-unit", "fallback": "composer test" },
    "test_integration": { "cmd": "vendor/bin/phpunit --configuration tests/Integration/phpunit.xml.dist" },
    "build":     null
  },
  "source_dirs": ["src/", "inc/", "classes/"],
  "public_api_surface": [
    "WordPress hooks (add_action/add_filter additions)",
    "AJAX actions, REST routes",
    "option_keys, capabilities",
    "WP-CLI commands"
  ],
  "harness": {
    "kind": "wp-local",
    "base_url": "http://localhost:8888",
    "boot_cmd": null,
    "seed_cmd": "bash .maestro/bin/dev-seed.sh",
    "ui_entry": "/wp-admin/options-general.php?page=<plugin-page>",
    "browser_login": { "url": "/wp-login.php", "user": "admin", "pass": "password" },
    "e2e_runner": "npx --yes playwright test"
  },
  "gates": ["compliance"],
  "variants": { "concept": "editions", "values": ["free", "pro"] },
  "idioms": [
    "Use esc_html/esc_attr/esc_url/wp_kses_post for output by context",
    "No jQuery in new JS — native DOM",
    "Use the project-registered capability, not manage_options"
  ]
}
```

A **derived profile** has the identical shape but: `kind: "derived"`, `gates: []`,
`variants: null`, `idioms: []`, `harness.kind: "generic" | "web" | "api" | "none"`.
Authored profiles fill the un-inferrable fields; derived profiles leave them empty.

### Resolved `stack` block in `maestro.json` (what onboard writes)
Commands are flattened to **strings** here — onboard picks cmd-or-fallback at confirm time so
agents never branch on `{cmd,fallback}`.
```json
"stack": {
  "profile": "wordpress",
  "profile_version": "1",
  "verification": {
    "lint": "composer phpcs-changed", "lint_fallback": "composer run phpcs",
    "autofix": "composer phpcs:fix",
    "typecheck": "composer run-stan", "typecheck_fallback": "composer phpstan",
    "test_unit": "composer test-unit", "test_unit_fallback": "composer test",
    "build": null
  },
  "source_dirs": ["src/", "inc/", "classes/"],
  "public_api_surface": ["WordPress hooks", "AJAX actions, REST routes", "option_keys, capabilities", "WP-CLI commands"],
  "harness": {
    "kind": "wp-local", "base_url": "http://localhost:8888",
    "boot_cmd": "bash .maestro/bin/dev-up.sh", "ui_entry": "/wp-admin/options-general.php?page=wprocket",
    "browser_login": { "url": "/wp-login.php", "user": "admin", "pass": "password" },
    "e2e_runner": "npx --yes playwright test"
  },
  "gates": ["compliance"],
  "variants": { "concept": "editions", "values": ["free", "pro"] }
}
```

---

## 2. Derive-then-confirm onboarding (`skills/onboard-project/SKILL.md`)

Keep the existing confirm-before-write discipline. Insert stack resolution **before** identity
gathering.

**Detection (score-based, highest wins):**
| Profile | Signal |
|---|---|
| `wordpress` (authored) | `*.php` with `Plugin Name:` header → score 10, meets `min_score` |
| derived/node | `package.json`, no WP header |
| derived/python | `pyproject.toml` or `setup.py` |
| derived/rust | `Cargo.toml` |
| derived/make | `Makefile` and none of the above dominate |

**Manifest → command extraction (derived path):**
| Manifest | lint | typecheck | test | build |
|---|---|---|---|---|
| `package.json` scripts | `lint` → `npm run lint` | `typecheck`/`tsc` → `npm run typecheck` | `test` → `npm test` | `build` → `npm run build` |
| `pyproject.toml` | `ruff`/`flake8` dep → `ruff check .` | `mypy` dep → `mypy .` | `pytest` → `pytest` | — |
| `Makefile` | `lint:` → `make lint` | — | `test:` → `make test` | `build:` → `make build` |
| `Cargo.toml` | `cargo clippy` | (clippy covers) | `cargo test` | `cargo build` |
| `composer.json` scripts | `phpcs`/`phpcs-changed` | `phpstan`/`run-stan` | `test-unit`/`test` | — |

**Rule:** read the *actual key names* from the manifest; never invent a script that isn't
declared. Any category with no detectable command → propose `null`, tell the user that gate
will be skipped.

**Confirm gate (non-negotiable):** print detected stack + proposed commands + harness, then:
> Confirm, edit any line, or tell me what's missing. I will not write config until you confirm.

For the WordPress path, propose `wordpress.json` defaults verbatim but still confirm
`boot_cmd` / `ui_entry` (project-specific even within WP).

---

## 3. "Read from config, don't hardcode" contract

### DOD (`skills/dod/SKILL.md`)
Add to the config-loading block:
- `VERIFY = .stack.verification` (lint, lint_fallback, typecheck, typecheck_fallback,
  test_unit, test_unit_fallback, autofix, build — any may be null)
- `SOURCE_DIRS = .stack.source_dirs`
- `API_SURFACE = .stack.public_api_surface`

Edits:
- **Check 2:** "each changed source file under a `{SOURCE_DIRS}` path" (was `src/`/`inc/`/`classes/`).
  Run `{VERIFY.test_unit}`; if null → report `N/A` with evidence "no test command configured".
- **Check 3:** replace the hardcoded WP hook/AJAX/REST/WP-CLI bullet list with "changes to any
  item in `{API_SURFACE}`." Identical content for WP, now arriving as data.
- **Check 5:** replace the three `composer …` lines with `{VERIFY.lint}` (fallback
  `{VERIFY.lint_fallback}`), `{VERIFY.typecheck}` (fallback `{VERIFY.typecheck_fallback}`),
  `{VERIFY.test_unit}` (fallback `{VERIFY.test_unit_fallback}`); autofix block →
  `{VERIFY.autofix}`. Each line emits `{cmd} || {cmd_fallback}` when a fallback is configured,
  mirroring the lint line — this preserves the develop-era `|| composer phpstan` /
  `|| composer test` behavior byte-for-byte (regression oracle, §6). **Each guarded by null** —
  a missing command is a skip-with-note, NEVER a FAIL. This is the single most important
  correctness rule in the whole change.

Leave Checks 1 & 4 and the anti-rationalization table untouched (already agnostic).

### QA (`agents/qa-engineer.md`)
Add to config table: `HARNESS = .stack.harness`, `VERIFY = .stack.verification`.
- **Step 0 boot:** if `HARNESS.kind == "none"` or `HARNESS.boot_cmd` null → skip boot, go to
  Strategy C. Else run `{HARNESS.boot_cmd}`, check `{HARNESS.base_url}`. WP wording moves behind
  `kind == "wp-local"`.
- **Strategy A:** "REST/AJAX/WP-CLI" → "the harness's API surface" (wp-local = curl + WP-CLI;
  generic = curl against `base_url`).
- **Strategy B (browser):** stays mandatory-when-UI but only reachable when `base_url` non-null.
  No harness → Strategy B structurally unavailable; skip reason = "no browser harness configured
  for this stack" (not a boot failure).
- **Strategy C:** run `{VERIFY.test_unit}` (not a hardcoded composer/phpunit string).
- **Dispatch:** invoke `wp-e2e-qa-tester` only when `HARNESS.kind == "wp-local"`; invoke
  `web-e2e-qa-tester` when `HARNESS.kind == "web"`; otherwise no browser agent.

### `agents/e2e-qa-tester.md` → RENAME to `agents/wp-e2e-qa-tester.md`
- `git mv` the file; update its `name:` frontmatter to `wp-e2e-qa-tester`.
- Stays the WordPress browser specialist. Replace hardcoded `/wp-admin/…`, `admin/password`
  with `{HARNESS.ui_entry}` and `{HARNESS.browser_login}` (read from config) so even the WP
  specialist no longer hardcodes them.
- Propagate the rename to ALL references: `AGENTS.md`, `skills/e2e/SKILL.md`,
  `agents/qa-engineer.md`, any transplant files, and the agent registry/description.

### `agents/web-e2e-qa-tester.md` → NEW (scaffold-only)
- Config-driven browser QA for `harness.kind == "web"`: boot via `{HARNESS.boot_cmd}`,
  navigate `{HARNESS.base_url}`, login via `{HARNESS.browser_login}`, drive Playwright MCP,
  screenshot, write temp specs — same lifecycle as the WP one but reads ALL targets from config,
  assumes no wp-admin idioms.
- **Mark prominently as UNTESTED / pending validation against a real non-WP web project.** Do
  not claim hardened browser coverage. Register it in `AGENTS.md` with that caveat.

---

## 4. WordPress authored profile — extraction map

`profiles/wordpress.json` is assembled by **moving** (not copying) these out of the spine:
| Source | Moves into profile | Stays in source |
|---|---|---|
| dod Check 2/5 | composer phpcs/run-stan/test-unit/phpcs:fix, `src/ inc/ classes/` → `verification` + `source_dirs` | 6-check structure, anti-rationalization table |
| dod Check 3 | WP hooks/AJAX/REST/option_keys/WP-CLI → `public_api_surface` | "did docs update for public API" logic |
| qa-engineer / wp-e2e | localhost:8888, boot/seed, `/wp-admin/…`, admin/password, license_option_key → `harness` | Strategy A/B/C logic, screenshot/gist flow |
| compliance SKILL | entire skill body referenced by `gates: ["compliance"]` | nothing — compliance was always WP-only |
| `.template/maestro.json` | `type`, `editions`, `text_domain`, `namespace`, `rest_namespace`, `e2e` → `variants`+`idioms`+`harness` | `slug`, `repo`, `display_name`, `temp_root`, `architecture_skill` (per-project identity) |

**`compliance` becomes a profile-gated step:** orchestrator runs a gate only if it appears in
`stack.gates`. Derived stacks → `gates: []` → compliance never fires. WP keeps it.

---

## 5. Orchestrator (`skills/orchestrator/SKILL.md`)
- Add `STACK = .stack` to the config table, pass it to dispatched implementation/QA agents on
  the same channel as the other config vars.
- Run a gate (e.g. compliance) only if listed in `stack.gates`.

---

## 6. Migration, compat, risks

**Backward compatibility (no existing WP config needs editing):**
- Keep `ai.e2e` as a live alias of `stack.harness` during migration; `stack.harness` is the
  source of truth, `ai.e2e` mirrors it.
- Compat shim: if `.stack` is ABSENT from a project's `maestro.json`, agents synthesize it from
  `ai.e2e` + the `wordpress.json` defaults. So a wp-rocket config with no `stack` block keeps
  working unchanged.

**Phased order (build the provable two-stack milestone in this sequence):**
1. Author `profiles/wordpress.json` with today's EXACT values (extraction; no behavior change).
2. Add `stack` block to `.template/maestro.json`; keep `ai.e2e` alias + compat shim.
3. Edit dod + qa-engineer to read `{VERIFY}`/`{HARNESS}`, null-guarded.
4. Rewrite `/onboard-project` (detect → derive → confirm).
5. Rename e2e-qa-tester → wp-e2e-qa-tester + scaffold web-e2e-qa-tester + propagate references.

Steps 1–3 are pure refactor with a **regression oracle**: the commands DOD/QA emit for a WP
project MUST be byte-identical to today (verify against `git show develop:` originals).

**Top failure modes:**
- *Wrong command guessed (derived):* mandatory confirm gate; onboard dry-checks each proposed
  command resolves before asking.
- *Mixed-stack tickets (WP + Gutenberg React):* `verification.test_unit` may be an ARRAY of
  commands run in sequence; one profile composes multiple toolchains. Don't split into
  per-language agents.
- *Profile drift:* project bakes a snapshot (`stack.profile_version`); `/onboard-project`
  re-run mode diffs baked-vs-current and offers to re-bake. Improvements to `wordpress.json`
  live in the Maestro base; per-project `boot_cmd`/`ui_entry` live in the project's config.

**Out-of-scope flags (do NOT gold-plate; note only):** wp-e2e temp-spec promotion limitation;
`ai.namespace`/`text_domain` "not yet read programmatically"; the PHP-shaped `areas` array in
the template is unused by this contract — decide its fate later.
