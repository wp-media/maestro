import { useEffect } from 'react'
import { useStore } from '../store'
import { RawEvent } from '../types'

const RECONNECT_DELAY_MS = 3000

/**
 * Maintains an SSE connection to the selected session's event stream.
 *
 * On `sessionId` change it first pulls a snapshot (so the graph is fully
 * populated immediately), then opens an EventSource for live updates. The
 * snapshot is also applied via `appendRawEvents` so the store's incremental
 * path stays the single source of truth — note `selectSession` in the store
 * already processes the snapshot, so here we only stream deltas after open.
 */
export function useSSE(sessionId: string | null): void {
  useEffect(() => {
    if (!sessionId) return

    let cancelled = false
    let es: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const { appendRawEvents, setSSEStatus } = useStore.getState()

    const parse = (raw: string): RawEvent | null => {
      try {
        return JSON.parse(raw) as RawEvent
      } catch {
        return null
      }
    }

    const connect = () => {
      if (cancelled) return

      es = new EventSource(
        `/api/sessions/${encodeURIComponent(sessionId)}/events`,
      )

      es.addEventListener('connected', () => {
        if (cancelled) return
        setSSEStatus(true, false)
      })

      es.addEventListener('event', (e) => {
        if (cancelled) return
        const ev = parse((e as MessageEvent).data)
        if (ev) appendRawEvents([ev])
      })

      // Keep-alive — intentionally ignored.
      es.addEventListener('ping', () => {})

      // Default message handler in case the server emits unnamed events.
      es.onmessage = (e) => {
        if (cancelled) return
        const ev = parse(e.data)
        if (ev) appendRawEvents([ev])
      }

      es.onerror = () => {
        if (cancelled) return
        setSSEStatus(false, true)
        if (es) {
          es.close()
          es = null
        }
        if (retryTimer) clearTimeout(retryTimer)
        retryTimer = setTimeout(connect, RECONNECT_DELAY_MS)
      }
    }

    // Prime the store with a snapshot, then start streaming.
    const bootstrap = async () => {
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/events?snapshot=1`,
        )
        if (cancelled) return
        if (res.ok) {
          const payload: unknown = await res.json()
          if (cancelled) return
          const events: RawEvent[] = Array.isArray(payload)
            ? (payload as RawEvent[])
            : Array.isArray((payload as { events?: unknown })?.events)
              ? ((payload as { events: RawEvent[] }).events)
              : []
          if (events.length > 0) appendRawEvents(events)
        }
      } catch (err) {
        console.error('[podium] SSE snapshot fetch failed', err)
      } finally {
        if (!cancelled) connect()
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (es) {
        es.close()
        es = null
      }
      setSSEStatus(false, false)
    }
  }, [sessionId])
}

export default useSSE
