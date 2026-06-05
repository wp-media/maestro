# Podium

Real-time agent observer for Maestro pipelines. Zero token cost — powered by
Claude Code hooks, not orchestrator instructions.

## Quick start

```bash
# 1. Register hooks in the project (once per project, restart Claude Code after)
node podium/install.mjs

# 2. Start the dashboard server
node podium/server.mjs

# 3. Open http://localhost:7337
```

Or from within a Claude Code session: `/podium`

## How it works

```
Claude Code harness
      │
      │ fires hook on every Agent / Workflow tool use (PreToolUse, PostToolUse,
      │ SubagentStart, SubagentStop, SessionStart, SessionEnd)
      ▼
podium/hook.mjs        ← reads stdin, appends one JSON line, exits < 1 s
      │
      ▼
{TEMP_ROOT}/podium/{session_id}/events.jsonl
      │
      │ tailed every 500 ms
      ▼
podium/server.mjs      ← HTTP + SSE server on port 7337
      │
      │ Server-Sent Events
      ▼
podium/index.html      ← single-file dashboard, no CDN
```

## Files

| File | Purpose |
|---|---|
| `hook.mjs` | Claude Code hook — reads tool events, writes JSONL |
| `server.mjs` | Zero-dep HTTP + SSE server |
| `index.html` | Self-contained dashboard (no external CDN) |
| `install.mjs` | Registers / removes hooks in `.claude/settings.json` |

## CLI options

```bash
node podium/server.mjs [--port 7337] [--temp-root .maestro]
node podium/install.mjs [--check] [--uninstall] [--global]
```

## Hook events captured

| Hook | Event written |
|---|---|
| `SessionStart` | `session_start` |
| `PreToolUse` (Agent / Workflow) | `agent_start` |
| `PostToolUse` (Agent / Workflow) | `agent_end` |
| `SubagentStart` | `subagent_meta` (enriches agent name) |
| `SubagentStop` | `subagent_stop` |
| `SessionEnd` | `session_end` |
