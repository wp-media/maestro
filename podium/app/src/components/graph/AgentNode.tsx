import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import type { AgentNodeData } from '../../types'

function formatDuration(ms: number | null): string {
  if (ms == null) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

/** Strip "maestro:" or any "vendor:" prefix */
function cleanName(raw: string | null): string {
  if (!raw) return 'agent'
  const i = raw.indexOf(':')
  return i >= 0 ? raw.slice(i + 1) : raw
}

/** Two-letter avatar initials from a kebab-case name */
function initials(name: string): string {
  const parts = name.split('-').filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Colour that identifies the agent type */
const AGENT_COLORS: Record<string, string> = {
  'grooming-agent':    '#22c55e',
  'challenger':        '#f59e0b',
  'backend-agent':     '#2bcdc1',
  'frontend-agent':    '#40b1d0',
  'lead-reviewer':     '#4f7cff',
  'qa-engineer':       '#f472b6',
  'e2e-qa-tester':     '#f472b6',
  'release-agent':     '#a855f7',
  'ticket-writer':     '#9b9b9b',
}

function agentColor(name: string): string {
  return AGENT_COLORS[name] ?? '#fed23a'
}

function AgentNodeInner({ data }: NodeProps<AgentNodeData>) {
  const { toolCall, isSelected } = data
  const name       = cleanName(toolCall.subagent_type)
  const color      = agentColor(name)
  const abbrev     = initials(name)
  const isRunning  = toolCall.status === 'running'
  const isFailed   = toolCall.status === 'failed'
  const statusColor = isFailed ? '#ef4444' : '#22c55e'

  // description: use summary (which captures the tool description from hook.mjs)
  const desc = toolCall.summary ? toolCall.summary.slice(0, 60) : null

  return (
    <div
      style={{
        width: 230,
        borderRadius: 14,
        background: `rgba(${hexToRgb(color)},0.06)`,
        border: `1px solid rgba(${hexToRgb(color)},0.25)`,
        borderLeft: `3px solid ${color}`,
        overflow: 'hidden',
        color: 'var(--text,#f0f4fc)',
        cursor: 'pointer',
        boxShadow: isSelected
          ? `0 0 0 2px ${color}, 0 8px 28px rgba(0,0,0,0.55)`
          : isRunning
          ? `0 0 18px rgba(${hexToRgb(color)},0.25), 0 4px 14px rgba(0,0,0,0.45)`
          : `0 4px 14px rgba(0,0,0,0.45)`,
        transition: 'box-shadow .15s ease',
        animation: 'podium-fade-in 200ms ease-out both',
        boxSizing: 'border-box',
      }}
    >
      <Handle
        type="target" position={Position.Top}
        style={{ background: color, width: 8, height: 8, border: 'none' }}
      />

      <div style={{ padding: '10px 12px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {/* Avatar circle */}
        <div style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: `rgba(${hexToRgb(color)},0.15)`,
          border: `1.5px solid rgba(${hexToRgb(color)},0.45)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11.5, fontWeight: 700, color, letterSpacing: '0.02em',
          fontFamily: "'Whitney HTF Bold','Inter',system-ui,sans-serif",
        }}>
          {abbrev}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Agent name */}
          <div style={{
            fontWeight: 700, fontSize: 13, color,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            lineHeight: 1.3,
          }}>
            {name}
          </div>

          {/* Description excerpt */}
          {desc && (
            <div style={{
              fontSize: 11, color: '#9b9b9b', lineHeight: 1.4, marginTop: 3,
              overflow: 'hidden', display: '-webkit-box',
              WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
            }}>
              {desc}
            </div>
          )}

          {/* Duration + status */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginTop: 6,
          }}>
            {toolCall.duration_ms != null && (
              <span style={{ fontSize: 11, color: '#9b9b9b', fontVariantNumeric: 'tabular-nums' }}>
                {formatDuration(toolCall.duration_ms)}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: isRunning ? color : statusColor,
              boxShadow: `0 0 5px ${isRunning ? color : statusColor}`,
              animation: isRunning ? 'podium-pulse 1.4s ease-in-out infinite' : undefined,
            }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `${r},${g},${b}`
}

export const AgentNode = memo(AgentNodeInner)
