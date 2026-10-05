// createLocalHost on real processes (RFC §10): no descendant outlives a call, however it ends; and the ripgrep
// arguments against a real ripgrep, when one is on PATH
import type { Chunk, Exit, Host } from '../src/index.ts'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { CommandNotFoundError, createGrepTool, createLocalHost, runProcess } from '../src/index.ts'

const host = createLocalHost()

/** Starts a child in the background and prints its pid, then does `rest`. */
const background = (rest: string): string[] => ['/bin/bash', '-c', `sleep 30 & echo $!; ${rest}`]

describe('createLocalHost', () => {
  it('should give stdout, stderr and the exit code, whatever stderr holds', async () => {
    // Act
    const { chunks, exit } = await collect(host, ['/bin/bash', '-c', 'echo out; echo err >&2; exit 7'])

    // Assert
    expect(
      chunks
        .filter(c => c.fd === 1)
        .map(c => c.text)
        .join(''),
    ).toBe('out\n')
    expect(
      chunks
        .filter(c => c.fd === 2)
        .map(c => c.text)
        .join(''),
    ).toBe('err\n')
    expect(exit).toEqual({ kind: 'exit', code: 7 })
  })

  it('should not wait for a background child, and kill it when the command exits', async () => {
    // Act
    const started = performance.now()
    const { chunks, exit } = await collect(host, background('exit 0'))

    // Assert
    expect(performance.now() - started).toBeLessThan(5000)
    expect(exit).toEqual({ kind: 'exit', code: 0 })
    expect(await alive(pidOf(chunks))).toBe(false)
  })

  it('should kill the whole group when a clock stops the command', async () => {
    // Arrange
    const chunks: Chunk[] = []
    const stream = runProcess(host, { argv: background('wait') }, { totalMs: 300 }, never())

    // Act
    let r = await stream.next()
    while (!r.done) {
      chunks.push(r.value)
      r = await stream.next()
    }

    // Assert
    expect(r.value).toEqual({ kind: 'timeout', clock: 'total', ms: 300 })
    expect(await alive(pidOf(chunks))).toBe(false)
  })

  it('should kill the whole group when the step is cancelled, and throw', async () => {
    // Arrange
    const cancel = new AbortController()
    const stream = runProcess(host, { argv: background('wait') }, {}, cancel.signal)

    // Act
    const first = await stream.next()
    cancel.abort(new Error('cancelled'))

    // Assert
    await expect(stream.next()).rejects.toThrow('cancelled')
    expect(await alive(pidOf([first.value as Chunk]))).toBe(false)
  })

  it('should throw CommandNotFoundError when the executable does not exist', async () => {
    await expect(collect(host, ['/no/such/executable'])).rejects.toBeInstanceOf(CommandNotFoundError)
  })

  it('should start every process with stdin closed', async () => {
    // Act: a read from a closed stdin gets end of file at once instead of waiting
    const { chunks, exit } = await collect(host, ['/bin/bash', '-c', 'read line; echo "read $?"'])

    // Assert
    expect(chunks.map(c => c.text).join('')).toBe('read 1\n')
    expect(exit).toEqual({ kind: 'exit', code: 0 })
  })
})

const rg = process.env.PATH?.split(delimiter).some(dir => existsSync(join(dir, 'rg')))

describe.skipIf(!rg)('grep with a real ripgrep (scenario 2.5)', () => {
  it('should search for text that looks like a command or an option as plain text', async () => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), 'ji-grep-'))
    await mkdir(join(root, 'scripts'))
    await writeFile(join(root, 'scripts/probe.sh'), 'echo "$(printf PROBE_MARKER)"\necho PROBE_MARKER\n--flag here\n')
    const grep = createGrepTool(createLocalHost({ cwd: root }))

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

async function collect(h: Host, argv: string[]): Promise<{ chunks: Chunk[]; exit: Exit }> {
  const chunks: Chunk[] = []
  const stream = h.spawn({ argv }, never())
  let r = await stream.next()
  while (!r.done) {
    chunks.push(r.value)
    r = await stream.next()
  }
  return { chunks, exit: r.value }
}

function pidOf(chunks: Chunk[]): number {
  return Number(
    chunks
      .map(c => c.text)
      .join('')
      .split('\n')[0],
  )
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
