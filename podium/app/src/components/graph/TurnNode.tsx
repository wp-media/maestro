import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import type { ToolCall, ToolCategory, TurnNodeData } from '../../types'

const CATEGORY_COLOR: Record<ToolCategory, string> = {
  shell:  '#9b9b9b',
  read:   '#40b1d0',
  write:  '#2bcdc1',
  agent:  '#fed23a',
  web:    '#f7a933',
  other:  '#5a6f8c',
}

const CATEGORY_LABEL: Record<ToolCategory, string> = {
  shell: 'shell', read: 'read', write: 'write',
  agent: 'agent', web: 'web', other: 'other',
}

const CATEGORY_ORDER: ToolCategory[] = ['agent', 'write', 'shell', 'read', 'web', 'other']

function rgba(hex: string, a: number) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

function formatDuration(ms: number | null): string {
  if (ms == null) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

/** Proportional horizontal bar — one coloured segment per category */
function ActivityBar({ toolCalls }: { toolCalls: ToolCall[] }) {
  const total = toolCalls.length
  if (total === 0) return null

  const counts: Partial<Record<ToolCategory, number>> = {}
  for (const t of toolCalls) counts[t.category] = (counts[t.category] ?? 0) + 1

  const segments = CATEGORY_ORDER.filter(c => (counts[c] ?? 0) > 0)

  return (
    <div style={{ padding: '0 14px 10px' }}>
      {/* Colour bar */}
      <div style={{
        display: 'flex', height: 5, borderRadius: 3,
        overflow: 'hidden', gap: 1, marginBottom: 5,
      }}>
        {segments.map(cat => (
          <div key={cat} style={{
            flex: counts[cat],
            background: CATEGORY_COLOR[cat],
            opacity: 0.85,
            borderRadius: 2,
            minWidth: 2,
          }} />
        ))}
      </div>

      {/* Labels under bar */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {segments.map(cat => (
          <span key={cat} style={{
            fontSize: 10, color: CATEGORY_COLOR[cat],
            fontVariantNumeric: 'tabular-nums',
          }}>
            {CATEGORY_LABEL[cat]}·{counts[cat]}
          </span>
        ))}
      </div>
    </div>
  )
}

function StatusDot({ isRunning, isFailed }: { isRunning: boolean; isFailed: boolean }) {
  const color = isFailed ? '#ef4444' : '#22c55e'
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: color, boxShadow: `0 0 5px ${color}`,
      animation: isRunning ? 'podium-pulse 1.4s ease-in-out infinite' : undefined,
    }} />
  )
}

function TurnNodeInner({ data }: NodeProps<TurnNodeData>) {
  const { turn, isSelected } = data
  const accent  = CATEGORY_COLOR[turn.category] ?? CATEGORY_COLOR.other
  const isRunning = turn.status === 'running'
  const hasFail   = turn.tool_calls.some(t => t.status === 'failed')

  const hasPrompt = Boolean(turn.prompt_preview?.trim())

  return (
    <div
      style={{
        width: 280,
        borderRadius: 14,
        background: '#1c2433',
        borderLeft: `3px solid ${accent}`,
        overflow: 'hidden',
        color: 'var(--text,#f0f4fc)',
        cursor: 'pointer',
        boxShadow: isSelected
          ? `0 0 0 2px #fed23a, 0 8px 28px rgba(0,0,0,0.55)`
          : `0 4px 14px rgba(0,0,0,0.45)`,
        transition: 'box-shadow .15s ease, transform .15s ease',
        animation: 'podium-fade-in 200ms ease-out both',
        boxSizing: 'border-box',
      }}
    >
      <Handle
        type="target" position={Position.Top}
        style={{ background: accent, width: 8, height: 8, border: 'none' }}
      />

      <div style={{ padding: '12px 14px 10px' }}>
        {/* Prompt preview — shown as an italic quote when available */}
        {hasPrompt && (
          <p style={{
            margin: '0 0 7px 0',
            fontSize: 12,
            fontStyle: 'italic',
            lineHeight: 1.45,
            color: '#9b9b9b',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as const,
          }}>
            &ldquo;{turn.prompt_preview!.trim()}&rdquo;
          </p>
        )}

        {/* Label row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: '1rem', lineHeight: 1, flexShrink: 0 }}>
            {turn.icon || '•'}
          </span>
          <span style={{
            flex: 1, fontWeight: 600, fontSize: 13, lineHeight: 1.25,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {turn.label}
          </span>
          {turn.duration_ms != null && (
            <span style={{
              fontSize: 11, color: '#9b9b9b', flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {formatDuration(turn.duration_ms)}
            </span>
          )}
          <StatusDot isRunning={isRunning} isFailed={hasFail} />
        </div>
      </div>

      {/* Proportional activity bar — the visual centrepiece */}
      {turn.tool_calls.length > 0 && (
        <div style={{
          borderTop: `1px solid ${rgba(accent, 0.15)}`,
          marginTop: 2,
        }}>
          <ActivityBar toolCalls={turn.tool_calls} />
        </div>
      )}

      <Handle
        type="source" position={Position.Bottom}
        style={{ background: accent, width: 8, height: 8, border: 'none' }}
      />
    </div>
  )
}

export const TurnNode = memo(TurnNodeInner)
