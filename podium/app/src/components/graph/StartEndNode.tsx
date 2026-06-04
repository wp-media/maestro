import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import type { EndNodeData, StartNodeData } from '../../types'

/** Format a unix-ms timestamp as HH:MM (24h, local time). */
function formatClock(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
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

const pillBase: React.CSSProperties = {
  width: 160,
  height: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 14px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text, #f0f4fc)',
  background: 'linear-gradient(135deg, #151921, #1c2433)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
  animation: 'podium-fade-in 220ms ease-out both',
  boxSizing: 'border-box',
  whiteSpace: 'nowrap',
}

function StartNodeComponent({ data }: NodeProps<StartNodeData>) {
  return (
    <div
      className="podium-start-node"
      style={{ ...pillBase, border: '1px solid var(--border, #2e3243)' }}
      title={data.cwd ?? undefined}
    >
      <span style={{ color: '#fed23a' }} aria-hidden>
        ◆
      </span>
      <span>Session started</span>
      <span style={{ color: 'var(--text-muted, #9b9b9b)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
        {formatClock(data.startedAt)}
      </span>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#5a6f8c', width: 8, height: 8, border: 'none' }}
      />
    </div>
  )
}

function EndNodeComponent({ data }: NodeProps<EndNodeData>) {
  const isRunning = data.status === 'running'
  const isFailed = data.status === 'failed'

  const borderColor = isRunning
    ? 'var(--border-light, #3a4d68)'
    : isFailed
    ? '#ef4444'
    : '#22c55e'
  const dotColor = isRunning ? '#22c55e' : isFailed ? '#ef4444' : '#22c55e'
  const emoji = isRunning ? '' : isFailed ? '✕' : '✓'

  return (
    <div
      className="podium-end-node"
      style={{
        ...pillBase,
        border: `1px solid ${borderColor}`,
        boxShadow: isRunning
          ? pillBase.boxShadow
          : `0 0 0 1px ${borderColor}33, 0 2px 8px rgba(0,0,0,0.4)`,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: borderColor, width: 8, height: 8, border: 'none' }}
      />
      {isRunning ? (
        <>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: dotColor,
              boxShadow: `0 0 6px ${dotColor}`,
              animation: 'podium-pulse 1.4s ease-in-out infinite',
            }}
          />
          <span>Running</span>
        </>
      ) : (
        <>
          <span style={{ color: isFailed ? '#ef4444' : '#22c55e' }} aria-hidden>
            {emoji}
          </span>
          <span>Done</span>
          {data.duration_ms != null && (
            <span
              style={{
                color: 'var(--text-muted, #9b9b9b)',
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              · {formatDuration(data.duration_ms)}
            </span>
          )}
        </>
      )}
    </div>
  )
}

export const StartNode = memo(StartNodeComponent)
export const EndNode = memo(EndNodeComponent)
