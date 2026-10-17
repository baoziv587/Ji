// Links `ji` (src/cli.ts) onto the PATH, run by `pnpm install` at the repository's root: into the first folder of the
// PATH where it can, pnpm's global bin or ~/.local/bin first, then Node's own (where `npm link` puts it), never over a
// `ji` that is not this one. It never fails the install: it says what it did, or why it could not.

import { accessSync, constants, lstatSync, readlinkSync, rmSync, symlinkSync  } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

function link(): string {
  const path = (process.env.PATH ?? '').split(delimiter).filter(dir => dir !== '')
  const preferred = [process.env.PNPM_HOME, join(homedir(), '.local', 'bin'), join(homedir(), 'bin'), dirname(process.execPath)]
  const onPath = preferred.filter((dir): dir is string => dir !== undefined && path.includes(dir))

  for (const dir of new Set([...onPath, ...path])) {
    if (!isWritable(dir)) {
      continue
    }
    const target = join(dir, 'ji')
    const existing = linkOf(target)
    if (existing === CLI) {
      return `ji is linked: ${target}`
    }
    if (existing !== undefined) {
      return `ji not linked: ${target} is another ji; remove it, then run pnpm install again`
    }
    rmSync(target, { force: true })
    symlinkSync(CLI, target)
    return `ji linked: ${target} -> ${CLI}`
  }
  return `ji not linked: no folder of the PATH can be written to; link ${CLI} as ji yourself`
}

/** Where a link points; '' for a file that is no link, none when nothing is there. */
function linkOf(path: string): string | undefined {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : ''
  } catch {
    return undefined
  }
}

function isWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

if (process.env.CI === undefined) {
  try {
    process.stdout.write(`${link()}\n`)
  } catch (error) {
    process.stdout.write(`ji not linked: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}
