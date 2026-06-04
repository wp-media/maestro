import { ToolCall, ToolCategory } from '../types'

// Tie-break priority: agent > write > shell > read > web > other
const CATEGORY_PRIORITY: ToolCategory[] = ['agent', 'write', 'shell', 'read', 'web', 'other']

function basename(path: string): string {
  if (!path) return path
  // Strip trailing slashes, then take the last path segment.
  const cleaned = path.replace(/[\\/]+$/, '')
  const parts = cleaned.split(/[\\/]/)
  return parts[parts.length - 1] || cleaned
}

/**
 * Extract a plausible file path from a write-category tool call's summary.
 * Summaries are typically "Write to src/foo.ts" / "Edit src/foo.ts" etc.
 */
function fileFromToolCall(t: ToolCall): string | null {
  const summary = t.summary
  if (!summary) return null
  // Find a token that looks like a path (contains a slash or a dot extension).
  const tokens = summary.split(/\s+/)
  for (const tok of tokens) {
    const stripped = tok.replace(/^["'`(]+|["'`)]+$/g, '')
    if (/[\\/]/.test(stripped) || /\.[A-Za-z0-9]+$/.test(stripped)) {
      return basename(stripped)
    }
  }
  return null
}

export function labelTurn(
  toolCalls: ToolCall[],
): { label: string; icon: string; category: ToolCategory } {
  if (!toolCalls || toolCalls.length === 0) {
    return { label: 'Processing', icon: '⚡', category: 'other' }
  }

  // 1. Count tool_calls by category.
  const counts: Record<ToolCategory, number> = {
    shell: 0,
    read: 0,
    write: 0,
    agent: 0,
    web: 0,
    other: 0,
  }
  for (const t of toolCalls) counts[t.category] = (counts[t.category] ?? 0) + 1

  // 2. Dominant = highest count; ties resolved by CATEGORY_PRIORITY.
  let dominant: ToolCategory = 'other'
  let bestCount = -1
  for (const cat of CATEGORY_PRIORITY) {
    if (counts[cat] > bestCount) {
      bestCount = counts[cat]
      dominant = cat
    }
  }

  switch (dominant) {
    case 'agent': {
      const agents = toolCalls.filter(
        (t) => t.tool_name === 'Agent' || t.tool_name === 'Workflow',
      )
      if (agents.length === 1) {
        const a = agents[0]
        const name =
          a.subagent_type ||
          (typeof a.summary === 'string' ? a.summary.slice(0, 30) : '') ||
          'agent'
        return { label: `Spawning ${name}`, icon: '🤖', category: 'agent' }
      }
      return {
        label: `Spawning ${agents.length} agents`,
        icon: '🤖',
        category: 'agent',
      }
    }

    case 'write': {
      const files = Array.from(
        new Set(
          toolCalls
            .filter((t) => t.category === 'write')
            .map((t) => fileFromToolCall(t))
            .filter((f): f is string => !!f),
        ),
      )
      if (files.length === 1) {
        return { label: `Writing ${files[0]}`, icon: '✏️', category: 'write' }
      }
      if (files.length === 0) {
        return { label: 'Writing files', icon: '✏️', category: 'write' }
      }
      return {
        label: `Writing ${files.length} files`,
        icon: '✏️',
        category: 'write',
      }
    }

    case 'shell': {
      const first = toolCalls.find((t) => t.tool_name === 'Bash')?.summary ?? ''
      if (first.includes('git commit')) {
        return { label: 'Committing changes', icon: '💾', category: 'shell' }
      }
      if (first.includes('git checkout') || first.includes('git switch')) {
        return { label: 'Switching branch', icon: '🔀', category: 'shell' }
      }
      if (
        first.includes('npm') ||
        first.includes('node') ||
        first.includes('yarn') ||
        first.includes('bun')
      ) {
        return { label: 'Running scripts', icon: '⚙️', category: 'shell' }
      }
      if (first.includes('curl') || first.includes('wget')) {
        return { label: 'HTTP request', icon: '🌐', category: 'shell' }
      }
      return { label: 'Running commands', icon: '🖥️', category: 'shell' }
    }

    case 'read':
      return { label: 'Reading codebase', icon: '📖', category: 'read' }

    case 'web':
      return { label: 'Web research', icon: '🔍', category: 'web' }

    default:
      return { label: 'Processing', icon: '⚡', category: 'other' }
  }
}
