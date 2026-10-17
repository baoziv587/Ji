// A session the terminal and the service share: one reply at a time takes its lock, a lock left by a process that is
// gone is taken over, each reads what the other appended to its log, and the service lists what the terminal made
import type { AddressInfo } from 'node:net'
import type { ServiceEvent } from '../src/server/events.ts'
import type { SessionSummary } from '../src/server/sessions.ts'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { createAgent } from '@ji.dev/llm'
import { jsonl } from '@ji.dev/plugin-jsonl'
import { assistantMessage, createFakeModel } from '@ji.dev/testing'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Conversation, SessionBusyError } from '../src/agent/conversation.ts'
import { createAgentHttpServer } from '../src/server/http.ts'
import { SessionOpener } from '../src/server/open.ts'
import { SessionHub } from '../src/server/sessions.ts'
import { SessionStore } from '../src/server/store.ts'
import { SharedSession } from '../src/ui/shared.ts'

type FakeModel = ReturnType<typeof createFakeModel>['model']

describe('session lock', () => {
  it('should refuse a session another live process replies in, and take over one whose process is gone', () => {
    // Arrange
    const dir = scratch()
    const store = new SessionStore(dir)
    holdAs(dir, 'live', process.ppid)
    holdAs(dir, 'stale', spawnSync('true').pid!)
    mkdirSync(join(dir, 'broken.lock'))
    writeFileSync(join(dir, 'broken.lock', 'owner.json'), '{"by":"term')
    // Made by a process about to name itself in it, and by one that crashed before it could
    mkdirSync(join(dir, 'taking.lock'))
    mkdirSync(join(dir, 'crashed.lock'))
    utimesSync(join(dir, 'crashed.lock'), new Date(0), new Date(0))

    // Act
    const live = errorOf(() => store.lock('live'))
    const stale = errorOf(() => store.lock('stale'))
    const again = errorOf(() => store.lock('stale'))
    const broken = errorOf(() => store.lock('broken'))
    const taking = errorOf(() => store.lock('taking'))
    const crashed = errorOf(() => store.lock('crashed'))

    // Assert
    expect(live).toBeInstanceOf(SessionBusyError)
    expect(live).toMatchObject({ by: 'terminal', message: 'The terminal is replying in this session.' })
    expect(store.holder('live')).toMatchObject({ by: 'terminal', pid: process.ppid })
    expect(stale).toBeUndefined()
    expect(again).toBeUndefined()
    expect(store.holder('stale')).toBeUndefined()
    expect(broken).toBeUndefined()
    expect(taking).toBeInstanceOf(SessionBusyError)
    expect(crashed).toBeUndefined()
    expect(readdirSync(dir).sort()).toEqual(['broken.lock', 'crashed.lock', 'live.lock', 'stale.lock', 'taking.lock'])
    expect(store.holder('crashed')).toBeUndefined()
    store.unlock('crashed')
    expect(readdirSync(dir)).not.toContain('crashed.lock')
  })

  it('should hand the session over as soon as the lock is given back, or within a second of its process being gone', async () => {
    // Arrange
    const dir = scratch()
    const store = new SessionStore(dir)
    const child = spawn('sleep', ['10'])
    onTestFinished(() => {
      child.kill()
    })
    holdAs(dir, 'given', process.ppid)
    holdAs(dir, 'gone', child.pid!)
    const given = store.whenFree('given')
    const gone = store.whenFree('gone')

    // Act
    const started = Date.now()
    rmSync(join(dir, 'given.lock'), { recursive: true })
    await given
    const givenAfter = Date.now() - started
    child.kill()
    await once(child, 'exit')
    await gone

    // Assert
    expect(givenAfter).toBeLessThan(500)
    expect(readFileSync(join(dir, 'gone.lock', 'owner.json'), 'utf8')).toContain(String(child.pid))
  })

  it('should read only the whole lines another process appended since', () => {
    // Arrange
    const dir = scratch()
    const store = new SessionStore(dir)
    const line = (t: number): string => JSON.stringify({ run: 'r', session: 's', t, type: 'run_start' })
    writeFileSync(join(dir, 's.jsonl'), `${line(0)}\n`)
    store.records('s')

    // Act
    appendFileSync(join(dir, 's.jsonl'), `${line(1)}\n${line(2).slice(0, 10)}`)
    const first = store.unread('s')
    appendFileSync(join(dir, 's.jsonl'), `${line(2).slice(10)}\n`)
    const second = store.unread('s')
    store.append('s', line(3))
    const third = store.unread('s')

    // Assert
    expect(first.map(r => r.t)).toEqual([1])
    expect(second.map(r => r.t)).toEqual([2])
    expect(third).toEqual([])
  })

  it("should call back once for writes close together, a reply's lines as they stream", async () => {
    // Arrange
    const store = new SessionStore(scratch())
    const watching = await watched(store)

    // Act
    for (let i = 0; i < 50; i++) {
      store.append('s', '{}')
    }
    await sleep(300)

    // Assert
    expect(watching.calls).toBeGreaterThan(0)
    expect(watching.calls).toBeLessThanOrEqual(2)
  })

  it('should not call back for the lines of a reply this process writes', async () => {
    // Arrange
    const store = new SessionStore(scratch())
    const watching = await watched(store)
    store.lock('s')
    await sleep(300)
    watching.calls = 0

    // Act
    for (let i = 0; i < 20; i++) {
      store.append('s', '{}')
    }
    await sleep(300)

    // Assert
    expect(watching.calls).toBe(0)
  })
})

