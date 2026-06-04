import { RawEvent, Session, Turn, ToolCall, ToolCategory, SessionStatus, ItemStatus, AgentPipelineStep } from '../types'
import { labelTurn } from './labeler'

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID.
  return 'tc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ReadMcpResourceTool'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch'])
const AGENT_TOOLS = new Set(['Agent', 'Workflow', 'Task'])

/** Map a tool name to a ToolCategory. Prefers an explicit category on the event. */
function categorize(toolName: string, explicit?: unknown): ToolCategory {
  if (
    explicit === 'shell' ||
    explicit === 'read' ||
    explicit === 'write' ||
    explicit === 'agent' ||
    explicit === 'web' ||
    explicit === 'other'
  ) {
    return explicit
  }
  if (!toolName) return 'other'
  if (toolName === 'Bash' || toolName === 'BashOutput' || toolName === 'KillShell') return 'shell'
  if (AGENT_TOOLS.has(toolName)) return 'agent'
  if (WRITE_TOOLS.has(toolName)) return 'write'
  if (READ_TOOLS.has(toolName)) return 'read'
  if (WEB_TOOLS.has(toolName)) return 'web'
  return 'other'
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function toolUseId(ev: RawEvent): string | null {
  return (
    asString(ev.tool_use_id) ||
    asString((ev as Record<string, unknown>).toolUseId) ||
    null
  )
}

function isStatus(v: unknown): v is ItemStatus {
  return v === 'running' || v === 'success' || v === 'failed'
}

// ── Internal event-bucketing ───────────────────────────────────────────────────

interface TurnBucket {
  turn_start?: RawEvent
  events: RawEvent[]
}

/**
 * Build ToolCall objects from a flat list of events belonging to one turn.
 * Pairs tool_start / tool_end events by tool_use_id (falling back to order).
 */
function buildToolCalls(events: RawEvent[]): ToolCall[] {
  const order: string[] = [] // ordered keys for deterministic output
  const calls = new Map<string, ToolCall>()
  // Track pending starts without ids so we can pair the next end by order.
  const danglingStarts: string[] = []

  for (const ev of events) {
    if (ev.type === 'tool_start') {
      const id = toolUseId(ev) || genId()
      const toolName = asString(ev.tool_name) || 'unknown'
      const call: ToolCall = {
        id,
        tool_name: toolName,
        category: categorize(toolName, ev.category),
        summary: asString(ev.summary),
        started_at: ev.ts,
        ended_at: null,
        duration_ms: null,
        status: 'running',
        output_preview: null,
        error: null,
        subagent_type: asString(ev.subagent_type),
        model: asString(ev.model),
      }
      calls.set(id, call)
      order.push(id)
      if (!toolUseId(ev)) danglingStarts.push(id)
    } else if (ev.type === 'tool_end') {
      const tid = toolUseId(ev)
      let target: ToolCall | undefined
      if (tid && calls.has(tid)) {
        target = calls.get(tid)
      } else {
        // No id match — pair with the oldest dangling start, if any.
        const key = danglingStarts.shift()
        if (key) target = calls.get(key)
      }
      if (target) {
        target.ended_at = ev.ts
        target.duration_ms = ev.ts - target.started_at
        target.status = isStatus(ev.status) ? ev.status : 'success'
        target.output_preview = asString(ev.output_preview)
        target.error = asString(ev.error)
        // Remove from dangling set if it was there.
        const di = danglingStarts.indexOf(target.id)
        if (di !== -1) danglingStarts.splice(di, 1)
      }
    } else if (ev.type === 'subagent_meta') {
      // Enrich the most recent agent spawn lacking metadata (proximity match).
      const subagentType = asString(ev.subagent_type)
      const model = asString(ev.model)
      for (let i = order.length - 1; i >= 0; i--) {
        const c = calls.get(order[i])!
        const isAgent = AGENT_TOOLS.has(c.tool_name)
        if (isAgent && (!c.subagent_type || !c.model)) {
          if (subagentType && !c.subagent_type) c.subagent_type = subagentType
          if (model && !c.model) c.model = model
          break
        }
      }
    }
  }

  return order.map((k) => calls.get(k)!)
}

function assembleTurn(bucket: TurnBucket, index: number): Turn {
  const ts = bucket.turn_start
  const startedAt = ts ? ts.ts : bucket.events.length > 0 ? bucket.events[0].ts : 0
  const toolCalls = buildToolCalls(bucket.events)

  const agentSpawns = toolCalls.filter(
    (t) => t.tool_name === 'Agent' || t.tool_name === 'Workflow',
  )

  const { label, icon, category } = labelTurn(toolCalls)

  const anyRunning = toolCalls.some((t) => t.status === 'running')
  const status: Turn['status'] = anyRunning ? 'running' : 'done'

  // ended_at = max ended_at among tool calls (null if any unfinished).
  let endedAt: number | null = null
  if (!anyRunning && toolCalls.length > 0) {
    endedAt = toolCalls.reduce<number>((max, t) => {
      const e = t.ended_at ?? t.started_at
      return e > max ? e : max
    }, startedAt)
  }

  const promptPreview = ts
    ? asString(ts.prompt_preview) || asString(ts.prompt)
    : null

  return {
    id: `turn-${index}`,
    turn_index: index,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: endedAt != null ? endedAt - startedAt : null,
    prompt_preview: promptPreview,
    label,
    icon,
    category,
    tool_calls: toolCalls,
    agent_spawns: agentSpawns,
    status,
  }
}

/**
 * Partition the (non session_start/session_end) events into turn buckets.
 * `turn_start` events act as dividers. Events before the first divider form
 * an implicit Turn 0.
 */
function bucketTurns(events: RawEvent[]): TurnBucket[] {
  const buckets: TurnBucket[] = []
  let current: TurnBucket | null = null

  for (const ev of events) {
    if (ev.type === 'turn_start') {
      current = { turn_start: ev, events: [] }
      buckets.push(current)
      continue
    }
    if (ev.type === 'session_start' || ev.type === 'session_end') continue
    if (!current) {
      // Implicit Turn 0 — events arriving before any turn_start.
      current = { events: [] }
      buckets.push(current)
    }
    current.events.push(ev)
  }

  return buckets
}

// ── Public API ──────────────────────────────────────────────────────────────────

export function processEvents(events: RawEvent[], sessionId: string): Session {
  const sorted = [...events].sort((a, b) => a.ts - b.ts)

  const startEv = sorted.find((e) => e.type === 'session_start')
  const endEv = sorted.find((e) => e.type === 'session_end')

  const cwd = startEv ? asString(startEv.cwd) : null
  const model = startEv ? asString(startEv.model) : null
  const startedAt = startEv ? startEv.ts : sorted.length > 0 ? sorted[0].ts : 0

  const buckets = bucketTurns(sorted)
  const turns = buckets.map((b, i) => assembleTurn(b, i))

  const anyRunningTurn = turns.some((t) => t.status === 'running')

  let status: SessionStatus
  let endedAt: number | null
  if (endEv) {
    const s = endEv.status
    status = s === 'success' || s === 'failed' || s === 'running' ? s : 'success'
    endedAt = endEv.ts
  } else {
    status = 'running'
    endedAt = null
  }
  // A session with a finished session_end but still-running turns is anomalous;
  // trust session_end's verdict but keep ended_at consistent.
  if (!endEv && !anyRunningTurn) {
    status = 'running'
  }

  const totalToolCalls = turns.reduce((n, t) => n + t.tool_calls.length, 0)
  const totalAgentSpawns = turns.reduce((n, t) => n + t.agent_spawns.length, 0)

  const { pipeline, isOrchestratorMode } = buildAgentPipeline(turns)

  return {
    id: sessionId,
    cwd,
    model,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: endedAt != null ? endedAt - startedAt : null,
    status,
    turns,
    total_tool_calls: totalToolCalls,
    total_agent_spawns: totalAgentSpawns,
    agent_pipeline: pipeline,
    is_orchestrator_mode: isOrchestratorMode,
  }
}

/**
 * Incremental update: fold new raw events into an existing processed Session.
 * Reconstructs by replaying — but only re-buckets the tail. For correctness and
 * simplicity we re-derive turns from the merged raw stream we keep alongside.
 *
 * Since the processed Session does not retain raw events, we take a pragmatic
 * approach: apply each new event to the live structure directly.
 */
export function appendEvents(session: Session, newEvents: RawEvent[]): Session {
  if (!newEvents || newEvents.length === 0) return session

  // Work on shallow clones so React/Zustand detect a new reference.
  const turns = session.turns.map((t) => ({
    ...t,
    tool_calls: [...t.tool_calls],
    agent_spawns: [...t.agent_spawns],
  }))

  let cwd = session.cwd
  let model = session.model
  let startedAt = session.started_at
  let status = session.status
  let endedAt = session.ended_at

  // Idempotency guards: re-applying a snapshot (selectSession already processed
  // it, and useSSE replays it on connect) must not duplicate turns or tool calls.
  const seenToolIds = new Set<string>()
  const seenTurnStarts = new Set<number>()
  for (const t of turns) {
    seenTurnStarts.add(t.started_at)
    for (const c of t.tool_calls) seenToolIds.add(c.id)
  }

  const sorted = [...newEvents].sort((a, b) => a.ts - b.ts)

  for (const ev of sorted) {
    switch (ev.type) {
      case 'session_start': {
        if (cwd == null) cwd = asString(ev.cwd)
        if (model == null) model = asString(ev.model)
        if (!startedAt) startedAt = ev.ts
        break
      }
      case 'session_end': {
        const s = ev.status
        status = s === 'success' || s === 'failed' || s === 'running' ? s : 'success'
        endedAt = ev.ts
        break
      }
      case 'turn_start': {
        // Skip a turn_start we've already materialized (dedup on timestamp).
        if (seenTurnStarts.has(ev.ts)) break
        seenTurnStarts.add(ev.ts)
        const index = turns.length
        const newTurn: Turn = {
          id: `turn-${index}`,
          turn_index: index,
          started_at: ev.ts,
          ended_at: null,
          duration_ms: null,
          prompt_preview: asString(ev.prompt_preview) || asString(ev.prompt),
          label: 'Processing',
          icon: '⚡',
          category: 'other',
          tool_calls: [],
          agent_spawns: [],
          status: 'running',
        }
        turns.push(newTurn)
        break
      }
      case 'tool_start': {
        const existingId = toolUseId(ev)
        // Skip a tool_start we've already recorded (dedup on tool_use_id).
        if (existingId && seenToolIds.has(existingId)) break
        const turn = ensureTurn(turns, ev.ts)
        const id = existingId || genId()
        seenToolIds.add(id)
        const toolName = asString(ev.tool_name) || 'unknown'
        const call: ToolCall = {
          id,
          tool_name: toolName,
          category: categorize(toolName, ev.category),
          summary: asString(ev.summary),
          started_at: ev.ts,
          ended_at: null,
          duration_ms: null,
          status: 'running',
          output_preview: null,
          error: null,
          subagent_type: asString(ev.subagent_type),
          model: asString(ev.model),
        }
        turn.tool_calls.push(call)
        if (call.tool_name === 'Agent' || call.tool_name === 'Workflow') {
          turn.agent_spawns.push(call)
        }
        recomputeTurn(turn)
        break
      }
      case 'tool_end': {
        const tid = toolUseId(ev)
        const target = findToolCall(turns, tid)
        if (target) {
          target.ended_at = ev.ts
          target.duration_ms = ev.ts - target.started_at
          target.status = isStatus(ev.status) ? ev.status : 'success'
          target.output_preview = asString(ev.output_preview)
          target.error = asString(ev.error)
          const turn = turns.find((t) => t.tool_calls.includes(target))
          if (turn) recomputeTurn(turn)
        }
        break
      }
      case 'subagent_meta': {
        const subagentType = asString(ev.subagent_type)
        const model2 = asString(ev.model)
        // Enrich the most recent agent spawn lacking metadata.
        outer: for (let i = turns.length - 1; i >= 0; i--) {
          const t = turns[i]
          for (let j = t.tool_calls.length - 1; j >= 0; j--) {
            const c = t.tool_calls[j]
            const isAgent = c.tool_name === 'Agent' || c.tool_name === 'Workflow' || c.tool_name === 'Task'
            if (isAgent && (!c.subagent_type || !c.model)) {
              if (subagentType && !c.subagent_type) c.subagent_type = subagentType
              if (model2 && !c.model) c.model = model2
              recomputeTurn(t)
              break outer
            }
          }
        }
        break
      }
      default:
        break
    }
  }

  const anyRunningTurn = turns.some((t) => t.status === 'running')
  if (!endedAt) {
    status = 'running'
  }
  void anyRunningTurn

  const totalToolCalls = turns.reduce((n, t) => n + t.tool_calls.length, 0)
  const totalAgentSpawns = turns.reduce((n, t) => n + t.agent_spawns.length, 0)

  const { pipeline, isOrchestratorMode } = buildAgentPipeline(turns)

  return {
    ...session,
    cwd,
    model,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: endedAt != null ? endedAt - startedAt : null,
    status,
    turns,
    total_tool_calls: totalToolCalls,
    total_agent_spawns: totalAgentSpawns,
    agent_pipeline: pipeline,
    is_orchestrator_mode: isOrchestratorMode,
  }
}

// ── Incremental helpers ─────────────────────────────────────────────────────────

function ensureTurn(turns: Turn[], ts: number): Turn {
  if (turns.length === 0) {
    const turn: Turn = {
      id: 'turn-0',
      turn_index: 0,
      started_at: ts,
      ended_at: null,
      duration_ms: null,
      prompt_preview: null,
      label: 'Processing',
      icon: '⚡',
      category: 'other',
      tool_calls: [],
      agent_spawns: [],
      status: 'running',
    }
    turns.push(turn)
    return turn
  }
  return turns[turns.length - 1]
}

function findToolCall(turns: Turn[], tid: string | null): ToolCall | undefined {
  if (tid) {
    for (let i = turns.length - 1; i >= 0; i--) {
      const c = turns[i].tool_calls.find((tc) => tc.id === tid)
      if (c) return c
    }
    return undefined
  }
  // No id — match the most recent still-running tool call.
  for (let i = turns.length - 1; i >= 0; i--) {
    for (let j = turns[i].tool_calls.length - 1; j >= 0; j--) {
      if (turns[i].tool_calls[j].status === 'running') return turns[i].tool_calls[j]
    }
  }
  return undefined
}

function recomputeTurn(turn: Turn): void {
  const { label, icon, category } = labelTurn(turn.tool_calls)
  turn.label = label
  turn.icon = icon
  turn.category = category

  turn.agent_spawns = turn.tool_calls.filter(
    (t) => t.tool_name === 'Agent' || t.tool_name === 'Workflow',
  )

  const anyRunning = turn.tool_calls.some((t) => t.status === 'running')
  turn.status = anyRunning ? 'running' : 'done'

  if (!anyRunning && turn.tool_calls.length > 0) {
    const endedAt = turn.tool_calls.reduce<number>((max, t) => {
      const e = t.ended_at ?? t.started_at
      return e > max ? e : max
    }, turn.started_at)
    turn.ended_at = endedAt
    turn.duration_ms = endedAt - turn.started_at
  } else {
    turn.ended_at = null
    turn.duration_ms = null
  }
}

// ── Agent pipeline (orchestrator-mode) ──────────────────────────────────────────

/** Map a cleaned agent name to its Maestro pipeline stage label */
export function getStageLabel(agentName: string): string | null {
  const n = agentName.toLowerCase()
  if (n.includes('grooming'))  return 'Grooming'
  if (n.includes('challenger')) return 'Challenge'
  if (n.includes('backend') || n.includes('frontend')) return 'Implementation'
  if (n.includes('reviewer') || n.includes('lead')) return 'Review'
  if (n.includes('e2e') || n.includes('e2e-qa')) return 'E2E Testing'
  if (n.includes('qa')) return 'Quality Assurance'
  if (n.includes('release')) return 'Release'
  if (n.includes('ticket')) return 'Tickets'
  return null
}

/** Clean a raw subagent_type like "maestro:grooming-agent" → "grooming-agent" */
export function cleanAgentName(raw: string | null | undefined): string {
  if (!raw) return 'agent'
  const i = raw.indexOf(':')
  return i >= 0 ? raw.slice(i + 1) : raw
}

/**
 * Parse a Maestro agent return value (JSON or plain text) into a short human
 * summary of what the agent reported back to the orchestrator.
 */
export function parseReturnSummary(output: string | null, agentName: string): string {
  if (!output || !output.trim()) return ''
  const name = agentName.toLowerCase()
  void name

  // Try JSON parse
  let json: Record<string, unknown> | null = null
  const trimmed = output.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      json = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      // not JSON
    }
  }

  if (json) {
    // grooming-agent: {effort, risk_level, open_questions}
    if (json.effort && json.risk_level) {
      const oq = Array.isArray(json.open_questions) ? json.open_questions.length : 0
      return `effort=${json.effort} · risk=${json.risk_level}${oq > 0 ? ` · ${oq} open q` : ''}`
    }
    // challenger: {verdict, must_have, should_have}
    if (json.verdict === 'APPROVED' || json.verdict === 'NEEDS_REVISION' || json.verdict === 'BLOCKED') {
      const mh = Array.isArray(json.must_have) ? json.must_have.length : 0
      return mh > 0 ? `${json.verdict} · ${mh} must-fix` : String(json.verdict)
    }
    // backend/frontend: {files_changed, dod_layer1}
    if (Array.isArray(json.files_changed)) {
      const dod = (json.dod_layer1 as Record<string,unknown>)?.status ?? ''
      return `${json.files_changed.length} files${dod ? ` · DOD ${dod}` : ''}`
    }
    // lead-reviewer: {verdict, blockers}
    if ((json.verdict === 'PASS' || json.verdict === 'CHANGES_REQUESTED') && json.blockers !== undefined) {
      const bl = Array.isArray(json.blockers) ? json.blockers.length : 0
      return bl > 0 ? `${json.verdict} · ${bl} blocker${bl > 1 ? 's' : ''}` : String(json.verdict)
    }
    // qa-engineer: {ac_results, blockers}
    if (json.ac_results && typeof json.ac_results === 'object') {
      const vals = Object.values(json.ac_results as Record<string, unknown>)
      const passed = vals.filter((v) => (v as Record<string,unknown>)?.status === 'PASS').length
      return `${passed}/${vals.length} AC passing`
    }
    // release-agent: {pr_number, pr_url}
    if (json.pr_number) return `PR #${json.pr_number} created`
    // Generic: first short string value
    for (const v of Object.values(json)) {
      if (typeof v === 'string' && v.length > 0 && v.length <= 80) return v
    }
  }

  // Plain text fallback
  return trimmed.slice(0, 70).replace(/\n/g, ' ')
}

