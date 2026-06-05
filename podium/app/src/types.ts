export type ToolCategory = 'shell' | 'read' | 'write' | 'agent' | 'web' | 'other'
export type ItemStatus   = 'running' | 'success' | 'failed'
export type SessionStatus = 'running' | 'success' | 'failed'

// ── Raw JSONL events (hook.mjs output) ──────────────────────────────────────
export interface RawEvent {
  ts: number
  type: string
  session_id: string
  [key: string]: unknown
}

// ── Processed structures ──────────────────────────────────────────────────────
export interface ToolCall {
  id: string               // tool_use_id or generated
  tool_name: string
  category: ToolCategory
  summary: string | null   // human-readable one-liner
  started_at: number
  ended_at: number | null
  duration_ms: number | null
  status: ItemStatus
  output_preview: string | null
  error: string | null
  subagent_type: string | null
  model: string | null
}

export interface Turn {
  id: string
  turn_index: number
  started_at: number
  ended_at: number | null
  duration_ms: number | null
  prompt_preview: string | null  // from UserPromptSubmit
  label: string                  // auto-generated, e.g. "Writing hook.mjs"
  icon: string                   // emoji
  category: ToolCategory         // dominant category
  tool_calls: ToolCall[]         // all tool calls in this turn
  agent_spawns: ToolCall[]       // subset: tool_name === 'Agent'|'Workflow'
  status: 'running' | 'done'
}

export interface Session {
  id: string
  cwd: string | null
  model: string | null
  started_at: number
  ended_at: number | null
  duration_ms: number | null
  status: SessionStatus
  turns: Turn[]
  total_tool_calls: number
  total_agent_spawns: number
  agent_pipeline: AgentPipelineStep[]   // ordered pipeline steps
  is_orchestrator_mode: boolean         // true → use pipeline graph, false → turn graph
}

// ── Agent pipeline (orchestrator-mode visualization) ─────────────────────────

/** One step in the agent pipeline — may contain parallel agents */
export interface AgentPipelineStep {
  step_index: number
  agents: ToolCall[]              // usually 1, >1 when parallel
  is_parallel: boolean
  // Non-agent tool calls that occurred BEFORE this step (after previous step ended)
  orchestrator_work: ToolCall[]   // Bash, Read, Write, etc. between agents
  stage_label: string | null      // Maestro pipeline stage: "Grooming", "Implementation", etc.
}

export interface SessionSummary {
  run_id: string           // = session_id (backward compat)
  session_id: string
  cwd: string | null
  status: SessionStatus
  started_at: number | null
  ended_at: number | null
  total_duration_ms: number | null
  event_count: number
  turn_count: number
  agents: string[]
  first_prompt: string | null   // user's actual message (from UserPromptSubmit)
  first_label: string | null    // auto-generated label from tool calls
}

// ── React Flow node data types ────────────────────────────────────────────────
export interface TurnNodeData {
  turn: Turn
  isSelected: boolean
  isFirst: boolean
  isLast: boolean
}

export interface AgentNodeData {
  toolCall: ToolCall
  turnId: string
  isSelected: boolean
}

export interface PipelineAgentNodeData {
  toolCall: ToolCall
  stepIndex: number
  stageLabel: string | null
  isSelected: boolean
  isFirstInPipeline: boolean
  isLastInPipeline: boolean
}

export interface StartNodeData { startedAt: number; cwd: string | null }
export interface EndNodeData   { status: SessionStatus; duration_ms: number | null }

// ── React Flow node/edge type discriminants ─────────────────────────────────
export type PodiumNodeType = 'turnNode' | 'agentNode' | 'pipelineAgentNode' | 'startNode' | 'endNode'

// ── Store shape ─────────────────────────────────────────────────────────────
export interface AppState {
  sessions: SessionSummary[]
  selectedSessionId: string | null
  selectedSession: Session | null     // fully processed
  selectedTurnId: string | null       // for detail panel
  selectedTurn: Turn | null           // derived: selectedSession.turns.find(selectedTurnId)
  isLoadingSessions: boolean
  loadingSessions: boolean            // alias for isLoadingSessions
  isLoadingSession: boolean
  sseConnected: boolean
  sseReconnecting: boolean
  connection: 'connected' | 'reconnecting' | 'disconnected'  // derived from sseConnected/sseReconnecting
  selectSession: (id: string) => void
  selectTurn: (id: string | null) => void
  setSSEStatus: (connected: boolean, reconnecting?: boolean) => void
  appendRawEvents: (events: RawEvent[]) => void
  refreshSessions: () => Promise<void>
}
