---
name: onboard-project
description: Wire a new project — detects the stack, derives verification commands, confirms with you, then writes maestro.json and scaffolds the temp directory structure.
---

# Onboard Project

Wires any project (WordPress, Node/React, Python, Rust, Make-based, or an
unknown stack) into the Maestro ecosystem in one pass: detects the stack,
derives the verification commands and harness from the repo's own manifests,
confirms everything with you, then writes `.claude/maestro.json` (including a
resolved `stack` block), scaffolds the `.ai/` working directory, and prints the
next steps. After this skill runs, the project is ready for every Maestro agent
and workflow. Podium (the optional dashboard) can be installed separately.

The flow is **detect → derive → confirm → write**. Nothing is written to disk
until you confirm.

Run from the **project root** (the repo you are onboarding), not from inside
Maestro.

---

## Note: Podium is now optional (Step 7 update)

In earlier versions, Podium hooks were installed as part of onboarding. Podium
is now a **separate plugin** (see the Optional section). It has been simplified.

---

## Step 1 — Guard

```bash
ls .claude/maestro.json 2>/dev/null
```

If `.claude/maestro.json` already exists, show its contents and ask:

> `.claude/maestro.json` already exists. Overwrite it, or update only
> missing/null fields?

Stop until the user responds. Do not clobber an existing config silently.

---

## Step 2 — Detect the stack (score-based, highest wins)

**Do this BEFORE gathering identity.** Inspect the repo for manifest and marker
files, score each candidate profile, and pick the highest-scoring one. The
WordPress profile is *authored* (Maestro ships `profiles/wordpress.json`); all
other stacks produce a *derived* profile synthesized here in-memory.

```bash
ls *.php 2>/dev/null
grep -lR "Plugin Name:" *.php 2>/dev/null | head -1
ls package.json pyproject.toml setup.py Cargo.toml Makefile composer.json 2>/dev/null
```

| Profile | Signal | Outcome |
|---|---|---|
| `wordpress` (authored) | a `*.php` file with a `Plugin Name:` header → score 10, meets `min_score` 10 | use `profiles/wordpress.json` defaults verbatim |
| derived / node | `package.json` present, no WP header | derive from `package.json` |
| derived / python | `pyproject.toml` or `setup.py` | derive from Python manifest |
| derived / rust | `Cargo.toml` | derive from Cargo |
| derived / make | `Makefile` and none of the above dominate | derive from Make targets |

If a `*.php` file carries a `Plugin Name:` header, the WordPress signal scores
10 and meets `min_score` — take the **WordPress path** (Step 3a). Otherwise take
the **derived path** (Step 3b) for the highest-scoring manifest. If multiple
manifests are present (e.g. a WP plugin with a `package.json` for Gutenberg
blocks), WordPress still wins on score; mention the secondary toolchain in the
confirm gate so the user can fold its commands into `verification.test_unit` as
an array if they want.

If nothing matches, the profile is `derived` with `harness.kind: "none"` and
every undetectable category proposed as `null`.

---

## Step 3a — WordPress path: load authored profile

When the WordPress signal wins, the resolved stack block uses the
`profiles/wordpress.json` defaults **verbatim**. Flatten each `{cmd, fallback}`
verification object to strings: `cmd` → the field (`lint`, `typecheck`,
`test_unit`), `fallback` → the matching `*_fallback` field (`lint_fallback`,
`typecheck_fallback`, `test_unit_fallback`). Do not drop the typecheck/test_unit
fallbacks — they preserve the develop-era `|| composer phpstan` / `|| composer test`
behavior (regression oracle). Drop profile-only fields (`detect`, `idioms`,
`test_integration`, `harness.seed_cmd`, `kind: "authored"`). The resolved block
is:

```json
"stack": {
  "profile": "wordpress",
  "profile_version": "1",
  "verification": {
    "lint": "composer phpcs-changed",
    "lint_fallback": "composer run phpcs",
    "autofix": "composer phpcs:fix",
    "typecheck": "composer run-stan",
    "typecheck_fallback": "composer phpstan",
    "test_unit": "composer test-unit",
    "test_unit_fallback": "composer test",
    "build": null
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
    "ui_entry": "/wp-admin/options-general.php?page=<plugin-page>",
    "browser_login": { "url": "/wp-login.php", "user": "admin", "pass": "password" },
    "e2e_runner": "npx --yes playwright test"
  },
  "gates": ["compliance"],
  "variants": { "concept": "editions", "values": ["free", "pro"] }
}
```

These values are fixed by the authored profile and must NOT be re-derived. The
only two harness fields that are project-specific even within WordPress are
`harness.boot_cmd` and `harness.ui_entry` (`<plugin-page>`) — surface those for
confirmation in Step 4. Everything else is proposed as-is.

---

## Step 3b — Derived path: extract commands from the manifest

