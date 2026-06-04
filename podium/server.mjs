#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const START_TIME = Date.now();
const POLL_INTERVAL_MS = 500;
const HEARTBEAT_INTERVAL_MS = 15000;
const RUN_END_GRACE_MS = 5000;

function parseArgs(argv) {
  const args = { port: 7337, tempRoot: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') {
      const value = Number(argv[++i]);
      if (Number.isFinite(value) && value > 0) args.port = value;
    } else if (arg.startsWith('--port=')) {
      const value = Number(arg.slice('--port='.length));
      if (Number.isFinite(value) && value > 0) args.port = value;
    } else if (arg === '--temp-root') {
      args.tempRoot = argv[++i];
    } else if (arg.startsWith('--temp-root=')) {
      args.tempRoot = arg.slice('--temp-root='.length);
    }
  }
  return args;
}

function resolveTempRoot(cliTempRoot) {
  if (cliTempRoot) return cliTempRoot;
  try {
    const configPath = path.join(process.cwd(), '.claude', 'maestro.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    const fromConfig = config?.ai?.temp_root;
    if (typeof fromConfig === 'string' && fromConfig.length > 0) return fromConfig;
  } catch {
    // Fall through to default.
  }
  return '.maestro';
}

const cliArgs = parseArgs(process.argv.slice(2));
const PORT = cliArgs.port;
const TEMP_ROOT = path.resolve(resolveTempRoot(cliArgs.tempRoot));
const PODIUM_DIR = path.join(TEMP_ROOT, 'podium');

function parseLines(text) {
  const events = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines.
    }
  }
  return events;
}

async function listEventFiles() {
  const files = [];
  let entries;
  try {
    entries = await fsp.readdir(PODIUM_DIR, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(PODIUM_DIR, entry.name, 'events.jsonl');
    try {
      await fsp.access(file);
      files.push(file);
    } catch {
      // No event file for this session.
    }
  }
  return files;
}

function deriveRunSummary(events, filePath) {
  if (events.length === 0) return null;

  // Session ID from directory name (most reliable source)
  const sessionId = path.basename(path.dirname(filePath));

  const sessionStart = events.find((e) => e?.type === 'session_start');
  const sessionEnd   = events.find((e) => e?.type === 'session_end');

  // Collect agents from agent_start events; enrich with subagent_meta when available.
  // Merge by tool_use_id: agent_start carries the description, subagent_meta carries name.
  const agentMap = new Map(); // tool_use_id → { description, subagent_type, name }
  const seenNames = new Set();
  for (const e of events) {
    if (e?.type === 'agent_start' && e.tool_use_id) {
      if (!agentMap.has(e.tool_use_id)) {
        agentMap.set(e.tool_use_id, { description: e.description, subagent_type: e.subagent_type, name: null });
      }
    }
    if (e?.type === 'subagent_meta' && e.name) {
      // The subagent_meta event doesn't carry tool_use_id directly; enrich the most recent
      // agent_start entry that doesn't yet have a name.
      for (const [, val] of agentMap) {
        if (!val.name) { val.name = e.name; break; }
      }
    }
  }

  const agents = [];
  for (const val of agentMap.values()) {
    const label = val.name || val.subagent_type || (val.description ? val.description.slice(0, 40) : null);
    if (label && !seenNames.has(label)) { seenNames.add(label); agents.push(label); }
  }

  const startedAt = sessionStart?.ts ?? events[0]?.ts ?? null;
  const endedAt   = sessionEnd?.ts ?? null;

  // Status: if session_end seen → done. Otherwise check if any agent is still running.
  let status = 'running';
  if (sessionEnd) {
    // Check for any failed agent_end
    const failedAgent = events.find((e) => e?.type === 'agent_end' && e.status === 'failed');
    status = failedAgent ? 'failed' : 'success';
  }

  // First agent description can serve as a run label when no issue title is known
  const firstAgent = events.find((e) => e?.type === 'agent_start');
  const runLabel = firstAgent?.description ?? null;

  return {
    run_id: sessionId,
    session_id: sessionId,
    issue_id: null,      // not available from hooks alone
    issue_title: runLabel,
    repo: null,          // not available from hooks alone
    branch: null,        // not available from hooks alone
    cwd: sessionStart?.cwd ?? null,
    status,
    started_at: startedAt,
    ended_at: endedAt,
    total_duration_ms: (startedAt != null && endedAt != null) ? endedAt - startedAt : null,
    event_count: events.length,
    agents,
  };
}

async function getRuns() {
  const files = await listEventFiles();
  const runs = [];
  for (const file of files) {
    try {
      const text = await fsp.readFile(file, 'utf8');
      const events = parseLines(text);
      const summary = deriveRunSummary(events, file);
      if (summary) runs.push(summary);
    } catch (err) {
      console.error(`Failed to read run file ${file}:`, err.message);
    }
  }
  runs.sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0));
  return runs;
}

