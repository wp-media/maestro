# Onboard Project

Creates `.claude/maestro.json` for the current project by auto-discovering everything it can from the codebase, then asking for what it can't infer.

---

## Step 1 — Guard

Check whether `.claude/maestro.json` already exists.

```bash
ls .claude/maestro.json 2>/dev/null
```

If it exists, show its current contents and ask:
> `.claude/maestro.json` already exists. Overwrite it, or update only missing/null fields?

Stop until the user responds. If they say stop, exit cleanly.

---

## Step 2 — Check for legacy config

```bash
ls .aiassistant/config/repo-map.json 2>/dev/null
```

If found, read it. Use its values as a starting point — they are the ground truth for this project's prior config. Note that field names may differ (old format used `ai.slug`, `ai.repo`, etc. — same structure, just the file was named differently). Port all non-null values directly.

---

## Step 3 — Discover from the codebase

Run each discovery step below. Collect the results — do not ask the user for anything that can be reliably inferred.

### Repository identity

```bash
git remote get-url origin 2>/dev/null
```

Extract `owner/repo` from the URL. Strip `.git` suffix if present. This becomes `repo` and `ai.repo`.

Derive `ai.slug` from the repo name (the part after the slash).

### Plugin header

Search for the main plugin file (the one with `Plugin Name:` in its header):

```bash
grep -rl "Plugin Name:" --include="*.php" . 2>/dev/null | grep -v vendor | head -5
```

From the main plugin file, extract:

```bash
grep -E "Plugin Name:|Text Domain:|Description:" <main-plugin-file>
```

- `Plugin Name:` → `ai.display_name` and `name`
- `Text Domain:` → `ai.text_domain`
- `Description:` → `description`
- Filename without extension → candidate for `ai.slug` (use this if different from repo slug)

### PHP namespace

```bash
cat composer.json 2>/dev/null
```

Extract the root namespace from `autoload.psr-4` — the key of the first entry (e.g. `"WP_Rocket\\"` → `WP_Rocket`). This becomes `ai.namespace`.

Also extract:
- Available composer scripts → tooling commands
- Whether `phpcs`, `phpstan`, `psalm` appear in require-dev

### Tooling files

```bash
ls phpcs.xml phpcs.xml.dist phpstan.neon phpstan.neon.dist phpstan-baseline.neon package.json 2>/dev/null
```

Build the `tooling` object from what exists:
- `composer.json` present → `"composer": "composer.json"`
- `phpcs.xml` present → `"phpcs": "phpcs.xml"`, else try `phpcs.xml.dist`
- `phpstan.neon.dist` present → `"phpstan": "phpstan.neon.dist"`, else try `phpstan.neon`
- `package.json` present → `"node": "package.json"`

### Directory structure

```bash
ls -d src/ tests/ assets/ vendor/ 2>/dev/null
```

Build the `areas` array from what exists:
- `src/` → `{ "path": "src/", "role": "namespaced-php", "notes": "Modern PSR-4 codebase." }`
- `tests/` → `{ "path": "tests/", "role": "tests", "notes": "PHPUnit unit and integration tests." }`
- `assets/` → `{ "path": "assets/", "role": "built-assets", "notes": "Compiled JS/CSS for production." }`
- `vendor/` → `{ "path": "vendor/", "role": "third-party", "notes": "Composer dependencies (do not edit)." }`

### Plugin entrypoints

The main plugin PHP file (found above) → `entrypoints.plugin_bootstrap`.

```bash
ls uninstall.php 2>/dev/null
```

If present → `entrypoints.uninstall: "uninstall.php"`.

---

## Step 4 — Present findings and ask for the rest

Show a summary of everything discovered in a clean table, clearly marking what was found vs. what needs input. For example:

```
Discovered automatically:
  repo            wp-media/wp-rocket         (from git remote)
  slug            wp-rocket                  (from repo name)
  display_name    WP Rocket                  (from plugin header)
  text_domain     rocket                     (from plugin header)
  namespace       WP_Rocket                  (from composer.json)
  tooling         composer, phpcs, phpstan, node
  areas           src/, tests/, assets/, vendor/

Need your input:
  architecture_skill   (e.g. "wp-rocket-architecture")
  frontend_skill       (e.g. "wp-rocket-frontend-architecture", or null)
  rest_namespace       (e.g. "/wp-json/wp-rocket/v1/", or null)
  capabilities         (WordPress capabilities, e.g. ["rocket_manage_options"])
  editions             (null, or ["free","pro"] for split plugins like BackWPup)
  slack_channel        (Slack channel ID, or null)
  e2e.settings_path    (WP admin path to plugin settings page)
  e2e.boot_cmd         (command to start local environment, e.g. "bash bin/dev-up.sh")
  e2e.seed_cmd         (optional seed command, or null)
  e2e.test_cmd         (optional E2E test command, or null)
  e2e.ci_integration   (true if E2E tests are committed permanently, else false)
```

Ask all missing fields in a single message. Do not ask one by one.

For `architecture_skill`, suggest `<slug>-architecture` as the default and confirm.
For `frontend_skill`, suggest `<slug>-frontend-architecture` or null if no significant JS.
For `e2e.local_url`, default to `http://localhost:8888` unless the user says otherwise.
For `temp_root`, default to `.TemporaryItems/Issues/<slug>`.

---

## Step 5 — Write the file

Construct the full `maestro.json` from all discovered and provided values. Write it to `.claude/maestro.json`.

The file must follow this structure exactly:

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

Omit `slack_threads_dir` if `slack_channel` is null. Set null fields explicitly to `null` rather than omitting them, so developers know the field exists.

Omit `slack_threads_dir` if `slack_channel` is null. Set null fields explicitly to `null` rather than omitting them, so developers know the field exists.

After writing, confirm:

> `.claude/maestro.json` created. Run `/issue-workflow <number>` to start the pipeline on this project.

---

## Step 6 — Copy the knowledge graph builder

Find the Maestro plugin cache directory and copy the graph builder script to the project:

```bash
find ~/.claude/plugins/cache/maestro -name "build-knowledge-graph.js" 2>/dev/null | head -1
```

If found, copy it to `bin/build-knowledge-graph.js` in the project (create `bin/` if needed). Then run an initial full build:

```bash
node bin/build-knowledge-graph.js --full
```

If the script is not found (plugin not installed), skip silently and note it in the summary.

---

## Step 7 — Remind about remaining setup

After writing the file, check whether each of these exists and remind the user about anything missing:

```bash
ls .claude/commands/<slug>-architecture.md 2>/dev/null
ls AGENTS.md 2>/dev/null
```

If the architecture skill file is missing:
> Next: write `.claude/commands/<slug>-architecture.md` — define your DI patterns, module structure, and static analysis rules. The grooming agent reads this before every implementation.

If `AGENTS.md` is missing or is clearly the Maestro base (not yet extended):
> Next: extend `AGENTS.md` with a **Project Overview** section describing this project's architecture.
