# Onboard Project

Creates `.claude/maestro.json` for the current project by running a team of parallel analysis agents, then presenting a single pre-filled confirmation table.

The user only corrects what's wrong and provides what truly can't be found in code (`slack_channel`).

---

## Step 1 — Guard

```bash
ls .claude/maestro.json 2>/dev/null
ls .aiassistant/config/repo-map.json 2>/dev/null
```

If `maestro.json` already exists, show its contents and ask:
> `.claude/maestro.json` already exists. Overwrite it, or update only missing/null fields?

Stop until the user responds. If they say stop, exit cleanly.

If a legacy `.aiassistant/config/repo-map.json` exists, read it now — use its values as the starting point for the analysis. Port all non-null values directly.

---

## Step 2 — Deep analysis

Spawn four agents in parallel. If parallel execution is not available, run them sequentially. Each agent reads the project files and returns a JSON object with its findings.

---

### Agent: identity

**Goal:** establish the project's identity and PHP structure.

Read:
- `git remote get-url origin`
- The main plugin PHP file (the one with `Plugin Name:` in its header — search root-level `.php` files, excluding `vendor/`)
- `composer.json` in full
- `README.md` or `README.txt` if present

Return JSON:
```json
{
  "repo": "wp-media/<repo-name>",
  "slug": "<repo-name>",
  "display_name": "<Plugin Name from header>",
  "description": "<Description from header or README first paragraph>",
  "text_domain": "<Text Domain from header>",
  "namespace": "<Root PHP namespace from composer autoload.psr-4>",
  "entrypoint": "<main-plugin-file>.php",
  "has_uninstall": true
}
```

---

### Agent: wordpress

**Goal:** understand how the plugin integrates with WordPress, and map edition boundaries if applicable.

Read:
- PHP files in `src/` and `inc/` (or `classes/` if neither exist) — look for REST routes, admin menus, capabilities
- The main plugin bootstrap file (root-level `.php` with `Plugin Name:`)
- Do not read `vendor/` or `tests/`

Specifically look for:

**REST routes:**
- `register_rest_route(` calls → extract namespace string from first argument → build `rest_namespace` as `/wp-json/<namespace>/`

**Admin settings:**
- `add_menu_page(` / `add_options_page(` / `add_submenu_page(` calls → extract page slug (last positional argument before callback) → build `settings_path`

**Capabilities:**
- `current_user_can(` calls → extract capability strings
- Ignore generic WordPress capabilities: `manage_options`, `activate_plugins`, `edit_posts`, `manage_network`, `administrator`
- Keep only plugin-specific ones

**Edition split — directory and code signals:**
```bash
find . -maxdepth 3 -type d \( -name "pro" -o -name "free" -o -name "Pro" -o -name "Free" \) 2>/dev/null | grep -v vendor | grep -v node_modules
grep -rEl "IS_PRO|is_pro\(\)|BACKWPUP_PRO|WP_ROCKET_PRO|IMAGIFY_PRO" --include="*.php" . 2>/dev/null | grep -v vendor | head -5
```

If a free/pro split is confirmed, map the edition paths by examining:
- Which directories contain only PRO classes/features (look for `Pro/` subdirectories, `pro/` root directories, conditional `IS_PRO` guards)
- Which files/directories are shared (the main bootstrap, `src/`, `inc/` minus Pro subdirs)
- Read the main plugin file to see how PRO is conditionally loaded

Build a detailed `editions` object:
```json
{
  "editions": {
    "free": {
      "paths": ["<main>.php", "inc/", "src/", "views/", "components/"],
      "notes": ["Shared core and FREE features.", "FREE must not reference PRO namespaces."]
    },
    "pro": {
      "paths": ["inc/Pro/", "pro/"],
      "notes": ["PRO features extend FREE via composition.", "No feature flags inside shared services."]
    }
  },
  "ai_editions_signal": ["free", "pro"]
}
```

If no split is found, return `"editions": null, "ai_editions_signal": null`.

Return JSON:
```json
{
  "rest_namespace": "/wp-json/<namespace>/",
  "settings_path": "/wp-admin/admin.php?page=<slug>",
  "capabilities": ["<capability-1>"],
  "editions": { "free": { "paths": [], "notes": [] }, "pro": { "paths": [], "notes": [] } },
  "ai_editions_signal": ["free", "pro"]
}
```

Use `null` for any field where no clear evidence was found.

---

### Agent: devops

**Goal:** understand the local development and testing setup.

Read:
- `package.json` (full)
- `Makefile` (if present)
- `composer.json` scripts section
- `bin/` directory listing + content of any `dev-*.sh`, `test-*.sh`, `seed-*.sh` files found there
- `.github/workflows/` — look for E2E or Playwright jobs
- Any `docker-compose.yml` or `Dockerfile` at the root