describe('shared conversation', () => {
  it('should not start a reply while another process writes one, and go on from what it wrote', async () => {
    // Arrange
    const dir = scratch()
    const fake = createFakeModel([assistantMessage('from the terminal'), assistantMessage('from the desktop')])
    onTestFinished(() => fake.dispose())
    const terminal = terminalConversation(dir, fake.model)
    await say(terminal, 'hello')
    const desktop = new SessionStore(dir)
    desktop.records(terminal.conversation.id)
    holdAs(dir, terminal.conversation.id, process.ppid)

    // Act
    const refused = errorOf(() => terminal.conversation.send('too soon'))
    rmSync(join(dir, `${terminal.conversation.id}.lock`), { recursive: true })
    const meta = desktop.meta(terminal.conversation.id)

    // Assert
    expect(refused).toBeInstanceOf(SessionBusyError)
    expect(terminal.conversation.replying).toBe(false)
    expect(meta).toMatchObject({ title: 'hello', root: terminal.root, model: expect.stringContaining('/') })
  })

  it("should list the terminal's session in the service, wait while it replies, then go on from its history", async () => {
    // Arrange
    // One model for both: the service opens the session on the model the terminal ran it on
    const dir = scratch()
    const seen: number[] = []
    const fake = createFakeModel([
      assistantMessage('one'),
      assistantMessage('two'),
      request => {
        seen.push(request.messages.length)
        return assistantMessage('three')
      },
    ])
    onTestFinished(() => fake.dispose())
    const { url } = await serve(dir, fake.model)
    const terminal = terminalConversation(dir, fake.model)
    const { id } = terminal.conversation
    await say(terminal, 'first')

    // Act: listed, then held by the terminal
    const listed = await sessions(url)
    const events = await subscribe(`${url}/api/sessions/${id}/events`)
    holdAs(dir, id, process.ppid)
    const held = await sessions(url)
    const heldState = await events.until(e => e.type === 'state' && e.state.heldBy === 'terminal')
    const refused = await fetch(`${url}/api/sessions/${id}/messages`, { method: 'POST', body: '{"text":"hi"}' })

    // Act: the terminal's next reply, read by the service, then one of the service's own
    rmSync(join(dir, `${id}.lock`), { recursive: true })
    await say(terminal, 'second')
    await sessions(url)
    await events.until(e => e.type === 'user' && e.text === 'second')
    await fetch(`${url}/api/sessions/${id}/messages`, { method: 'POST', body: '{"text":"third"}' })
    await events.until(e => e.type === 'user' && e.text === 'third')
    const end = await events.until(e => e.type === 'reply_end')

    // Assert
    expect(listed).toMatchObject([{ id, title: 'first', root: terminal.root }])
    expect(held).toMatchObject([{ id, heldBy: 'terminal' }])
    expect(heldState.type === 'state' && heldState.state.heldBy).toBe('terminal')
    expect(refused.status).toBe(409)
    expect(end).toMatchObject({ outcome: 'done' })
    // first, one, second, two, third
    expect(seen).toEqual([5])
  })

  it('should wait in the terminal until the other process is done, then go on from what it wrote', async () => {
    // Arrange
    const dir = scratch()
    const seen: number[] = []
    const fake = createFakeModel([
      assistantMessage('one'),
      assistantMessage('two'),
      request => {
        seen.push(request.messages.length)
        return assistantMessage('three')
      },
    ])
    onTestFinished(() => fake.dispose())
    const terminal = terminalConversation(dir, fake.model)
    const { id } = terminal.conversation
    await say(terminal, 'first')
    // The lines of the desktop app's reply, as it writes them
    const elsewhere = scratch()
    const desktop = terminalConversation(elsewhere, fake.model)
    await say(desktop, 'second')
    holdAs(dir, id, process.ppid)

    // Act: the desktop app writes its reply, then gives the session back
    const free = terminal.shared.whenFree()
    appendFileSync(join(dir, `${id}.jsonl`), readFileSync(join(elsewhere, `${desktop.conversation.id}.jsonl`)))
    rmSync(join(dir, `${id}.lock`), { recursive: true })
    const wrote = await free
    await say(terminal, 'third')

    // Assert
    expect(wrote).toBe(true)
    // first, one, second, two, third
    expect(seen).toEqual([5])
  })
})

