---
name: podium
description: >
  Manage the Podium agent observer — a real-time dashboard that visualises
  every agent the orchestrator spawns at zero token cost (Claude Code hooks).
  Use when asked to "open podium", "start podium", "watch agents", "monitor
  pipeline", "show agent tree", "stop podium", or "podium status".
  Subcommands: setup · start · stop · restart · status · logs · uninstall.
  Bare `/podium` is an alias for `/podium start`.
---

## How Podium works

Podium is a forked and WP Media branded version of Claude Code Agent Monitor (MIT).
It captures every Claude Code event through native hooks, stores them in SQLite,
and streams updates to the browser via WebSocket. Zero extra LLM calls.

## Config

| Variable | Value |
|---|---|
| `DASHBOARD_ROOT` | `/Users/gaelrobin/Desktop/Work/maestro/podium/dashboard` |
| `INSTALL_SCRIPT` | `{DASHBOARD_ROOT}/scripts/install-hooks.js` |
| `HOOK_HANDLER` | `{DASHBOARD_ROOT}/scripts/hook-handler.js` |
| `PORT` | `4820` |
| `LOG_FILE` | `{TEMP_ROOT}/podium/server.log` (fallback: `/tmp/podium/server.log`) |

`TEMP_ROOT` is read from `.claude/maestro.json` at `.ai.temp_root`, defaulting to `.maestro`.

---

## `/podium setup`

First-time wiring of Claude Code hooks. Run once per project (or globally).

**a. Register hooks**

```bash
node /Users/gaelrobin/Desktop/Work/maestro/podium/dashboard/scripts/install-hooks.js
```

Registers the Podium hook handler in `.claude/settings.json` so every Claude Code
event is captured by `hook-handler.js`.

**b. Optional: install globally** (all projects on this machine)

```bash
node /Users/gaelrobin/Desktop/Work/maestro/podium/dashboard/scripts/install-hooks.js --global
```

**c. Confirm**

Print:
```
Podium hooks registered in .claude/settings.json
  -> Restart Claude Code to activate, then run /podium start
```

---

## `/podium start`

Start the dashboard server (hooks must be set up first).

**a. Warn if hooks are missing**

Check `.claude/settings.json` for the presence of `hook-handler.js`. If absent,
print a gentle warning: "Hooks not set up. Run `/podium setup` first, then restart
Claude Code." — but continue anyway (the server is still useful for browsing past runs).

**b. Check if already running**

```bash
curl -s --max-time 2 http://localhost:4820/health
```

HTTP 200 → already up, skip to step e.

**c. First-time setup (if node_modules missing)**

Check whether `{DASHBOARD_ROOT}/node_modules` exists:

```bash
ls {DASHBOARD_ROOT}/node_modules/.bin/vite 2>/dev/null && echo "ok" || echo "missing"
```

If missing, install dependencies first. On Linux, `better-sqlite3` requires build tools:

```bash
# Linux only (skip on macOS):
# sudo apt-get install -y python3 make g++   ← if npm install fails

cd {DASHBOARD_ROOT} && npm install 2>&1 | tail -5
```

This takes 1–2 minutes on first run. The `dist/` directory is pre-built and committed,
so no build step is needed unless you're developing the dashboard itself.

**d. Start server in background**

```bash
cd {DASHBOARD_ROOT} && node server/index.js >> {LOG_FILE} 2>&1 &
```

Wait 2 s, then verify:

```bash
curl -s --max-time 2 http://localhost:4820/health
```

If still unreachable:
1. Check the log: `tail -20 {LOG_FILE}`
2. Common Linux issue: `better-sqlite3` failed to compile — run `npm install` manually
   inside `{DASHBOARD_ROOT}` after installing `python3`, `make`, `g++`

**d. Show current stats**

```bash
curl -s http://localhost:4820/api/stats
```

Print a compact summary (total sessions, active agents, recent activity).

**e. Print URL**

```
Podium running -> http://localhost:4820
```

---

## `/podium stop`

Find the process (cross-platform — try `lsof` first, fall back to `fuser` on Linux):

```bash
# macOS / Linux with lsof
lsof -ti:4820 2>/dev/null || fuser 4820/tcp 2>/dev/null
```

No output → "Podium is not running."

Otherwise:

```bash
# macOS / Linux with lsof
kill $(lsof -ti:4820 2>/dev/null) 2>/dev/null || fuser -k 4820/tcp 2>/dev/null || true
```

Confirm: "Podium stopped."

---

## `/podium restart`

Run `/podium stop`, wait 1 s, then run `/podium start`.

---

## `/podium status`

Full health snapshot.

```bash
curl -s --max-time 2 http://localhost:4820/health
```

**If not running:** "Podium is not running. Run `/podium start` to launch it."

**If running,** also fetch:

```bash
curl -s http://localhost:4820/api/stats
```

Display:
- Server: port 4820 · uptime
- Hooks: present in `.claude/settings.json` → installed / not installed
- Stats summary from `/api/stats`

```
Podium status
  Server  http://localhost:4820  uptime 4m 12s
  Hooks   installed (.claude/settings.json)

  Stats
  ─────────────────────────────────────────────────
  Sessions  12   Agents  47   Tool calls  312
```

---

## `/podium logs`

Tail the server log file:

```bash
tail -n 50 {LOG_FILE}
```

If the file doesn't exist: "No log file found. Has Podium been started yet?"

---

## `/podium uninstall`

Remove hooks from settings.json:

```bash
node /Users/gaelrobin/Desktop/Work/maestro/podium/dashboard/scripts/install-hooks.js --uninstall
```

Confirm: "Podium hooks removed. Restart Claude Code to apply."

Does **not** stop a running server — run `/podium stop` first if needed.

---

## `/podium` (bare)

Alias for `/podium start`.

---

## Quick-reference

| Command | What it does |
|---|---|
| `/podium setup` | Register Claude Code hooks (once per project) |
| `/podium start` | Start the dashboard server |
| `/podium stop` | Stop the server |
| `/podium restart` | Stop then start |
| `/podium status` | Health + hooks + stats |
| `/podium logs` | Tail server log |
| `/podium uninstall` | Remove hooks from settings.json |

---

## Notes

- Hooks fire **per-project**: the hook handler reads the Claude Code event payload
  and stores data in SQLite under the dashboard's data directory.
- Token cost: **zero**. Hooks execute outside the LLM turn.
- Podium is read-only — it never modifies code or project files.
- The dashboard is served as a pre-built SPA (`dist/` is committed to the repo).
- Requires Node 18+. Run `npm install` inside `{DASHBOARD_ROOT}` before first use.
- The server listens on port **4820** by default.
- **Linux:** `better-sqlite3` requires native compilation. If `npm install` fails, run:
  `sudo apt-get install -y python3 make g++` then retry.
- **Linux:** `lsof` may not be installed. `/podium stop` falls back to `fuser -k 4820/tcp`.
- The `dist/` is pre-built and committed — no build step needed after `npm install`.
