// `pnpm release pre <tag>` and `pnpm release pre exit`. Each step only writes .changeset/pre.json, which takes effect
// once committed and undoes by reverting, so it says what will happen and asks nothing. Moving from one tag to the next
// (alpha to beta) edits the tag in place, as the Changesets guide says to.

import type { Workspace } from '../workspace.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { enterPre, exitPre } from '@changesets/pre'
import semver from 'semver'
import writeFileAtomic from 'write-file-atomic'
import { command, dim, done, notice, print, ReleaseError } from '../ui.ts'
import { releasePlan, versioned } from '../workspace.ts'

const TAG = /^[a-z][a-z0-9]*$/

const COMMIT = dim('Wrote .changeset/pre.json. Commit it to take effect; revert it to undo.')

async function enter(ws: Workspace, tag: string): Promise<void> {
  if (ws.pre?.mode === 'pre' && ws.pre.tag === tag) {
    print(`Already in the ${tag} prerelease.`)
    return
  }

  if (ws.pre?.mode === 'pre') {
    const file = join(ws.root, '.changeset', 'pre.json')
    const state = JSON.parse(await readFile(file, 'utf8')) as { tag: string }
    await writeFileAtomic(file, `${JSON.stringify({ ...state, tag }, null, 2)}\n`)
    print(
      `${done('Moved')} from ${ws.pre.tag} to ${tag}.`,
      `The next versions end in -${tag}.0 and publish to the ${tag} dist-tag.`,
      COMMIT,
    )
    return
  }

  // Changesets waiting since a stable release go into the first prerelease instead (the guide's first pitfall)
  const plan = await releasePlan(ws)
  const stable = versioned(ws).some(
    pkg => pkg.packageJson.version !== '0.0.0' && semver.prerelease(pkg.packageJson.version) === null,
  )
  const lines: string[] = []
  if (stable && plan.changesets.length > 0) {
    lines.push(
      notice(`${plan.changesets.length} pending changesets will ship in the first ${tag}, not as a stable release.`),
      dim('To release them stable first, merge the Version Packages PR before entering.'),
      '',
    )
  }

  await enterPre(ws.root, tag)
  lines.push(
    `${done('Entered')} the ${tag} prerelease.`,
    `Releases now end in -${tag}.N and publish to the ${tag} dist-tag.`,
    'Dependents release along with each of them: no version range takes a prerelease.',
    `Leave it with ${command('pnpm release pre exit')}.`,
    COMMIT,
  )
  print(...lines)
}

async function exit(ws: Workspace): Promise<void> {
  if (ws.pre === undefined) {
    print('Not in a prerelease.')
    return
  }
  if (ws.pre.mode === 'exit') {
    print(`Already leaving ${ws.pre.tag}; the next Version Packages PR makes the stable versions.`)
    return
  }
  await exitPre(ws.root)
  print(
    `${done('Leaving')} the ${ws.pre.tag} prerelease.`,
    `The next Version Packages PR drops the -${ws.pre.tag} suffix and publishes to latest.`,
    COMMIT,
  )
}

export async function pre(ws: Workspace, tag: string | undefined): Promise<void> {
  if (tag === 'exit') {
    return exit(ws)
  }
  if (tag === undefined || !TAG.test(tag)) {
    throw new ReleaseError(
      'Name the prerelease: alpha, beta or rc.',
      'pnpm release pre alpha   or   pnpm release pre exit',
      2,
    )
  }
  return enter(ws, tag)
}
