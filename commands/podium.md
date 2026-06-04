---
name: podium
description: >
  Start, inspect, or stop the Podium agent observer — a local dashboard that
  visualises every agent the orchestrator spawns, in real time, at zero token
  cost (powered by Claude Code hooks). Use this skill when asked to "open
  podium", "start podium", "watch agents", "monitor pipeline", "show agent
  tree", or to check "/podium status". Invoke with `/podium` or
  `/podium start` to launch, `/podium status` to inspect, `/podium install`
  to wire up hooks, or `/podium stop` to shut it down.
---

## How Podium works

Podium captures every `Agent` and `Workflow` tool invocation through Claude
Code hooks — **no tokens consumed, no orchestrator changes needed**. The hook
script (`podium/hook.mjs`) receives each event from the harness, appends a
JSON line to `{TEMP_ROOT}/podium/{session_id}/events.jsonl`, and exits in
under 1 second. The dashboard server (`podium/server.mjs`) tails those files
and streams updates to the browser via SSE.

## Config loading

Read `.claude/maestro.json` and extract:

| Variable | JSON path | Default |
|---|---|---|
| `TEMP_ROOT` | `.ai.temp_root` | `.maestro` |

## Resolve the Maestro plugin root

The server lives at `{maestro_plugin_root}/podium/server.mjs` and the
installer at `{maestro_plugin_root}/podium/install.mjs`.

To find `maestro_plugin_root`, try in order:
1. Look for `podium/server.mjs` relative to this skill's own parent dir
   (skill is at `{root}/commands/podium.md` → root is one level up).
2. Look in `~/.claude/plugins/maestro/`.

Set `SERVER_PATH={maestro_plugin_root}/podium/server.mjs`  
Set `INSTALL_PATH={maestro_plugin_root}/podium/install.mjs`

---

## `/podium` or `/podium start`

**a. Check if hooks are installed**

```bash
node {INSTALL_PATH} --check
```

If exit code is `1` (not installed), run step b first. Otherwise skip to step c.

**b. Install hooks** (first-time setup only)

```bash
node {INSTALL_PATH}
```

This registers Podium in the project's `.claude/settings.json` for the hooks:
`SessionStart`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`,
`SessionEnd`. Tell the user: "Hooks registered — **restart Claude Code** to
activate Podium, then run `/podium` again."

**c. Check if server is already running**

```bash
curl -s http://localhost:7337/health
```

If HTTP 200 → server is up, skip to step e.

**d. Start the server in the background**

```bash
node {SERVER_PATH} --temp-root {TEMP_ROOT} &
```

Wait 1 s, verify:

```bash
curl -s http://localhost:7337/health
```

If still unreachable, report: "Podium failed to start — check that Node.js is
installed and that `{SERVER_PATH}` exists."

**e. List current sessions**

```bash
curl -s http://localhost:7337/api/runs
```

Parse the JSON array and show:
- Total session count
- Most recent 5 sessions: short session ID, status, agent list, duration

**f. Print the URL**

```
◆ Podium is running → http://localhost:7337
```

---

## `/podium status`

```bash
curl -s http://localhost:7337/health
```

If not 200: "Podium is not running. Run `/podium start` to launch it."

Otherwise show:
- Port, TEMP_ROOT, uptime
- Run `curl -s http://localhost:7337/api/runs` and display a summary table

Also check hooks:

```bash
node {INSTALL_PATH} --check
```

Report whether hooks are installed and remind the user to restart if they
were just installed.

---

## `/podium install`

Run the installer explicitly (useful after pulling Maestro into a new project):

```bash
node {INSTALL_PATH}
```

Report the result. If hooks were already present, say so. Remind the user to
restart Claude Code.

To install globally (all projects on this machine):

```bash
node {INSTALL_PATH} --global
```

---

## `/podium stop`

Find and kill the Podium server process:

```bash
lsof -ti:7337
```

If no output: "Podium is not running."

Otherwise:

```bash
kill $(lsof -ti:7337)
```

Confirm: "Podium stopped."

---

## Notes for the user

- The hooks write events **only for the current project** — they detect the
  `TEMP_ROOT` from `.claude/maestro.json` in the session's `cwd`.
- Sessions appear in the sidebar as soon as they start. Refresh the sidebar
  (top-left) to pick up new sessions.
- Podium is read-only — it never modifies your code or configuration.
- Token cost: **zero**. The hook script exits before Claude Code processes
  its next message.
