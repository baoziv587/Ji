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
//
// Once it listens it prints one line to stdout, `listening on http://host:port`, for whoever started it to read.

import type { ThinkingLevel } from '@ji.dev/llm'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { findModel, UnsupportedThinkingError, useCredentialStore } from '@ji.dev/llm'
import { createFileCredentialStore } from '@ji.dev/plugin-auth'
import { createAgentHttpServer } from './server/http.ts'
import { createSessionOpener } from './server/open.ts'
import { createSessionHub } from './server/sessions.ts'
import { createSessionStore } from './server/store.ts'

const { values: ARGS } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '4317' },
    model: { type: 'string', default: 'deepseek/deepseek-flash' },
    thinking: { type: 'string', default: 'high' },
    root: { type: 'string', default: process.env.INIT_CWD ?? process.cwd() },
    sessions: { type: 'string', default: join(homedir(), '.ji', 'sessions') },
    skills: { type: 'string', default: join(homedir(), '.agents', 'skills') },
    yolo: { type: 'boolean', default: false },
  },
})

const thinking = ARGS.thinking as ThinkingLevel
// A typo in the model or the level stops the service before it listens, with the choices listed
const info = findModel(ARGS.model)
if (!info.thinkingLevels.includes(thinking)) {
  throw new UnsupportedThinkingError(info, thinking)
}

useCredentialStore(createFileCredentialStore(join(homedir(), '.ji', 'auth.json')))

const store = createSessionStore(ARGS.sessions)
const hub = createSessionHub({
  store,
  open: createSessionOpener({
    store,
    model: ARGS.model,
    thinking,
    skills: ARGS.skills,
    auth: join(homedir(), '.ji'),
    yolo: ARGS.yolo,
  }),
})

const server = createAgentHttpServer({ hub, defaultRoot: resolve(ARGS.root) })
server.listen(Number(ARGS.port), ARGS.host, () => {
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : ARGS.port
  process.stdout.write(`listening on http://${ARGS.host}:${port}\n`)
})

const shutdown = (): void => {
  server.closeAllConnections()
  server.close()
  hub.close().finally(() => process.exit(0))
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