/**
 * Detect parallel groups among agent spawns.
 * Two agents are parallel if their execution time ranges overlap.
 */
export function detectParallelGroups(agents: ToolCall[]): ToolCall[][] {
  if (agents.length === 0) return []
  const sorted = [...agents].sort((a, b) => a.started_at - b.started_at)

  const groups: ToolCall[][] = []
  let group: ToolCall[] = [sorted[0]]
  let groupEnd = sorted[0].ended_at ?? sorted[0].started_at + 1

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    if (cur.started_at < groupEnd) {
      // Overlap → parallel
      group.push(cur)
      const curEnd = cur.ended_at ?? cur.started_at + 1
      if (curEnd > groupEnd) groupEnd = curEnd
    } else {
      groups.push(group)
      group = [cur]
      groupEnd = cur.ended_at ?? cur.started_at + 1
    }
  }
  groups.push(group)
  return groups
}

/**
 * Build the agent pipeline from a list of turns.
 * Returns the pipeline steps and whether orchestrator mode should be used.
 */
export function buildAgentPipeline(turns: Turn[]): {
  pipeline: AgentPipelineStep[]
  isOrchestratorMode: boolean
} {
  // Collect ALL agent spawns across all turns, preserving order
  const allAgents = turns
    .flatMap((t) => t.agent_spawns)
    .sort((a, b) => a.started_at - b.started_at)

  if (allAgents.length === 0) return { pipeline: [], isOrchestratorMode: false }

  // Orchestrator mode: ≥2 agent spawns
  // (For regular conversations, each turn typically has 0–1 agents)
  const isOrchestratorMode = allAgents.length >= 2

  const parallelGroups = detectParallelGroups(allAgents)

  // For orchestrator_work: collect non-agent tool calls that occur between agent groups
  const allToolCallsSorted = turns
    .flatMap((t) => t.tool_calls)
    .sort((a, b) => a.started_at - b.started_at)

  const pipeline: AgentPipelineStep[] = parallelGroups.map((groupAgents, stepIndex) => {
    const stepStart = groupAgents[0].started_at
    const prevGroupEnd = stepIndex === 0
      ? 0
      : Math.max(...parallelGroups[stepIndex - 1].map((a) => a.ended_at ?? a.started_at))

    // Non-agent tools between previous group's end and this group's start
    const orchestratorWork = allToolCallsSorted.filter(
      (tc) =>
        tc.category !== 'agent' &&
        tc.started_at >= prevGroupEnd &&
        tc.started_at < stepStart,
    )

    // Pick stage label from first agent in the group
    const firstName = cleanAgentName(groupAgents[0].subagent_type)
    const stageLabel = getStageLabel(firstName)

    return {
      step_index: stepIndex,
      agents: groupAgents,
      is_parallel: groupAgents.length > 1,
      orchestrator_work: orchestratorWork,
      stage_label: stageLabel,
    }
  })

  return { pipeline, isOrchestratorMode }
}
