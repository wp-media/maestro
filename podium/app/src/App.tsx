import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import { ReasoningGraph } from './components/graph/ReasoningGraph'
import DetailPanel from './components/detail/DetailPanel'
import { useStore } from './store'
import { useSessions } from './hooks/useSessions'
import { useSSE } from './hooks/useSSE'

export function App() {
  const selectedSessionId = useStore((s) => s.selectedSessionId)

  useSessions()
  useSSE(selectedSessionId)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--bg, #0f1318)',
        color: 'var(--text, #f0f4fc)',
      }}
    >
      {/* Fixed 52px top bar */}
      <div style={{ flex: '0 0 52px', minHeight: 0 }}>
        <TopBar />
      </div>

      {/* Body row: sidebar + main */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Fixed 260px sidebar */}
        <div style={{ flex: '0 0 260px', minWidth: 0, overflow: 'hidden' }}>
          <Sidebar />
        </div>

        {/* Main area: graph + overlaid detail panel */}
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Graph fills the entire main area */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <ReasoningGraph />
          </div>

          {/* Detail panel slides up from the bottom via absolute positioning */}
          <DetailPanel />
        </main>
      </div>
    </div>
  )
}
