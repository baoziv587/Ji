// The sessions over HTTP: a message starts a reply whose events stream to the client, a command waits for the client's
// yes, the list follows what each session does, a session read back from its log goes on where it was, and an
// archived session stays on disk
import type { AssistantMessage } from '@ji.dev/llm'
import type { FakeReply } from '@ji.dev/testing'
import type { AddressInfo } from 'node:net'
import type { ServiceEvent } from '../src/server/events.ts'
import type { SessionSummary } from '../src/server/sessions.ts'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assistantMessage, createFakeModel, toolUse } from '@ji.dev/testing'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createAgentHttpServer } from '../src/server/http.ts'
import { createSessionOpener } from '../src/server/open.ts'
import { createSessionHub } from '../src/server/sessions.ts'
import { createSessionStore } from '../src/server/store.ts'

describe('agent HTTP service', () => {
  it('should stream a reply and wait for the client to approve a command', async () => {
    // Arrange
    const { url, root } = await serve([
      assistantMessage([toolUse('bash', { command: 'echo hi > out.txt' })]),
      assistantMessage('done writing'),
    ])
    const { id } = await create(url)
    const events = await subscribe(`${url}/api/sessions/${id}/events`)

    // Act
    const sent = await post(url, `/api/sessions/${id}/messages`, { text: 'write hi' })
    const ask = await events.until(e => e.type === 'ask')
    const answered = await post(url, `/api/sessions/${id}/questions/${idOf(ask)}`, { answers: [['yes']] })
    await events.until(e => e.type === 'reply_end')

    // Assert
    expect(sent).toEqual({ result: 'started' })
    expect(ask).toMatchObject({ type: 'ask', tool: 'bash', questions: [{ options: expect.any(Array) }] })
    expect(answered).toEqual({ ok: true })
    expect(readFileSync(join(root, 'out.txt'), 'utf8')).toBe('hi\n')
    expect(events.seen.map(e => e.type)).toEqual(
      expect.arrayContaining(['user', 'ask', 'ask_closed', 'tool_start', 'tool_end', 'text']),
    )
    expect(texts(events.seen)).toBe('done writing')
    expect(events.seen.find(e => e.type === 'reply_end')).toMatchObject({ outcome: 'done' })
  })

  it('should tell the model the command was refused when the client says no', async () => {
    // Arrange
    const { url, root } = await serve([
      assistantMessage([toolUse('bash', { command: 'echo hi > out.txt' })]),
      assistantMessage('ok, not running it'),
    ])
    const { id } = await create(url)
    const events = await subscribe(`${url}/api/sessions/${id}/events`)

    // Act
    await post(url, `/api/sessions/${id}/messages`, { text: 'write hi' })
    const ask = await events.until(e => e.type === 'ask')
    await post(url, `/api/sessions/${id}/questions/${idOf(ask)}`, { answers: [['no']] })
    await events.until(e => e.type === 'reply_end')

    // Assert
    expect(() => readFileSync(join(root, 'out.txt'))).toThrow()
    expect(events.seen.find(e => e.type === 'tool_end')).toMatchObject({
      ok: false,
      output: expect.stringContaining('rejected'),
    })
  })

  it('should list each session with its title and what it is doing', async () => {
    // Arrange
    const { url } = await serve([assistantMessage([toolUse('bash', { command: 'true' })]), assistantMessage('ran it')])
    const first = await create(url)
    const second = await create(url)
    const list = await subscribe<{ type: 'sessions'; sessions: SessionSummary[] }>(`${url}/api/events`)
    const events = await subscribe(`${url}/api/sessions/${second.id}/events`)

    // Act
    await post(url, `/api/sessions/${second.id}/messages`, { text: 'run true\nplease' })
    const asking = await list.until(e => e.sessions.some(s => s.status === 'asking'))
    await post(url, `/api/sessions/${second.id}/questions/${idOf(await events.until(e => e.type === 'ask'))}`, {
      answers: [['yes']],
    })
    const idle = await list.until(e => e.sessions.every(s => s.status === 'idle'))

    // Assert
    expect(asking.sessions.find(s => s.id === second.id)).toMatchObject({ title: 'run true', status: 'asking' })
    expect(asking.sessions.find(s => s.id === first.id)).toMatchObject({ title: '', status: 'idle' })
    expect(idle.sessions[0].id).toBe(second.id)
  })

  it('should read a session back from its log and go on from its history', async () => {
    // Arrange
    const sessions = scratch()
    const seen: number[] = []
    const replies: FakeReply[] = [
      assistantMessage('first answer'),
      request => {
        seen.push(request.messages.length)
        return assistantMessage('second answer')
      },
    ]
    const before = await serve(replies, sessions)
    const { id } = await create(before.url)
    const events = await subscribe(`${before.url}/api/sessions/${id}/events`)
    await post(before.url, `/api/sessions/${id}/messages`, { text: 'hello' })
    await events.until(e => e.type === 'reply_end')

    // Act: another service on the same folder, as after a restart
    const after = await serve(replies.slice(1), sessions)
    const listed = (await (await fetch(`${after.url}/api/sessions`)).json()) as { sessions: SessionSummary[] }
    const replayed = await subscribe(`${after.url}/api/sessions/${id}/events`)
    await replayed.until(e => e.type === 'reply_end')
    await post(after.url, `/api/sessions/${id}/messages`, { text: 'and again' })
    await replayed.until(e => e.type === 'reply_end')

    // Assert
    expect(listed.sessions).toMatchObject([{ id, title: 'hello' }])
    expect(existsSync(join(sessions, `${id}.jsonl`))).toBe(true)
    expect(replayed.seen.filter(e => e.type === 'user').map(e => (e.type === 'user' ? e.text : ''))).toEqual([
      'hello',
      'and again',
    ])
    expect(texts(replayed.seen)).toBe('first answersecond answer')
    // The second call saw the first exchange: hello, first answer, and again
    expect(seen).toEqual([3])
  })

  it("should start a session's events with its state, new or read back from its log", async () => {
    // Arrange
    const sessions = scratch()
    const before = await serve([assistantMessage('first answer')], sessions)
    const { id } = await create(before.url)

    // Act
    const fresh = await subscribe(`${before.url}/api/sessions/${id}/events`)
    const first = await fresh.until(() => true)
    await post(before.url, `/api/sessions/${id}/messages`, { text: 'hello' })
    await fresh.until(e => e.type === 'reply_end')
    const after = await serve([], sessions)
    const replayed = await subscribe(`${after.url}/api/sessions/${id}/events`)
    await replayed.until(e => e.type === 'state' && !e.state.replying)

    // Assert
    const state = { id, model: expect.any(String), thinkingLevels: expect.any(Array), mode: 'ask' }
    expect(first).toMatchObject({ type: 'state', state })
    expect(replayed.seen.map(e => e.type)).toEqual(['user', 'text', 'reply_end', 'state'])
    expect(replayed.seen.at(-1)).toMatchObject({ state: { ...state, outcome: 'done' } })
  })

  it('should archive a session and keep it on disk', async () => {
    // Arrange
    const sessions = scratch()
    const { url } = await serve([], sessions)
    const { id } = await create(url)

    // Act
    const archived = await post(url, `/api/sessions/${id}/archive`, { archived: true })
    const back = await post(url, `/api/sessions/${id}/archive`, { archived: false })

    // Assert
    expect(archived).toMatchObject({ id, archived: true })
    expect(back).toMatchObject({ id, archived: false })
    expect(JSON.parse(readFileSync(join(sessions, `${id}.json`), 'utf8'))).toMatchObject({ archived: false })
  })

  it('should answer a bad request with a 4xx and its reason', async () => {
    // Arrange
    const { url } = await serve([])
    const { id } = await create(url)

    // Act
    const empty = await fetch(`${url}/api/sessions/${id}/messages`, { method: 'POST', body: '{"text":" "}' })
    const unknown = await fetch(`${url}/api/sessions/nope/messages`, { method: 'POST', body: '{"text":"hi"}' })
    const question = await fetch(`${url}/api/sessions/${id}/questions/9`, { method: 'POST', body: '{"answers":[]}' })
    const folder = await fetch(`${url}/api/sessions`, { method: 'POST', body: '{"root":"/no/such/folder"}' })

    // Assert
    expect(empty.status).toBe(400)
    expect(await empty.json()).toEqual({ error: 'the message is empty' })
    expect(unknown.status).toBe(404)
    expect(question.status).toBe(404)
    expect(folder.status).toBe(400)
  })

  it("should switch a session's mode on its own", async () => {
    // Arrange
    const { url } = await serve([])
    const first = await create(url)
    const second = await create(url)

    // Act
    const switched = (await post(url, `/api/sessions/${first.id}/mode`, {})) as { mode: string }
    const other = (await (await fetch(`${url}/api/sessions/${second.id}/state`)).json()) as { mode: string }

    // Assert
    expect(switched.mode).toBe('auto')
    expect(other.mode).toBe('ask')
  })
})

