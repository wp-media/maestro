import { useMemo } from 'react'
import type { SessionSummary, SessionStatus } from '../types'
import { useStore } from '../store/useStore'

/** Format a duration in ms as a compact human string. */
function formatDuration(ms: number | null): string {
  if (ms == null || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** Basename of a path, tolerant of trailing slashes. */
function basename(p: string | null): string | null {
  if (!p) return null
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

interface StatusDotProps {
  status: SessionStatus
}

function StatusDot({ status }: StatusDotProps) {
  if (status === 'running') {
    return (
      <span
        className="podium-pulse"
        aria-label="running"
        style={{ color: 'var(--brand)', fontSize: 10, lineHeight: 1 }}
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

interface SessionRowProps {
  session: SessionSummary
  selected: boolean
  onSelect: () => void
}

function SessionRow({ session, selected, onSelect }: SessionRowProps) {
  const shortId = session.session_id.slice(-8)
  const dir = basename(session.cwd)
  const statusLabel =
    session.status === 'running' ? 'running' : session.status === 'success' ? 'done' : 'failed'

  return (
    <button
      type="button"
      onClick={onSelect}
      className="podium-session-row"
      data-selected={selected || undefined}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        appearance: 'none',
        background: selected ? 'var(--surface-3)' : 'transparent',
        border: 'none',
        borderLeft: `2px solid ${selected ? 'var(--brand)' : 'transparent'}`,
        padding: '8px 12px 8px 10px',
        color: 'inherit',
        font: 'inherit',
      }}
    >
      {/* Row 1: id + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <StatusDot status={session.status} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          {shortId}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {statusLabel}
        </span>
      </div>

      {/* Row 2: first label + duration */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 3 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            fontStyle: 'italic',
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {session.first_label || 'No activity yet'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: '0 0 auto' }}>
          {formatDuration(session.total_duration_ms)}
        </span>
      </div>

      {/* Row 3: cwd basename */}
      {dir && (
        <div
          title={session.cwd ?? undefined}
          style={{
            marginTop: 2,
            fontSize: 10,
            color: 'var(--text-dim)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {dir}
        </div>
      )}
    </button>
  )
}

function SkeletonRow() {
  return (
    <div style={{ padding: '8px 12px 8px 10px' }}>
      <div className="podium-shimmer" style={{ height: 12, width: '55%', borderRadius: 4 }} />
      <div className="podium-shimmer" style={{ height: 10, width: '80%', borderRadius: 4, marginTop: 6 }} />
      <div className="podium-shimmer" style={{ height: 9, width: '40%', borderRadius: 4, marginTop: 5 }} />
    </div>
  )
}

export default function Sidebar() {
  const sessions = useStore((s) => s.sessions)
  const selectedSessionId = useStore((s) => s.selectedSessionId)
  const selectSession = useStore((s) => s.selectSession)
  const refreshSessions = useStore((s) => s.refreshSessions)
  const loading = useStore((s) => s.loadingSessions)

  const sorted = useMemo(
    () => [...sessions].sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0)),
    [sessions]
  )

  return (
    <aside
      style={{
        width: 260,
        flex: '0 0 260px',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        minHeight: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 38,
          flex: '0 0 38px',
          padding: '0 10px 0 12px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
          }}
        >
          SESSIONS
        </span>
        <button
          type="button"
          onClick={() => refreshSessions()}
          title="Refresh sessions"
          aria-label="Refresh sessions"
          className="podium-icon-btn"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          <span className={loading ? 'podium-spin' : undefined}>{'↺'}</span>
        </button>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {loading && sessions.length === 0 ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
              No sessions yet
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                lineHeight: 1.5,
                color: 'var(--text-dim)',
              }}
            >
              Run <code style={{ color: 'var(--brand)' }}>/podium setup</code>, restart Claude
              Code, then start a pipeline.
            </div>
          </div>
        ) : (
          sorted.map((session) => (
            <SessionRow
              key={session.session_id}
              session={session}
              selected={session.session_id === selectedSessionId}
              onSelect={() => selectSession(session.session_id)}
            />
          ))
        )}
      </div>
    </aside>
  )
}
