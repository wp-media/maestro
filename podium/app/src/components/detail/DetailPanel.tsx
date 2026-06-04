import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Turn, ItemStatus } from '../../types'
import { useStore } from '../../store/useStore'
import EventRow from './EventRow'

type Tab = 'tools' | 'context'

const MIN_HEIGHT = 200
const MAX_HEIGHT = 640
const DEFAULT_HEIGHT = 320

function formatDuration(ms: number | null): string {
  if (ms == null || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

function StatusBadge({ status }: { status: Turn['status'] | ItemStatus }) {
  const map: Record<string, { label: string; color: string }> = {
    running: { label: 'Running', color: 'var(--brand)' },
    done: { label: 'Done', color: 'var(--success)' },
    success: { label: 'Success', color: 'var(--success)' },
    failed: { label: 'Failed', color: 'var(--danger)' },
  }
  const cfg = map[status] ?? map.done
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 22,
        padding: '0 9px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color: cfg.color,
        background: `${cfg.color}22`,
        border: `1px solid ${cfg.color}40`,
      }}
    >
      {status === 'running' && (
        <span className="podium-pulse" style={{ fontSize: 8 }}>
          {'●'}
        </span>
      )}
      {cfg.label}
    </span>
  )
}

interface TabButtonProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  count?: number
}

function TabButton({ active, onClick, children, count }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'relative',
        appearance: 'none',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        height: 34,
        padding: '0 4px',
        fontSize: 12,
        fontWeight: 600,
        color: active ? 'var(--text)' : 'var(--text-muted)',
        borderBottom: `2px solid ${active ? 'var(--brand)' : 'transparent'}`,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {children}
      {count != null && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: 999,
            color: 'var(--text-muted)',
            background: 'var(--surface-3)',
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

export default function DetailPanel() {
  const selectedTurn = useStore((s) => s.selectedTurn)
  const selectTurn = useStore((s) => s.selectTurn)

  const [tab, setTab] = useState<Tab>('tools')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [height, setHeight] = useState(DEFAULT_HEIGHT)

  // The turn we render. Keep the last non-null turn so the panel can animate
  // out gracefully instead of snapping to empty mid-slide.
  const lastTurnRef = useRef<Turn | null>(null)
  if (selectedTurn) lastTurnRef.current = selectedTurn
  const turn = selectedTurn ?? lastTurnRef.current
  const visible = selectedTurn !== null

  // Reset transient UI state whenever a different turn is opened.
  useEffect(() => {
    if (selectedTurn) {
      setTab('tools')
      setExpanded(new Set())
    }
  }, [selectedTurn?.id])

  const close = useCallback(() => selectTurn(null), [selectTurn])

  // Escape closes the panel.
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, close])

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Drag-to-resize handle.
  const dragState = useRef<{ startY: number; startH: number } | null>(null)
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragState.current = { startY: e.clientY, startH: height }
      const onMove = (ev: MouseEvent) => {
        if (!dragState.current) return
        const delta = dragState.current.startY - ev.clientY
        const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragState.current.startH + delta))
        setHeight(next)
      }
      const onUp = () => {
        dragState.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.userSelect = ''
      }
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [height]
  )

  const agentSpawnCount = useMemo(
    () => (turn ? turn.agent_spawns.length : 0),
    [turn]
  )

  return (
    <div
      role="dialog"
      aria-hidden={!visible}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-2)',
        borderTop: '1px solid var(--border-light)',
        boxShadow: '0 -8px 28px rgba(0,0,0,0.45)',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.25s ease-out',
        zIndex: 20,
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={onDragStart}
        title="Drag to resize"
        style={{
          height: 10,
          flex: '0 0 10px',
          cursor: 'ns-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 40,
            height: 3,
            borderRadius: 999,
            background: 'var(--border-light)',
          }}
        />
      </div>

      {turn && (
        <>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '0 14px 8px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>
              {turn.icon}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {turn.label}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: '0 0 auto' }}>
              {formatDuration(turn.duration_ms)}
            </span>
            <StatusBadge status={turn.status} />
            <button
              type="button"
              onClick={close}
              aria-label="Close detail panel"
              title="Close (Esc)"
              className="podium-icon-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              {'✕'}
            </button>
          </div>

          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '0 14px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <TabButton active={tab === 'tools'} onClick={() => setTab('tools')} count={turn.tool_calls.length}>
              Tools
            </TabButton>
            <TabButton active={tab === 'context'} onClick={() => setTab('context')}>
              Context
            </TabButton>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {tab === 'tools' ? (
              turn.tool_calls.length === 0 ? (
                <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                  No tool calls in this turn.
                </div>
              ) : (
                turn.tool_calls.map((tc) => (
                  <EventRow
                    key={tc.id}
                    toolCall={tc}
                    isExpanded={expanded.has(tc.id)}
                    onToggle={() => toggle(tc.id)}
                  />
                ))
              )
            ) : (
              <div style={{ padding: '14px' }}>
                {turn.prompt_preview ? (
                  <pre
                    style={{
                      margin: 0,
                      padding: '12px 14px',
                      borderRadius: 8,
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      fontSize: 12,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}
                  >
                    {turn.prompt_preview}
                  </pre>
                ) : (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      No user prompt captured for this turn
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 11,
                        fontStyle: 'italic',
                        color: 'var(--text-dim)',
                      }}
                    >
                      Prompts are captured from UserPromptSubmit hooks.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer stats */}
          <div
            style={{
              flex: '0 0 auto',
              padding: '8px 14px',
              borderTop: '1px solid var(--border)',
              fontSize: 11,
              color: 'var(--text-muted)',
            }}
          >
            {turn.tool_calls.length} tool call{turn.tool_calls.length === 1 ? '' : 's'}
            {' · '}
            {agentSpawnCount} agent spawn{agentSpawnCount === 1 ? '' : 's'}
            {' · '}
            {formatDuration(turn.duration_ms)}
          </div>
        </>
      )}
    </div>
  )
}
