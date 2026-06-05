import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import type { PipelineAgentNodeData } from '../../types'
import { parseReturnSummary, cleanAgentName } from '../../lib/event-processor'

// ── Agent colour + initials helpers ──────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  'grooming-agent': '#22c55e',
  'challenger': '#f59e0b',
  'backend-agent': '#22d3ee',
  'frontend-agent': '#22d3ee',
  'lead-reviewer': '#4f7cff',
  'qa-engineer': '#f472b6',
  'e2e-qa-tester': '#f472b6',
  'release-agent': '#a855f7',
  'ticket-writer': '#94a3b8',
}

function agentColor(name: string): string {
  return AGENT_COLORS[name] ?? '#fed23a'
}

function initials(name: string): string {
  const p = name.split('-').filter(Boolean)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[1][0]).toUpperCase()
}

/** Derive 2-letter initials from a plain-English task description. */
function initialsFromTask(task: string | null): string {
  if (!task) return 'AG'
  // Pick the first two meaningful words (skip articles, prepositions)
  const SKIP = new Set(['the','a','an','in','on','at','of','for','to','by','with','all','per'])
  const words = task.trim().split(/\s+/).filter(w => w.length > 1 && !SKIP.has(w.toLowerCase()))
  if (words.length === 0) return 'AG'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Trim a task description to a title-length string. */
function taskTitle(summary: string | null): string {
  if (!summary) return 'Agent'
  const s = summary.trim()
  return s.length <= 38 ? s : s.slice(0, 35) + '…'
}

/** Return null when the summary is a trivially uninformative status word. */
function meaningfulReturn(summary: string): string | null {
  const TRIVIAL = new Set(['completed', 'success', 'done', 'ok', 'true', 'false', ''])
  return TRIVIAL.has(summary.toLowerCase().trim()) ? null : summary
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `${r},${g},${b}`
}

function formatDuration(ms: number | null): string {
  if (ms == null) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

// ── Component ─────────────────────────────────────────────────────────────────

function PipelineAgentNodeInner({ data }: NodeProps<PipelineAgentNodeData>) {
  const { toolCall, stageLabel, isSelected } = data
  const name = cleanAgentName(toolCall.subagent_type)
  const isGeneric = name === 'agent'

  // For generic unnamed agents, the task description IS the identity
  const displayName  = isGeneric ? taskTitle(toolCall.summary) : name
  const displayAbbrev = isGeneric ? initialsFromTask(toolCall.summary) : initials(name)
  const color = agentColor(name)   // gold for all agents — keeps the visual language consistent
  const rgb = hexToRgb(color)

  const isRunning = toolCall.status === 'running'
  const isFailed  = toolCall.status === 'failed'
  const isSuccess = toolCall.status === 'success'

  const statusDotColor = isFailed ? '#ef4444' : isRunning ? color : '#22c55e'

  // For generic agents, the name row already shows the task — no need to repeat it
  const task = isGeneric ? null : (toolCall.summary || null)
  const rawReturn = parseReturnSummary(toolCall.output_preview, name)
  const returnSummary = meaningfulReturn(rawReturn)

  return (
    <div
      style={{
        width: 250,
        position: 'relative',
        boxSizing: 'border-box',
        background: '#1c2433',
        borderLeft: `3px solid ${color}`,
        borderRadius: 14,
        overflow: 'hidden',
        cursor: 'pointer',
        color: 'var(--text,#f0f4fc)',
        boxShadow: isSelected
          ? '0 0 0 2px #fed23a, 0 8px 28px rgba(0,0,0,0.55)'
          : isRunning
          ? `0 0 0 1px rgba(${rgb},0.3), 0 0 12px rgba(${rgb},0.15)`
          : '0 4px 16px rgba(0,0,0,0.5)',
        animation: 'podium-fade-in 200ms ease-out both',
        transition: 'box-shadow .15s ease',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: color, width: 8, height: 8, border: 'none' }}
      />

      {/* Stage badge (top-right) */}
      {stageLabel && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 10,
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: `rgba(${rgb},0.7)`,
            background: `rgba(${rgb},0.1)`,
            padding: '2px 6px',
            borderRadius: 5,
            zIndex: 1,
          }}
        >
          {stageLabel}
        </div>
      )}

      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px 10px',
          paddingRight: stageLabel ? 90 : 14,
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            flexShrink: 0,
            background: `rgba(${rgb},0.15)`,
            border: `1.5px solid rgba(${rgb},0.4)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
            color,
            letterSpacing: '0.02em',
            fontFamily: "'Whitney HTF Bold','Inter',system-ui,sans-serif",
          }}
        >
          {displayAbbrev}
        </div>

        {/* Name — for generic agents this is the full task description */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontWeight: isGeneric ? 600 : 700,
            fontSize: isGeneric ? 12.5 : 13.5,
            color,
            overflow: 'hidden',
            // Generic agents get 2 lines since description is longer
            ...(isGeneric
              ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, lineHeight: 1.35 }
              : { textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }),
          }}
        >
          {displayName}
        </div>

        {/* Duration */}
        {toolCall.duration_ms != null && (
          <span
            style={{
              fontSize: 11,
              color: '#9b9b9b',
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
            }}
          >
            {formatDuration(toolCall.duration_ms)}
          </span>
        )}

        {/* Status dot */}
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flexShrink: 0,
            background: statusDotColor,
            boxShadow: `0 0 5px ${statusDotColor}`,
            animation: isRunning ? 'podium-pulse 1.4s ease-in-out infinite' : undefined,
          }}
        />
      </div>

      {/* Task description — only shown for named agents (generic agents show task as title) */}
      {task && (
        <>
          <div style={{ height: 1, background: 'rgba(46,50,67,0.7)' }} />
          <div
            style={{
              padding: '8px 14px',
              fontSize: 12,
              fontStyle: 'italic',
              color: '#9b9b9b',
              lineHeight: 1.4,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical' as const,
              ...(isRunning
                ? {
                    backgroundImage:
                      `linear-gradient(90deg, rgba(${rgb},0) 0%, rgba(${rgb},0.12) 50%, rgba(${rgb},0) 100%)`,
                    backgroundSize: '200% 100%',
                    animation: 'podium-shimmer 1.6s linear infinite',
                  }
                : {}),
            }}
          >
            {task}
          </div>
        </>
      )}

      {/* Running shimmer for generic agents (no separate task row) */}
      {isRunning && isGeneric && (
        <div style={{
          height: 3, margin: '0 14px 8px',
          backgroundImage: `linear-gradient(90deg, rgba(${rgb},0) 0%, rgba(${rgb},0.4) 50%, rgba(${rgb},0) 100%)`,
          backgroundSize: '200% 100%',
          borderRadius: 2,
          animation: 'podium-shimmer 1.6s linear infinite',
        }} />
      )}

      {/* Return value section — only when done AND we have something meaningful */}
      {(isSuccess && returnSummary) && (
        <div
          style={{
            padding: '7px 14px',
            background: `rgba(${rgb},0.05)`,
            borderTop: '1px solid rgba(46,50,67,0.7)',
            display: 'flex',
            gap: 6,
            alignItems: 'flex-start',
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          <span style={{ color: `rgba(${rgb},0.8)`, flexShrink: 0, fontSize: 11 }}>↩</span>
          <span style={{ color: `rgba(${rgb},0.9)`, fontWeight: 500 }}>{returnSummary}</span>
        </div>
      )}

      {/* Failed state */}
      {isFailed && (
        <div style={{
          padding: '7px 14px', background: 'rgba(239,68,68,0.05)',
          borderTop: '1px solid rgba(46,50,67,0.7)', fontSize: 12,
        }}>
          <span style={{ color: '#ef4444', fontWeight: 500 }}>
            ✕ {toolCall.error?.slice(0, 80) || 'failed'}
          </span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: color, width: 8, height: 8, border: 'none' }}
      />
    </div>
  )
}

export const PipelineAgentNode = memo(PipelineAgentNodeInner)
