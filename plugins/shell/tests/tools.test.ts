// bash and grep on createMemoryHost: the scenarios of RFC §2.2–§2.6, as the model reads them, and L9
import type { BashOptions, Chunk, GrepOptions, Host, MemoryProcess } from '../src/index.ts'
import { readFileSync } from 'node:fs'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CommandNotFoundError,
  createBashTool,
  createFileLog,
  createGrepTool,
  createMemoryHost,
  streamResult,
} from '../src/index.ts'

interface Result {
  text: string
  details: Record<string, unknown>
  isError: boolean
}

describe('bash', () => {
  it('should end with the exit code even when stderr is empty (scenario 2.2, probe E3)', async () => {
    // Arrange
    const host = createMemoryHost(() => ({
      chunks: [out(' FAIL  tests/config.test.ts > timeout defaults to 2s\n')],
      exit: { kind: 'exit', code: 1 },
    }))

    // Act
    const result = await bash(host, { command: 'pnpm test' })

    // Assert
    expect(result.text).toMatch(/^ FAIL {2}tests\/config\.test\.ts > timeout defaults to 2s\n\[exit 1 · \d+\.\ds\]$/)
    expect(result).toMatchObject({ isError: true, details: { outcome: { kind: 'exit', code: 1 } } })
  })

  it('should run the command as bash -c, and say when there was no output', async () => {
    // Arrange
    const host = createMemoryHost(() => ({}))

    // Act
    const result = await bash(host, { command: 'true' })

    // Assert
    expect(host.specs).toEqual([{ argv: ['/bin/bash', '-c', 'true'] }])
    expect(result.text).toMatch(/^\(no output\)\n\[exit 0 · /)
    expect(result.isError).toBe(false)
  })

  it('should keep the first and last lines and count exactly the lines left out (scenario 2.3)', async () => {
    // Arrange
    const host = createMemoryHost(() => ({ chunks: [out(numbered(5000))] }))

    // Act
    const result = await bash(host, { command: 'pnpm build' })

    // Assert
    const lines = result.text.split('\n')
    expect(lines.slice(0, 2)).toEqual(['1', '2'])
    expect(lines[40]).toBe('[… 4800 lines omitted …]')
    expect(lines.at(-2)).toBe('5000')
    expect(lines).toHaveLength(40 + 1 + 160 + 1)
    expect(result.details).toMatchObject({ lines: { total: 5000, omitted: 4800 } })
  })

  it('should keep the whole output in a log only when lines were left out', async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), 'ji-shell-'))
    const text = numbered(300)
    const host = createMemoryHost(spec => ({ chunks: [out(spec.argv.at(-1) === 'long' ? text : 'short\n')] }))
    const options: BashOptions = { log: createFileLog(dir) }

    // Act
    const long = await bash(host, { command: 'long' }, options)
    const short = await bash(host, { command: 'short' }, options)

    // Assert
    const log = long.details.log as string
    expect(long.text).toContain(`[… 100 lines omitted; full output: ${log} …]`)
    expect(readFileSync(log, 'utf8')).toBe(text)
    expect(short.details.log).toBeUndefined()
    expect(await readdir(dir)).toEqual([log.slice(dir.length + 1)])
  })

  it('should say which clock stopped the command, and keep what it wrote before (scenario 2.4)', async () => {
    // Arrange
    const host = createMemoryHost(() => ({ chunks: [out('Username: ')], hangs: true }))

    // Act
    const idle = await bash(host, { command: 'npm login' }, { idleMs: 20 })
    const total = await bash(
      host,
      { command: 'npm login', timeout_seconds: 600 },
      { timeoutSeconds: { default: 1, max: 0.02 } },
    )

    // Assert
    expect(idle.text).toMatch(/^Username: \n\[no output for 0\.02s and was killed; the output above is partial · /)
    expect(idle.details.outcome).toEqual({ kind: 'timeout', clock: 'idle', ms: 20 })
    expect(total.text).toMatch(/\[timed out after 0\.02s and was killed; the output above is partial · /)
    expect(total.isError).toBe(true)
    expect(host.running).toBe(0)
  })

  it('should yield each chunk as it arrives (scenario 2.11)', async () => {
    // Arrange
    const chunks = [out('a\n'), { fd: 2, text: 'b\n' } satisfies Chunk]
    const host = createMemoryHost(() => ({ chunks }))
    const run = createBashTool(host).run({ command: 'x' }, never()) as AsyncGenerator<unknown, Result>

    // Act
    const yielded: unknown[] = []
    let r = await run.next()
    while (!r.done) {
      yielded.push(r.value)
      r = await run.next()
    }

    // Assert
    expect(yielded).toEqual(chunks)
    expect(r.value.text).toMatch(/^a\nb\n\[exit 0/)
  })
})

describe('grep', () => {
  it('should pass the pattern to ripgrep as one argument and show hits as path:line: text (scenario 2.5)', async () => {
    // Arrange
    const host = ripgrep({ chunks: [out(rgEvent('match', './scripts/probe.sh', 3, 'echo "$(printf PROBE_MARKER)"'))] })

    // Act
    const result = await grep(host, { pattern: '$(printf PROBE_MARKER)', literal: true })

    // Assert
    expect(host.specs[0].argv).toEqual([
      'rg',
      '--json',
      '--no-config',
      '--hidden',
      '--glob=!.git',
      '--fixed-strings',
      '--regexp=$(printf PROBE_MARKER)',
      '--',
      '.',
    ])
    expect(result).toEqual({
      text: 'scripts/probe.sh:3: echo "$(printf PROBE_MARKER)"\n[1 matching line]',
      details: { matches: 1, more: false },
      isError: false,
    })
  })

  it('should say there are more only past the limit, and show context lines apart (scenario 2.6)', async () => {
    // Arrange
    const events = [
      rgEvent('context', 'a.ts', 1, 'before'),
      rgEvent('match', 'a.ts', 2, 'TODO one'),
      rgEvent('match', 'a.ts', 3, 'TODO two'),
      rgEvent('match', 'b.ts', 9, 'TODO three'),
    ]
    // The search never ends on its own: the third match is what proves more, and closes it
    const host = ripgrep({ chunks: [out(events.join(''))], hangs: true })
    const done = ripgrep({ chunks: [out(events.join(''))] })

    // Act
    const cut = await grep(host, { pattern: 'TODO', limit: 2, context: 1 })
    const exact = await grep(done, { pattern: 'TODO', limit: 3, context: 1 })

    // Assert
    expect(cut.text).toBe(
      'a.ts-1- before\na.ts:2: TODO one\na.ts:3: TODO two\n' +
        '[first 2 matching lines; there are more. Narrow the pattern, path or glob.]',
    )
    expect(cut.details).toEqual({ matches: 2, more: true })
    expect(host.specs[0].argv).toContain('--context=1')
    expect(exact.text.split('\n').at(-1)).toBe('[3 matching lines]')
    expect(exact.details).toEqual({ matches: 3, more: false })
  })

  it("should take exit code 1 as no matches, and give ripgrep's own message on exit code 2", async () => {
    // Arrange
    const none = ripgrep({ exit: { kind: 'exit', code: 1 } })
    const broken = ripgrep({
      chunks: [{ fd: 2, text: 'regex parse error:\n    (\n    ^\nerror: unclosed group\n' }],
      exit: { kind: 'exit', code: 2 },
    })

    // Act
    const nothing = await grep(none, { pattern: 'absent' })
    const failed = await grep(broken, { pattern: '(' })

    // Assert
    expect(nothing).toEqual({ text: 'No matches.', details: { matches: 0, more: false }, isError: false })
    expect(failed).toMatchObject({ isError: true, details: { errors: [{ code: 'SEARCH_FAILED' }] } })
    expect(failed.text).toContain('error: unclosed group')
  })

  it('should tell the model to search with bash when ripgrep is missing, and rethrow anything else (L9)', async () => {
    // Arrange
    const missing = createMemoryHost(() => {
      throw new CommandNotFoundError('rg')
    })
    const broken = createMemoryHost(() => {
      throw new Error('EACCES')
    })

    // Act
    const result = await grep(missing, { pattern: 'x' })

    // Assert
    expect(result).toMatchObject({ isError: true, details: { errors: [{ code: 'NO_RIPGREP' }] } })
    expect(result.text).toContain('Search with bash instead')
    await expect(grep(broken, { pattern: 'x' })).rejects.toThrow('EACCES')
  })
})

// Helpers

function out(text: string): Chunk {
  return { fd: 1, text }
}

function numbered(n: number): string {
  return Array.from({ length: n }, (_, i) => `${i + 1}\n`).join('')
}

function never(): AbortSignal {
  return new AbortController().signal
}

async function bash(
  host: Host,
  args: { command: string; timeout_seconds?: number },
  options?: BashOptions,
): Promise<Result> {
  return streamResult(createBashTool(host, options).run(args, never()) as AsyncGenerator<unknown, Result>)
}

async function grep(
  host: Host,
  args: { pattern: string } & Record<string, unknown>,
  options?: GrepOptions,
): Promise<Result> {
  return (await createGrepTool(host, { timeoutMs: 50, ...options }).run(args, never())) as Result
}

/** A ripgrep that answers every search the same way. */
function ripgrep(process: MemoryProcess): ReturnType<typeof createMemoryHost> {
  return createMemoryHost(() => process)
}

/** One line of `rg --json`. */
function rgEvent(type: 'match' | 'context', path: string, line: number, text: string): string {
  return `${JSON.stringify({ type, data: { path: { text: path }, lines: { text: `${text}\n` }, line_number: line } })}\n`
}