Identify:
- **boot_cmd**: command that starts the local WordPress environment (docker-compose up, `bash bin/dev-up.sh`, `npm run dev`, make target, etc.)
- **seed_cmd**: command that seeds test data (if any)
- **test_cmd**: command that runs E2E tests (playwright, cypress, codecept — check `package.json` scripts and Makefile)
- **ci_integration**: are E2E spec files committed to the repo? (`git ls-files "*.spec.ts" "*.spec.js" | grep -v node_modules`)

Return JSON:
```json
{
  "boot_cmd": "bash bin/dev-up.sh",
  "seed_cmd": null,
  "test_cmd": "npm run test:e2e",
  "ci_integration": false
}
```

---

### Agent: structure

**Goal:** understand the project's current Claude setup, map every directory, and detect all tooling. Include everything that exists — more is better.

Read:
- `.claude/` directory listing (full tree)
- `AGENTS.md` if present
- `.gitignore`
- Root directory listing

Run:
```bash
# All first-level directories
find . -maxdepth 1 -type d | sort

# Tooling files
ls composer.json package.json phpcs.xml phpcs.xml.dist phpstan.neon phpstan.neon.dist \
   phpstan-baseline.neon gulpfile.ts gulpfile.js gulpfile.mjs \
   tailwind.config.js tailwind.config.ts \
   webpack.config.js webpack.config.ts \
   vite.config.js vite.config.ts \
   jest.config.js jest.config.ts \
   playwright.config.ts playwright.config.js \
   Makefile 2>/dev/null

# Claude skills
ls .claude/skills/ .claude/commands/ 2>/dev/null
```

**Areas** — include every directory that exists and is meaningful. For each:
- `src/` → `namespaced-php`
- `inc/` → `legacy-php`
- `inc/Pro/` → `legacy-php-pro` (if exists)
- `classes/` → `legacy-php`
- `views/` → `templates`
- `components/` → `template-components`
- `parts/` → `template-parts`
- `pages/` → `template-pages`
- `pro/` → `pro-only`
- `assets/` → `compiled-assets`
- `dist/` → `compiled-assets`
- `resources/` → `source-assets`
- `_dev/` → `source-assets`
- `languages/` → `i18n`
- `packages/` → `local-packages`
- `bin/` → `tooling`
- `tasks/` → `tooling`
- `config/` → `config`
- `tests/` → `tests`
- `vendor/` → `third-party`
- `node_modules/` → `third-party`

For notes on each area, read a few files to describe what's actually there (e.g. "PSR-4 codebase; subdirs: API, Admin, Backup…"). Be specific — agents use these notes to navigate.

**Tooling** — include every tool file that exists. Do not omit tools just because they're less common.

**Existing Claude skills:**
- Architecture skill → exact directory name in `.claude/skills/` matching `*architecture*`
- Frontend skill → exact directory name matching `*frontend*`
- `agents_md_extended` → `false` if AGENTS.md contains the Maestro placeholder text, `true` if extended

Return JSON:
```json
{
  "architecture_skill": "backwpup-architecture",
  "frontend_skill": "backwpup-frontend-architecture",
  "agents_md_extended": false,
  "areas": [
    { "path": "src/", "role": "namespaced-php", "notes": "PSR-4 codebase; subdirs: API, Admin, Backup, Jobs, License." },
    { "path": "inc/", "role": "legacy-php", "notes": "Non-namespaced classes, admin pages, job types." },
    { "path": "inc/Pro/", "role": "legacy-php-pro", "notes": "PRO-only legacy classes." },
    { "path": "views/", "role": "templates", "notes": "PHP templates for admin and restore UI." },
    { "path": "components/", "role": "template-components", "notes": "Reusable UI components." },
    { "path": "assets/", "role": "compiled-assets", "notes": "Compiled CSS/JS. Git-ignored output." },
    { "path": "resources/", "role": "source-assets", "notes": "SCSS source; subdirs: scss/components, scss/core." },
    { "path": "languages/", "role": "i18n", "notes": "Translation files." },
    { "path": "tests/", "role": "tests", "notes": "PHPUnit tests in tests/php/." },
    { "path": "vendor/", "role": "third-party", "notes": "Composer dependencies. Do not edit." },
    { "path": "node_modules/", "role": "third-party", "notes": "NPM dependencies. Do not edit." }
  ],
  "tooling": {
    "composer": "composer.json",
    "phpcs": "phpcs.xml",
    "phpstan": "phpstan.neon.dist",
    "node": "package.json",
    "gulp": "gulpfile.ts",
    "tailwind": "tailwind.config.js"
  }
}
```

---

## Step 3 — Synthesize and confirm

Merge all agent findings. For any conflict between agents, prefer the more specific finding with evidence.

Present the full table in a single message:

