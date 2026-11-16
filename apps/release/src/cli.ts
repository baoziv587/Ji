#!/usr/bin/env node
// pnpm release: the local half of releasing. Publishing itself happens only in CI (.github/workflows/release.yml),
// through npm trusted publishing, so no npm token lives on a machine or in the repository.
//
//   pnpm release              what the next release holds
//   pnpm release add          write a changeset for a change
//   pnpm release check        build and pack every package as npm would get it, and check the result
//   pnpm release pre <tag>    enter a prerelease (alpha, beta, rc); `pre exit` leaves it
//   pnpm release bootstrap    once per new package: its name on npm, linked to CI
//   pnpm release version      apply the changesets (CI runs this for the Version Packages PR)

import process from 'node:process'
import { parseArgs } from 'node:util'
import { add } from './commands/add.ts'
import { bootstrap } from './commands/bootstrap.ts'
import { check } from './commands/check.ts'
import { pre } from './commands/pre.ts'
import { status } from './commands/status.ts'
import { version } from './commands/version.ts'
import { blocking, dim, print, ReleaseError } from './ui.ts'
import { loadWorkspace } from './workspace.ts'

const USAGE = `pnpm release [command]

  (none)        What the next release holds
  add           Write a changeset for your change
  check         Build and pack every package as npm would get it, and check the result
  pre <tag>     Enter a prerelease (alpha, beta, rc); pre exit leaves it
  bootstrap     Once per new package: put its name on npm and link it to CI
  version       Apply the changesets (CI runs this)

add takes the flags of changeset add: --patch/--minor/--major <pkg,...>, -m <summary>, --empty.
bootstrap takes --dry-run.`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    empty: { type: 'boolean', default: false },
    message: { type: 'string', short: 'm' },
    patch: { type: 'string' },
    minor: { type: 'string' },
    major: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
})

async function main(): Promise<void> {
  const [name, ...rest] = positionals
  if (values.help === true) {
    print(USAGE)
    return
  }
  const ws = await loadWorkspace(process.cwd())
  switch (name) {
    case undefined:
    case 'status':
      return status(ws)
    case 'add':
      return add(ws, values)
    case 'check':
      return check(ws)
    case 'pre':
      return pre(ws, rest[0])
    case 'bootstrap':
      return bootstrap(ws, { dryRun: values['dry-run'] })
    case 'version':
      return version(ws)
    default:
      throw new ReleaseError(`No command "${name}".`, USAGE, 2)
  }
}

try {
  await main()
} catch (error) {
  if (error instanceof ReleaseError) {
    print(blocking(`✖ ${error.message}`), ...(error.fix === undefined ? [] : [dim(error.fix)]))
    process.exitCode = error.exitCode
  } else {
    throw error
  }
}
