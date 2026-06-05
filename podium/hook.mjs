#!/usr/bin/env node
// podium/hook.mjs
// Zero-token Claude Code hook for Podium.
//
// Registered in .claude/settings.json for ALL hook events.
// Captures every tool call + session lifecycle, writing one JSONL line to:
//   {TEMP_ROOT}/podium/{session_id}/events.jsonl
//
// Events written:
//   session_start / session_end        — session lifecycle
//   turn_start                         — new user prompt (UserPromptSubmit)
//   tool_start / tool_end              — every tool use (Bash, Read, Write, Agent…)
//   subagent_meta / subagent_stop      — sub-agent identity enrichment
//
// Hard exit deadline: 1 500 ms (well inside Claude Code's 2 s kill timeout).

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import http from 'node:http'

/**
 * Fire-and-forget POST to the Podium dashboard server.
 * Never blocks — if the server is not running, silently fails.
 */
function postToDashboard(hookType, data) {
  try {
    const payload = JSON.stringify({ hook_type: hookType, data })
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4820,
      path: '/api/hooks/event',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    })
    req.setTimeout(1000, () => req.destroy())
    req.on('error', () => {}) // silent — server may not be running
    req.write(payload)
    req.end()
  } catch { /* silent */ }
}

// Returns the value if it's a non-empty string, otherwise null.
function asString(v) {
  return typeof v === 'string' && v.length > 0 ? v : null
}

// ── Safety deadline ───────────────────────────────────────────────────────────
const DEADLINE = setTimeout(() => process.exit(0), 1_500)
DEADLINE.unref()

// ── Tool input summarisers — keep payloads small ──────────────────────────────
// Returns a short human-readable label for a tool call.
function summariseTool(tool_name, tool_input) {
  if (!tool_input) return null
  switch (tool_name) {
    case 'Bash':
      return typeof tool_input.command === 'string'
        ? tool_input.command.slice(0, 120)
        : null
    case 'Read':
      return tool_input.file_path ?? null
    case 'Write':
      return tool_input.file_path ?? null
    case 'Edit':
      return tool_input.file_path ?? null
    case 'Glob':
      return tool_input.pattern ?? null
    case 'Grep':
      return `${tool_input.pattern ?? ''}${tool_input.path ? ' in ' + tool_input.path : ''}`
    case 'Agent':
    case 'Workflow':
      return tool_input.description ?? tool_input.prompt?.slice(0, 100) ?? null
    case 'WebFetch':
      return tool_input.url ?? null
    case 'WebSearch':
      return tool_input.query ?? null
    default:
      // Generic: first string value found in input
      for (const v of Object.values(tool_input)) {
        if (typeof v === 'string' && v.length > 0) return v.slice(0, 120)
      }
      return null
  }
}

// Tool category — used by the graph layer to group and colour nodes
function categoryOf(tool_name) {
  const MAP = {
    Bash: 'shell',
    Read: 'read', Write: 'write', Edit: 'write', NotebookEdit: 'write',
    Glob: 'read', Grep: 'read',
    Agent: 'agent', Workflow: 'agent', Task: 'agent',
    WebFetch: 'web', WebSearch: 'web',
  }
  return MAP[tool_name] ?? 'other'
}

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
  } catch { /* not a Maestro project — use default */ }

  // ── Ensure session directory ────────────────────────────────────────────────
  const sessionDir = join(tempRoot, 'podium', session_id)
  try { mkdirSync(sessionDir, { recursive: true }) } catch { return }
  const eventsFile = join(sessionDir, 'events.jsonl')

  // ── Build event ─────────────────────────────────────────────────────────────
  const ts = Date.now()
  let event = null

  switch (hook_event_name) {

    case 'SessionStart': {
      const transcriptPath = asString(p.transcript_path)
      event = {
        ts,
        type: 'session_start',
        session_id,
        cwd: projectRoot,
        model: p.model ?? null,
        transcript_path: transcriptPath,
      }
      // Also persist a session-meta.json so the server can locate the transcript
      // without re-deriving it. Idempotent overwrite.
      try {
        const meta = {
          session_id,
          transcript_path: transcriptPath,
          cwd: projectRoot,
          model: asString(p.model),
          started_at: ts,
        }
        writeFileSync(
          join(sessionDir, 'session-meta.json'),
          JSON.stringify(meta, null, 2),
          { flag: 'w' },
        )
      } catch { /* silent — never crash Claude Code */ }
      break
    }

    case 'SessionEnd':
      event = { ts, type: 'session_end', session_id }
      break

    case 'UserPromptSubmit':
      // Marks the start of a new reasoning "turn" — used by graph layer to group tool calls
      event = {
        ts,
        type: 'turn_start',
        session_id,
        // First 200 chars of the user message — enough to label the turn in the graph
        prompt_preview: typeof p.message === 'string'
          ? p.message.slice(0, 200)
          : (typeof p.prompt === 'string' ? p.prompt.slice(0, 200) : null),
      }
      break

    case 'PreToolUse':
      event = {
        ts,
        type: 'tool_start',
        session_id,
        tool_name,
        tool_use_id: tool_use_id ?? null,
        category: categoryOf(tool_name),
        summary: summariseTool(tool_name, tool_input),
        // Extra context for agent spawns
        ...(tool_name === 'Agent' || tool_name === 'Workflow' ? {
          subagent_type: tool_input?.subagent_type ?? null,
          model: tool_input?.model ?? null,
        } : {}),
      }
      break

    case 'PostToolUse': {
      // Keep output small — just enough to know what happened
      const out = typeof tool_response === 'string'
        ? tool_response.slice(0, 300)
        : (tool_response != null ? JSON.stringify(tool_response).slice(0, 300) : null)
      event = {
        ts,
        type: 'tool_end',
        session_id,
        tool_name,
        tool_use_id: tool_use_id ?? null,
        category: categoryOf(tool_name),
        status: 'success',
        output_preview: out,
      }
      break
    }

    case 'PostToolUseFailure': {
      const err = typeof p.error === 'string' ? p.error.slice(0, 300) : null
      event = {
        ts,
        type: 'tool_end',
        session_id,
        tool_name,
        tool_use_id: tool_use_id ?? null,
        category: categoryOf(tool_name),
        status: 'failed',
        error: err,
      }
      break
    }

    case 'SubagentStart':
      // Fired in the parent session when a sub-agent's session begins
      event = {
        ts,
        type: 'subagent_meta',
        session_id,
        agent_id: p.agent_id ?? null,
        name: p.name ?? null,
        agent_type: p.agent_type ?? null,
      }
      break

    case 'SubagentStop':
      event = { ts, type: 'subagent_stop', session_id, agent_id: p.agent_id ?? null }
      break

    default:
      return // ignore everything else
  }

  // ── Append to JSONL ─────────────────────────────────────────────────────────
  if (event) {
    try {
      appendFileSync(eventsFile, JSON.stringify(event) + '\n')
    } catch { /* disk full or permissions — silent */ }
  }

  // ── Forward full payload to Podium dashboard (fire-and-forget) ───────────────
  postToDashboard(p.hook_event_name, p)
}
