import type { ToolCall, ToolCategory } from '../../types'

interface EventRowProps {
  toolCall: ToolCall
  isExpanded: boolean
  onToggle: () => void
}

/** Category → solid color (matches the brand palette mapping). */
const CATEGORY_COLOR: Record<ToolCategory, string> = {
  shell: '#9b9b9b',
  read: '#40b1d0',
  write: '#2bcdc1',
  agent: '#fed23a',
  web: '#f7a933',
  other: '#5a6f8c',
}

/** Convert a #rrggbb hex to an rgba() string at the given alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function formatDuration(ms: number | null): string {
  if (ms == null || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

function StatusDot({ status }: { status: ToolCall['status'] }) {
  if (status === 'running') {
    return (
      <span
        className="podium-pulse"
        aria-label="running"
        style={{ color: 'var(--brand)', fontSize: 9, lineHeight: 1 }}
      >
        {'●'}
      </span>
    )
  }
  if (status === 'success') {
    return (
      <span aria-label="success" style={{ color: 'var(--success)', fontSize: 11, lineHeight: 1 }}>
        {'✓'}
      </span>
    )
  }
  return (
    <span aria-label="failed" style={{ color: 'var(--danger)', fontSize: 11, lineHeight: 1 }}>
      {'✗'}
    </span>
  )
}

export default function EventRow({ toolCall, isExpanded, onToggle }: EventRowProps) {
  const color = CATEGORY_COLOR[toolCall.category] ?? CATEGORY_COLOR.other
  const isAgent = toolCall.tool_name === 'Agent' || toolCall.tool_name === 'Workflow'
  const hasError = !!toolCall.error
  const hasBody = hasError || !!toolCall.output_preview
  const duration = formatDuration(toolCall.duration_ms)

  return (
    <div
      className="podium-event-row"
      data-agent={isAgent || undefined}
      style={{
        borderBottom: '1px solid var(--border)',
        background: isAgent ? hexToRgba(color, 0.07) : 'transparent',
      }}
    >
      {/* Compact line */}
      <button
        type="button"
        onClick={hasBody ? onToggle : undefined}
        aria-expanded={hasBody ? isExpanded : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          minHeight: 36,
          padding: '0 12px',
          textAlign: 'left',
          appearance: 'none',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          font: 'inherit',
          cursor: hasBody ? 'pointer' : 'default',
        }}
      >
        {/* Expand caret (only when there's a body) */}
        <span
          aria-hidden
          style={{
            width: 8,
            flex: '0 0 8px',
            fontSize: 9,
            color: 'var(--text-dim)',
            transform: isExpanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s ease',
            visibility: hasBody ? 'visible' : 'hidden',
          }}
        >
          {'▶'}
        </span>

        {/* Category dot */}
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            flex: '0 0 8px',
            borderRadius: '50%',
            background: color,
          }}
        />

        {/* Tool name badge */}
        <span
          style={{
            flex: '0 0 auto',
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: 999,
            color,
            background: hexToRgba(color, 0.16),
            whiteSpace: 'nowrap',
          }}
        >
          {toolCall.tool_name}
          {toolCall.subagent_type ? `·${toolCall.subagent_type}` : ''}
        </span>

        {/* Summary */}
        <span
          title={toolCall.summary ?? undefined}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {toolCall.summary ?? <span style={{ color: 'var(--text-dim)' }}>—</span>}
        </span>

        {/* Duration */}
        {duration && (
          <span style={{ flex: '0 0 auto', fontSize: 10, color: 'var(--text-dim)' }}>
            {duration}
          </span>
        )}

        {/* Status */}
        <span style={{ flex: '0 0 auto', display: 'inline-flex', width: 12, justifyContent: 'center' }}>
          <StatusDot status={toolCall.status} />
        </span>
      </button>

      {/* Expanded body */}
      {isExpanded && hasBody && (
        <div style={{ padding: '0 12px 10px 36px' }}>
          {hasError ? (
            <pre
              style={{
                margin: 0,
                maxHeight: 120,
                overflowY: 'auto',
                padding: '8px 10px',
                borderRadius: 6,
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.3)',
                color: 'var(--danger)',
                fontSize: 11,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            >
              {toolCall.error}
            </pre>
          ) : (
            <pre
              style={{
                margin: 0,
                maxHeight: 120,
                overflowY: 'auto',
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                fontSize: 11,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            >
              {toolCall.output_preview}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
