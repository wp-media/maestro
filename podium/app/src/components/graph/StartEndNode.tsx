import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import type { EndNodeData, StartNodeData } from '../../types'

function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function formatDuration(ms: number | null): string {
  if (ms == null) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

function basename(p: string | null): string | null {
  if (!p) return null
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

function StartNodeInner({ data }: NodeProps<StartNodeData>) {
  const dir = basename(data.cwd)

  return (
    <div style={{
      display: 'inline-flex', flexDirection: 'column',
      alignItems: 'center', gap: 4,
      padding: '8px 18px',
      borderRadius: 999,
      background: 'linear-gradient(135deg,#1a2436,#232f45)',
      border: '1px solid #2e3243',
      boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
      color: 'var(--text,#f0f4fc)',
      fontSize: 12, fontWeight: 600,
      animation: 'podium-fade-in 200ms ease-out both',
      boxSizing: 'border-box',
      minWidth: 160,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#fed23a', fontSize: 14 }}>◆</span>
        <span>Session started</span>
        <span style={{ color: '#9b9b9b', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
          {formatClock(data.startedAt)}
        </span>
      </div>
      {dir && (
        <div style={{ fontSize: 10, color: '#5a6f8c', fontWeight: 400, letterSpacing: '0.02em' }}>
          {dir}
        </div>
      )}
      <Handle
        type="source" position={Position.Bottom}
        style={{ background: '#2e3243', width: 8, height: 8, border: 'none' }}
      />
    </div>
  )
}

function EndNodeInner({ data }: NodeProps<EndNodeData>) {
  const isRunning = data.status === 'running'
  const isFailed  = data.status === 'failed'
  const color = isFailed ? '#ef4444' : '#22c55e'

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
      padding: '8px 18px',
      borderRadius: 999,
      background: isRunning
        ? 'linear-gradient(135deg,#1a2436,#232f45)'
        : isFailed
        ? 'rgba(239,68,68,0.08)'
        : 'rgba(34,197,94,0.08)',
      border: `1px solid ${isRunning ? '#2e3243' : color + '55'}`,
      boxShadow: isRunning
        ? '0 2px 10px rgba(0,0,0,0.4)'
        : `0 0 12px ${color}22, 0 2px 10px rgba(0,0,0,0.4)`,
      color: 'var(--text,#f0f4fc)',
      fontSize: 12, fontWeight: 600,
      animation: 'podium-fade-in 200ms ease-out both',
      boxSizing: 'border-box',
      minWidth: 160,
    }}>
      <Handle
        type="target" position={Position.Top}
        style={{ background: '#2e3243', width: 8, height: 8, border: 'none' }}
      />

      {isRunning ? (
        <>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#22c55e', boxShadow: '0 0 6px #22c55e',
            animation: 'podium-pulse 1.4s ease-in-out infinite',
          }} />
          <span>Running</span>
        </>
      ) : (
        <>
          <span style={{ color, fontSize: 13 }}>{isFailed ? '✕' : '✓'}</span>
          <span style={{ color: isFailed ? '#ef4444' : 'var(--text,#f0f4fc)' }}>Done</span>
          {data.duration_ms != null && (
            <span style={{ color: '#9b9b9b', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
              · {formatDuration(data.duration_ms)}
            </span>
          )}
        </>
      )}
    </div>
  )
}

export const StartNode = memo(StartNodeInner)
export const EndNode   = memo(EndNodeInner)
