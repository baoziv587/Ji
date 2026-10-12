// The sessions over HTTP: a message starts a reply whose events stream to the client, a command waits for the client's
// yes, the list follows what each session does, a session read back from its log goes on where it was, and an
// archived session stays on disk
import type { AssistantMessage } from '@ji.dev/llm'
import type { FakeReply } from '@ji.dev/testing'
import type { AddressInfo } from 'node:net'
import type { ServiceEvent, ServiceState } from '../src/server/events.ts'
import type { ModelView, ProviderView } from '../src/server/providers.ts'
import type { SessionSummary } from '../src/server/sessions.ts'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assistantMessage, createFakeModel, toolUse } from '@ji.dev/testing'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createAgentHttpServer } from '../src/server/http.ts'
import { SessionOpener } from '../src/server/open.ts'
import { SessionHub } from '../src/server/sessions.ts'
import { SessionStore } from '../src/server/store.ts'

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

  it('should list the sessions without reading their logs, one that cannot be read back included', () => {
    // Arrange
    const store = new SessionStore(scratch())
    const meta = store.create(scratch())
    const records = vi.spyOn(store, 'records').mockImplementation(() => {
      throw new RangeError('Cannot create a string longer than 0x1fffffe8 characters')
    })
    const fake = createFakeModel([])
    onTestFinished(() => fake.dispose())
    const hub = new SessionHub({ store, opener: new SessionOpener({ store, model: fake.model, thinking: 'off' }) })

    // Act
    const listed = hub.list()
    const opening = (): unknown => hub.session(meta.id)

    // Assert
    expect(listed).toMatchObject([{ id: meta.id, status: 'idle' }])
    expect(records).not.toHaveBeenCalled()
    expect(opening).toThrow('Cannot create a string')
    expect(hub.list()).toMatchObject([{ id: meta.id, status: 'idle' }])
  })

  it('should read back a log longer than a chunk with its deltas joined, skipping a line cut short', () => {
    // Arrange: a write logged a line a delta, as before the deltas were joined
    const sessions = scratch()
    const piece = '写个页面 '.repeat(100)
    const call = { type: 'toolCall', id: 'c1', name: 'write', arguments: {} }
    const lines = Array.from({ length: 3000 }, (_, t) =>
      JSON.stringify({ run: 'r', session: 's', t, type: 'tool_call_delta', call, delta: piece }),
    )
    lines.push('{"run":"r","session":"s","t":3000,"type":"tool_call"')
    lines.push(JSON.stringify({ run: 'r', session: 's', t: 3001, type: 'text', delta: 'done' }))
    writeFileSync(join(sessions, 'a.jsonl'), `${lines.join('\n')}\n`)

    // Act
    const records = new SessionStore(sessions).records('a')

    // Assert
    expect(records.map(r => r.type)).toEqual(['tool_call_delta', 'text'])
    expect(records[0]).toMatchObject({ t: 2999, delta: piece.repeat(3000) })
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

  it('should set every session to a mode, one opened later and one set back out of yolo included', async () => {
    // Arrange
    const { url } = await serve([])
    const opened = await create(url)
    await fetch(`${url}/api/sessions/${opened.id}/state`)

    // Act
    const set = await post(url, '/api/mode', { mode: 'yolo' })
    const later = await create(url)
    const states = [await modeOf(url, opened.id), await modeOf(url, later.id)]
    const back = (await post(url, `/api/sessions/${opened.id}/mode`, { mode: 'ask' })) as { mode: string }
    const wrong = await fetch(`${url}/api/mode`, { method: 'POST', body: JSON.stringify({ mode: 'never' }) })

    // Assert
    expect(set).toEqual({ mode: 'yolo' })
    expect(states).toEqual(['yolo', 'yolo'])
    expect(back.mode).toBe('ask')
    expect(wrong.status).toBe(400)
  })
})

