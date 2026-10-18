// The service the terminal is a client of: the one JI_SERVER names, or else this machine's shared one (server.ts
// --shared), started when none of this code is running there, and left running: the desktop app and the next terminal
// use it too, and it ends once nothing has for a while. What it says goes to ~/.ji/server.log.

import type { ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { serviceAt, SHARED_HOST, SHARED_PORT } from '../server/shared.ts'
import { codeVersion } from '../server/version.ts'

const SHARED = `http://${SHARED_HOST}:${SHARED_PORT}`

const SERVER = join(import.meta.dirname, '..', 'server.ts')

const LOG = join(homedir(), '.ji', 'server.log')

/** How long the service may take to listen. */
const START_MS = 30_000

/** The address of the service to use: a running one of this code, or one started for it. */
export async function startService(): Promise<string> {
  const named = process.env.JI_SERVER
  if (named !== undefined && named !== '') {
    return named.replace(/\/$/, '')
  }

  const running = await serviceAt(SHARED)
  return running?.version === codeVersion() ? SHARED : spawnShared()
}

/** Starts the shared service on its own, so it outlives the terminal, and waits for the address it listens on. */
async function spawnShared(): Promise<string> {
  mkdirSync(dirname(LOG), { recursive: true })
  const log = openSync(LOG, 'a')
  const child = spawn(process.execPath, [SERVER, '--shared'], {
    cwd: homedir(),
    detached: true,
    stdio: ['ignore', 'pipe', log],
  })
  closeSync(log)

  const { stdout } = child
  if (stdout === null) {
    throw new Error('the service was started without its output')
  }
  try {
    return await addressOf(child, stdout)
  } finally {
    // What it writes after the line is not read: it knows to drop it
    stdout.destroy()
    child.unref()
  }
}

/** The address the line it prints once it listens names. */
function addressOf(child: ChildProcess, stdout: Readable): Promise<string> {
  const lines = createInterface({ input: stdout })
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const timer = setTimeout(() => reject(new Error(`The service did not listen within 30s: see ${LOG}`)), START_MS)

  lines.on('line', line => {
    if (line.startsWith('listening on ')) {
      resolve(line.slice('listening on '.length))
    }
  })
  child.once('error', reject)
  // After its output is read: one that found another running prints the line and ends
  child.once('close', code => reject(new Error(`The service ended before it listened (${code}): see ${LOG}`)))
  return promise.finally(() => {
    clearTimeout(timer)
    lines.close()
  })
}
