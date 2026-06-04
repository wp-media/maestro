# Onboard Project

Creates `.claude/maestro.json` for the current project.

Operates fully autonomously — discovers everything it can from the codebase, asks only for what genuinely cannot be found in code. Works on any project structure without assumptions.

---

## Step 1 — Guard

```bash
ls .claude/maestro.json 2>/dev/null
ls .aiassistant/config/repo-map.json 2>/dev/null
```

If `maestro.json` already exists, show its contents and ask:
> `.claude/maestro.json` already exists. Overwrite it, or update only missing/null fields?

Stop until the user responds. If they say stop, exit cleanly.

If a legacy `.aiassistant/config/repo-map.json` exists, read it. Use its values as the starting point and port all non-null values directly.

---

## Step 2 — Scout

Before spawning agents, do a quick top-level scan to understand what kind of project this is and what's available to read.

```bash
git remote get-url origin 2>/dev/null
ls -la
find . -maxdepth 1 -type f -name "*.php" | head -10
find . -maxdepth 1 -type f -name "*.json" -o -name "*.xml" -o -name "*.neon*" -o -name "*.ts" -o -name "Makefile" | head -20
find . -maxdepth 2 -type d | grep -v "^\./\." | grep -v vendor | grep -v node_modules | sort
```

Use these results to brief the agents with the actual layout — do not invent structure.

---

## Step 3 — Deep analysis

Spawn four agents in parallel, each briefed with the scout findings. If parallel execution is not available, run sequentially.

---

### Agent: identity

**Goal:** establish who this project is.

Start from what the scout found. Read everything that describes the project:
- Git remote URL → extract full `owner/repo`
- All root-level `.php` files → find the one with `Plugin Name:` or equivalent project header
- `composer.json` → name, description, namespace from `autoload.psr-4`, require-dev tools
- `package.json` → name, description if PHP header not found
- `README.md` / `README.txt` / `README.rst` → project description if not found elsewhere
- Any manifest file found (plugin header, `plugin.json`, `package.json`)

Derive:
- `repo` → exact `owner/repo` from git remote (never assume `wp-media/`)
- `slug` → repo name portion after the `/`
- `display_name` → human-readable name from header/README
- `description` → one sentence from header or README first paragraph
- `text_domain` → from plugin header if WordPress plugin, else null
- `namespace` → root PHP namespace from `autoload.psr-4`, else null
- `entrypoint` → main bootstrap file, else null
- `has_uninstall` → whether `uninstall.php` exists

Return JSON:
```json
{
  "repo": "<owner>/<repo>",
  "slug": "<repo-name>",
  "display_name": "<name>",
  "description": "<one sentence>",
  "text_domain": "<text-domain or null>",
  "namespace": "<Namespace\\Root or null>",
  "entrypoint": "<file.php or null>",
  "has_uninstall": true
}
```

---

### Agent: wordpress

**Goal:** understand WordPress-specific integration. If this is not a WordPress project, return nulls gracefully.

Run targeted searches across all PHP source files (exclude `vendor/`, `node_modules/`):

```bash
# REST routes
grep -rh "register_rest_route\s*(" --include="*.php" . 2>/dev/null | grep -v vendor | head -10

# Admin menus
grep -rh "add_menu_page\|add_options_page\|add_submenu_page\|add_management_page" --include="*.php" . 2>/dev/null | grep -v vendor | head -10

# Capabilities
grep -rh "current_user_can\s*(" --include="*.php" . 2>/dev/null | grep -v vendor | grep -v test | head -30

# Edition split signals
grep -rEl "IS_PRO|is_pro\(\)|_PRO_|_FREE_|LITE_VERSION" --include="*.php" . 2>/dev/null | grep -v vendor | head -5
find . -maxdepth 4 -type d \( -iname "pro" -o -iname "free" -o -iname "lite" -o -iname "premium" \) 2>/dev/null | grep -v vendor | grep -v node_modules
```