// Helpers

interface Terminal {
  conversation: Conversation
  shared: SharedSession
  root: string
}

/** The terminal's conversation, kept in `dir` as main.ts keeps it. */
function terminalConversation(dir: string, model: FakeModel): Terminal {
  const root = scratch()
  const store = new SessionStore(dir, 'terminal')
  onTestFinished(() => store.close())
  let conversation: Conversation | undefined
  const shared = new SharedSession({
    store,
    root,
    id: () => conversation!.id,
    model: () => `${conversation!.agent.model.provider}/${conversation!.agent.model.id}`,
  })
  const agent = createAgent({ model, plugins: [jsonl(line => store.append(conversation!.id, line), { interval: 0 })] })
  conversation = new Conversation(agent, {}, shared)
  return { conversation, shared, root }
}

/** A message typed in the terminal, and its reply to the end, as ui/input.ts sends it. */
async function say({ conversation, shared }: Terminal, message: string): Promise<void> {
  const run = conversation.send(message)!
  shared.used(message)
  await conversation.follow(run, readAll)
}

/** The store's watch, once it reports writes: until then, a write may go unseen. */
async function watched(store: SessionStore): Promise<{ calls: number }> {
  const watching = { calls: 0 }
  const unwatch = store.watch(
    () => watching.calls++,
    error => {
      throw error
    },
  )
  onTestFinished(unwatch)
  await vi.waitFor(
    () => {
      store.append('warm', '{}')
      expect(watching.calls).toBeGreaterThan(0)
    },
    { timeout: 2000, interval: 50 },
  )
  await sleep(300)
  watching.calls = 0
  return watching
}

function errorOf(fn: () => unknown): unknown {
  try {
    fn()
    return undefined
  } catch (error) {
    return error
  }
}

/** A lock as another process leaves it: the terminal's, with `pid`. */
function holdAs(dir: string, id: string, pid: number): void {
  mkdirSync(join(dir, `${id}.lock`), { recursive: true })
  writeFileSync(join(dir, `${id}.lock`, 'owner.json'), JSON.stringify({ by: 'terminal', pid, started: Date.now() }))
}

async function readAll(run: AsyncIterable<unknown> & { result: Promise<unknown> }): Promise<void> {
  for await (const _ of run) {
    // read to the end
  }
  await run.result
}

async function serve(dir: string, model: FakeModel): Promise<{ url: string }> {
  const store = new SessionStore(dir)
  const hub = new SessionHub({ store, opener: new SessionOpener({ store, model, thinking: 'off' }) })
  const server = createAgentHttpServer({ hub, defaultRoot: scratch() })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await hub.close()
  })
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

/** The list, read again from the folder. */
async function sessions(url: string): Promise<SessionSummary[]> {
  const listed = (await (await fetch(`${url}/api/sessions`)).json()) as { sessions: SessionSummary[] }
  return listed.sessions
}

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shared-'))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** The events a client reads, as they come; `until` waits for the first one after those already matched. */
async function subscribe(
  url: string,
): Promise<{ until: (match: (e: ServiceEvent) => boolean) => Promise<ServiceEvent> }> {
  const stopping = new AbortController()
  onTestFinished(() => stopping.abort())
  const response = await fetch(url, { signal: stopping.signal })
  const seen: ServiceEvent[] = []
  let checked = 0
  const waiters = new Set<() => void>()

  void (async () => {
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for await (const chunk of response.body!) {
        buffer += decoder.decode(chunk as Uint8Array, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const data = block.split('\n').find(l => l.startsWith('data: '))
          if (data !== undefined) {
            seen.push(JSON.parse(data.slice(6)) as ServiceEvent)
          }
        }
        waiters.forEach(w => w())
      }
    } catch {
      // Aborted as the test finishes
    }
  })()

  return {
    until: match =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no such event in ${JSON.stringify(seen)}`)), 5_000)
        const check = (): void => {
          const index = seen.findIndex((e, i) => i >= checked && match(e))
          if (index !== -1) {
            waiters.delete(check)
            clearTimeout(timer)
            checked = index + 1
            resolve(seen[index])
          }
        }
        waiters.add(check)
        check()
      }),
  }
}
