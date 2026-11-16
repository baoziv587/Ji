// Colour says one thing each: green done, yellow worth a look, red blocking, dim secondary. styleText leaves the text
// plain when stdout is no terminal or NO_COLOR is set.

import process from 'node:process'
import { styleText } from 'node:util'

export const done = (text: string): string => styleText('green', text)
export const notice = (text: string): string => styleText('yellow', text)
export const blocking = (text: string): string => styleText('red', text)
export const dim = (text: string): string => styleText('dim', text)
export const strong = (text: string): string => styleText('bold', text)

/** A command the person can run, as the text tells it. */
export const command = (text: string): string => styleText('cyan', `\`${text}\``)

export function print(...lines: string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`)
}

/** Rows in two columns, the first padded to the longest. */
export function columns(rows: ReadonlyArray<readonly [string, string]>, indent = '  '): string[] {
  const width = Math.max(0, ...rows.map(([left]) => left.length))
  return rows.map(([left, right]) => `${indent}${left.padEnd(width)}   ${right}`.trimEnd())
}

/** An error the person can act on: what went wrong, and what to do. */
export class ReleaseError extends Error {
  readonly fix: string | undefined
  readonly exitCode: number

  constructor(message: string, fix?: string, exitCode = 1) {
    super(message)
    this.fix = fix
    this.exitCode = exitCode
  }
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && process.env.CI === undefined
}