From these results:
- `rest_namespace` → extract from first `register_rest_route()` call, build `/wp-json/<ns>/`
- `settings_path` → extract page slug from `add_menu_page()` or `add_options_page()`; determine whether it goes under `admin.php` or `options-general.php`
- `capabilities` → unique plugin-specific capabilities from `current_user_can()` calls; exclude generic WP caps (`manage_options`, `activate_plugins`, `edit_posts`, `publish_posts`, `administrator`, `manage_network`)
- `editions` → if split detected: map which directories/files belong to free vs. pro by reading the main bootstrap and PRO-specific directories; build the full object with paths and notes. If no split: null.

Return JSON:
```json
{
  "rest_namespace": "/wp-json/<ns>/ or null",
  "settings_path": "/wp-admin/admin.php?page=<slug> or null",
  "capabilities": ["<cap>"],
  "editions": {
    "free": { "paths": [], "notes": [] },
    "pro": { "paths": [], "notes": [] }
  },
  "ai_editions_signal": ["free", "pro"]
}
```

---

### Agent: devops

**Goal:** understand how to run this project locally and in CI. Read everything related to scripts, containers, and automation.

```bash
cat Makefile 2>/dev/null
cat package.json 2>/dev/null
cat composer.json 2>/dev/null
ls bin/ 2>/dev/null && cat bin/*.sh 2>/dev/null | head -100
ls docker-compose.yml docker-compose.yaml .docker/ 2>/dev/null
ls .github/workflows/ 2>/dev/null
cat .github/workflows/*.yml 2>/dev/null | grep -A5 "e2e\|playwright\|cypress\|codecept" | head -40
git ls-files "*.spec.ts" "*.spec.js" "*.spec.php" "*.test.ts" 2>/dev/null | grep -v node_modules | head -10
```

From these results, identify the most likely commands for:
- `boot_cmd` → starts the local WordPress/dev environment. Look for: `bash bin/dev-up.sh`, `docker-compose up`, `make dev`, `npm run dev`, `wp-env start`. Use the most specific one found.
- `seed_cmd` → seeds test data. Look for: `bash bin/dev-seed.sh`, `make seed`, `npm run seed`. Null if none found.
- `test_cmd` → runs E2E tests. Look for: playwright config, cypress config, `npm run test:e2e`, `make e2e`. Null if none found.
- `ci_integration` → `true` if committed spec files exist in the repo (from `git ls-files`)

Return JSON:
```json
{
  "boot_cmd": "<command or null>",
  "seed_cmd": "<command or null>",
  "test_cmd": "<command or null>",
  "ci_integration": false
}
```

---

### Agent: structure

**Goal:** map the full project layout. Include everything — more is better. Read actual directory contents to write meaningful notes.

```bash
# All directories up to depth 3, excluding noise
find . -maxdepth 3 -type d \
  | grep -v "^\./\." \
  | grep -vE "vendor|node_modules|\.git" \
  | sort

# All tooling config files at root
ls composer.json package.json phpcs.xml phpcs.xml.dist \
   phpstan.neon phpstan.neon.dist phpstan-baseline.neon \
   gulpfile.ts gulpfile.js gulpfile.mjs \
   tailwind.config.js tailwind.config.ts \
   webpack.config.js webpack.config.ts \
   vite.config.js vite.config.ts \
   jest.config.js jest.config.ts \
   playwright.config.ts playwright.config.js \
   Makefile tsconfig.json \
   2>/dev/null

# Existing Claude setup
find .claude -type f 2>/dev/null | sort
cat AGENTS.md 2>/dev/null | head -20
```

For **each directory that exists**, determine its role and write a specific note:
- Read a few files in the directory to understand what's there
- Describe actual contents (e.g. "PSR-4 codebase; subdirs: API, Admin, Jobs, License" not just "PHP files")
- Map role using the convention: `namespaced-php`, `legacy-php`, `legacy-php-pro`, `templates`, `template-components`, `template-parts`, `pro-only`, `compiled-assets`, `source-assets`, `i18n`, `local-packages`, `tooling`, `config`, `tests`, `third-party`
- Skip only: `vendor/`, `node_modules/`, `.git/`

For **tooling**, include every config file that exists. Do not omit any.

For **existing Claude skills**, check `.claude/skills/` and `.claude/commands/` for directories/files matching `*architecture*` and `*frontend*`.