Read the **actual declared script/target names** from the manifest. Never
invent a command that the manifest does not declare. For each verification
category, if no matching command is declared, propose `null` (Step 4 will note
that the corresponding gate is skipped).

```bash
# inspect whichever manifest detection picked
cat package.json 2>/dev/null
cat pyproject.toml 2>/dev/null
cat Cargo.toml 2>/dev/null
cat composer.json 2>/dev/null
grep -nE '^[a-zA-Z0-9_.-]+:' Makefile 2>/dev/null
```

| Manifest | lint | typecheck | test | build |
|---|---|---|---|---|
| `package.json` scripts | `lint` script → `npm run lint` | `typecheck`/`tsc` script → `npm run typecheck` | `test` script → `npm test` | `build` script → `npm run build` |
| `pyproject.toml` | `ruff`/`flake8` dep → `ruff check .` | `mypy` dep → `mypy .` | `pytest` dep/config → `pytest` | — |
| `Makefile` | `lint:` target → `make lint` | — | `test:` target → `make test` | `build:` target → `make build` |
| `Cargo.toml` | `cargo clippy` | (clippy covers typecheck) | `cargo test` | `cargo build` |
| `composer.json` scripts | `phpcs`/`phpcs-changed` script | `phpstan`/`run-stan` script | `test-unit`/`test` script | — |

**Hard rule:** only emit a command whose underlying script/target/dep is
actually declared in the manifest. A `lint` command goes in `verification.lint`
only if a `lint` script (or equivalent declared name) exists. Otherwise →
`null`.

A derived stack also gets:
- `profile`: `"derived"`, `profile_version`: `"1"`
- `verification.lint_fallback`, `verification.typecheck_fallback`,
  `verification.test_unit_fallback`: `null` (derived stacks have no fallback —
  only the authored WordPress profile carries the `composer run phpcs` /
  `composer phpstan` / `composer test` fallbacks),
  `verification.autofix`: a declared autofix script if present, else `null`
- `source_dirs`: inferred from the repo layout (e.g. `["src/"]`, `["lib/"]`,
  Python package dir, Rust `["src/"]`); confirm in Step 4
- `public_api_surface`: `[]` (un-inferrable for derived stacks; leave empty)
- `harness.kind`: `"web"` for a web app with a dev server, `"api"` for an API,
  `"generic"` for a library/CLI, `"none"` if nothing is bootable
- `harness.base_url` / `boot_cmd` / `ui_entry` / `e2e_runner` /
  `browser_login`: propose from any declared `dev`/`start`/`serve` script and
  conventional ports, else `null`
- `gates`: `[]` (compliance is WordPress-only; derived stacks run no gates)
- `variants`: `null`

For any verification command you propose, dry-check that it resolves before
asking (e.g. the script key exists in `package.json`, the Make target exists).
If a proposed command cannot be confirmed to resolve, downgrade it to `null` and
note it.

---

## Step 4 — Gather project identity

Now collect the per-project identity values. Infer sensible defaults from the
git remote and directory structure first, then confirm — do not invent values
you can't verify.

```bash
git remote get-url origin 2>/dev/null
basename "$(pwd)"
ls -la
```

| Field | How to infer | Default |
|---|---|---|
| **Slug** | repo name after `/` in the remote, or the directory name | — |
| **Display name** | `Plugin Name:` header in the main `.php` file (WP), else title-cased slug | — |
| **GitHub repo** | `owner/repo` extracted exactly from the remote URL | — |
| **Temp root** | — | `.ai` |
| **Base branch** | — | `origin/develop` |

Examples of slug → display name: `wp-rocket` → "WP Rocket", `imagify` →
"Imagify", `backwpup` → "BackWPup".

---

## Step 5 — Confirm gate (non-negotiable)

Print the detected stack, the proposed verification commands, the harness, and
the project identity in one block. For any category proposed as `null`, state
plainly that the corresponding gate/check will be **skipped**.

> Detected stack: **{profile}** ({authored | derived})
>
> Verification commands:
> - lint: `{lint}`  (fallback: `{lint_fallback}`)
> - typecheck: `{typecheck}`
> - test_unit: `{test_unit}`
> - autofix: `{autofix}`
> - build: `{build}`
>
> _(For any of the above shown as `null`: that check will be skipped — never
> failed.)_
>
> Source dirs: `{source_dirs}`
> Public API surface: `{public_api_surface}`
> Harness: kind `{harness.kind}`, base_url `{harness.base_url}`,
>   boot_cmd `{harness.boot_cmd}`, ui_entry `{harness.ui_entry}`
> Gates: `{gates}`   Variants: `{variants}`
>
> Identity:
> - slug: `{slug}`
> - display_name: `{display_name}`
> - repo: `{repo}`
> - temp_root: `{temp_root}`
> - base_branch: `{base_branch}`
>
> Confirm, edit any line, or tell me what's missing. **I will not write config
> until you confirm.**

