// A session the terminal and the service share: one reply at a time takes its lock, a lock left by a process that is
// gone is taken over, each reads what the other appended to its log, and the service lists what the terminal made
import type { AddressInfo } from 'node:net'
import type { ServiceEvent } from '../src/server/events.ts'
import type { SessionSummary } from '../src/server/sessions.ts'
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

    // Act
    const live = errorOf(() => store.lock('live'))
    const stale = errorOf(() => store.lock('stale'))
    const again = errorOf(() => store.lock('stale'))

    // Assert
    expect(live).toBeInstanceOf(SessionBusyError)
    expect(live).toMatchObject({ by: 'terminal', message: 'The terminal is replying in this session.' })
    expect(store.holder('live')).toMatchObject({ by: 'terminal', pid: process.ppid })
    expect(stale).toBeUndefined()
    expect(again).toBeUndefined()
    expect(store.holder('stale')).toBeUndefined()
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
    const dir = scratch()
    const store = new SessionStore(dir)
    let calls = 0
    const unwatch = store.watch(
      () => calls++,
      error => {
        throw error
      },
    )
    onTestFinished(unwatch)
    // The watcher reads the folder before it reports a write: until then, a write may go unseen
    await vi.waitFor(
      () => {
        store.append('s', '{}')
        expect(calls).toBeGreaterThan(0)
      },
      { timeout: 2000, interval: 50 },
    )
    await sleep(300)
    calls = 0

    // Act
    for (let i = 0; i < 50; i++) {
      store.append('s', '{}')
    }
    await sleep(300)

    // Assert
    expect(calls).toBeGreaterThan(0)
    expect(calls).toBeLessThanOrEqual(2)
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
    rmSync(join(dir, `${terminal.conversation.id}.lock`))
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
    rmSync(join(dir, `${id}.lock`))
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

  it('should wait in the terminal until the other process is done, then hand over what it wrote', async () => {
    // Arrange
    const dir = scratch()
    const fake = createFakeModel([assistantMessage('one')])
    onTestFinished(() => fake.dispose())
    const terminal = terminalConversation(dir, fake.model)
    const { id } = terminal.conversation
    await say(terminal, 'first')
    holdAs(dir, id, process.ppid)

    // Act: the desktop app writes a reply, then gives the session back
    const free = terminal.shared.whenFree()
    const line = { session: id, run: 'desktop-run', t: 0 }
    appendFileSync(join(dir, `${id}.jsonl`), `${JSON.stringify({ ...line, type: 'text', delta: 'hi there' })}\n`)
    rmSync(join(dir, `${id}.lock`))
    const state = await free

    // Assert
    expect(state).toBeDefined()
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
  writeFileSync(join(dir, `${id}.lock`), JSON.stringify({ by: 'terminal', pid, started: Date.now() }))
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
