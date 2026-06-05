#!/usr/bin/env node
// Podium backend — reads JSONL event files written by podium/hook.mjs and serves
// them over REST + SSE. Built with Express, but file watching uses pure Node
// built-ins (polling). No dependencies beyond express.

import express from 'express'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(APP_ROOT, 'dist')
const ASSETS_DIR = path.join(DIST_DIR, 'assets')
const INDEX_HTML = path.join(DIST_DIR, 'index.html')

const START_TIME = Date.now()
const POLL_INTERVAL_MS = 500
const HEARTBEAT_INTERVAL_MS = 15000
const SESSION_END_GRACE_MS = 5000

// ── CLI args ───────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { port: 7337, tempRoot: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port') {
      const v = Number(argv[++i])
      if (Number.isFinite(v) && v > 0) args.port = v
    } else if (arg.startsWith('--port=')) {
      const v = Number(arg.slice('--port='.length))
      if (Number.isFinite(v) && v > 0) args.port = v
    } else if (arg === '--temp-root') {
      args.tempRoot = argv[++i]
    } else if (arg.startsWith('--temp-root=')) {
      args.tempRoot = arg.slice('--temp-root='.length)
    }
  }
  return args
}

function resolveTempRoot(cliTempRoot) {
  if (cliTempRoot) return cliTempRoot
  try {
    const configPath = path.join(process.cwd(), '.claude', 'maestro.json')
    const raw = fs.readFileSync(configPath, 'utf8')
    const config = JSON.parse(raw)
    const fromConfig = config?.ai?.temp_root
    if (typeof fromConfig === 'string' && fromConfig.length > 0) return fromConfig
  } catch {
    // Fall through to default.
  }
  return '.maestro'
}

const cliArgs = parseArgs(process.argv.slice(2))
const PORT = cliArgs.port
const TEMP_ROOT = path.resolve(resolveTempRoot(cliArgs.tempRoot))
const PODIUM_DIR = path.join(TEMP_ROOT, 'podium')

// ── JSONL parsing ────────────────────────────────────────────────────────────
function parseLines(text) {
  const events = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      events.push(JSON.parse(trimmed))
    } catch {
      // Skip malformed lines.
    }
  }
  return events
}

async function readEvents(filePath) {
  let text
  try {
    text = await fsp.readFile(filePath, 'utf8')
  } catch {
    return []
  }
  return parseLines(text)
}

// Resolve the events.jsonl path for a given session id.
function eventFileForSession(sessionId) {
  return path.join(PODIUM_DIR, sessionId, 'events.jsonl')
}

