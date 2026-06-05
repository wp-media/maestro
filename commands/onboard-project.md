---
name: onboard-project
description: >
  One-command Maestro setup for a new WordPress plugin project. Run this in the
  project root to generate maestro.json and create the temp directory structure.
  Invoke with /maestro:onboard-project.
---

# Onboard Project

Wires a WordPress plugin project into the Maestro ecosystem in one pass: writes
`.claude/maestro.json`, scaffolds the `.maestro/` working directory, and prints
the next steps. After this skill runs, the project is ready for every Maestro
agent and workflow. Podium (the optional dashboard) can be installed separately.

Run from the **project root** (the plugin repo), not from inside Maestro.

---

## Note: Podium is now optional (Step 5 update)

In earlier versions, Podium hooks were installed as part of onboarding. Podium
is now a **separate plugin** (see Installation section). Step 5 has been
simplified.

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

## Step 2 — Gather project details

Collect these five values. Infer sensible defaults from the git remote and
directory structure first, then confirm with the user — do not invent values
you can't verify.

```bash
git remote get-url origin 2>/dev/null
basename "$(pwd)"
ls -la
ls *.php 2>/dev/null
```

| Field | How to infer | Default |
|---|---|---|
| **Plugin slug** | repo name after `/` in the remote, or the directory name | — |
| **Display name** | `Plugin Name:` header in the main `.php` file, else title-cased slug | — |
| **GitHub repo** | `owner/repo` extracted exactly from the remote URL | — |
| **Temp root** | — | `.maestro` |
| **Base branch** | — | `origin/develop` |

Examples of slug → display name: `wp-rocket` → "WP Rocket", `imagify` →
"Imagify", `backwpup` → "BackWPup".

Present what you inferred and ask the user to confirm or correct:

> Onboarding this project with:
> - slug: `wp-rocket`
> - display_name: `WP Rocket`
> - repo: `wp-media/wp-rocket`
> - temp_root: `.maestro`
> - base_branch: `origin/develop`
>
> Confirm, or tell me what to change.

Wait for confirmation before writing anything.

---

## Step 3 — Write `.claude/maestro.json`

Create the `.claude/` directory if needed, then write the config using the
confirmed values. Use this exact structure:

```json
{
  "ai": {
    "slug": "wp-rocket",
    "display_name": "WP Rocket",
    "repo": "wp-media/wp-rocket",
    "temp_root": ".maestro",
    "base_branch": "origin/develop",
    "architecture_skill": "wp-rocket-architecture",
    "frontend_skill": null,
    "editions": null,
    "e2e": {
      "settings_path": null,
      "ci_integration": false,
      "license_option_key": null
    }
  }
}
```

Rules for filling it in:

- `slug`, `display_name`, `repo`, `temp_root`, `base_branch` → the confirmed
  values from Step 2.
- `architecture_skill` → `"{slug}-architecture"` (e.g. `wp-rocket-architecture`).
  This skill may not exist yet — that's expected; flag it in the summary.
- `frontend_skill`, `editions`, `e2e.settings_path` → leave `null`. Later runs
  or the full deep-analysis onboarding can fill these in.
- `e2e.ci_integration` → `false`.

```bash
mkdir -p .claude
```

Write the JSON to `.claude/maestro.json`.

---

## Step 4 — Create the `.maestro/` working directory

Use the confirmed `temp_root` (default `.maestro`).

```bash
mkdir -p .maestro/issues
```

- `.maestro/issues/` — orchestrator run artifacts (one folder per issue).

If the user chose a non-default `temp_root`, substitute it in the path.

---

## Step 5 — Podium (Optional)

Podium is a separate plugin. If the user wants the agent observer dashboard,
they can install it after Maestro is set up:

```bash
/plugin marketplace add wp-media/claude-marketplace
/plugin install podium@wp-media
/podium setup
```

This is optional — Maestro works fine without Podium. Mention it in Step 7
as a suggested next step, but do not install it automatically.

---

## Step 6 — Update `.gitignore`

Keep generated working files out of version control.

```bash
grep -n "\.maestro" .gitignore 2>/dev/null
```

If `.maestro/` is **not** already ignored, append it:

```bash
printf '\n# Maestro working files\n.maestro/\n' >> .gitignore
```

If `.gitignore` doesn't exist, create it with the same content. Skip this step
entirely if `.maestro` already appears in `.gitignore`.

---

## Step 7 — Print the summary

Print exactly this (substituting the real display name):

```
✓ Maestro configured for {display_name}
  Config: .claude/maestro.json
  Temp:   .maestro/

Next steps:
  /orchestrator issue-N  → run the full delivery pipeline

Optional:
  /plugin install podium@wp-media  → install the agent observer dashboard
```

If the architecture skill (`{slug}-architecture`) doesn't exist yet, add one
extra line after the next steps:

```
  Heads up: create .claude/skills/{slug}-architecture/SKILL.md so grooming and
  implementation agents understand this plugin's patterns.
```