Return JSON:
```json
{
  "architecture_skill": "<exact-name or null>",
  "frontend_skill": "<exact-name or null>",
  "agents_md_extended": false,
  "areas": [
    { "path": "src/", "role": "namespaced-php", "notes": "PSR-4 codebase; subdirs: API, Admin, Backup, Jobs." }
  ],
  "tooling": {
    "composer": "composer.json",
    "phpcs": "phpcs.xml"
  }
}
```

---

## Step 4 — Synthesize and confirm

Merge all agent findings. For conflicts, prefer the more specific finding with evidence.

For any field that could not be determined from the codebase, mark it `?` in the table — do not guess.

Present the full table:

```
Here's everything I found — confirm or correct anything, and tell me the Slack channel ID (or null).

┌──────────────────────┬──────────────────────────────────────┬────────────────────────────────────┐
│ Field                │ Value                                │ Source                             │
├──────────────────────┼──────────────────────────────────────┼────────────────────────────────────┤
│ repo                 │ wp-media/backwpup-pro                │ git remote                         │
│ slug                 │ backwpup-pro                         │ repo name                          │
│ display_name         │ BackWPup Pro                         │ plugin header                      │
│ text_domain          │ backwpup                             │ plugin header                      │
│ namespace            │ WPMedia\BackWPup                     │ composer.json                      │
│ architecture_skill   │ backwpup-architecture                │ .claude/skills/ existing           │
│ frontend_skill       │ backwpup-frontend-architecture       │ .claude/skills/ existing           │
│ rest_namespace       │ /wp-json/backwpup/v1/                │ register_rest_route() call         │
│ capabilities         │ backwpup, backwpup_jobs_edit         │ current_user_can() calls           │
│ editions.free.paths  │ backwpup.php, inc/, src/             │ bootstrap + shared dirs            │
│ editions.pro.paths   │ inc/Pro/, pro/                       │ IS_PRO guard + Pro/ subdir         │
│ e2e.settings_path    │ /wp-admin/admin.php?page=backwpup    │ add_menu_page() slug               │
│ e2e.boot_cmd         │ bash bin/dev-up.sh                   │ bin/dev-up.sh found                │
│ e2e.seed_cmd         │ bash bin/dev-seed.sh                 │ bin/dev-seed.sh found              │
│ e2e.test_cmd         │ null                                 │ no e2e script found                │
│ e2e.ci_integration   │ false                                │ no committed spec files            │
├──────────────────────┼──────────────────────────────────────┼────────────────────────────────────┤
│ slack_channel        │ ?                                    │ cannot be found in code            │
└──────────────────────┴──────────────────────────────────────┴────────────────────────────────────┘
```

Ask in a single message:
1. Does everything look correct? Call out anything to change.
2. Slack channel ID? (or null)

Wait for the response before proceeding.

---

## Step 5 — Write the file

Construct `maestro.json` entirely from confirmed values. Write to `.claude/maestro.json`.

Rules:
- `repo` comes from the git remote — never assume `wp-media/` or any other prefix
- Include root-level `editions` block only if a split was confirmed. Omit entirely otherwise.
- `ai.editions` = `["free","pro"]` signal if editions exist, else `null`
- Include all discovered `areas` — do not reduce to a minimal set
- Include all discovered `tooling` entries
- `slack_threads_dir` = `.TemporaryItems/Issues/<slug>/slack-threads` if `slack_channel` is set, else omit
- Set all missing optional fields explicitly to `null`

---

## Step 6 — Build the initial knowledge graph

```bash
GRAPH_SCRIPT=$(find ~/.claude/plugins/cache/maestro -name "build-knowledge-graph.js" 2>/dev/null | sort -V | tail -1)
[ -n "$GRAPH_SCRIPT" ] && node "$GRAPH_SCRIPT" --full
```

Graph written to `.claude/graph/dependency-graph.json`. Add to `.gitignore` if not already there.

---

## Step 7 — Remaining setup

```bash
ls .claude/skills/<slug>-architecture/ 2>/dev/null
```

If architecture skill is missing:
> Next: create `.claude/skills/<slug>-architecture/SKILL.md` — define your DI patterns, module structure, and static analysis rules. The grooming agent reads this before every implementation.

If `AGENTS.md` was not extended:
> Next: extend `AGENTS.md` with a **Project Overview** section describing this project's architecture.