describe('models over HTTP', () => {
  it('should list every provider, the detected ones marked with where their key comes from', async () => {
    // Arrange
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-test')
    vi.stubEnv('MISTRAL_API_KEY', '')
    onTestFinished(() => {
      vi.unstubAllEnvs()
    })
    const { url } = await serve([])

    // Act
    const { providers } = (await (await fetch(`${url}/api/providers`)).json()) as { providers: ProviderView[] }
    const deepseek = providers.find(p => p.id === 'deepseek')
    const mistral = providers.find(p => p.id === 'mistral')

    // Assert
    expect(deepseek).toMatchObject({ name: 'DeepSeek', detected: true, source: 'DEEPSEEK_API_KEY', login: true })
    expect(mistral).toMatchObject({ detected: false, login: true })
    expect(mistral?.source).toBeUndefined()
    expect(deepseek?.models).toBeGreaterThan(0)
  })

  it("should list a provider's models, and none of a provider the catalog lacks", async () => {
    // Arrange
    const { url } = await serve([])

    // Act
    const listed = (await (await fetch(`${url}/api/providers/deepseek/models`)).json()) as { models: ModelView[] }
    const unknown = await fetch(`${url}/api/providers/nope/models`)

    // Assert
    expect(listed.models.map(m => m.id)).toContain('deepseek-flash')
    expect(listed.models[0]).toMatchObject({ name: expect.any(String), contextWindow: expect.any(Number) })
    expect(unknown.status).toBe(404)
  })

  it('should switch a session to another model for its next reply, and open it on that model again', async () => {
    // Arrange
    const sessions = scratch()
    const other = createFakeModel([assistantMessage('from the other model')])
    onTestFinished(() => other.dispose())
    const spec = `${other.model.provider}/${other.model.id}`
    const before = await serve([assistantMessage('from the first model')], sessions)
    const { id } = await create(before.url)
    const events = await subscribe(`${before.url}/api/sessions/${id}/events`)

    // Act
    const switched = (await post(before.url, `/api/sessions/${id}/model`, { model: spec })) as ServiceState
    await post(before.url, `/api/sessions/${id}/messages`, { text: 'hello' })
    await events.until(e => e.type === 'reply_end')
    const after = await serve([], sessions)
    const reopened = (await (await fetch(`${after.url}/api/sessions/${id}/state`)).json()) as ServiceState

    // Assert
    expect(switched).toMatchObject({ model: spec, thinking: 'off' })
    expect(texts(events.seen)).toBe('from the other model')
    expect(reopened.model).toBe(spec)
  })

  it('should start a session on the model it is created with, and refuse one the catalog lacks', async () => {
    // Arrange
    const other = createFakeModel([])
    onTestFinished(() => other.dispose())
    const spec = `${other.model.provider}/${other.model.id}`
    const { url } = await serve([])

    // Act
    const { id } = (await post(url, '/api/sessions', { model: spec })) as SessionSummary
    const state = (await (await fetch(`${url}/api/sessions/${id}/state`)).json()) as ServiceState
    const unknown = await fetch(`${url}/api/sessions`, {
      method: 'POST',
      body: JSON.stringify({ model: 'nope/nothing' }),
    })

    // Assert
    expect(state.model).toBe(spec)
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as { error: string }).error).toContain('Unknown provider "nope"')
  })

  it('should refuse a model the catalog lacks, and a switch while the session replies', async () => {
    // Arrange
    const { url } = await serve([assistantMessage([toolUse('bash', { command: 'echo hi' })])])
    const { id } = await create(url)
    const events = await subscribe(`${url}/api/sessions/${id}/events`)

    // Act
    const unknown = await fetch(`${url}/api/sessions/${id}/model`, {
      method: 'POST',
      body: JSON.stringify({ model: 'deepseek/deepseek-flsh' }),
    })
    await post(url, `/api/sessions/${id}/messages`, { text: 'run it' })
    await events.until(e => e.type === 'ask')
    const replying = await fetch(`${url}/api/sessions/${id}/model`, {
      method: 'POST',
      body: JSON.stringify({ model: 'deepseek/deepseek-flash' }),
    })

    // Assert
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as { error: string }).error).toContain('Did you mean "deepseek/deepseek-flash"?')
    expect(replying.status).toBe(400)
    expect(await replying.json()).toEqual({ error: 'Stop the reply before switching models.' })
  })

  it('should switch the model with /model, and say which it is without one', async () => {
    // Arrange
    const other = createFakeModel([])
    onTestFinished(() => other.dispose())
    const spec = `${other.model.provider}/${other.model.id}`
    const { url } = await serve([])
    const { id } = await create(url)
    const events = await subscribe(`${url}/api/sessions/${id}/events`)

    // Act
    await post(url, `/api/sessions/${id}/commands`, { line: `/model ${spec}` })
    const switched = await events.until(e => e.type === 'notice')
    await post(url, `/api/sessions/${id}/commands`, { line: '/model' })
    const told = await events.until(e => e.type === 'notice')

    // Assert
    expect(switched).toMatchObject({ level: 'success', text: `Model: ${spec}, thinking off` })
    expect(told).toMatchObject({ level: 'info', text: expect.stringContaining(`Model: ${spec}.`) })
  })
})

