#!/usr/bin/env node
// podium/hook.mjs
// Zero-token Claude Code hook for Podium.
//
// Registered in .claude/settings.json for:
//   SessionStart, PreToolUse (Agent/Workflow), PostToolUse (Agent/Workflow),
//   SubagentStart, SubagentStop, SessionEnd
//
// Reads the hook payload from stdin, appends one JSONL line to:
//   {TEMP_ROOT}/podium/{session_id}/events.jsonl
//
// Hard exit deadline: 1 500 ms (well inside Claude Code's 2 s kill timeout).

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Safety deadline ───────────────────────────────────────────────────────────
const DEADLINE = setTimeout(() => process.exit(0), 1_500)
DEADLINE.unref()

// ── Read stdin ────────────────────────────────────────────────────────────────
let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { raw += c })
process.stdin.on('end', () => {
  try { run(raw.trim()) } catch { /* silent — never crash Claude Code */ }
  process.exit(0)
})

// ── Main logic ────────────────────────────────────────────────────────────────
function run(input) {
  if (!input) return

  let p
  try { p = JSON.parse(input) } catch { return }

  const {
    hook_event_name,
    session_id,
    cwd,
    tool_name,
    tool_use_id,
    tool_input,
    tool_response,
  } = p

  if (!hook_event_name || !session_id) return

  // Filter: only track these events
  const TRACKED_EVENTS = new Set([
    'SessionStart', 'SessionEnd',
    'PreToolUse', 'PostToolUse',
    'SubagentStart', 'SubagentStop',
  ])
  if (!TRACKED_EVENTS.has(hook_event_name)) return

  // For tool-use events: only track Agent and Workflow spawns
  if (hook_event_name === 'PreToolUse' || hook_event_name === 'PostToolUse') {
    if (tool_name !== 'Agent' && tool_name !== 'Workflow') return
  }

  // ── Resolve TEMP_ROOT ───────────────────────────────────────────────────────
  const projectRoot = cwd || process.cwd()
  let tempRoot = join(projectRoot, '.maestro')
  try {
    const cfg = JSON.parse(
      readFileSync(join(projectRoot, '.claude', 'maestro.json'), 'utf8'),
    )
    if (typeof cfg?.ai?.temp_root === 'string' && cfg.ai.temp_root.length > 0) {
      tempRoot = join(projectRoot, cfg.ai.temp_root)
    }
  } catch { /* not a Maestro project or no config — use default */ }

  // ── Ensure session directory ────────────────────────────────────────────────
  const sessionDir = join(tempRoot, 'podium', session_id)
  try { mkdirSync(sessionDir, { recursive: true }) } catch { return }
  const eventsFile = join(sessionDir, 'events.jsonl')

  // ── Build event ─────────────────────────────────────────────────────────────
  const ts = Date.now()
  let event = null

  if (hook_event_name === 'SessionStart') {
    event = {
      ts,
      type: 'session_start',
      session_id,
      cwd: projectRoot,
      model: p.model ?? null,
    }

  } else if (hook_event_name === 'SessionEnd') {
    event = {
      ts,
      type: 'session_end',
      session_id,
    }

  } else if (hook_event_name === 'PreToolUse') {
    // Agent or Workflow spawn — start marker
    const description = tool_input?.description ?? null
    const subagent_type = tool_input?.subagent_type ?? null
    const model = tool_input?.model ?? null
    // Cheap summary of prompt: first 300 chars (never the full prompt — too large)
    const prompt_preview = typeof tool_input?.prompt === 'string'
      ? tool_input.prompt.slice(0, 300)
      : null

    event = {
      ts,
      type: 'agent_start',
      session_id,
      tool_name,
      tool_use_id: tool_use_id ?? null,
      description,
      subagent_type,
      model,
      prompt_preview,
    }

  } else if (hook_event_name === 'PostToolUse') {
    // Agent or Workflow finished
    const responseText = typeof tool_response === 'string'
      ? tool_response
      : (tool_response != null ? JSON.stringify(tool_response) : null)

    event = {
      ts,
      type: 'agent_end',
      session_id,
      tool_name,
      tool_use_id: tool_use_id ?? null,
      status: 'success',
      output_preview: responseText ? responseText.slice(0, 400) : null,
    }

  } else if (hook_event_name === 'SubagentStart') {
    // Sub-agent session started — gives us agent name and type to enrich the agent_start
    event = {
      ts,
      type: 'subagent_meta',
      session_id,
      agent_id: p.agent_id ?? null,
      name: p.name ?? null,
      agent_type: p.agent_type ?? null,
    }

  } else if (hook_event_name === 'SubagentStop') {
    event = {
      ts,
      type: 'subagent_stop',
      session_id,
      agent_id: p.agent_id ?? null,
    }
  }

  // ── Append to JSONL ─────────────────────────────────────────────────────────
  if (event) {
    try {
      appendFileSync(eventsFile, JSON.stringify(event) + '\n')
    } catch { /* disk full or permissions — silent */ }
  }
}