function eventMatchesRunId(events, runId) {
  if (events.length === 0) return false;
  const first = events[0];
  const data = first?.data || first;
  const fileRunId =
    first?.run_id || data?.run_id;
  return fileRunId === runId;
}

async function findFileForRun(runId) {
  const files = await listEventFiles();
  // Fast path: session directory name match (session_id IS the dir name).
  for (const file of files) {
    if (path.basename(path.dirname(file)) === runId) {
      return file;
    }
  }
  for (const file of files) {
    try {
      const text = await fsp.readFile(file, 'utf8');
      const events = parseLines(text);
      if (eventMatchesRunId(events, runId)) return file;
    } catch {
      // Skip unreadable files.
    }
  }
  return null;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleIndex(res) {
  const indexPath = path.join(__dirname, 'index.html');
  try {
    const html = await fsp.readFile(indexPath, 'utf8');
    res.writeHead(200, {
      ...CORS_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
    });
    res.end(html);
  } catch {
    res.writeHead(500, {
      ...CORS_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
    });
    res.end(
      `<!doctype html><html><body style="background:#0d1117;color:#e6edf3;font-family:system-ui;padding:2rem">
        <h1>Podium</h1>
        <p style="color:#f85149">Could not load <code>index.html</code>.</p>
        <p style="color:#7d8590">Expected at: <code>${indexPath}</code></p>
        <p style="color:#7d8590">The server is running. The dashboard UI file is missing.</p>
      </body></html>`
    );
  }
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function handleSse(req, res, runId) {
  const file = await findFileForRun(runId);
  if (!file) {
    sendJson(res, 404, { error: 'run not found' });
    return;
  }

  res.writeHead(200, {
    ...CORS_HEADERS,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let offset = 0;
  let buffer = '';
  let closed = false;
  let runEndSeen = false;
  let pollTimer = null;
  let heartbeatTimer = null;
  let graceTimer = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (pollTimer) clearTimeout(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (graceTimer) clearTimeout(graceTimer);
    try {
      res.end();
    } catch {
      // Already closed.
    }
  };

  req.on('close', cleanup);
  res.on('error', cleanup);

  const emitEvents = (events) => {
    for (const event of events) {
      if (closed) return;
      writeSse(res, 'event', event);
      if (event?.type === 'run_end' && !runEndSeen) {
        runEndSeen = true;
        graceTimer = setTimeout(cleanup, RUN_END_GRACE_MS);
      }
    }
  };

  const readNew = async () => {
    if (closed) return [];
    let chunk;
    try {
      const handle = await fsp.open(file, 'r');
      try {
        const stat = await handle.stat();
        if (stat.size <= offset) return [];
        const length = stat.size - offset;
        const buf = Buffer.alloc(length);
        await handle.read(buf, 0, length, offset);
        offset = stat.size;
        chunk = buf.toString('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      return [];
    }
    buffer += chunk;
    const events = [];
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // Skip malformed line.
      }
    }
    return events;
  };

  // Initial read of all existing events.
  const initial = await readNew();
  if (closed) return;
  writeSse(res, 'connected', { run_id: runId, event_count: initial.length });
  emitEvents(initial);

  heartbeatTimer = setInterval(() => {
    if (closed) return;
    res.write('event: ping\ndata: {}\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  const poll = async () => {
    if (closed) return;
    const events = await readNew();
    if (events.length > 0) emitEvents(events);
    if (closed) return;
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  };
  pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
}

async function handleSnapshot(res, runId) {
  const file = await findFileForRun(runId);
  if (!file) {
    sendJson(res, 404, { error: 'run not found' });
    return;
  }
  try {
    const text = await fsp.readFile(file, 'utf8');
    sendJson(res, 200, parseLines(text));
  } catch (err) {
    console.error(`Failed to read snapshot for ${runId}:`, err.message);
    sendJson(res, 500, { error: 'failed to read events' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      sendJson(res, 404, { error: 'not found' });
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      await handleIndex(res);
      return;
    }

    if (pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        port: PORT,
        temp_root: TEMP_ROOT,
        podium_dir: PODIUM_DIR,
        uptime_ms: Date.now() - START_TIME,
      });
      return;
    }

    if (pathname === '/api/runs') {
      const runs = await getRuns();
      sendJson(res, 200, runs);
      return;
    }

    if (pathname === '/api/events') {
      const runId = url.searchParams.get('run_id');
      if (!runId) {
        sendJson(res, 400, { error: 'run_id required' });
        return;
      }
      if (url.searchParams.get('snapshot') === '1') {
        await handleSnapshot(res, runId);
      } else {
        await handleSse(req, res, runId);
      }
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('Request handler error:', err.message);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'internal server error' });
    } else {
      try {
        res.end();
      } catch {
        // Already closed.
      }
    }
  }
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
});

server.listen(PORT, () => {
  console.log(`Podium running at http://localhost:${PORT}`);
  console.log(`Watching ${TEMP_ROOT} for pipeline runs`);
});

function shutdown() {
  console.log('Shutting down Podium...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err?.message ?? err);
});
