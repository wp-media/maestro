#!/usr/bin/env node
// podium/install.mjs
// Registers Podium hooks in the project's .claude/settings.json.
//
// Usage:
//   node podium/install.mjs              -- registers hooks, prints status
//   node podium/install.mjs --uninstall  -- removes Podium hooks
//   node podium/install.mjs --check      -- exits 0 if installed, 1 if not

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = resolve(join(__dirname, 'hook.mjs'))

const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',   // turn boundaries — groups tool calls into reasoning turns
  'PreToolUse',         // every tool call start (Bash, Read, Write, Agent, …)
  'PostToolUse',        // every tool call end
  'PostToolUseFailure', // failed tool calls
  'SubagentStart',      // sub-agent identity enrichment
  'SubagentStop',
  'SessionEnd',
]

const PODIUM_MARKER = 'podium/hook.mjs'

// ── Parse args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const MODE = args.includes('--uninstall') ? 'uninstall'
  : args.includes('--check') ? 'check'
  : 'install'

// ── Find settings.json (project or global) ────────────────────────────────────
const projectSettings = join(process.cwd(), '.claude', 'settings.json')
const globalSettings  = join(process.env.HOME ?? '~', '.claude', 'settings.json')
const SETTINGS_PATH   = args.includes('--global') ? globalSettings : projectSettings

// ── Read existing settings ────────────────────────────────────────────────────
let settings = {}
if (existsSync(SETTINGS_PATH)) {
  try { settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) }
  catch { console.error(`Cannot parse ${SETTINGS_PATH}`); process.exit(1) }
}

// ── Check if already installed ────────────────────────────────────────────────
function isInstalled(settings) {
  if (!settings.hooks) return false
  return HOOK_EVENTS.some((evt) => {
    const entries = settings.hooks[evt]
    if (!Array.isArray(entries)) return false
    return entries.some((e) =>
      Array.isArray(e.hooks) &&
      e.hooks.some((h) => typeof h.command === 'string' && h.command.includes(PODIUM_MARKER))
    )
  })
}

if (MODE === 'check') {
  const installed = isInstalled(settings)
  console.log(installed ? 'Podium hooks: installed' : 'Podium hooks: not installed')
  process.exit(installed ? 0 : 1)
}

if (MODE === 'uninstall') {
  if (!settings.hooks) { console.log('Nothing to uninstall.'); process.exit(0) }
  let removed = 0
  for (const evt of HOOK_EVENTS) {
    if (!Array.isArray(settings.hooks[evt])) continue
    const before = settings.hooks[evt].length
    settings.hooks[evt] = settings.hooks[evt].filter((e) =>
      !(Array.isArray(e.hooks) &&
        e.hooks.some((h) => typeof h.command === 'string' && h.command.includes(PODIUM_MARKER)))
    )
    removed += before - settings.hooks[evt].length
  }
  writeSettingsFile(settings)
  console.log(`Podium hooks removed (${removed} entries). Restart Claude Code to apply.`)
  process.exit(0)
}

// ── Install ───────────────────────────────────────────────────────────────────
if (!settings.hooks) settings.hooks = {}

let added = 0
for (const evt of HOOK_EVENTS) {
  if (!settings.hooks[evt]) settings.hooks[evt] = []

  // Skip if already registered for this event
  const already = settings.hooks[evt].some((e) =>
    Array.isArray(e.hooks) &&
    e.hooks.some((h) => typeof h.command === 'string' && h.command.includes(PODIUM_MARKER))
  )
  if (already) continue

  settings.hooks[evt].push({
    hooks: [{
      type: 'command',
      command: `node "${HOOK_PATH}"`,
      timeout: 2,
    }],
  })
  added++
}

if (added === 0) {
  console.log(`Podium hooks already installed in ${SETTINGS_PATH}`)
  process.exit(0)
}

writeSettingsFile(settings)
console.log(`✓ Podium hooks installed (${added} events) in ${SETTINGS_PATH}`)
console.log('  Restart Claude Code to activate.')

// ── Helpers ───────────────────────────────────────────────────────────────────
function writeSettingsFile(data) {
  const dir = join(SETTINGS_PATH, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2) + '\n')
}
