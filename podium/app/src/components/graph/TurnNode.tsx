import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import type { ToolCategory, TurnNodeData } from '../../types'

/** Left-border / accent color per tool category. */
const CATEGORY_COLOR: Record<ToolCategory, string> = {
  shell: '#9b9b9b',
  read: '#40b1d0',
  write: '#2bcdc1',
  agent: '#fed23a',
  web: '#f7a933',
  other: '#5a6f8c',
}

/** Tiny emoji per category, used in the footer count badges. */
const CATEGORY_EMOJI: Record<ToolCategory, string> = {
  shell: '🖥️',
  read: '📖',
  write: '✏️',
  agent: '🤖',
  web: '🌐',
  other: '⚙️',
}

const CATEGORY_ORDER: ToolCategory[] = ['shell', 'read', 'write', 'agent', 'web', 'other']

/** Convert a hex color (#rrggbb) + alpha into an rgba() string. */
function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
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

function TurnNodeComponent({ data }: NodeProps<TurnNodeData>) {
  const { turn, isSelected } = data
  const accent = CATEGORY_COLOR[turn.category] ?? CATEGORY_COLOR.other
  const isRunning = turn.status === 'running'

  // Determine the overall status of the turn from its tool calls.
  const hasFailure = turn.tool_calls.some((t) => t.status === 'failed')
  const statusColor = isRunning ? '#22c55e' : hasFailure ? '#ef4444' : '#22c55e'

  // Count tool calls by category for the footer badges.
  const counts: Partial<Record<ToolCategory, number>> = {}
  for (const tc of turn.tool_calls) {
    counts[tc.category] = (counts[tc.category] ?? 0) + 1
  }
  const badges = CATEGORY_ORDER.filter((c) => (counts[c] ?? 0) > 0)

  return (
    <div
      className="podium-turn-node group"
      style={{
        width: 240,
        minHeight: 80,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 12px 10px 13px',
        borderRadius: 12,
        borderLeft: `3px solid ${accent}`,
        background: 'var(--surface-2, #1c2433)',
        boxShadow: isSelected
          ? '0 0 0 2px #fed23a, 0 6px 18px rgba(0,0,0,0.45)'
          : '0 2px 8px rgba(0,0,0,0.35)',
        color: 'var(--text, #f0f4fc)',
        transition: 'background 160ms ease, box-shadow 160ms ease, transform 160ms ease',
        animation: 'podium-fade-in 220ms ease-out both',
        cursor: 'pointer',
        boxSizing: 'border-box',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: accent, width: 8, height: 8, border: 'none' }}
      />

      {/* Header row: icon + label + duration + status dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: '1.2rem', lineHeight: 1, flexShrink: 0 }} aria-hidden>
          {turn.icon || '•'}
        </span>
        <span
          title={turn.label}
          style={{
            flex: 1,
            minWidth: 0,
            fontWeight: 600,
            fontSize: 13,
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {turn.label}
        </span>
        {turn.duration_ms != null && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-muted, #9b9b9b)',
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatDuration(turn.duration_ms)}
          </span>
        )}
        <span
          aria-label={isRunning ? 'running' : hasFailure ? 'failed' : 'success'}
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

      {/* Footer row: per-category count badges */}
      {badges.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {badges.map((cat) => {
            const color = CATEGORY_COLOR[cat]
            return (
              <span
                key={cat}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 10,
                  lineHeight: 1,
                  padding: '3px 6px',
                  borderRadius: 999,
                  background: rgba(color, 0.16),
                  color,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span aria-hidden style={{ fontSize: 10 }}>
                  {CATEGORY_EMOJI[cat]}
                </span>
                {counts[cat]}
              </span>
            )
          })}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: accent, width: 8, height: 8, border: 'none' }}
      />
    </div>
  )
}

export const TurnNode = memo(TurnNodeComponent)
