import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import type { AgentNodeData } from '../../types'

/** Strip a "maestro:" (or any "vendor:") prefix from a subagent type. */
function cleanAgentName(raw: string | null): string {
  if (!raw) return 'agent'
  const idx = raw.indexOf(':')
  return idx >= 0 ? raw.slice(idx + 1) : raw
}

/** Human-friendly short duration (e.g. 920ms, 3.4s, 1m 12s). */
function formatDuration(ms: number | null): string {
  if (ms == null) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m ${rem}s`
}

function AgentNodeComponent({ data }: NodeProps<AgentNodeData>) {
  const { toolCall, isSelected } = data
  const name = cleanAgentName(toolCall.subagent_type) || toolCall.tool_name
  const isRunning = toolCall.status === 'running'
  const isFailed = toolCall.status === 'failed'

  const statusColor = isRunning ? '#fed23a' : isFailed ? '#ef4444' : '#22c55e'

  return (
    <div
      className="podium-agent-node"
      style={{
        width: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '9px 11px 9px 12px',
        borderRadius: 12,
        background: 'rgba(254,210,58,0.08)',
        border: '1px solid rgba(254,210,58,0.35)',
        borderLeft: '3px solid #fed23a',
        color: 'var(--text, #f0f4fc)',
        boxShadow: isSelected
          ? '0 0 0 2px #fed23a, 0 6px 18px rgba(0,0,0,0.45)'
          : '0 2px 10px rgba(254,210,58,0.10)',
        transition: 'box-shadow 160ms ease, transform 160ms ease',
        animation: isRunning
          ? 'podium-agent-glow 1.6s ease-in-out infinite, podium-fade-in 220ms ease-out both'
          : 'podium-fade-in 220ms ease-out both',
        cursor: 'pointer',
        boxSizing: 'border-box',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#fed23a', width: 8, height: 8, border: 'none' }}
      />

      {/* Top row: robot + agent name + status dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: '1.05rem', lineHeight: 1, flexShrink: 0 }} aria-hidden>
          🤖
        </span>
        <span
          title={toolCall.subagent_type ?? name}
          style={{
            flex: 1,
            minWidth: 0,
            fontWeight: 600,
            fontSize: 12.5,
            lineHeight: 1.25,
            color: '#fed23a',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
        <span
          aria-label={isRunning ? 'running' : isFailed ? 'failed' : 'success'}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flexShrink: 0,
            background: statusColor,
            boxShadow: `0 0 6px ${statusColor}`,
            animation: isRunning ? 'podium-pulse 1.4s ease-in-out infinite' : undefined,
          }}
        />
      </div>

      {/* Bottom row: model + duration */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingLeft: 26,
          fontSize: 11,
          color: 'var(--text-muted, #9b9b9b)',
        }}
      >
        {toolCall.model && (
          <span
            title={toolCall.model}
            style={{
              maxWidth: 110,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {toolCall.model}
          </span>
        )}
        {toolCall.duration_ms != null && (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatDuration(toolCall.duration_ms)}
          </span>
        )}
      </div>
    </div>
  )
}

export const AgentNode = memo(AgentNodeComponent)
