import { Node, Edge, MarkerType } from 'reactflow'
import dagre from '@dagrejs/dagre'
import { Session } from '../types'

// Node dimensions used purely for dagre layout. Real nodes can render larger;
// dagre only needs consistent boxes to compute spacing.
const TURN_W = 260
const TURN_H = 88
const AGENT_W = 220
const AGENT_H = 72
const START_W = 200
const START_H = 64
const END_W = 200
const END_H = 64

const EDGE_COLOR = '#2e3243'

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
  const makeEdge = (source: string, target: string, animated: boolean): Edge => ({
    id: `e-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated,
    style: { stroke: EDGE_COLOR, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR },
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
        edges.push(makeEdge(turnId, `agent-${spawn.id}`, spawn.status === 'running'))
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
  g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 40 })
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
