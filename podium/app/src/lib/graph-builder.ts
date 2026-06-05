import { Node, Edge, MarkerType } from 'reactflow'
import dagre from '@dagrejs/dagre'
import { Session, ToolCall, AgentPipelineStep } from '../types'
import { parseReturnSummary, cleanAgentName } from './event-processor'

// ── Node dimensions for dagre layout ────────────────────────────────────────
// dagre only needs consistent boxes to compute spacing; the rendered nodes can
// be a different size. These must stay in rough agreement with the components.

// Conversation mode
const TURN_W = 300
const TURN_H = 110
const AGENT_W = 230
const AGENT_H = 80

// Pipeline mode
const PIPELINE_AGENT_W = 250
const PIPELINE_AGENT_H = 120
const PHANTOM_W = 12
const PHANTOM_H = 12
const ORCH_WORK_W = 200
const ORCH_WORK_H = 48

// Shared
const START_W = 200
const START_H = 56
const END_W = 200
const END_H = 56

// ── Colours ─────────────────────────────────────────────────────────────────
const DARK_EDGE = '#3a4d68'
const GOLD_PIPE = 'rgba(254,210,58,0.5)'
const GOLD_ARROW = 'rgba(254,210,58,0.7)'
const GOLD_RETURN = 'rgba(254,210,58,0.35)'
const PHANTOM_BG = 'rgba(254,210,58,0.4)'

const RETURN_LABEL_STYLE = { fill: '#9b9b9b', fontSize: 10, fontStyle: 'italic' as const }

interface DagreInput {
  id: string
  w: number
  h: number
}

// ── Public API ──────────────────────────────────────────────────────────────

export function buildGraph(session: Session): { nodes: Node[]; edges: Edge[] } {
  return session.is_orchestrator_mode ? buildPipelineGraph(session) : buildConversationGraph(session)
}

// ── Layout helper ─────────────────────────────────────────────────────────────

/**
 * Run dagre over the collected nodes/edges and rewrite each node's position to
 * top-left coordinates (React Flow's convention).
 */