/** A service on a folder of sessions, a new one by default, whose sessions work in a new folder of their own. */
describe('commands over HTTP', () => {
  it('should list the commands and run one, telling the client what it said', async () => {
    // Arrange
    const { url } = await serve([])
    const { id } = await create(url)
    const events = await subscribe(`${url}/api/sessions/${id}/events`)
    const first = await events.until(e => e.type === 'state')

    // Act
    const ran = await post(url, `/api/sessions/${id}/commands`, { line: '/fast on' })
    const notice = await events.until(e => e.type === 'notice')
    await post(url, `/api/sessions/${id}/commands`, { line: '/nope' })
    const unknown = await events.until(e => e.type === 'notice')
    await post(url, `/api/sessions/${id}/commands`, { line: '/help' })
    const help = await events.until(e => e.type === 'help')

    // Assert
    expect(ran).toEqual({ result: 'ran' })
    const commands = first.type === 'state' ? first.state.commands : []
    expect(commands.map(c => c.name)).toEqual(['/model', '/think', '/fast', '/compact', '/help', '/exit'])
    expect(commands[1]).toMatchObject({ arg: '<off>', choices: ['off'] })
    expect(notice).toMatchObject({ level: 'info', text: expect.stringContaining('Fast mode is for openai') })
    expect(unknown).toMatchObject({ level: 'warn', text: 'No such command: /nope. /help lists them.' })
    expect(help.type === 'help' && help.sections.map(s => s.title)).toEqual(['Commands', 'Mode', 'Tools (5)'])
  })

  it('should log in by asking the client for the key, and keep it where the terminal does', async () => {
    // Arrange
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    onTestFinished(() => {
      vi.unstubAllEnvs()
    })
    const auth = scratch()
    const { url } = await serve([], scratch(), auth)
    const { id } = await create(url)
    const events = await subscribe(`${url}/api/sessions/${id}/events`)
    const first = await events.until(e => e.type === 'state')

    // Act
    await post(url, `/api/sessions/${id}/commands`, { line: '/login deepseek' })
    const ask = await events.until(e => e.type === 'ask')
    await post(url, `/api/sessions/${id}/questions/${idOf(ask)}`, { answers: [['sk-typed']] })
    const notice = await events.until(e => e.type === 'notice')

    // Assert
    const login = first.type === 'state' ? first.state.commands.find(c => c.name === '/login') : undefined
    expect(login?.choices).toContain('deepseek')
    expect(ask).toMatchObject({ questions: [{ options: [], other: true, secret: true }] })
    expect(notice).toMatchObject({ level: 'success', text: expect.stringContaining('Logged in to deepseek') })
    expect(readFileSync(join(auth, 'auth.json'), 'utf8')).toContain('sk-typed')
  })

  it('should say what the replies spent in the state', async () => {
    // Arrange
    const { url } = await serve([assistantMessage('hi')])
    const { id } = await create(url)
    const events = await subscribe(`${url}/api/sessions/${id}/events`)

    // Act
    await post(url, `/api/sessions/${id}/messages`, { text: 'hello' })
    await events.until(e => e.type === 'reply_end')
    const state = await events.until(e => e.type === 'state')

    // Assert
    expect(state.type === 'state' && state.state.usage).toMatchObject({ calls: 1, context: { estimated: false } })
  })
})

async function serve(
  replies: (AssistantMessage | FakeReply)[],
  sessions = scratch(),
  auth?: string,
): Promise<{ url: string; root: string }> {
  const root = scratch()
  const fake = createFakeModel(replies)
  onTestFinished(() => fake.dispose())
  const store = new SessionStore(sessions)
  const hub = new SessionHub({ store, opener: new SessionOpener({ store, model: fake.model, thinking: 'off', auth }) })
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

async function modeOf(url: string, id: string): Promise<string> {
  const response = await fetch(`${url}/api/sessions/${id}/state`)
  const state = (await response.json()) as { mode: string }
  return state.mode
}

async function post(url: string, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${url}${path}`, { method: 'POST', body: JSON.stringify(body) })
  return response.json()
}