async function listSessionDirs() {
  let entries
  try {
    entries = await fsp.readdir(PODIUM_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  const sessions = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const file = path.join(PODIUM_DIR, entry.name, 'events.jsonl')
    try {
      await fsp.access(file)
      sessions.push({ sessionId: entry.name, file })
    } catch {
      // No events file for this session directory.
    }
  }
  return sessions
}

// ── Labeling (mirrors the event-processor logic) ──────────────────────────────
const CATEGORY_PRIORITY = ['agent', 'write', 'shell', 'read', 'web', 'other']

function basename(p) {
  if (typeof p !== 'string' || p.length === 0) return null
  const cleaned = p.replace(/[\\/]+$/, '')
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'))
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned
}

// Extract a filename from a write tool's summary. The hook summarises Write/Edit
// tools with the file path, so we take the last path segment if present.
function filenameFromSummary(summary) {
  if (typeof summary !== 'string' || summary.length === 0) return null
  // Grab the first whitespace-delimited token that looks like a path.
  const tokens = summary.split(/\s+/)
  for (const tok of tokens) {
    if (tok.includes('/') || tok.includes('\\') || /\.[A-Za-z0-9]+$/.test(tok)) {
      const name = basename(tok)
      if (name) return name
    }
  }
  return basename(summary)
}

// Derive the label of the first turn from its tool_start events.
function deriveFirstLabel(firstTurnTools) {
  if (firstTurnTools.length === 0) return null

  const counts = { agent: 0, write: 0, shell: 0, read: 0, web: 0, other: 0 }
  for (const t of firstTurnTools) {
    const cat = t.category && counts[t.category] !== undefined ? t.category : 'other'
    counts[cat]++
  }

  let dominant = 'other'
  for (const cat of CATEGORY_PRIORITY) {
    if (counts[cat] > 0) { dominant = cat; break }
  }

  switch (dominant) {
    case 'agent': {
      const n = counts.agent
      return `Spawning ${n} agent${n === 1 ? '' : 's'}`
    }
    case 'write': {
      const firstWrite = firstTurnTools.find((t) => t.category === 'write')
      const filename = filenameFromSummary(firstWrite?.summary)
      return filename ? `Writing ${filename}` : 'Writing files'
    }
    case 'shell': {
      const firstShell = firstTurnTools.find((t) => t.category === 'shell')
      const summary = typeof firstShell?.summary === 'string' && firstShell.summary.length > 0
        ? firstShell.summary
        : null
      return summary || 'Running commands'
    }
    case 'read':
      return 'Reading files'
    case 'web':
      return 'Web search'
    default:
      return 'Working'
  }
}

// ── Session summary derivation ────────────────────────────────────────────────
function deriveSummary(events, sessionId) {
  if (events.length === 0) {
    return {
      run_id: sessionId,
      session_id: sessionId,
      cwd: null,
      status: 'running',
      started_at: null,
      ended_at: null,
      total_duration_ms: null,
      event_count: 0,
      turn_count: 0,
      agents: [],
      first_prompt: null,
      first_label: null,
    }
  }

  const sessionStart = events.find((e) => e?.type === 'session_start')
  const sessionEnd = events.find((e) => e?.type === 'session_end')

  const startedAt = sessionStart?.ts ?? events[0]?.ts ?? null
  const endedAt = sessionEnd?.ts ?? null

  // Status: running until session_end; then success unless any agent/tool failed.
  let status = 'running'
  if (sessionEnd) {
    if (typeof sessionEnd.status === 'string' &&
        (sessionEnd.status === 'success' || sessionEnd.status === 'failed')) {
      status = sessionEnd.status
    } else {
      const failed = events.some(
        (e) => (e?.type === 'tool_end' || e?.type === 'agent_end') && e.status === 'failed',
      )
      status = failed ? 'failed' : 'success'
    }
  }

  // Turn count: number of turn_start events.
  const turnCount = events.filter((e) => e?.type === 'turn_start').length

  // Agents: unique subagent_type from tool_start where tool_name is Agent/Workflow.
  const agentSet = new Set()
  for (const e of events) {
    if (e?.type === 'tool_start' &&
        (e.tool_name === 'Agent' || e.tool_name === 'Workflow')) {
      const t = e.subagent_type
      if (typeof t === 'string' && t.length > 0) agentSet.add(t)
    }
  }
  const agents = Array.from(agentSet)

  // First prompt: the user's actual message from the first turn_start event.
  const firstTurnEvent = events.find((e) => e?.type === 'turn_start')
  const firstPromptRaw = firstTurnEvent?.prompt_preview ?? firstTurnEvent?.prompt ?? null
  const firstPrompt = typeof firstPromptRaw === 'string' && firstPromptRaw.trim().length > 0
    ? firstPromptRaw.trim()
    : null

  // First label: tool_start events belonging to the first turn (before the second
  // turn_start, if any).
  const firstTurnIdx = events.findIndex((e) => e?.type === 'turn_start')
  let firstTurnTools = []
  if (firstTurnIdx >= 0) {
    for (let i = firstTurnIdx + 1; i < events.length; i++) {
      const e = events[i]
      if (e?.type === 'turn_start') break
      if (e?.type === 'tool_start') firstTurnTools.push(e)
    }
  } else {
    // No turn_start at all — fall back to all tool_start events.
    firstTurnTools = events.filter((e) => e?.type === 'tool_start')
  }
  const firstLabel = deriveFirstLabel(firstTurnTools)

  return {
    run_id: sessionId,
    session_id: sessionId,
    cwd: sessionStart?.cwd ?? null,
    status,
    started_at: startedAt,
    ended_at: endedAt,
    total_duration_ms: (startedAt != null && endedAt != null) ? endedAt - startedAt : null,
    event_count: events.length,
    turn_count: turnCount,
    agents,
    first_prompt: firstPrompt,
    first_label: firstLabel,
  }
}

// ── Express app ────────────────────────────────────────────────────────────────
const app = express()
app.disable('x-powered-by')

// CORS on every route.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Last-Event-ID')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
})

// ── GET /health ────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    port: PORT,
    temp_root: TEMP_ROOT,
    podium_dir: PODIUM_DIR,
    uptime_ms: Date.now() - START_TIME,
  })
})

// ── GET /api/sessions ────────────────────────────────────────────────────────
app.get('/api/sessions', async (req, res) => {
  try {
    const dirs = await listSessionDirs()
    const summaries = []
    for (const { sessionId, file } of dirs) {
      const events = await readEvents(file)
      summaries.push(deriveSummary(events, sessionId))
    }
    summaries.sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))
    res.json(summaries)
  } catch (err) {
    res.status(500).json({ error: 'failed_to_list_sessions', message: String(err?.message ?? err) })
  }
})

