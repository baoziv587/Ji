// The shared service: the one a terminal or the desktop app starts on the port every client looks at. One of the same
// code already there is used instead; one of older code is taken over, unless it is in use
import type { AddressInfo } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { describe, expect, it, onTestFinished } from 'vitest'
import { codeVersion } from '../src/server/version.ts'

const SERVER = join(import.meta.dirname, '..', 'src', 'server.ts')

describe('shared service', () => {
  it('should use the one of the same code already listening, and end', { timeout: 30_000 }, async () => {
    // Arrange
    const port = await freePort()
    const first = await start(port)

    // Act
    const second = await start(port)

    // Assert
    expect(second.url).toBe(first.url)
    expect(await second.exited).toBe(0)
    expect(await versionAt(first.url)).toBe(codeVersion())
  })

  it('should take over from one of older code, and leave one in use as it is', { timeout: 30_000 }, async () => {
    // Arrange
    const port = await freePort()
    const old = await oldService(port, { inUse: false })
    const busy = await freePort()
    await oldService(busy, { inUse: true })

    // Act
    const taken = await start(port)
    const left = await start(busy)

    // Assert
    expect(old.stopped()).toBe(true)
    expect(await versionAt(taken.url)).toBe(codeVersion())
    expect(left.url).toBe(`http://127.0.0.1:${busy}`)
    expect(await left.exited).toBe(0)
  })
})

/** server.ts --shared on `port`, its sessions in a folder of its own: the address its line names, and its exit code. */
async function start(port: number): Promise<{ url: string; exited: Promise<number | null> }> {
  const sessions = mkdtempSync(join(tmpdir(), 'shared-'))
  const child = spawn(process.execPath, [SERVER, '--shared', '--port', String(port), '--sessions', sessions], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve))
  onTestFinished(async () => {
    child.kill()
    await exited
    rmSync(sessions, { recursive: true, force: true })
  })

  for await (const line of createInterface({ input: child.stdout })) {
    if (line.startsWith('listening on ')) {
      return { url: line.slice('listening on '.length), exited }
    }
  }
  throw new Error('the service ended before it listened')
}

/** A service of older code on `port`: one in use refuses to stop, one not in use stops and gives up the port. */
async function oldService(port: number, { inUse }: { inUse: boolean }): Promise<{ stopped: () => boolean }> {
  let stopped = false
  const server = createServer((req, res) => {
    if (req.url === '/api/service') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ pid: 1, version: 'old' }))
    } else if (req.url === '/api/service/stop' && !inUse) {
      stopped = true
      res.writeHead(200).end('{}', () => server.close())
    } else {
      res.writeHead(409).end('{}')
    }
  })
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve))
  onTestFinished(() => {
    server.close()
  })
  return { stopped: () => stopped }
}

async function versionAt(url: string): Promise<string> {
  return ((await (await fetch(`${url}/api/service`)).json()) as { version: string }).version
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise(resolve => server.close(resolve))
  return port
}
