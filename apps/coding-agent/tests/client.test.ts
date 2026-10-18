// The terminal as a client of the service: a reply's run events stream whole, in order with the session's own, so it
// can be drawn as it happens, whoever answers its questions; a session runs its commands with the environment of the
// terminal that made it; and the service says which code it is, and stops only once nothing uses it
import type { AssistantMessage } from '@ji.dev/llm'
import type { AddressInfo } from 'node:net'
import type { ClientEvent } from '../src/client/session.ts'
import type { LiveEvent } from '../src/server/events.ts'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { assistantMessage, createFakeModel, toolUse } from '@ji.dev/testing'
import { describe, expect, it, onTestFinished } from 'vitest'
import { SessionClient } from '../src/client/session.ts'
import { createAgentHttpServer } from '../src/server/http.ts'
import { SessionOpener } from '../src/server/open.ts'
import { SessionHub } from '../src/server/sessions.ts'
import { SessionStore } from '../src/server/store.ts'
import { EventFeed } from '../src/ui/reply/feed.ts'

const NO_NEWS = { dropped: () => {}, restored: () => {} }

describe('session client', () => {
  it('should stream the run events in order with the reply end, and take an answer from another client', async () => {
    // Arrange
    const { url, root } = await serve([
      assistantMessage([toolUse('bash', { command: 'echo hi > out.txt' })]),
      assistantMessage('done writing'),
    ])
    const session = await SessionClient.create(url, { root, model: '', env: process.env })
    const events = listen(session)

    // Act: the desktop app answers the terminal's question
    await session.send('write hi')
    const ask = await events.until(e => e.type === 'ask')
    await fetch(`${url}/api/sessions/${session.id}/questions/${ask.type === 'ask' ? ask.id : ''}`, {
      method: 'POST',
      body: JSON.stringify({ answers: [['yes']] }),
    })
    await events.until(e => e.type === 'reply_end')

    // Assert
    expect(ask).toMatchObject({ tool: 'bash', command: true })
    expect(readFileSync(join(root, 'out.txt'), 'utf8')).toBe('hi\n')
    const run = events.seen.flatMap(e => (e.type === 'run' ? [e.event] : []))
    expect(run.map(e => e.type)).toEqual(expect.arrayContaining(['tool_call', 'tool_start', 'tool_end', 'run_end']))
    // A step's end comes without the history it holds
    expect(run.find(e => e.type === 'step_end')).not.toHaveProperty('state')
    const types = events.seen.map(e => (e.type === 'run' ? e.event.type : e.type))
    expect(types.indexOf('run_end')).toBeLessThan(types.indexOf('reply_end'))
  })

  it("should run the session's commands with the environment it was made with, and take a key it has", async () => {
    // Arrange
    const { url, root } = await serve([
      assistantMessage([toolUse('bash', { command: 'echo "$GREETING" > out.txt' })]),
      assistantMessage('done'),
    ])
    delete process.env.CLIENT_TEST_API_KEY
    onTestFinished(() => {
      delete process.env.CLIENT_TEST_API_KEY
    })
    const env = { GREETING: 'hello from the terminal', CLIENT_TEST_API_KEY: 'sk-test' }
    const session = await SessionClient.create(url, { root, model: '', env })
    const events = listen(session)
    await session.setMode('yolo')

    // Act
    await session.send('greet')
    await events.until(e => e.type === 'reply_end')

    // Assert
    expect(readFileSync(join(root, 'out.txt'), 'utf8')).toBe('hello from the terminal\n')
    expect(process.env.CLIENT_TEST_API_KEY).toBe('sk-test')
    expect(process.env.GREETING).toBeUndefined()
  })

  it('should say which code the service is, and stop only once no client is connected', async () => {
    // Arrange
    let stopped = 0
    const { url, root } = await serve([], { version: '42', stop: () => stopped++ })
    const session = await SessionClient.create(url, { root, model: '', env: process.env })
    const listening = new AbortController()
    const events = listen(session, listening.signal)
    await events.until(e => e.type === 'state')

    // Act
    const service = await (await fetch(`${url}/api/service`)).json()
    const inUse = await fetch(`${url}/api/service/stop`, { method: 'POST' })
    listening.abort()
    await expect.poll(async () => (await fetch(`${url}/api/service/stop`, { method: 'POST' })).status).toBe(200)

    // Assert
    expect(service).toEqual({ pid: process.pid, version: '42' })
    expect(inUse.status).toBe(409)
    expect(stopped).toBe(1)
  })

  it('should refuse a model the catalog lacks with its reason', async () => {
    // Arrange
    const { url, root } = await serve([])

    // Act
    const creating = SessionClient.create(url, { root, model: 'nope/nothing', env: {} })

    // Assert
    await expect(creating).rejects.toThrow(/nope/)
  })
})

describe('event feed', () => {
  it('should hand the events over in order, and drain once each has been read and handled', async () => {
    // Arrange
    const feed = new EventFeed()
    const handled: string[] = []
    const reading = (async () => {
      for await (const e of feed) {
        await new Promise(resolve => setTimeout(resolve, 5))
        handled.push(e.type)
      }
    })()

    // Act
    feed.push(event('text'))
    feed.push(event('thinking'))
    await feed.drained()
    const drained = [...handled]
    feed.push(event('text'))
    feed.end()
    await reading

    // Assert
    expect(drained).toEqual(['text', 'thinking'])
    expect(handled).toEqual(['text', 'thinking', 'text'])
    await expect(feed.drained()).resolves.toBeUndefined()
  })
})

function event(type: 'text' | 'thinking'): LiveEvent {
  return { type, delta: '', t: 0 }
}

/** The session's events as the terminal reads them; `until` waits for the first one after those already matched. */
function listen(
  session: SessionClient,
  signal?: AbortSignal,
): { seen: ClientEvent[]; until: (match: (e: ClientEvent) => boolean) => Promise<ClientEvent> } {
  const stopping = new AbortController()
  onTestFinished(() => stopping.abort())
  const seen: ClientEvent[] = []
  const waiters = new Set<() => void>()
  let checked = 0
  void session.listen(
    e => {
      seen.push(e)
      waiters.forEach(check => check())
    },
    signal === undefined ? stopping.signal : AbortSignal.any([signal, stopping.signal]),
    NO_NEWS,
  )

  return {
    seen,
    until: match =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no such event in ${JSON.stringify(seen)}`)), 5_000)
        const check = (): void => {
          const at = seen.findIndex((e, i) => i >= checked && match(e))
          if (at !== -1) {
            waiters.delete(check)
            clearTimeout(timer)
            checked = at + 1
            resolve(seen[at])
          }
        }
        waiters.add(check)
        check()
      }),
  }
}

async function serve(
  replies: AssistantMessage[],
  service: { version?: string; stop?: () => void } = {},
): Promise<{ url: string; root: string }> {
  const root = scratch()
  const fake = createFakeModel(replies)
  onTestFinished(() => fake.dispose())
  const store = new SessionStore(scratch())
  const hub = new SessionHub({ store, opener: new SessionOpener({ store, model: fake.model, thinking: 'off' }) })
  const server = createAgentHttpServer({ hub, defaultRoot: root, ...service })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await hub.close()
  })

  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, root }
}

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'client-'))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
