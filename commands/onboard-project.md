# Onboard Project

Creates `.claude/maestro.json` for the current project. Does a deep codebase analysis to pre-fill every field it can, then presents a single confirmation table — the user only corrects what's wrong and provides what truly can't be found in code.

---

## Step 1 — Guard

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

If found, read it and use its values as the starting point — port all non-null values directly.

---

## Step 3 — Deep discovery

Run **all** of these in parallel. Collect everything. Make no assumptions yet — just gather raw data.

### Identity

```bash
git remote get-url origin 2>/dev/null
grep -rl "Plugin Name:" --include="*.php" . 2>/dev/null | grep -v vendor | head -5
```

From the main plugin file:
```bash
grep -E "Plugin Name:|Text Domain:|Description:|Version:" <main-plugin-file>
```

From composer.json:
```bash
cat composer.json 2>/dev/null
```

### Existing architecture skills

```bash
ls .claude/skills/ 2>/dev/null
ls .claude/commands/ 2>/dev/null
```

Look for directories or files matching `*architecture*` or `*frontend*`. If found, use those exact names for `architecture_skill` and `frontend_skill`.

### Editions split

```bash
find . -maxdepth 3 -type d \( -name "pro" -o -name "free" \) 2>/dev/null | grep -v vendor | grep -v node_modules
grep -rE "is_pro|edition|free_version|pro_version|BACKWPUP_PRO" --include="*.php" -l 2>/dev/null | grep -v vendor | head -5
```

Also look at the repo name — a `-pro` suffix strongly suggests a free/pro split.

If evidence of a free/pro split is found, propose `["free", "pro"]`. Otherwise `null`.

### REST API namespace

```bash
grep -rh "register_rest_route\s*(" --include="*.php" . 2>/dev/null | grep -v vendor | head -10
```

Extract the namespace from the first argument of `register_rest_route()` calls (e.g. `'backwpup/v1'` → `rest_namespace: "/wp-json/backwpup/v1/"`). If none found, `null`.

### WordPress capabilities

```bash
grep -rh "current_user_can\s*(" --include="*.php" . 2>/dev/null | grep -v vendor | grep -v test | head -20
grep -rh "add_menu_page\|add_options_page\|add_submenu_page" --include="*.php" . 2>/dev/null | grep -v vendor | head -10
```

Extract unique capability strings from `current_user_can()` calls. Ignore generic ones (`manage_options`, `administrator`). Keep plugin-specific ones.

### Admin settings path

```bash
grep -rh "add_menu_page\|add_options_page\|add_submenu_page" --include="*.php" . 2>/dev/null | grep -v vendor | head -10
```

Extract the page slug (last argument of `add_menu_page` / `add_options_page`). Build `e2e.settings_path` as `/wp-admin/admin.php?page=<slug>` or `/wp-admin/options-general.php?page=<slug>` depending on the function used.

### Dev environment commands

```bash
ls bin/ 2>/dev/null
cat Makefile 2>/dev/null | grep -E "^[a-z][a-z-]+:" | head -20
cat package.json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); [print(k,':',v) for k,v in d.get('scripts',{}).items()]" 2>/dev/null
```

Identify:
- `e2e.boot_cmd`: look for `dev-up`, `dev:up`, `start`, `docker-compose up` patterns in `bin/`, `Makefile`, or `package.json` scripts
- `e2e.seed_cmd`: look for `seed`, `fixtures`, `dev-seed` patterns
- `e2e.test_cmd`: look for `e2e`, `playwright`, `cypress`, `test:e2e` patterns

### E2E CI integration

```bash
find . -path "*/tests/e2e/*.spec.*" -o -path "*/e2e/*.spec.*" 2>/dev/null | grep -v node_modules | head -5
git ls-files "*.spec.ts" "*.spec.js" "*.spec.php" 2>/dev/null | grep -v node_modules | head -5
```

If committed spec files exist → `ci_integration: true`. Otherwise `false`.

### Directory structure and tooling

```bash
ls -d src/ tests/ assets/ vendor/ inc/ classes/ 2>/dev/null
ls phpcs.xml phpcs.xml.dist phpstan.neon phpstan.neon.dist package.json 2>/dev/null
ls uninstall.php 2>/dev/null
```

---

## Step 4 — Present full pre-filled table for confirmation

Show **every field** with its discovered value and source. Mark fields that need input with `?`. Present as a single table — do not ask questions yet.

```
┌─────────────────────┬──────────────────────────────────┬───────────────────────────────────┐
│ Field               │ Value                            │ Source                            │
├─────────────────────┼──────────────────────────────────┼───────────────────────────────────┤
│ slug                │ backwpup-pro                     │ git remote                        │
│ display_name        │ BackWPup Pro                     │ plugin header                     │
│ repo                │ wp-media/backwpup-pro            │ git remote                        │
│ text_domain         │ backwpup                         │ plugin header                     │
│ namespace           │ WPMedia\BackWPup                 │ composer.json                     │
│ architecture_skill  │ backwpup-architecture            │ .claude/skills/ (existing)        │
│ frontend_skill      │ backwpup-frontend-architecture   │ .claude/skills/ (existing)        │
│ editions            │ ["free", "pro"]                  │ -pro suffix + is_pro() found      │
│ rest_namespace      │ null                             │ no register_rest_route() found    │
│ capabilities        │ ["backwpup"]                     │ current_user_can() calls          │
│ e2e.settings_path   │ /wp-admin/admin.php?page=backwpup│ add_menu_page() slug              │
│ e2e.boot_cmd        │ bash bin/dev-up.sh               │ bin/dev-up.sh found               │
│ e2e.seed_cmd        │ null                             │ no seed script found              │
│ e2e.test_cmd        │ null                             │ no e2e script found               │
│ e2e.ci_integration  │ false                            │ no committed spec files           │
├─────────────────────┼──────────────────────────────────┼───────────────────────────────────┤
│ slack_channel       │ ?                                │ cannot be discovered from code    │
└─────────────────────┴──────────────────────────────────┴───────────────────────────────────┘
```

Then ask in a **single message**:
1. Does everything above look correct? Call out anything to change.
2. What is the Slack channel ID? (or `null` to skip)

Wait for the response before proceeding.

---

## Step 5 — Write the file

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

Set `slack_threads_dir` to `.TemporaryItems/Issues/<slug>/slack-threads` if `slack_channel` is set, otherwise omit it. Set null fields explicitly to `null`.

---

## Step 6 — Build the initial knowledge graph

Run the graph builder directly from the Maestro plugin cache — no file is copied to the project:

```bash
GRAPH_SCRIPT=$(find ~/.claude/plugins/cache/maestro -name "build-knowledge-graph.js" 2>/dev/null | sort -V | tail -1)
[ -n "$GRAPH_SCRIPT" ] && node "$GRAPH_SCRIPT" --full
```

The graph is written to `.claude/graph/dependency-graph.json`. Add that path to `.gitignore` — it is auto-generated and should not be committed.

---

## Step 7 — Remind about remaining setup

```bash
ls .claude/skills/<slug>-architecture/ 2>/dev/null
ls AGENTS.md 2>/dev/null
```

If the architecture skill directory is missing:
> Next: create `.claude/skills/<slug>-architecture/SKILL.md` — define your DI patterns, module structure, and static analysis rules. The grooming agent reads this before every implementation.

If `AGENTS.md` is missing or still contains the Maestro base placeholder text:
> Next: extend `AGENTS.md` with a **Project Overview** section describing this project's architecture.
