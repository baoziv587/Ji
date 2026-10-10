#!/usr/bin/env node
// Hands a GUI check to the Codex desktop app through its app-server control socket: Codex operates the app with
// Computer Use and reports. The thread is read-only; of the approvals Codex asks for, only Computer Use's access to the
// apps named with --app is granted, every other is declined.
//
//   node codex-verify.mjs <prompt-file> --app "Ji Agent,dev.ji.agent" [--out report.txt] [--cwd dir] [--minutes 6]
//
// Prints Codex's steps as they complete (screenshots left out) and writes them to --out; exits 0 when the turn
// completes, 1 on a connection error, 2 on timeout.
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    app: { type: 'string', default: '' },
    out: { type: 'string', default: 'codex-report.txt' },
    cwd: { type: 'string', default: process.cwd() },
    minutes: { type: 'string', default: '6' },
  },
})
if (positionals.length !== 1) {
  console.error(
    'usage: node codex-verify.mjs <prompt-file> --app "<name>,<bundle id>" [--out f] [--cwd d] [--minutes n]',
  )
  process.exit(1)
}
const prompt = readFileSync(positionals[0], 'utf8')
const apps = values.app
  .split(',')
  .map(a => a.trim())
  .filter(Boolean)
if (apps.length === 0) {
  console.error('--app is required: without it Computer Use is never approved')
  process.exit(1)
}

const WebSocket = loadWs(values.cwd)
const sock = realpathSync(join(process.env.HOME, '.codex/app-server-control/app-server-control.sock'))
// A WebSocket on a unix socket, not JSON lines
const ws = new WebSocket(`ws+unix://${sock}:/`)

let next = 0
const pending = new Map()
const log = []
const call = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++next
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ method, id, params }))
  })
const done = code => {
  writeFileSync(values.out, log.join('\n'))
  ws.close()
  process.exit(code)
}

ws.on('message', raw => {
  const m = JSON.parse(String(raw))
  // A response to one of ours
  if (m.id !== undefined && m.method === undefined) {
    const p = pending.get(m.id)
    pending.delete(m.id)
    return m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
  }
  // A request of Codex's: an approval
  if (m.id !== undefined) {
    const params = JSON.stringify(m.params ?? {})
    const granted = m.method === 'mcpServer/elicitation/request' && apps.some(app => params.includes(app))
    console.log(granted ? 'granted' : 'declined', m.method)
    const result = m.method.includes('elicitation')
      ? granted
        ? { action: 'accept', content: {} }
        : { action: 'decline' }
      : { decision: 'decline' }
    return ws.send(JSON.stringify({ id: m.id, result }))
  }
  if (m.method === 'item/completed') {
    const line = describe(m.params.item)
    if (line !== '') {
      console.log(line)
      log.push(line)
    }
  }
  if (m.method === 'turn/completed') {
    const { status, error } = m.params.turn
    console.log('turn', status, error ? JSON.stringify(error) : '')
    done(0)
  }
})

ws.on('open', async () => {
  try {
    await call('initialize', {
      clientInfo: { name: 'gui_verify', title: 'GUI verify', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    })
    ws.send(JSON.stringify({ method: 'initialized', params: {} }))
    // on-request: under the usual approval_policy = "never", Computer Use is refused outright
    const started = await call('thread/start', { cwd: values.cwd, sandbox: 'read-only', approvalPolicy: 'on-request' })
    console.log('thread', started.thread.id)
    await call('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text: prompt }] })
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})
ws.on('error', error => {
  console.error('ws', error.message)
  process.exit(1)
})
setTimeout(
  () => {
    console.error('timed out')
    done(2)
  },
  Number(values.minutes) * 60_000,
)

/** An item as a line: Codex's messages whole, tool calls short, screenshots left out. */
function describe(item) {
  if (item.type === 'agentMessage') {
    return `[agent] ${item.text}`
  }
  if (item.type === 'mcpToolCall') {
    const texts = (item.result?.content ?? []).filter(c => c.type === 'text').map(c => c.text)
    return `[tool] ${texts.join(' ').slice(0, 400)}`
  }
  return ''
}

/** ws from the project's node_modules, hoisted or in pnpm's store. */
function loadWs(dir) {
  try {
    return createRequire(join(dir, 'noop.js'))('ws')
  } catch {}
  const store = join(dir, 'node_modules/.pnpm')
  const found = existsSync(store) && readdirSync(store).find(d => /^ws@8\./.test(d))
  if (!found) {
    console.error(`ws@8 not found under ${dir}/node_modules: pnpm add -D ws, or pass --cwd a project that has it`)
    process.exit(1)
  }
  return createRequire(join(store, found, 'node_modules/ws/noop.js'))('ws')
}
