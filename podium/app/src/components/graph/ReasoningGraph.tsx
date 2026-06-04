import { useCallback, useEffect, useMemo } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  type Node,
  type NodeMouseHandler,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { TurnNode } from './TurnNode'
import { AgentNode } from './AgentNode'
import { StartNode, EndNode } from './StartEndNode'
import { buildGraph } from '../../lib/graph-builder'
import { useStore } from '../../store'
import type { ToolCategory } from '../../types'

const nodeTypes = {
  turnNode: TurnNode,
  agentNode: AgentNode,
  startNode: StartNode,
  endNode: EndNode,
}

const MINIMAP_CATEGORY_COLOR: Record<ToolCategory, string> = {
  shell: '#9b9b9b',
  read: '#40b1d0',
  write: '#2bcdc1',
  agent: '#fed23a',
  web: '#f7a933',
  other: '#5a6f8c',
}

/**
 * Keyframes used by the custom nodes. Injected once so the graph components are
 * self-contained and do not depend on a particular global stylesheet being loaded.
 */
const NODE_ANIMATIONS = `
@keyframes podium-fade-in {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes podium-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.78); }
}

/* Subtle hover lift — apply to the outer wrapper div */
.react-flow__node:hover > div {
  transform: translateY(-2px);
  transition: transform .15s ease;
}

/* Animated edge dashes for running agents */
.react-flow__edge.animated .react-flow__edge-path {
  stroke-dasharray: 6;
  animation: dash 1s linear infinite;
}
@keyframes dash {
  to { stroke-dashoffset: -24; }
}
`

function ReasoningGraphInner() {
  const selectedSession = useStore((s) => s.selectedSession)
  const selectedTurnId = useStore((s) => s.selectedTurnId)
  const selectTurn = useStore((s) => s.selectTurn)

  // Build the raw graph (layout + edges) from the selected session.
  const { nodes: rawNodes, edges } = useMemo(
    () => (selectedSession ? buildGraph(selectedSession) : { nodes: [], edges: [] }),
    [selectedSession],
  )

  // Mark the selected node by injecting isSelected into its data.
  const nodes = useMemo(
    () =>
      rawNodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          isSelected: n.id === selectedTurnId || n.id === 'agent-' + selectedTurnId,
        },
      })),
    [rawNodes, selectedTurnId],
  )

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(nodes)
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(edges)

  useEffect(() => {
    setFlowNodes(nodes)
    setFlowEdges(edges)
  }, [nodes, edges, setFlowNodes, setFlowEdges])

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      if (node.type === 'turnNode') selectTurn(node.data.turn.id)
      if (node.type === 'agentNode') selectTurn(node.data.turnId)
    },
    [selectTurn],
  )

  if (!selectedSession) return <EmptyState />

  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--bg, #0f1318)' }}>
      <style>{NODE_ANIMATIONS}</style>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#243048" gap={28} size={1.2} variant={'dots' as any} />
        <Controls
          style={{ background: 'var(--surface-2, #1c2433)', border: '1px solid var(--border, #2e3243)' }}
        />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(15,19,24,0.7)"
          nodeColor={miniMapNodeColor}
          nodeStrokeWidth={0}
          style={{ background: 'var(--surface-2, #1c2433)', border: '1px solid var(--border, #2e3243)' }}
        />
      </ReactFlow>
    </div>
  )
}

function miniMapNodeColor(n: Node): string {
  if (n.type === 'agentNode') return '#fed23a'
  if (n.type === 'startNode' || n.type === 'endNode') return '#5a6f8c'
  const cat = n.data?.turn?.category as ToolCategory | undefined
  return (cat && MINIMAP_CATEGORY_COLOR[cat]) || '#5a6f8c'
}

function EmptyState() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 32,
        textAlign: 'center',
        background: 'var(--bg, #0f1318)',
        color: 'var(--text-muted, #9b9b9b)',
      }}
    >
      <div
        style={{
          fontSize: '2.4rem',
          lineHeight: 1,
          color: '#fed23a',
          filter: 'drop-shadow(0 0 12px rgba(254,210,58,0.4))',
        }}
        aria-hidden
      >
        ◆
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text, #f0f4fc)', maxWidth: 360 }}>
        Select a session from the sidebar to view its reasoning graph
      </div>
      <div style={{ fontSize: 12.5, maxWidth: 380, lineHeight: 1.5, color: 'var(--text-dim, #5a6f8c)' }}>
        Each node is a turn in the agent's reasoning. Click a node to inspect its tool
        calls, and watch <span style={{ color: '#fed23a' }}>agent spawns</span> light up in gold
        as the orchestrator delegates work.
      </div>
    </div>
  )
}

export function ReasoningGraph() {
  return (
    <ReactFlowProvider>
      <ReasoningGraphInner />
    </ReactFlowProvider>
  )
}