// ── GET /api/sessions/:id/events ───────────────────────────────────────────────
// snapshot=1 → JSON array of raw events.
// otherwise   → SSE stream (existing events + live tail).
app.get('/api/sessions/:id/events', async (req, res) => {
  const sessionId = req.params.id
  const file = eventFileForSession(sessionId)

  if (req.query.snapshot === '1') {
    const events = await readEvents(file)
    res.json(events)
    return
  }

  // ── SSE ──────────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  let closed = false
  let pollTimer = null
  let heartbeatTimer = null
  let endGraceTimer = null
  let offset = 0
  // Carries a partial trailing line between polls (in case a write lands mid-line).
  let pending = ''
  let sessionEndSeen = false

  const send = (eventName, dataObj) => {
    if (closed) return
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(dataObj)}\n\n`)
    } catch {
      cleanup()
    }
  }

  const cleanup = () => {
    if (closed) return
    closed = true
    if (pollTimer) clearInterval(pollTimer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (endGraceTimer) clearTimeout(endGraceTimer)
    try { res.end() } catch { /* already gone */ }
  }

  // Process a chunk of newly-read text, emitting one SSE message per complete event.
  const processChunk = (chunk) => {
    pending += chunk
    let nlIdx
    while ((nlIdx = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, nlIdx)
      pending = pending.slice(nlIdx + 1)
      const trimmed = line.trim()
      if (!trimmed) continue
      let evt
      try {
        evt = JSON.parse(trimmed)
      } catch {
        continue
      }
      send('event', evt)
      if (evt?.type === 'session_end') sessionEndSeen = true
    }
  }

  // Read bytes from `offset` to EOF, advancing the offset.
  const readNew = async () => {
    if (closed) return
    let stat
    try {
      stat = await fsp.stat(file)
    } catch {
      // File not (yet) present — nothing to read.
      return
    }
    // Handle truncation/rotation: restart from the beginning.
    if (stat.size < offset) {
      offset = 0
      pending = ''
    }
    if (stat.size <= offset) return

    await new Promise((resolve) => {
      const stream = fs.createReadStream(file, {
        encoding: 'utf8',
        start: offset,
        end: stat.size - 1,
      })
      stream.on('data', (chunk) => processChunk(chunk))
      stream.on('end', () => {
        offset = stat.size
        resolve()
      })
      stream.on('error', () => resolve())
    })
  }

  // 1–3. Initial read of all existing events, then a `connected` marker.
  try {
    const initialText = await fsp.readFile(file, 'utf8')
    offset = Buffer.byteLength(initialText, 'utf8')
    const events = parseLines(initialText)
    for (const evt of events) {
      send('event', evt)
      if (evt?.type === 'session_end') sessionEndSeen = true
    }
    send('connected', { session_id: sessionId, event_count: events.length })
  } catch {
    // No file yet — still connect so the client can wait for events to appear.
    offset = 0
    send('connected', { session_id: sessionId, event_count: 0 })
  }

  // If the session already ended, schedule the grace close now.
  if (sessionEndSeen) {
    endGraceTimer = setTimeout(cleanup, SESSION_END_GRACE_MS)
  }

  // 4. Poll for new lines every 500ms.
  pollTimer = setInterval(async () => {
    if (closed) return
    await readNew()
    if (sessionEndSeen && !endGraceTimer && !closed) {
      endGraceTimer = setTimeout(cleanup, SESSION_END_GRACE_MS)
    }
  }, POLL_INTERVAL_MS)

  // 5. Heartbeat every 15s.
  heartbeatTimer = setInterval(() => send('ping', {}), HEARTBEAT_INTERVAL_MS)

  // Client disconnect.
  req.on('close', cleanup)
  res.on('error', cleanup)
})

// ── Static React app ───────────────────────────────────────────────────────────
app.use('/assets', express.static(ASSETS_DIR, {
  fallthrough: true,
  index: false,
}))

// Serve other static files at the dist root (favicon, etc.) without SPA fallback.
app.use(express.static(DIST_DIR, {
  index: false,
  fallthrough: true,
}))

// SPA fallback for any non-API GET route.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path === '/health') {
    res.status(404).json({ error: 'not_found' })
    return
  }
  fs.access(INDEX_HTML, fs.constants.R_OK, (err) => {
    if (err) {
      res.status(404).type('text/plain').send(
        'Podium UI not built. Run `npm run build` in podium/app first.',
      )
      return
    }
    res.sendFile(INDEX_HTML)
  })
})

// ── Start + graceful shutdown ────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  process.stdout.write(
    `Podium server listening on http://localhost:${PORT}  (temp_root: ${TEMP_ROOT})\n`,
  )
})

let shuttingDown = false
function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  process.stdout.write(`\nReceived ${signal} — shutting down...\n`)
  server.close(() => process.exit(0))
  // Force exit if connections (e.g. SSE) keep the socket open too long.
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
