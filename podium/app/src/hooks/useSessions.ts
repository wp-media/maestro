import { useEffect } from 'react'
import { useStore } from '../store'

const POLL_INTERVAL_MS = 10_000

/**
 * Loads the session list on mount and polls it every 10s.
 * The store's `refreshSessions` is stable (Zustand action), so we read it
 * lazily from getState() to keep the effect dependency-free.
 */
export function useSessions(): void {
  useEffect(() => {
    let cancelled = false

    const tick = () => {
      if (cancelled) return
      void useStore.getState().refreshSessions()
    }

    tick()
    const interval = setInterval(tick, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])
}

export default useSessions
