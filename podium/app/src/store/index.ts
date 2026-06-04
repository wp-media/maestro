import { create } from 'zustand'
import { AppState, RawEvent, Session, SessionSummary, Turn } from '../types'
import { processEvents, appendEvents } from '../lib/event-processor'

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${url})`)
  }
  return (await res.json()) as T
}

/** Normalize a raw snapshot response into a RawEvent[] regardless of envelope. */
function extractEvents(payload: unknown): RawEvent[] {
  if (Array.isArray(payload)) return payload as RawEvent[]
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    if (Array.isArray(obj.events)) return obj.events as RawEvent[]
  }
  return []
}

/** Derive the `connection` field from sseConnected / sseReconnecting. */
function deriveConnection(
  connected: boolean,
  reconnecting: boolean,
): AppState['connection'] {
  if (connected) return 'connected'
  if (reconnecting) return 'reconnecting'
  return 'disconnected'
}

/** Derive selectedTurn from the selected session and the selected turn id. */
function deriveSelectedTurn(
  session: Session | null,
  turnId: string | null,
): Turn | null {
  if (!session || !turnId) return null
  return session.turns.find((t) => t.id === turnId) ?? null
}

export const useStore = create<AppState>((set, get) => ({
  sessions: [],
  selectedSessionId: null,
  selectedSession: null,
  selectedTurnId: null,
  selectedTurn: null,
  isLoadingSessions: false,
  loadingSessions: false,
  isLoadingSession: false,
  sseConnected: false,
  sseReconnecting: false,
  connection: 'disconnected',

  refreshSessions: async () => {
    set({ isLoadingSessions: true, loadingSessions: true })
    try {
      const sessions = await fetchJSON<SessionSummary[]>('/api/sessions')
      const normalized = Array.isArray(sessions) ? sessions : []
      set({ sessions: normalized, isLoadingSessions: false, loadingSessions: false })
      // Auto-select most recent if nothing selected
      const { selectedSessionId } = get()
      if (!selectedSessionId && normalized.length > 0) {
        get().selectSession(normalized[0].session_id)
      }
    } catch (err) {
      console.error('[podium] refreshSessions failed', err)
      set({ isLoadingSessions: false, loadingSessions: false })
    }
  },

  selectSession: (id: string) => {
    set({
      selectedSessionId: id,
      selectedTurnId: null,
      selectedTurn: null,
      isLoadingSession: true,
      selectedSession: null,
    })

    void (async () => {
      try {
        const payload = await fetchJSON<unknown>(
          `/api/sessions/${encodeURIComponent(id)}/events?snapshot=1`,
        )
        if (get().selectedSessionId !== id) return
        const events = extractEvents(payload)
        const session = processEvents(events, id)
        set({ selectedSession: session, isLoadingSession: false })
      } catch (err) {
        console.error('[podium] selectSession failed', err)
        if (get().selectedSessionId === id) {
          set({ isLoadingSession: false })
        }
      }
    })()
  },

  selectTurn: (turnId: string | null) => {
    const { selectedSession } = get()
    set({
      selectedTurnId: turnId,
      selectedTurn: deriveSelectedTurn(selectedSession, turnId),
    })
  },

  setSSEStatus: (connected: boolean, reconnecting = false) => {
    set({
      sseConnected: connected,
      sseReconnecting: reconnecting,
      connection: deriveConnection(connected, reconnecting),
    })
  },

  appendRawEvents: (events: RawEvent[]) => {
    if (!events || events.length === 0) return
    const state = get()
    const current = state.selectedSession

    let nextSession: Session | null
    if (current) {
      nextSession = appendEvents(current, events)
    } else if (state.selectedSessionId) {
      nextSession = processEvents(events, state.selectedSessionId)
    } else {
      nextSession = null
    }

    if (!nextSession) return

    // Re-derive selectedTurn in case the turn was updated.
    const nextSelectedTurn = deriveSelectedTurn(nextSession, state.selectedTurnId)

    // Reflect status changes into the sessions list summary.
    let nextSessions = state.sessions
    const idx = state.sessions.findIndex(
      (s) => s.session_id === nextSession!.id || s.run_id === nextSession!.id,
    )
    if (idx !== -1) {
      const summary = state.sessions[idx]
      if (
        summary.status !== nextSession.status ||
        summary.ended_at !== nextSession.ended_at ||
        summary.turn_count !== nextSession.turns.length
      ) {
        const updated: SessionSummary = {
          ...summary,
          status: nextSession.status,
          ended_at: nextSession.ended_at,
          total_duration_ms: nextSession.duration_ms,
          turn_count: nextSession.turns.length,
          event_count: summary.event_count + events.length,
        }
        nextSessions = [...state.sessions]
        nextSessions[idx] = updated
      }
    }

    set({
      selectedSession: nextSession,
      selectedTurn: nextSelectedTurn,
      sessions: nextSessions,
    })
  },
}))

export default useStore
