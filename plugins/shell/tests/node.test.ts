// createLocalExecutor on real processes (RFC §10): the contract of execute, and the guarantee it adds, that no
// descendant outlives a call however it ends; quoteArgv against a real shell (L10); and the ripgrep arguments against
// a real ripgrep, when one is on PATH
import type { Chunk, Command, CommandExecutor, Outcome } from '../src/index.ts'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import process from 'node:process'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CommandNotFoundError, createGrepTool, createLocalExecutor, quoteArgv } from '../src/index.ts'

const local = createLocalExecutor()

/** Starts a child in the background and prints its pid, then does `rest`. */
const background = (rest: string): string => `sleep 30 & echo $!; ${rest}`

describe('createLocalExecutor', () => {
  it('should give stdout, stderr and the exit code, whatever stderr holds', async () => {
    // Act
    const { chunks, outcome } = await collect(local, 'echo out; echo err >&2; exit 7')

    // Assert
    expect(textOf(chunks.filter(c => c.fd === 1))).toBe('out\n')
    expect(textOf(chunks.filter(c => c.fd === 2))).toBe('err\n')
    expect(outcome).toEqual({ kind: 'exit', code: 7 })
  })

  it('should give an array to the program as it is, with no shell to read it', async () => {
    // Act
    const { chunks } = await collect(local, ['/bin/echo', '$(id)', "'quoted'", '-n'])

    // Assert
    expect(textOf(chunks)).toBe("$(id) 'quoted' -n\n")
  })

  it('should start a command line as a non-login bash, behind wrapArgv', async () => {
    // Arrange: echo stands in for a sandbox, and prints what it would have started
    const wrapped = createLocalExecutor({ wrapArgv: argv => ['/bin/echo', ...argv] })

    // Act
    const { chunks } = await collect(wrapped, 'pnpm test')

    // Assert
    expect(textOf(chunks)).toBe('/bin/bash -c pnpm test\n')
  })

  it('should not wait for a background child, and kill it when the command exits', async () => {
    // Act
    const started = performance.now()
    const { chunks, outcome } = await collect(local, background('exit 0'))

    // Assert
    expect(performance.now() - started).toBeLessThan(5000)
    expect(outcome).toEqual({ kind: 'exit', code: 0 })
    expect(await alive(pidOf(chunks))).toBe(false)
  })

  it('should kill the whole group when a clock stops the command, after the output so far', async () => {
    // Act
    const { chunks, outcome } = await collect(local, background('wait'), 300)

    // Assert
    expect(outcome).toEqual({ kind: 'timeout', clock: 'total', ms: 300 })
    expect(await alive(pidOf(chunks))).toBe(false)
  })

  it('should kill the whole group when the step is cancelled, and throw', async () => {
    // Arrange
    const cancel = new AbortController()
    const stream = local.execute(background('wait'), { signal: cancel.signal })

    // Act
    const first = await stream.next()
    cancel.abort(new Error('cancelled'))

    // Assert
    await expect(stream.next()).rejects.toThrow('cancelled')
    expect(await alive(pidOf([first.value as Chunk]))).toBe(false)
  })

  it('should throw CommandNotFoundError when the program does not exist', async () => {
    await expect(collect(local, ['/no/such/executable'])).rejects.toBeInstanceOf(CommandNotFoundError)
  })

  it('should start every process with stdin closed', async () => {
    // Act: a read from a closed stdin gets end of file at once instead of waiting
    const { chunks, outcome } = await collect(local, 'read line; echo "read $?"')

    // Assert
    expect(textOf(chunks)).toBe('read 1\n')
    expect(outcome).toEqual({ kind: 'exit', code: 0 })
  })
})

describe('quoteArgv (L10)', () => {
  it('should be read back by a POSIX shell as exactly the words it was given', () => {
    const word = fc.oneof(
      fc.string({ unit: 'grapheme' }),
      fc.constantFrom('', "'", "''", '\n', '$(id)', '`id`', '"$HOME"', '\\', '-n', '--', '*', '; rm x'),
    )
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 6 }), argv => {
        // Act: printf ends each word with a NUL, which no word can hold
        const out = execFileSync('/bin/sh', ['-c', `exec printf '%s\\0' ${quoteArgv(argv)}`], { encoding: 'utf8' })

        // Assert
        expect(out.split('\0').slice(0, -1)).toEqual(argv)
      }),
      { numRuns: 50 },
    )
  })
})

const rg = process.env.PATH?.split(delimiter).some(dir => existsSync(join(dir, 'rg')))

describe.skipIf(!rg)('grep with a real ripgrep (scenario 2.5)', () => {
  it('should search for text that looks like a command or an option as plain text', async () => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), 'ji-grep-'))
    await mkdir(join(root, 'scripts'))
    await writeFile(join(root, 'scripts/probe.sh'), 'echo "$(printf PROBE_MARKER)"\necho PROBE_MARKER\n--flag here\n')
    const grep = createGrepTool(createLocalExecutor({ cwd: root }))

    // Act
    const literal = await grep.run(
      { pattern: '$(printf PROBE_MARKER)', literal: true, glob: '*.sh', context: 0 },
      never(),
    )
    const dash = await grep.run({ pattern: '--flag', path: 'scripts' }, never())

    // Assert
    expect(literal).toMatchObject({ text: 'scripts/probe.sh:1: echo "$(printf PROBE_MARKER)"\n[1 matching line]' })
    expect(dash).toMatchObject({ text: 'scripts/probe.sh:3: --flag here\n[1 matching line]' })
  })
})

// Helpers

async function collect(
  executor: CommandExecutor,
  command: Command,
  timeoutMs?: number,
): Promise<{ chunks: Chunk[]; outcome: Outcome }> {
  const chunks: Chunk[] = []
  const stream = executor.execute(command, { signal: never(), timeoutMs })
  let r = await stream.next()
  while (!r.done) {
    chunks.push(r.value)
    r = await stream.next()
  }
  return { chunks, outcome: r.value }
}

function textOf(chunks: Chunk[]): string {
  return chunks.map(c => c.text).join('')
}

function pidOf(chunks: Chunk[]): number {
  return Number(textOf(chunks).split('\n')[0])
}

/** Whether the process is still there after a second: a killed one may take a moment to be reaped. */
async function alive(pid: number): Promise<boolean> {
  for (let tries = 0; tries < 20; tries++) {
    try {
      process.kill(pid, 0)
    } catch {
      return false
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return true
}

function never(): AbortSignal {
  return new AbortController().signal
}
