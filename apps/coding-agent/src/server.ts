// The coding agent as an HTTP service, for a client with a window of its own (apps/desktop): any number of sessions,
// each in a folder of its own, with the same tools, approvals and steering as the terminal, put to whoever connects
// (server/http.ts lists the routes). Each session's run events go to a JSONL log, which it is read back from when the
// service starts again.
//
//   node src/server.ts [options]
//
//   --host host        where it listens (default: 127.0.0.1, this machine only: whoever connects runs commands)
//   --port n           (default: 4317; 0 picks a free one)
//   --model provider/id   pi-ai's catalog; the key comes from what /login kept in ~/.ji, or the provider's environment
//                      variable (default: deepseek/deepseek-flash)
//   --thinking level   (default: high)
//   --root dir         where a new session works when the client names no folder (default: the current directory)
//   --sessions dir     where the sessions are kept (default: ~/.ji/sessions)
//   --skills dir       the skills, one SKILL.md folder each (default: ~/.agents/skills)
//   --yolo             nothing waits for a yes
//   --shared           the one service of this machine, the terminal's and the desktop app's alike: see below
//
// Once it listens it prints one line to stdout, `listening on http://host:port`, for whoever started it to read.
//
// Shared, it is started by whichever client comes first, on the port every client looks at, and outlives it: it ends
// once no client has been connected and no session replying for a while. One already there on that port and of the
// same code is used instead: the line names it, and this one ends. One of older code is stopped and taken over, unless
// it is in use: then it is used as it is, until it ends of itself.

import type { ThinkingLevel } from '@ji.dev/llm'
import type { Server } from 'node:http'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { findModel, UnsupportedThinkingError, useCredentialStore } from '@ji.dev/llm'
import { createFileCredentialStore, registerEndpoints } from '@ji.dev/plugin-auth'
import { createAgentHttpServer } from './server/http.ts'
import { SessionOpener } from './server/open.ts'
import { SessionHub } from './server/sessions.ts'
import { serviceAt, SHARED_HOST, SHARED_PORT, stopServiceAt } from './server/shared.ts'
import { SessionStore } from './server/store.ts'
import { codeVersion } from './server/version.ts'

const { values: ARGS } = parseArgs({
  options: {
    host: { type: 'string', default: SHARED_HOST },
    port: { type: 'string', default: String(SHARED_PORT) },
    model: { type: 'string', default: 'deepseek/deepseek-flash' },
    thinking: { type: 'string', default: 'high' },
    root: { type: 'string', default: process.env.INIT_CWD ?? process.cwd() },
    sessions: { type: 'string', default: join(homedir(), '.ji', 'sessions') },
    skills: { type: 'string', default: join(homedir(), '.agents', 'skills') },
    yolo: { type: 'boolean', default: false },
    shared: { type: 'boolean', default: false },
  },
})

/** A shared service with no client connected and no session replying ends after this long. */
const IDLE_MS = 30_000

/** How long a shared service of older code may take to give up the port, a tenth of a second at a time. */
const TAKEOVER_TRIES = 50
const TAKEOVER_WAIT_MS = 100

const AUTH = join(homedir(), '.ji')
useCredentialStore(createFileCredentialStore(join(AUTH, 'auth.json')))
registerEndpoints(AUTH)

const thinking = ARGS.thinking as ThinkingLevel
// A typo in the model or the level stops the service before it listens, with the choices listed
const info = findModel(ARGS.model)
if (!info.thinkingLevels.includes(thinking)) {
  throw new UnsupportedThinkingError(info, thinking)
}

const store = new SessionStore(ARGS.sessions)
const hub = new SessionHub({
  store,
  opener: new SessionOpener({
    store,
    model: ARGS.model,
    thinking,
    skills: ARGS.skills,
    auth: AUTH,
  }),
  mode: ARGS.yolo ? 'yolo' : 'ask',
})

const version = codeVersion()

let idle: NodeJS.Timeout | undefined

const server = createAgentHttpServer({
  hub,
  defaultRoot: resolve(ARGS.root),
  auth: AUTH,
  version,
  stop: ARGS.shared ? shutdown : undefined,
  inUse: ARGS.shared ? stayWhileInUse : undefined,
})

const url = await listen(server)
process.stdout.write(`listening on ${url}\n`)
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

if (ARGS.shared) {
  // Whoever started it reads up to the line, then may go: what is written after it has nowhere to go
  process.stdout.on('error', () => {})
  // Nothing can use it before it listens
  stayWhileInUse(false)
}

function shutdown(): void {
  server.closeAllConnections()
  server.close()
  hub.close().finally(() => process.exit(0))
}

/** Ends a shared service once it has not been in use for IDLE_MS. */
function stayWhileInUse(inUse: boolean): void {
  if (inUse) {
    clearTimeout(idle)
    idle = undefined
  } else {
    idle ??= setTimeout(shutdown, IDLE_MS)
  }
}

/**
 * Listens on --port; shared, a service already there of the same code, or of older code still in use, is used instead:
 * its address comes back, and this one ends once it has said so.
 */
async function listen(server: Server): Promise<string> {
  const port = Number(ARGS.port)
  const there = `http://${ARGS.host}:${port}`
  for (let tries = 0; ; tries++) {
    try {
      return await listenOn(server, port)
    } catch (error) {
      if (!ARGS.shared || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        throw error
      }
    }

    // Stopped already, and the port not free yet
    if (tries > 0 && tries < TAKEOVER_TRIES) {
      await sleep(TAKEOVER_WAIT_MS)
      continue
    }

    const found = await serviceAt(there)
    if (found === undefined) {
      throw new Error(`port ${port} is taken by something other than the coding agent's service: pass --port`)
    }
    if (tries > 0 || found.version === version || !(await stopServiceAt(there))) {
      process.stdout.write(`listening on ${there}\n`)
      process.exit(0)
    }
  }
}

function listenOn(server: Server, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, ARGS.host, () => {
      server.off('error', reject)
      const address = server.address()
      resolve(`http://${ARGS.host}:${typeof address === 'object' && address !== null ? address.port : port}`)
    })
  })
}