function layout(
  nodes: Node[],
  edges: Edge[],
  dagreNodes: DagreInput[],
  graphCfg: { rankdir: 'TB' | 'LR'; ranksep: number; nodesep: number },
): void {
  const g = new dagre.graphlib.Graph()
  g.setGraph(graphCfg)
  g.setDefaultEdgeLabel(() => ({}))

  for (const dn of dagreNodes) {
    g.setNode(dn.id, { width: dn.w, height: dn.h })
  }
  for (const e of edges) {
    // Only lay out edges whose endpoints are real layout nodes.
    g.setEdge(e.source, e.target)
  }

  dagre.layout(g)

  const dims = new Map(dagreNodes.map((d) => [d.id, d]))
  for (const node of nodes) {
    const pos = g.node(node.id)
    const dim = dims.get(node.id)
    if (pos && dim) {
      node.position = { x: pos.x - dim.w / 2, y: pos.y - dim.h / 2 }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PIPELINE MODE
// ════════════════════════════════════════════════════════════════════════════

function buildPipelineGraph(session: Session): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const dagreNodes: DagreInput[] = []

  const hasEnd = session.status !== 'running'
  const pipeline = session.agent_pipeline
  const lastStep = pipeline.length - 1

  // Start node.
  nodes.push({
    id: 'start',
    type: 'startNode',
    position: { x: 0, y: 0 },
    data: { startedAt: session.started_at, cwd: session.cwd },
  })
  dagreNodes.push({ id: 'start', w: START_W, h: START_H })

  // Degenerate: no pipeline steps. Wire start straight to end (if finished).
  if (pipeline.length === 0) {
    if (hasEnd) {
      nodes.push({
        id: 'end',
        type: 'endNode',
        position: { x: 0, y: 0 },
        data: { status: session.status, duration_ms: session.duration_ms },
      })
      dagreNodes.push({ id: 'end', w: END_W, h: END_H })
      edges.push(darkEdge('start', 'end'))
    }
    layout(nodes, edges, dagreNodes, { rankdir: 'TB', ranksep: 80, nodesep: 36 })
    return { nodes, edges }
  }

  // For each step, the agent node ids it contributes.
  const stepAgentIds: string[][] = []

  pipeline.forEach((step, stepIndex) => {
    const ids: string[] = []

    step.agents.forEach((agent) => {
      const id = `pagent-${agent.id}`
      ids.push(id)
      const agentName = cleanAgentName(agent.subagent_type)
      nodes.push({
        id,
        type: 'pipelineAgentNode',
        position: { x: 0, y: 0 },
        data: {
          toolCall: agent,
          stepIndex,
          stageLabel: step.stage_label,
          isSelected: false,
          isFirstInPipeline: stepIndex === 0,
          isLastInPipeline: stepIndex === lastStep,
          returnSummary: parseReturnSummary(agent.output_preview, agentName),
        },
      })
      dagreNodes.push({ id, w: PIPELINE_AGENT_W, h: PIPELINE_AGENT_H })
    })

    stepAgentIds.push(ids)
  })

  // Simple helpers — no phantom nodes, no orchwork intermediaries.
  const entryIds = (stepIndex: number): string[] => stepAgentIds[stepIndex]
  const exitIds  = (stepIndex: number): string[] => stepAgentIds[stepIndex]

  // start → first step entry.
  for (const id of entryIds(0)) {
    edges.push(darkEdge('start', id))
  }

  // Wire step i → step i+1 with direct fan-out/fan-in edges (no phantom nodes).
  // dagre handles the layout naturally; direct edges produce cleaner visuals.
  for (let i = 0; i < lastStep; i++) {
    const fromIds = exitIds(i)
    const toIds   = entryIds(i + 1)

    for (let k = 0; k < fromIds.length; k++) {
      const label = returnLabelForAgent(pipeline[i], k)
      for (const to of toIds) {
        edges.push(goldPipeEdge(fromIds[k], to, label))
      }
    }
  }

  // Last step exits → end.
  if (hasEnd) {
    nodes.push({
      id: 'end',
      type: 'endNode',
      position: { x: 0, y: 0 },
      data: { status: session.status, duration_ms: session.duration_ms },
    })
    dagreNodes.push({ id: 'end', w: END_W, h: END_H })
    for (const id of exitIds(lastStep)) {
      edges.push(darkEdge(id, 'end'))
    }
  }

  layout(nodes, edges, dagreNodes, { rankdir: 'TB', ranksep: 100, nodesep: 60 })
  return { nodes, edges }
}

// Return-summary label for a single-agent step (uses its sole agent).
function returnLabelFor(step: AgentPipelineStep): string {
  const agent = step.agents[0]
  if (!agent) return ''
  return parseReturnSummary(agent.output_preview, cleanAgentName(agent.subagent_type))
}

// Return-summary label for a specific agent within a (parallel) step.
function returnLabelForAgent(step: AgentPipelineStep, idx: number): string {
  const agent = step.agents[idx]
  if (!agent) return ''
  return parseReturnSummary(agent.output_preview, cleanAgentName(agent.subagent_type))
}

function pushPhantom(nodes: Node[], dagreNodes: DagreInput[], id: string): void {
  nodes.push({
    id,
    type: 'phantomNode',
    position: { x: 0, y: 0 },
    selectable: false,
    draggable: false,
    data: {},
    style: {
      width: 10,
      height: 10,
      background: PHANTOM_BG,
      borderRadius: '50%',
      border: 'none',
    },
  })
  dagreNodes.push({ id, w: PHANTOM_W, h: PHANTOM_H })
}

function darkEdge(source: string, target: string): Edge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated: false,
    style: { stroke: DARK_EDGE, strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: DARK_EDGE,
      width: 14,
      height: 14,
    },
  }
}

