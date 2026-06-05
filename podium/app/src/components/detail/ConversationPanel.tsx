import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  TranscriptContent,
  TranscriptMessage,
  TranscriptResponse,
} from '../../types'

interface ConversationPanelProps {
  sessionId: string | null
}

const POLL_INTERVAL_MS = 3000
const FETCH_LIMIT = 100

// ── Tool icon + category color mapping ───────────────────────────────────────
type ToolVisual = { icon: string; color: string }

function toolVisual(name: string | undefined): ToolVisual {
  const n = (name ?? '').toLowerCase()
  if (n === 'bash' || n === 'bashoutput' || n === 'killshell') return { icon: '🖥️', color: '#9b9b9b' }
  if (n === 'read' || n === 'glob' || n === 'grep' || n === 'ls') return { icon: '📖', color: '#40b1d0' }
  if (n === 'edit' || n === 'write' || n === 'notebookedit' || n === 'multiedit')
    return { icon: '✏️', color: '#2bcdc1' }
  if (n.includes('web') || n.includes('fetch')) return { icon: '🌐', color: '#f7a933' }
  if (n === 'task' || n === 'agent' || n === 'workflow' || n.includes('agent'))
    return { icon: '🤖', color: '#fed23a' }
  return { icon: '⚡', color: '#5a6f8c' }
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function formatTime(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function shortModel(model: string | undefined): string {
  if (!model) return ''
  // claude-opus-4-8[1m] → claude-opus-4-8
  return model.replace(/\[.*\]$/, '')
}

// ── Extract a plain string from a tool_result content field ───────────────────
function resultToText(content: TranscriptContent['content']): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  return content
    .map((c) => (typeof c === 'string' ? c : c.text ?? ''))
    .filter(Boolean)
    .join('\n')
}

// ── A one-line summary of a tool_use input ────────────────────────────────────
function inputSummary(name: string | undefined, input: Record<string, unknown> | undefined): string {
  if (!input) return ''
  const n = (name ?? '').toLowerCase()
  const get = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  if (n === 'bash') return get('command') ?? ''
  if (n === 'read' || n === 'edit' || n === 'write' || n === 'multiedit' || n === 'notebookedit')
    return get('file_path') ?? get('path') ?? ''
  if (n === 'glob' || n === 'grep') return get('pattern') ?? get('query') ?? ''
  if (n === 'task' || n === 'agent') return get('description') ?? get('subagent_type') ?? get('prompt') ?? ''
  if (n.includes('web') || n.includes('fetch')) return get('url') ?? get('query') ?? ''
  // Fall back to the first stringish value.
  const first = Object.values(input).find((v) => typeof v === 'string') as string | undefined
  return first ?? ''
}

function truncate(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// ── Inline markdown rendering (bold + inline code) ────────────────────────────
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Split on **bold** and `code`, keeping the delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  parts.forEach((part, i) => {
    if (!part) return
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${i}`} style={{ color: 'var(--text)', fontWeight: 700 }}>
          {part.slice(2, -2)}
        </strong>
      )
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      nodes.push(
        <code
          key={`${keyPrefix}-c-${i}`}
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.92em',
            padding: '1px 5px',
            borderRadius: 4,
            background: 'rgba(64,177,208,0.12)',
            color: '#7fd3ec',
          }}
        >
          {part.slice(1, -1)}
        </code>
      )
    } else {
      nodes.push(<span key={`${keyPrefix}-t-${i}`}>{part}</span>)
    }
  })
  return nodes
}

// ── Render assistant prose: split fenced code blocks from prose ───────────────
function MarkdownText({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const out: Array<{ kind: 'code' | 'prose'; body: string }> = []
    const lines = text.split('\n')
    let buffer: string[] = []
    let inCode = false
    let codeBuffer: string[] = []

    const flushProse = () => {
      if (buffer.length) {
        out.push({ kind: 'prose', body: buffer.join('\n') })
        buffer = []
      }
    }
    const flushCode = () => {
      out.push({ kind: 'code', body: codeBuffer.join('\n') })
      codeBuffer = []
    }

    for (const line of lines) {
      if (line.trimStart().startsWith('```')) {
        if (inCode) {
          inCode = false
          flushCode()
        } else {
          flushProse()
          inCode = true
        }
        continue
      }
      if (inCode) codeBuffer.push(line)
      else buffer.push(line)
    }
    // Unterminated code fence — treat the remainder as code.
    if (inCode) flushCode()
    else flushProse()
    return out
  }, [text])

  return (
    <>
      {blocks.map((block, i) =>
        block.kind === 'code' ? (
          <pre
            key={i}
            style={{
              margin: '6px 0',
              padding: '10px 12px',
              borderRadius: 8,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              overflowX: 'auto',
              fontSize: 12,
              lineHeight: 1.55,
            }}
          >
            <code
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: 'var(--text)',
                whiteSpace: 'pre',
              }}
            >
              {block.body}
            </code>
          </pre>
        ) : (
          block.body.split('\n').map((line, j) =>
            line.trim() === '' ? (
              <div key={`${i}-${j}`} style={{ height: 6 }} />
            ) : (
              <p
                key={`${i}-${j}`}
                style={{ margin: '2px 0', fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}
              >
                {renderInline(line, `${i}-${j}`)}
              </p>
            )
          )
        )
      )}
    </>
  )
}

