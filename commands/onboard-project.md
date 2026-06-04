# Onboard Project

Creates `.claude/maestro.json` — the single file every Maestro agent reads before doing anything.

**Quality over speed.** This skill spawns multiple deep-analysis agents, then a verifier that challenges the result before writing anything. A thorough `maestro.json` means every grooming spec, every implementation, every PR is grounded in accurate project knowledge. A bad `maestro.json` silently degrades the entire pipeline.

---

## Step 1 — Guard

```bash
ls .claude/maestro.json 2>/dev/null
ls .aiassistant/config/repo-map.json 2>/dev/null
```

If `maestro.json` already exists, show its contents and ask:
> `.claude/maestro.json` already exists. Overwrite it, or update only missing/null fields?

Stop until the user responds.

If a legacy `.aiassistant/config/repo-map.json` exists, read it and port all non-null values as the starting point.

---

## Step 2 — Scout

Quick top-level scan to brief the agents with real data:

```bash
git remote get-url origin 2>/dev/null
ls -la
find . -maxdepth 1 -type f \( -name "*.php" -o -name "*.json" -o -name "*.xml" -o -name "*.neon*" -o -name "*.ts" -o -name "Makefile" \) | head -30
find . -maxdepth 2 -type d | grep -v "^\./\." | grep -vE "vendor|node_modules|\.git" | sort
ls .github/workflows/ 2>/dev/null
ls bin/ 2>/dev/null
```

Pass the full scout output to all agents as context.

---

## Step 3 — Deep analysis (parallel agents)

Spawn all agents simultaneously. Each does a genuine deep read — not just grepping, but reading actual files and reasoning about what they find.

---

### Agent: identity

Read everything that establishes who this project is:

- Git remote URL → `owner/repo` (extract exactly, never assume a prefix)
- Every root-level `.php` file → find the one with `Plugin Name:` or equivalent bootstrap header; read it fully
- `composer.json` → name, description, all `autoload.psr-4` entries, `require`, `require-dev`, scripts
- `package.json` → name, description, version
- `README.md` / `README.txt` → first meaningful paragraph for description
- `LICENSE` → license type

Extract:
- `repo` → exact `owner/repo` from remote
- `slug` → repo name (after `/`)
- `display_name` → from header or README
- `description` → one clear sentence; synthesise from header + README if needed
- `text_domain` → from plugin header if WP plugin, else null
- `namespace` → all PSR-4 namespace roots from composer.json (not just the first — some plugins have multiple)
- `entrypoint` → main bootstrap file
- `has_uninstall` → check for `uninstall.php`
- `license` → from LICENSE file or composer.json

Return full JSON.

---

### Agent: architecture

Read the actual PHP source deeply to understand how the plugin is built. This feeds every future grooming spec.

Read:
- The full main bootstrap file
- `src/` directory tree (or `inc/`, `classes/` if no `src/`)
- 10–15 representative PHP files across different subdirectories — pick files that look like core services, not helpers
- `composer.json` `require` section — understand third-party dependencies and what patterns they imply