For the WordPress path, the verification commands and surface are the authored
defaults — present them as such, but still confirm `harness.boot_cmd` and
`harness.ui_entry` (the `<plugin-page>` slug), which are project-specific even
within WordPress.

Wait for explicit confirmation before writing anything.

---

## Step 6 — Write `.claude/maestro.json`

Create the `.claude/` directory if needed, then write the config using the
confirmed values. The config has the existing `ai` identity block **plus** the
resolved `stack` block. Use this structure (WordPress example shown — substitute
the confirmed/derived values):

```json
{
  "ai": {
    "slug": "wp-rocket",
    "display_name": "WP Rocket",
    "repo": "wp-media/wp-rocket",
    "temp_root": ".ai",
    "base_branch": "origin/develop",
    "architecture_skill": "wp-rocket-architecture",
    "frontend_skill": null,
    "editions": null,
    "rest_namespace": null,
    "html_log": false,
    "e2e": {
      "local_url": null,
      "boot_cmd": null,
      "settings_path": null,
      "ci_integration": false,
      "license_option_key": null
    }
  },
  "stack": {
    "profile": "wordpress",
    "profile_version": "1",
    "verification": {
      "lint": "composer phpcs-changed",
      "lint_fallback": "composer run phpcs",
      "autofix": "composer phpcs:fix",
      "typecheck": "composer run-stan",
      "test_unit": "composer test-unit",
      "build": null
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
      "ui_entry": "/wp-admin/options-general.php?page=<plugin-page>",
      "browser_login": { "url": "/wp-login.php", "user": "admin", "pass": "password" },
      "e2e_runner": "npx --yes playwright test"
    },
    "gates": ["compliance"],
    "variants": { "concept": "editions", "values": ["free", "pro"] }
  }
}
```

Rules for filling it in:

- **`ai` block** (per-project identity):
  - `slug`, `display_name`, `repo`, `temp_root`, `base_branch` → the confirmed
    values from Step 4.
  - `architecture_skill` → `"{slug}-architecture"` (e.g.
    `wp-rocket-architecture`). This skill may not exist yet — that's expected;
    flag it in the summary.
  - `frontend_skill`, `editions`, `rest_namespace`, `e2e.local_url`,
    `e2e.boot_cmd`, `e2e.settings_path` → leave `null`. (Agents skip E2E probing
    via `ai.e2e` while these are null; the `stack.harness` block is the source
    of truth, `ai.e2e` is a compat alias.)
  - `html_log` → `false`. `e2e.ci_integration` → `false`.
- **`stack` block** (resolved profile): write the confirmed resolved block from
  Step 3a (WordPress) or Step 3b (derived). Verification commands are flattened
  **strings** (or `null`) — never `{cmd, fallback}` objects. For a derived
  stack, set `profile` to `"derived"`, `gates` to `[]`, `variants` to `null`,
  and `public_api_surface` to `[]` unless the user supplied entries.

```bash
mkdir -p .claude
```

Write the JSON to `.claude/maestro.json`.

---

## Step 7 — Create the `.ai/` working directory

Use the confirmed `temp_root` (default `.ai`).

```bash
mkdir -p .ai/issues
```

- `.ai/issues/` — orchestrator run artifacts (one folder per issue).

If the user chose a non-default `temp_root`, substitute it in the path.

---

## Step 8 — Podium (Optional)

Podium is a separate plugin. If the user wants the agent observer dashboard,
they can install it after Maestro is set up:

```bash
/plugin marketplace add wp-media/claude-marketplace
/plugin install podium@wp-media
/podium setup
```

This is optional — Maestro works fine without Podium. Mention it in Step 10 as a
suggested next step, but do not install it automatically.

---

## Step 9 — Update `.gitignore`

Keep generated working files out of version control.

```bash
grep -n ".ai/" .gitignore 2>/dev/null
```

If `.ai/` is **not** already ignored, append it:

```bash
printf '\n# Maestro working files\n.ai/\n' >> .gitignore
```

If `.gitignore` doesn't exist, create it with the same content. Skip this step
entirely if `.ai/` already appears in `.gitignore`.

---

## Step 10 — Print the summary

Print exactly this (substituting the real display name and detected profile):

```
✓ Maestro configured for {display_name}
  Config: .claude/maestro.json
  Stack:  {profile}
  Temp:   .ai/

Next steps:
  /orchestrator issue-N  → run the full delivery pipeline

Optional:
  /plugin install podium@wp-media  → install the agent observer dashboard
```

If any verification category was set to `null`, add a line listing which checks
will be skipped:

```
  Note: {categories} have no configured command — those checks will be skipped.
```

If the architecture skill (`{slug}-architecture`) doesn't exist yet, add one
extra line after the next steps:

```
  Heads up: create .claude/skills/{slug}-architecture/SKILL.md so grooming and
  implementation agents understand this plugin's patterns.
```
