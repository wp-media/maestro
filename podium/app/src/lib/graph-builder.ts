import { Node, Edge, MarkerType } from 'reactflow'
import dagre from '@dagrejs/dagre'
import { Session } from '../types'

// Node dimensions used purely for dagre layout. Real nodes can render larger;
// dagre only needs consistent boxes to compute spacing.
const TURN_W  = 300   // matches new 280px node + breathing room
const TURN_H  = 110  // taller — now includes activity bar
const AGENT_W = 250
const AGENT_H = 80
const START_W = 200
const START_H = 56
const END_W   = 200
const END_H   = 56

const EDGE_COLOR = '#3a4d68'

interface DagreInput {
  id: string
  w: number
  h: number
}

export function buildGraph(session: Session): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const dagreNodes: DagreInput[] = []

  const hasEnd = session.status !== 'running'

  // 1. Start node.
  nodes.push({
    id: 'start',
    type: 'startNode',
    position: { x: 0, y: 0 },
    data: { startedAt: session.started_at, cwd: session.cwd },
  })
  dagreNodes.push({ id: 'start', w: START_W, h: START_H })

  // 2 + 3. Turn nodes and their agent spawns.
  const lastTurnIndex = session.turns.length - 1
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
      nodes.push({
        id: agentId,
        type: 'agentNode',
        position: { x: 0, y: 0 },
        data: {
          toolCall: spawn,
          turnId: turn.id,
          isSelected: false,
        },
      })
      dagreNodes.push({ id: agentId, w: AGENT_W, h: AGENT_H })
    }
  })

  // 4. End node (only if the session has finished).
  if (hasEnd) {
    nodes.push({
      id: 'end',
      type: 'endNode',
      position: { x: 0, y: 0 },
      data: { status: session.status, duration_ms: session.duration_ms },
    })
    dagreNodes.push({ id: 'end', w: END_W, h: END_H })
  }

  // ── Edges ────────────────────────────────────────────────────────────────────
  const makeEdge = (source: string, target: string, animated: boolean, isAgentEdge = false): Edge => ({
    id: `e-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated,
    style: {
      stroke: isAgentEdge ? 'rgba(254,210,58,0.45)' : EDGE_COLOR,
      strokeWidth: isAgentEdge ? 2 : 2,
      strokeDasharray: animated ? '6 4' : undefined,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: isAgentEdge ? 'rgba(254,210,58,0.6)' : EDGE_COLOR,
      width: 14,
      height: 14,
    },
  })

  if (session.turns.length > 0) {
    // start → turn-0
    edges.push(makeEdge('start', 'turn-0', false))

    // turn-i → turn-i+1 and turn-i → agent spawns
    session.turns.forEach((turn, i) => {
      const turnId = `turn-${i}`
      if (i < lastTurnIndex) {
        edges.push(makeEdge(turnId, `turn-${i + 1}`, false))
      }
      for (const spawn of turn.agent_spawns) {
        edges.push(makeEdge(turnId, `agent-${spawn.id}`, spawn.status === 'running', true))
      }
    })

    // last turn → end
    if (hasEnd) {
      edges.push(makeEdge(`turn-${lastTurnIndex}`, 'end', false))
    }
  } else if (hasEnd) {
    // Degenerate session with no turns: start → end directly.
    edges.push(makeEdge('start', 'end', false))
  }

  // ── Dagre layout ─────────────────────────────────────────────────────────────
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', ranksep: 90, nodesep: 55 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const dn of dagreNodes) {
    g.setNode(dn.id, { width: dn.w, height: dn.h })
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target)
  }

  dagre.layout(g)

  const dims = new Map(dagreNodes.map((d) => [d.id, d]))
  for (const node of nodes) {
    const pos = g.node(node.id)
    const dim = dims.get(node.id)
    if (pos && dim) {
      // dagre returns center coordinates; React Flow expects top-left.
      node.position = {
        x: pos.x - dim.w / 2,
        y: pos.y - dim.h / 2,
      }
    }
  }

  return { nodes, edges }
}
