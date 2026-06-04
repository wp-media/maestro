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

Podium captures every `Agent` and `Workflow` tool invocation through Claude
Code hooks — **zero tokens, zero orchestrator changes**. The hook script
(`podium/hook.mjs`) fires on every agent spawn, appends one JSON line to
`{TEMP_ROOT}/podium/{session_id}/events.jsonl`, and exits in under 1 s.
The server tails those files and streams them to the browser via SSE.

## Config loading

Read `.claude/maestro.json`:

| Variable | JSON path | Default |
|---|---|---|
| `TEMP_ROOT` | `.ai.temp_root` | `.maestro` |
| `PORT` | `.ai.podium.port` | `7337` |

## Resolve Maestro plugin root

This skill is at `{root}/commands/podium.md`. The plugin root is one level up.

```
SERVER_PATH  = {root}/podium/server.mjs
INSTALL_PATH = {root}/podium/install.mjs
LOG_FILE     = {TEMP_ROOT}/podium/server.log
```

Fallback: look for `podium/server.mjs` in `~/.claude/plugins/maestro/`.

---

## `/podium setup`

First-time wiring of Claude Code hooks. Run once per project (or globally).

**a. Check if already set up**

```bash
node {INSTALL_PATH} --check
```

Exit 0 → already installed, tell the user and stop.

**b. Register hooks**

```bash
node {INSTALL_PATH}
```

Registers `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
`PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `SessionEnd`
in `.claude/settings.json`.

**c. Optional: install globally** (all projects on this machine)

```bash
node {INSTALL_PATH} --global
```

**d. Confirm**

Print:
```
✓ Podium hooks registered in .claude/settings.json
  → Restart Claude Code to activate, then run /podium start
```

---

## `/podium start`

Start the dashboard server (hooks must be set up first).

**a. Warn if hooks are missing**

```bash
node {INSTALL_PATH} --check
```

If exit 1: print a gentle warning — "Hooks not set up. Run `/podium setup`
first, then restart Claude Code." — but continue anyway (server still useful
for browsing past runs).

**b. Check if already running**

```bash
curl -s --max-time 2 http://localhost:{PORT}/health
```

HTTP 200 → already up, skip to step d.

**c. Start server in background, log to file**

```bash
node {SERVER_PATH} --temp-root {TEMP_ROOT} --port {PORT} >> {LOG_FILE} 2>&1 &
```

Wait 1.5 s, then verify:

```bash
curl -s --max-time 2 http://localhost:{PORT}/health
```

If still unreachable: "Podium failed to start. Check `{LOG_FILE}` for errors."

**d. Show current sessions**

```bash
curl -s http://localhost:{PORT}/api/runs
```

Print a compact summary (last 5 sessions: status dot, short ID, agents, duration).

**e. Print URL**

```
◆ Podium running → http://localhost:{PORT}
```

---

## `/podium stop`

```bash
lsof -ti:{PORT}
```

No output → "Podium is not running."

Otherwise:

```bash
kill $(lsof -ti:{PORT})
```

Confirm: "◆ Podium stopped."

---

## `/podium restart`

Run `/podium stop`, wait 1 s, then run `/podium start`.

---

## `/podium status`

Full health snapshot.

```bash
curl -s --max-time 2 http://localhost:{PORT}/health
```

**If not running:** "Podium is not running. Run `/podium start` to launch it."

**If running,** show:
- Server: port · TEMP\_ROOT · uptime
- Hooks: run `node {INSTALL_PATH} --check` → installed / not installed
- Sessions: `curl -s http://localhost:{PORT}/api/runs` → table of all runs

```
◆ Podium status
  Server  http://localhost:7337  uptime 4m 12s
  Hooks   ✓ installed (.claude/settings.json)
  
  Sessions (3)
  ─────────────────────────────────────────────────
  ● issue-42   running   grooming · backend · qa     —
  ✓ issue-41   2m 14s    grooming · backend · qa     done
  ✗ issue-39   failed    grooming                    escalated
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
node {INSTALL_PATH} --uninstall
```

Confirm: "◆ Podium hooks removed. Restart Claude Code to apply."

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
| `/podium status` | Health + hooks + session list |
| `/podium logs` | Tail server log |
| `/podium uninstall` | Remove hooks from settings.json |

---

## Notes

- Hooks fire **per-project**: the hook reads `cwd` from the harness event and
  resolves TEMP\_ROOT from `.claude/maestro.json` in that directory.
- Token cost: **zero**. The hook exits before Claude Code processes its next
  turn.
- Podium is read-only — it never modifies code or project files.
- Sessions appear in the sidebar automatically; refresh with the ↺ button.