/** A service on a folder of sessions, a new one by default, whose sessions work in a new folder of their own. */
async function serve(
  replies: (AssistantMessage | FakeReply)[],
  sessions = scratch(),
): Promise<{ url: string; root: string }> {
  const root = scratch()
  const fake = createFakeModel(replies)
  onTestFinished(() => fake.dispose())
  const store = createSessionStore(sessions)
  const hub = createSessionHub({ store, open: createSessionOpener({ store, model: fake.model, thinking: 'off' }) })
  const server = createAgentHttpServer({ hub, defaultRoot: root })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await hub.close()
  })

  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, root }
}

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'server-'))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

async function create(url: string): Promise<SessionSummary> {
  return (await post(url, '/api/sessions', {})) as SessionSummary
}

function idOf(e: ServiceEvent): string {
  return e.type === 'ask' ? e.id : ''
}

function texts(events: ServiceEvent[]): string {
  return events.map(e => (e.type === 'text' ? e.delta : '')).join('')
}

/** The events a client reads, as they come; `until` waits for the first one after those already matched. */
async function subscribe<E = ServiceEvent>(
  url: string,
): Promise<{
  seen: E[]
  until: (match: (e: E) => boolean) => Promise<E>
}> {
  const stopping = new AbortController()
  onTestFinished(() => stopping.abort())
  const response = await fetch(url, { signal: stopping.signal })
  const seen: E[] = []
  const waiters: { from: number; match: (e: E) => boolean; resolve: (e: E) => void }[] = []
  let checked = 0

  const check = (): void => {
    for (const waiter of [...waiters]) {
      const found = seen.slice(waiter.from).find(waiter.match)
      if (found !== undefined) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(found)
      }
    }
  }

  void (async () => {
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for await (const chunk of response.body!) {
        buffer += decoder.decode(chunk as Uint8Array, { stream: true })
        let end = buffer.indexOf('\n\n')
        while (end !== -1) {
          const data = buffer
            .slice(0, end)
            .split('\n')
            .find(line => line.startsWith('data: '))
          buffer = buffer.slice(end + 2)
          if (data !== undefined) {
            seen.push(JSON.parse(data.slice(6)) as E)
          }
          end = buffer.indexOf('\n\n')
        }
        check()
      }
    } catch {
      // Aborted as the test finishes
    }
  })()

  return {
    seen,
    until: match =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no such event in ${JSON.stringify(seen)}`)), 5_000)
        waiters.push({
          from: checked,
          match,
          resolve: e => {
            clearTimeout(timer)
            checked = seen.indexOf(e) + 1
            resolve(e)
          },
        })
        check()
      }),
  }
}

async function post(url: string, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${url}${path}`, { method: 'POST', body: JSON.stringify(body) })
  return response.json()
}