// ── Collapsible thinking block ────────────────────────────────────────────────
function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      style={{
        margin: '4px 0',
        borderRadius: 8,
        background: 'rgba(94,94,94,0.06)',
        border: '1px solid rgba(94,94,94,0.18)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          width: '100%',
          padding: '6px 10px',
          appearance: 'none',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--text-muted)',
          font: 'inherit',
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: 9,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s ease',
            color: 'var(--text-dim)',
          }}
        >
          {'▶'}
        </span>
        <span style={{ fontSize: 11, fontStyle: 'italic' }}>💭 Thinking</span>
      </button>
      {open && (
        <div
          style={{
            padding: '0 10px 10px 26px',
            fontSize: 12,
            fontStyle: 'italic',
            lineHeight: 1.6,
            color: 'var(--text-muted)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </div>
      )}
    </div>
  )
}

// ── Collapsible tool call block ───────────────────────────────────────────────
function ToolCallBlock({
  use,
  result,
}: {
  use: TranscriptContent
  result: TranscriptContent | undefined
}) {
  const [open, setOpen] = useState(false)
  const visual = toolVisual(use.name)
  const summary = truncate(inputSummary(use.name, use.input))
  const isError = result?.is_error === true
  const resultText = result ? resultToText(result.content) : ''
  const inputJson = useMemo(() => {
    try {
      return JSON.stringify(use.input ?? {}, null, 2)
    } catch {
      return String(use.input)
    }
  }, [use.input])

  return (
    <div
      style={{
        margin: '5px 0',
        borderRadius: 8,
        background: 'var(--surface-2)',
        borderLeft: `3px solid ${visual.color}`,
        border: '1px solid var(--border)',
        borderLeftWidth: 3,
        borderLeftColor: visual.color,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          minHeight: 34,
          padding: '0 10px',
          appearance: 'none',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
          font: 'inherit',
        }}
      >
        <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>
          {visual.icon}
        </span>
        <span
          style={{
            flex: '0 0 auto',
            fontSize: 11,
            fontWeight: 600,
            color: visual.color,
          }}
        >
          {use.name ?? 'tool'}
        </span>
        {summary && (
          <span
            title={summary}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily:
                (use.name ?? '').toLowerCase() === 'bash'
                  ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
                  : 'inherit',
            }}
          >
            {(use.name ?? '').toLowerCase() === 'bash' ? `$ ${summary}` : summary}
          </span>
        )}
        {isError && (
          <span style={{ flex: '0 0 auto', fontSize: 11, color: 'var(--danger)' }}>✗</span>
        )}
        <span
          aria-hidden
          style={{
            flex: '0 0 auto',
            marginLeft: 'auto',
            fontSize: 9,
            color: 'var(--text-dim)',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s ease',
          }}
        >
          {'▶'}
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 10px 10px' }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              color: 'var(--text-dim)',
              margin: '2px 0 4px',
            }}
          >
            Input
          </div>
          <pre
            style={{
              margin: 0,
              maxHeight: 200,
              overflow: 'auto',
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
            {inputJson}
          </pre>

          {result && (
            <>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  color: isError ? 'var(--danger)' : 'var(--text-dim)',
                  margin: '8px 0 4px',
                }}
              >
                {isError ? 'Error' : 'Result'}
              </div>
              <pre
                style={{
                  margin: 0,
                  maxHeight: 220,
                  overflow: 'auto',
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: isError ? 'rgba(239,68,68,0.08)' : 'var(--bg)',
                  border: `1px solid ${isError ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
                  color: isError ? 'var(--danger)' : 'var(--text-muted)',
                  fontSize: 11,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >
                {resultText || '(no output)'}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── User message bubble ───────────────────────────────────────────────────────
function UserMessage({ msg }: { msg: TranscriptMessage }) {
  const content = Array.isArray(msg.content) ? msg.content : []
  const text = content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text as string)
    .join('\n')
    .trim()

  // A user message may also be a tool_result echo — skip if it carries no prose.
  if (!text) return null

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div
        style={{
          maxWidth: '82%',
          padding: '8px 12px',
          borderRadius: 10,
          background: 'rgba(254,210,58,0.08)',
          border: '1px solid rgba(254,210,58,0.2)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'var(--brand)' }}>
            USER
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{formatTime(msg.timestamp)}</span>
        </div>
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textAlign: 'left',
          }}
        >
          {text}
        </div>
      </div>
    </div>
  )
}

// ── Assistant message ─────────────────────────────────────────────────────────
function AssistantMessage({
  msg,
  resultsById,
}: {
  msg: TranscriptMessage
  resultsById: Map<string, TranscriptContent>
}) {
  const usage = msg.usage
  const inTok = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0)
  const outTok = usage?.output_tokens ?? 0

  // Normalise content to always be an array (some transcript lines use a string)
  const contentArr = Array.isArray(msg.content) ? msg.content : []

  // Nothing visible? Skip empty assistant frames.
  const hasContent = contentArr.some(
    (c) =>
      (c.type === 'text' && c.text && c.text.trim()) ||
      c.type === 'tool_use' ||
      (c.type === 'thinking' && c.thinking)
  )
  if (!hasContent) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '92%' }}>
      {/* Meta line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span aria-hidden style={{ color: 'var(--brand)', fontSize: 11, lineHeight: 1 }}>
          ◆
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{formatTime(msg.timestamp)}</span>
        {msg.model && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{shortModel(msg.model)}</span>
        )}
        {(inTok > 0 || outTok > 0) && (
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {inTok > 0 && `${inTok}↑`} {outTok > 0 && `${outTok}↓`}
          </span>
        )}
      </div>

      {/* Content stream */}
      <div style={{ paddingLeft: 19 }}>
        {contentArr.map((c, i) => {
          if (c.type === 'thinking' && c.thinking) {
            return <ThinkingBlock key={i} text={c.thinking} />
          }
          if (c.type === 'text' && c.text && c.text.trim()) {
            return <MarkdownText key={i} text={c.text} />
          }
          if (c.type === 'tool_use') {
            const result = c.id ? resultsById.get(c.id) : undefined
            return <ToolCallBlock key={c.id ?? i} use={c} result={result} />
          }
          return null
        })}
      </div>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 14 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="podium-pulse"
          style={{
            alignSelf: i % 2 === 0 ? 'flex-start' : 'flex-end',
            width: i % 2 === 0 ? '70%' : '50%',
            height: 48,
            borderRadius: 10,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
        />
      ))}
    </div>
  )
}

export function ConversationPanel({ sessionId }: ConversationPanelProps) {
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showNewButton, setShowNewButton] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const prevCountRef = useRef(0)
  const reqIdRef = useRef(0)

  const fetchTranscript = useCallback(
    async (mode: 'initial' | 'poll') => {
      if (!sessionId) return
      const myReq = ++reqIdRef.current
      if (mode === 'initial') setLoading(true)
      else setRefreshing(true)
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/transcript?limit=${FETCH_LIMIT}`
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: TranscriptResponse = await res.json()
        // Ignore stale responses (session switched mid-flight).
        if (myReq !== reqIdRef.current) return
        setMessages(data.messages ?? [])
        setTotal(data.total ?? data.messages?.length ?? 0)
        setError(null)
      } catch (e) {
        if (myReq !== reqIdRef.current) return
        setError(e instanceof Error ? e.message : 'Failed to load transcript')
      } finally {
        if (myReq === reqIdRef.current) {
          setLoading(false)
          setRefreshing(false)
          setLoaded(true)
        }
      }
    },
    [sessionId]
  )

  // Reset + initial fetch + poll loop when the session changes.
  useEffect(() => {
    setMessages([])
    setTotal(0)
    setLoaded(false)
    setError(null)
    setShowNewButton(false)
    prevCountRef.current = 0
    atBottomRef.current = true
    if (!sessionId) return
    fetchTranscript('initial')
    const id = window.setInterval(() => fetchTranscript('poll'), POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [sessionId, fetchTranscript])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    setShowNewButton(false)
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distance < 40
    atBottomRef.current = atBottom
    if (atBottom) setShowNewButton(false)
  }, [])

  // Auto-scroll on new messages if we were already pinned to the bottom.
  useEffect(() => {
    const count = messages.length
    if (count === prevCountRef.current) return
    const grew = count > prevCountRef.current
    prevCountRef.current = count
    if (!grew) return
    if (atBottomRef.current) {
      // Defer to let the DOM paint.
      requestAnimationFrame(() => scrollToBottom('smooth'))
    } else {
      setShowNewButton(true)
    }
  }, [messages.length, scrollToBottom])

  // First successful load → jump to bottom instantly.
  useEffect(() => {
    if (loaded && messages.length > 0) {
      requestAnimationFrame(() => scrollToBottom('auto'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  // Map tool_use_id → tool_result content, scanning all (user) messages.
  const resultsById = useMemo(() => {
    const map = new Map<string, TranscriptContent>()
    for (const m of messages) {
      for (const c of m.content) {
        if (c.type === 'tool_result' && c.tool_use_id) map.set(c.tool_use_id, c)
      }
    }
    return map
  }, [messages])

  // Renderable messages: drop system frames and pure tool_result user frames.
  const renderable = useMemo(
    () => messages.filter((m) => m.type === 'user' || m.type === 'assistant'),
    [messages]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header bar */}
      <div
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Conversation</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {renderable.length} message{renderable.length === 1 ? '' : 's'}
          {total > messages.length ? ` of ${total}` : ''}
        </span>
        <button
          type="button"
          onClick={() => fetchTranscript('poll')}
          disabled={!sessionId || refreshing}
          aria-label="Refresh transcript"
          title="Refresh"
          className="podium-icon-btn"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            height: 26,
            padding: '0 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: sessionId && !refreshing ? 'pointer' : 'default',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          <span
            aria-hidden
            className={refreshing ? 'podium-pulse' : undefined}
            style={{ fontSize: 12, lineHeight: 1 }}
          >
            ↻
          </span>
          Refresh
        </button>
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ position: 'relative', flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        {!sessionId ? (
          <div style={{ padding: '24px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
            Select a session to view its conversation.
          </div>
        ) : !loaded && loading ? (
          <Skeleton />
        ) : error ? (
          <div style={{ padding: '24px 14px' }}>
            <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 6 }}>
              Could not load transcript — {error}
            </div>
            <button
              type="button"
              onClick={() => fetchTranscript('initial')}
              style={{
                appearance: 'none',
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        ) : renderable.length === 0 ? (
          <div
            style={{
              padding: '32px 18px',
              maxWidth: 480,
              margin: '0 auto',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 22, marginBottom: 8 }}>💬</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
              No transcript available
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)' }}>
              Claude Code may not have written one yet for this session, or the transcript file has
              been pruned. New sessions will capture transcripts automatically.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}>
            {renderable.map((m) =>
              m.type === 'user' ? (
                <UserMessage key={m.id} msg={m} />
              ) : (
                <AssistantMessage key={m.id} msg={m} resultsById={resultsById} />
              )
            )}
          </div>
        )}

        {/* New-messages affordance */}
        {showNewButton && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            style={{
              position: 'sticky',
              bottom: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 999,
              border: '1px solid rgba(254,210,58,0.4)',
              background: 'var(--brand)',
              color: '#0f1318',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
            }}
          >
            ↓ New messages
          </button>
        )}
      </div>
    </div>
  )
}

export default ConversationPanel
