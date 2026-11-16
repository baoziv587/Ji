// Child processes: `capture` for the ones whose output is read, `attach` for the ones that talk to the person (npm
// asking for a one-time password, Changesets printing what it versioned).

import { spawn } from 'node:child_process'

export interface Output {
  code: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
}

export function capture(command: string, args: readonly string[], options: RunOptions): Promise<Output> {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.on('error', error => resolve({ code: 127, stdout, stderr: stderr + error.message }))
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

export function attach(command: string, args: readonly string[], options: RunOptions): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: 'inherit' })
    child.on('error', () => resolve(127))
    child.on('close', code => resolve(code ?? 1))
  })
}

/** `fn` over `items`, at most `limit` at a time, results in the items' order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
