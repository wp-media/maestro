import { useStore } from '../store/useStore'

/** Connection state of the SSE stream, surfaced by the store. */
type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

interface IndicatorConfig {
  label: string
  glyph: string
  color: string
  bg: string
  pulse: boolean
}

const INDICATOR: Record<ConnectionStatus, IndicatorConfig> = {
  connected: {
    label: 'Live',
    glyph: '●', // ●
    color: 'var(--success)',
    bg: 'rgba(34,197,94,0.15)',
    pulse: true,
  },
  reconnecting: {
    label: 'Reconnecting',
    glyph: '↺', // ↺
    color: 'var(--warning)',
    bg: 'rgba(245,158,11,0.15)',
    pulse: false,
  },
  disconnected: {
    label: 'Offline',
    glyph: '○', // ○
    color: 'var(--danger)',
    bg: 'rgba(239,68,68,0.15)',
    pulse: false,
  },
}

export default function TopBar() {
  const sessions = useStore((s) => s.sessions)
  const connection = useStore((s) => s.connection)

  const indicator = INDICATOR[connection] ?? INDICATOR.disconnected
  const sessionCount = sessions.length

  return (
    <header
      style={{
        height: 52,
        flex: '0 0 52px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 16px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        userSelect: 'none',
      }}
    >
      {/* Brand: ◆ Podium */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
        <span
          aria-hidden
          style={{
            fontSize: 14,
            lineHeight: 1,
            color: 'var(--brand)',
            transform: 'translateY(-1px)',
            filter: 'drop-shadow(0 0 6px rgba(254,210,58,0.45))',
          }}
        >
          {'◆'}
        </span>
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: 'var(--brand)',
          }}
        >
          Podium
        </span>
      </div>

      {/* WP Media wordmark */}
      <span
        style={{
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          color: 'var(--text-muted)',
          letterSpacing: '0.02em',
        }}
      >
        {'{wpmedia}'}
      </span>

      {/* spacer */}
      <div style={{ flex: 1 }} />

      {/* SSE indicator pill */}
      <span
        title={`Stream ${connection}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 24,
          padding: '0 10px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          color: indicator.color,
          background: indicator.bg,
          border: `1px solid ${indicator.color}33`,
        }}
      >
        <span
          aria-hidden
          className={indicator.pulse ? 'podium-pulse' : undefined}
          style={{ fontSize: 9, lineHeight: 1 }}
        >
          {indicator.glyph}
        </span>
        {indicator.label}
      </span>

      {/* Session count */}
      {sessionCount > 0 && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {sessionCount} session{sessionCount === 1 ? '' : 's'}
        </span>
      )}
    </header>
  )
}