Understand and document:
- **DI / service container**: is there a container? Which one (e.g. `league/container`, custom, none)? How are services registered?
- **Hook/subscriber pattern**: does the plugin use a subscriber pattern for `add_action`/`add_filter`? Or direct calls?
- **Module structure**: what are the top-level modules/domains? (e.g. Jobs, Backup, License, StorageProviders)
- **Key abstractions**: important interfaces, abstract classes, or base classes that define patterns
- **Namespace structure**: map the namespace tree (e.g. `WPMedia\BackWPup\API\`, `WPMedia\BackWPup\Jobs\`)
- **Notable patterns**: anything unusual or important that future agents should know before touching code
- **Legacy vs. modern split**: if both `inc/` and `src/` exist, describe what lives where and why

This output becomes the foundation for `areas[].notes` — make it specific and useful.

Return JSON:
```json
{
  "namespace_tree": ["WPMedia\\BackWPup\\API", "WPMedia\\BackWPup\\Jobs"],
  "di_pattern": "league/container registered in Plugin\\ServiceProvider",
  "hook_pattern": "Subscriber pattern via SubscriberInterface",
  "modules": ["API", "Admin", "Backup", "Jobs", "License", "StorageProviders"],
  "key_abstractions": ["JobInterface", "DestinationInterface"],
  "legacy_split": "inc/ = pre-2020 non-namespaced code, src/ = modern PSR-4",
  "notable_patterns": ["..."]
}
```

---

### Agent: wordpress

Read PHP source to understand WordPress integration. If not a WP project, return nulls.

**REST API:**
```bash
grep -rh "register_rest_route\s*(" --include="*.php" . 2>/dev/null | grep -v vendor | head -20
```
Read the REST controller files. Extract the actual namespace string, not just the first grep hit. Verify consistency across all route registrations.

**Admin UI:**
```bash
grep -rh "add_menu_page\|add_options_page\|add_submenu_page\|add_management_page\|add_dashboard_page" --include="*.php" . 2>/dev/null | grep -v vendor | head -20
```
Extract the page slug. Determine the correct admin URL (`admin.php` vs `options-general.php`).

**Capabilities:**
```bash
grep -rh "current_user_can\s*(" --include="*.php" . 2>/dev/null | grep -v vendor | grep -vE "test|spec|fixture" | head -50
```
Extract all plugin-specific capability strings. Exclude generic WP capabilities. Group them by what they gate.

**WordPress hooks registered:**
```bash
grep -rh "add_action\|add_filter" --include="*.php" . 2>/dev/null | grep -v vendor | grep -v test | head -30
```
Note the main hooks the plugin uses — useful context for agents scoping changes.

**Editions:**

Gather all signals:
```bash
grep -rEl "IS_PRO|is_pro\(\)|_PRO_|LITE|_FREE_|premium" --include="*.php" . 2>/dev/null | grep -v vendor | head -10
find . -maxdepth 4 -type d \( -iname "pro" -o -iname "free" -o -iname "lite" -o -iname "premium" \) 2>/dev/null | grep -vE "vendor|node_modules"
```

If split confirmed: read the main bootstrap to understand exactly how PRO is loaded conditionally. Read `inc/Pro/` or `pro/` to understand what's PRO-only. Build the complete edition paths object — be exhaustive, not approximate.

Return JSON:
```json
{
  "rest_namespace": "/wp-json/<ns>/ or null",
  "settings_path": "/wp-admin/admin.php?page=<slug> or null",
  "capabilities": ["backwpup", "backwpup_jobs_edit"],
  "main_hooks": ["plugins_loaded", "init", "admin_menu"],
  "editions": {
    "free": {
      "paths": ["backwpup.php", "inc/", "src/", "views/", "components/"],
      "notes": ["Shared core and FREE features.", "FREE must not reference PRO namespaces."]
    },
    "pro": {
      "paths": ["inc/Pro/", "pro/"],
      "notes": ["PRO extends FREE via composition.", "No feature flags inside shared services."]
    }
  },
  "ai_editions_signal": ["free", "pro"]
}
```

---

### Agent: frontend

Read the JavaScript/CSS pipeline. If no significant JS, return minimal result.

```bash
cat package.json 2>/dev/null
cat webpack.config.js webpack.config.ts vite.config.js vite.config.ts gulpfile.ts gulpfile.js 2>/dev/null
ls resources/ _dev/ assets/src/ assets/js/ 2>/dev/null
find . -maxdepth 3 -name "*.ts" -o -name "*.tsx" -o -name "*.vue" 2>/dev/null | grep -vE "node_modules|vendor|\.d\.ts" | head -20
```

Understand:
- Build tool (Webpack, Vite, Gulp, none)
- Source JS/TS entry points and their purpose
- CSS preprocessor (SCSS, PostCSS, Tailwind)
- `package.json` scripts relevant to build and dev
- What the compiled output is and where it goes

This informs `tooling`, `areas` source-asset entries, and the frontend skill relevance.

Return JSON:
```json
{
  "has_significant_js": true,
  "build_tool": "gulp",
  "js_entry_points": ["resources/js/admin.ts", "resources/js/restore.ts"],
  "css_preprocessor": "scss + tailwind",
  "build_scripts": {"build": "npm run build", "watch": "npm run dev"},
  "compiled_output": "assets/js/, assets/css/"
}
```

---

### Agent: devops

Read everything about running this project. Don't skim — read full file contents.

```bash
cat Makefile 2>/dev/null
cat bin/*.sh 2>/dev/null
cat docker-compose.yml docker-compose.yaml 2>/dev/null
cat .github/workflows/*.yml 2>/dev/null
cat package.json 2>/dev/null
git ls-files "*.spec.ts" "*.spec.js" "tests/e2e/**" 2>/dev/null | grep -v node_modules | head -20
```

Understand the complete dev workflow:
- How does a developer start the local environment?
- How does data get seeded?
- How do tests run (unit, integration, e2e)?
- What does CI run on each PR?
- Are E2E specs committed (permanent) or generated (temporary)?

For `boot_cmd`, `seed_cmd`, `test_cmd`: prefer the most specific, reliable command found. Check multiple sources — a Makefile target may call a bin script; understand the full chain.

Return JSON:
```json
{
  "boot_cmd": "bash bin/dev-up.sh",
  "seed_cmd": "bash bin/dev-seed.sh",
  "test_cmd": null,
  "ci_matrix": ["phpcs", "phpstan", "phpunit", "e2e"],
  "ci_integration": false,
  "local_url": "http://localhost:8888"
}
```

---

### Agent: structure

Map the complete project layout with specific, useful notes per directory.

```bash
find . -maxdepth 3 -type d | grep -v "^\./\." | grep -vE "vendor|node_modules|\.git" | sort
ls -la
```

For **each directory that exists**:
- Read a sample of actual files to understand what's inside
- Write notes that describe real contents — module names, patterns, what agents should know before touching files
- Assign the correct role

For **tooling**, check every possible config file:
```bash
ls composer.json package.json phpcs.xml phpcs.xml.dist phpstan.neon phpstan.neon.dist \
   phpstan-baseline.neon gulpfile.ts gulpfile.js gulpfile.mjs \
   tailwind.config.js tailwind.config.ts webpack.config.js webpack.config.ts \
   vite.config.js vite.config.ts jest.config.js jest.config.ts \
   playwright.config.ts playwright.config.js Makefile tsconfig.json \
   .phpunit.xml .phpunit.xml.dist phpunit.xml phpunit.xml.dist 2>/dev/null
```

For **existing Claude setup**:
```bash
find .claude -type f 2>/dev/null | sort
cat AGENTS.md 2>/dev/null | head -30
```

Identify existing architecture and frontend skills by exact name.

Return JSON with complete `areas` array (all real directories, specific notes) and `tooling` (all files that exist).

---

## Step 4 — Verify

Before presenting anything to the user, spawn one more agent that reviews all findings and challenges them.

**This agent receives the complete output from all five analysis agents.**

It must:
- Cross-check for inconsistencies (e.g. namespace in composer.json vs. actual classes found)
- Verify REST namespace against actual `register_rest_route()` calls
- Verify capabilities are plugin-specific (not generic WP caps that leaked through)
- Check edition paths are complete — do they cover all pro/free code?
- Check `areas` notes are specific and accurate, not generic placeholders
- Verify `boot_cmd` / `seed_cmd` / `test_cmd` actually exist as runnable commands
- Flag anything uncertain with a confidence score: `high`, `medium`, `low`
- Correct any field it can verify is wrong
- Return the corrected, final synthesis

Return JSON: the complete merged `maestro.json` content, with a `_confidence` note on any field below `high`.

---

## Step 5 — Present and confirm

Show the full verified table. For low-confidence fields, show the evidence and why it's uncertain.

```
Deep analysis complete. Here's the verified config — confirm or correct anything.

[full table with all fields and sources]

Low-confidence fields (please verify):
  editions.pro.paths — found inc/Pro/ and pro/ but couldn't confirm if pro/parts/ is also PRO-only
  e2e.test_cmd — no explicit e2e script found, but playwright.config.ts exists

One thing I need from you:
  slack_channel — Slack channel ID, or null
```

Wait for response.

---

## Step 6 — Write

Write the confirmed config to `.claude/maestro.json`. Follow the full schema from `.template/maestro.json` — include all fields, set unknowns to `null` rather than omitting.

---

## Step 7 — Knowledge graph

```bash
GRAPH_SCRIPT=$(find ~/.claude/plugins/cache/maestro -name "build-knowledge-graph.js" 2>/dev/null | sort -V | tail -1)
[ -n "$GRAPH_SCRIPT" ] && node "$GRAPH_SCRIPT" --full
```

Add `.claude/graph/` to `.gitignore` if not already there.

---

## Step 8 — Scaffold dev scripts

### 8a — Resolve Maestro bin path and set boot_cmd

```bash
find ~/.claude/plugins/cache/maestro -name "dev-up.sh" 2>/dev/null | sort -V | tail -1
```

Extract the directory from that path — this is `MAESTRO_BIN`.

Update `ai.e2e.boot_cmd` in `.claude/maestro.json` to `"bash $MAESTRO_BIN/dev-up.sh"` (with the resolved absolute path).

`dev-up.sh` and `dev-down.sh` live in Maestro — nothing to create in the project.

---

### 8b — Scaffold `.maestro/bin/dev-seed.sh`

Check if it already exists:

```bash
ls .maestro/bin/dev-seed.sh 2>/dev/null
```

If it exists, skip to 8c.

If not: use the `devops` agent findings from Step 3 and read the PHP source to infer what seeding this plugin needs. Look for:

```bash
grep -rh "get_option\|update_option" --include="*.php" . 2>/dev/null | grep -i "license\|key\|activation" | grep -v vendor | head -20
find . -path "*/tests/e2e*" -o -path "*/tests/E2E*" 2>/dev/null | grep -vE "vendor|node_modules" | head -10
```

Determine with confidence:
- Does the plugin store a license key in a WordPress option? If yes: option name + key field.
- What env var should hold the test key? (convention: `PLUGIN_SLUG_UPPER_TESTS_LICENSE_KEY`)
- Any plugin-specific state to seed (jobs, settings, cache flush, etc.)?

If confidence is low on any point, ask before generating:
> "For E2E seeding: does this plugin have a license key stored in a WordPress option? If yes — option name and field. Anything else that needs seeding (e.g. create a job, flush cache, configure settings)?"

Wait for the answer, then generate `.maestro/bin/dev-seed.sh` using this structure as a base, filled with the plugin-specific values:

```bash
#!/usr/bin/env bash
# Seed the wp-env environment with test data for E2E tests.
# Idempotent — safe to run multiple times.
set -euo pipefail

WP="npx @wordpress/env run cli wp"

echo "Seeding test data..."

# Set license key if provided via env var.
if [[ -n "${<LICENSE_KEY_ENV>:-}" ]]; then
  $WP eval "
    \$options = get_option( '<option_name>', [] );
    \$options['<key_field>'] = '${<LICENSE_KEY_ENV>}';
    update_option( '<option_name>', \$options );
  "
  echo "  License key set."
fi

# <plugin-specific seeding>

echo "Done seeding."
```

Update `ai.e2e.seed_cmd` in `.claude/maestro.json` to `"bash .maestro/bin/dev-seed.sh"`.

---

### 8c — Update .gitignore

Check the current `.gitignore`:

```bash
grep -n "\.maestro" .gitignore 2>/dev/null
```

If `.maestro/` appears as a whole-directory ignore, replace it with:

```
.maestro/*
!.maestro/bin/
```

This keeps all generated working files gitignored while committing the seed script.

---

## Step 9 — Remaining setup

Report what still needs to be done:

```bash
ls .claude/skills/<slug>-architecture/ 2>/dev/null
```

If architecture skill is missing:
> Next: create `.claude/skills/<slug>-architecture/SKILL.md` — define your DI patterns, module structure, key abstractions. The grooming agent reads this before writing every spec.

If `AGENTS.md` has not been extended with a Project Overview:
> Next: extend `AGENTS.md` — add a Project Overview section. Use the architecture agent's findings as source material.