```
Here's everything I found — confirm or correct anything, and tell me the Slack channel ID (or null).

┌─────────────────────┬──────────────────────────────────────┬────────────────────────────────────┐
│ Field               │ Value                                │ Source                             │
├─────────────────────┼──────────────────────────────────────┼────────────────────────────────────┤
│ slug                │ backwpup-pro                         │ git remote                         │
│ display_name        │ BackWPup Pro                         │ plugin header                      │
│ text_domain         │ backwpup                             │ plugin header                      │
│ namespace           │ WPMedia\BackWPup                     │ composer.json                      │
│ architecture_skill  │ backwpup-architecture                │ .claude/skills/ (existing)         │
│ frontend_skill      │ backwpup-frontend-architecture       │ .claude/skills/ (existing)         │
│ editions.free.paths │ backwpup.php, inc/, src/, views/     │ bootstrap + shared dirs            │
│ editions.pro.paths  │ inc/Pro/, pro/                       │ Pro/ subdir + pro/ root dir        │
│ rest_namespace      │ null                                 │ no register_rest_route() found     │
│ capabilities        │ ["backwpup"]                         │ current_user_can() calls           │
│ e2e.settings_path   │ /wp-admin/admin.php?page=backwpup    │ add_menu_page() slug               │
│ e2e.boot_cmd        │ bash bin/dev-up.sh                   │ bin/dev-up.sh found                │
│ e2e.seed_cmd        │ null                                 │ no seed script found               │
│ e2e.test_cmd        │ npm run test:e2e                     │ package.json scripts               │
│ e2e.ci_integration  │ false                                │ no committed spec files            │
├─────────────────────┼──────────────────────────────────────┼────────────────────────────────────┤
│ slack_channel       │ ?                                    │ cannot be found in code            │
└─────────────────────┴──────────────────────────────────────┴────────────────────────────────────┘
```

Wait for the user's response before proceeding.

---

## Step 4 — Write the file

Construct the full `maestro.json` from confirmed values. Write it to `.claude/maestro.json`.

```json
{
  "name": "<slug>",
  "repo": "wp-media/<slug>",
  "type": "wordpress-plugin",
  "description": "<description>",
  "entrypoints": {
    "plugin_bootstrap": "<main-file>.php",
    "uninstall": "uninstall.php"
  },

  // Only include editions block if a free/pro split was confirmed.
  // Remove entirely for single-edition plugins.
  "editions": {
    "free": {
      "paths": ["<main>.php", "inc/", "src/"],
      "notes": ["Shared core and FREE features.", "FREE must not reference PRO namespaces."]
    },
    "pro": {
      "paths": ["inc/Pro/", "pro/"],
      "notes": ["PRO features extend FREE via composition."]
    }
  },

  "areas": [...],
  "tooling": {...},
  "notes": [
    "Prefer minimal diffs and avoid unrelated formatting changes."
  ],
  "ai": {
    "slug": "<slug>",
    "display_name": "<Human Readable Name>",
    "repo": "wp-media/<slug>",
    "temp_root": ".TemporaryItems/Issues/<slug>",

    "architecture_skill": "<slug>-architecture",
    "frontend_skill": "<slug>-frontend-architecture",

    "text_domain": "<text-domain>",
    "namespace": "<PHP\\Namespace\\Root>",

    "rest_namespace": null,

    "push_agent": "release-agent",

    "editions": null,

    "capabilities": [],

    "slack_channel": null,
    "slack_threads_dir": null,

    "e2e": {
      "local_url": "http://localhost:8888",
      "boot_cmd": "bash bin/dev-up.sh",
      "seed_cmd": null,
      "test_cmd": null,
      "settings_path": "/wp-admin/options-general.php?page=<plugin-page>",
      "ci_integration": false
    }
  }
}
```

Rules:
- Include the root-level `editions` block only if a free/pro split was confirmed. Omit it entirely for single-edition plugins.
- `ai.editions` is the signal array `["free","pro"]` or `null` — it mirrors whether the root `editions` block is present.
- Set `slack_threads_dir` to `.TemporaryItems/Issues/<slug>/slack-threads` if `slack_channel` is set, otherwise omit it.
- Set all null fields explicitly to `null`.

---

## Step 5 — Build the initial knowledge graph

Run the graph builder directly from the Maestro plugin cache — no file is copied to the project:

```bash
GRAPH_SCRIPT=$(find ~/.claude/plugins/cache/maestro -name "build-knowledge-graph.js" 2>/dev/null | sort -V | tail -1)
[ -n "$GRAPH_SCRIPT" ] && node "$GRAPH_SCRIPT" --full
```

The graph is written to `.claude/graph/dependency-graph.json`. Add that path to `.gitignore` if not already there.

---

## Step 6 — Remind about remaining setup

Check what's missing and surface it:

```bash
ls .claude/skills/<slug>-architecture/ 2>/dev/null
```

If the architecture skill directory is missing:
> Next: create `.claude/skills/<slug>-architecture/SKILL.md` — define your DI patterns, module structure, and static analysis rules. The grooming agent reads this before every implementation.

If `AGENTS.md` was not yet extended (from agent: structure findings):
> Next: extend `AGENTS.md` with a **Project Overview** section describing this project's architecture.