function goldPipeEdge(source: string, target: string, label?: string): Edge {
  const edge: Edge = {
    id: `e-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated: false,
    style: { stroke: GOLD_PIPE, strokeWidth: 2, strokeDasharray: undefined },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: GOLD_ARROW,
      width: 14,
      height: 14,
    },
  }
  if (label) {
    edge.label = label
    edge.labelStyle = RETURN_LABEL_STYLE
    edge.labelBgStyle = { fill: 'transparent' }
    edge.labelShowBg = false
  }
  return edge
}

// ════════════════════════════════════════════════════════════════════════════
// CONVERSATION MODE
// ════════════════════════════════════════════════════════════════════════════

function buildConversationGraph(session: Session): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const dagreNodes: DagreInput[] = []

  const hasEnd = session.status !== 'running'
  const lastTurnIndex = session.turns.length - 1

  // Start node.
  nodes.push({
    id: 'start',
    type: 'startNode',
    position: { x: 0, y: 0 },
    data: { startedAt: session.started_at, cwd: session.cwd },
  })
  dagreNodes.push({ id: 'start', w: START_W, h: START_H })

  // Turn nodes + their agent spawns.
  session.turns.forEach((turn, i) => {
    const turnId = `turn-${i}`
    nodes.push({
      id: turnId,
      type: 'turnNode',
      position: { x: 0, y: 0 },
      data: {
        turn,
        isFirst: i === 0,
        isLast: i === lastTurnIndex,
        isSelected: false,
      },
    })
    dagreNodes.push({ id: turnId, w: TURN_W, h: TURN_H })

    for (const spawn of turn.agent_spawns) {
      const agentId = `agent-${spawn.id}`
      const agentName = cleanAgentName(spawn.subagent_type)
      nodes.push({
        id: agentId,
        type: 'agentNode',
        position: { x: 0, y: 0 },
        data: {
          toolCall: spawn,
          turnId: turn.id,
          isSelected: false,
          returnSummary: parseReturnSummary(spawn.output_preview, agentName),
        },
      })
      dagreNodes.push({ id: agentId, w: AGENT_W, h: AGENT_H })
    }
  })

  // End node.
  if (hasEnd) {
    nodes.push({
      id: 'end',
      type: 'endNode',
      position: { x: 0, y: 0 },
      data: { status: session.status, duration_ms: session.duration_ms },
    })
    dagreNodes.push({ id: 'end', w: END_W, h: END_H })
  }

  // ── Edges ────────────────────────────────────────────────────────────────
  if (session.turns.length > 0) {
    edges.push(convEdge('start', 'turn-0', false))

    session.turns.forEach((turn, i) => {
      const turnId = `turn-${i}`
      if (i < lastTurnIndex) {
        edges.push(convEdge(turnId, `turn-${i + 1}`, false))
      }
      for (const spawn of turn.agent_spawns) {
        const agentId = `agent-${spawn.id}`
        // turn → agent (spawn edge)
        edges.push(convAgentEdge(turnId, agentId, spawn.status === 'running'))
        // agent → next turn (RETURN edge) — agent reports back to the
        // orchestrator turn that reads its result.
        if (i + 1 <= lastTurnIndex) {
          edges.push(returnEdge(agentId, `turn-${i + 1}`, spawn))
        }
      }
    })

    if (hasEnd) {
      edges.push(convEdge(`turn-${lastTurnIndex}`, 'end', false))
    }
  } else if (hasEnd) {
    edges.push(convEdge('start', 'end', false))
  }

  layout(nodes, edges, dagreNodes, { rankdir: 'TB', ranksep: 90, nodesep: 55 })
  return { nodes, edges }
}

function convEdge(source: string, target: string, animated: boolean): Edge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated,
    style: {
      stroke: DARK_EDGE,
      strokeWidth: 2,
      strokeDasharray: animated ? '6 4' : undefined,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: DARK_EDGE,
      width: 14,
      height: 14,
    },
  }
}

function convAgentEdge(source: string, target: string, animated: boolean): Edge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated,
    style: {
      stroke: 'rgba(254,210,58,0.45)',
      strokeWidth: 2,
      strokeDasharray: animated ? '6 4' : undefined,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: 'rgba(254,210,58,0.6)',
      width: 14,
      height: 14,
    },
  }
}

function returnEdge(source: string, target: string, spawn: ToolCall): Edge {
  const label = parseReturnSummary(spawn.output_preview, cleanAgentName(spawn.subagent_type))
  const edge: Edge = {
    id: `e-return-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated: false,
    style: {
      stroke: GOLD_RETURN,
      strokeWidth: 1.5,
      strokeDasharray: '4 3',
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: GOLD_ARROW,
      width: 10,
      height: 10,
    },
  }
  if (label) {
    edge.label = label
    edge.labelStyle = RETURN_LABEL_STYLE
    edge.labelBgStyle = { fill: 'transparent' }
    edge.labelShowBg = false
  }
  return edge
}
