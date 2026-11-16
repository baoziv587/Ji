// `pnpm release bootstrap`, once per new package: npm only lets CI publish through trusted publishing (no token
// anywhere) to a package that already exists, so this puts a 0.0.0 placeholder under each new name from this machine,
// then links the package to the release workflow. Publishing takes a name for good, the one step here that cannot be
// undone, so it shows exactly what it will publish and asks once.
//
// Every write to npm takes two-factor authentication, confirmed in the browser, and npm will not even say whether a
// package is linked without it. So what gets linked follows a rule instead of a lookup: the packages this run
// publishes; with none to publish, every package; or the packages named. A failed run prints the command that finishes
// the rest, with their names.

import type { Package } from '@manypkg/get-packages'
import type { Workspace } from '../workspace.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { confirm, isCancel } from '@clack/prompts'
import writeFileAtomic from 'write-file-atomic'
import { attach, capture, mapLimit } from '../run.ts'
import { blocking, columns, command, dim, done, isInteractive, notice, print, ReleaseError, strong } from '../ui.ts'
import { currentBranch, githubRepo, published } from '../workspace.ts'
import { header } from './status.ts'

/** The workflow npm lets publish, by its file name under .github/workflows. */
const WORKFLOW = 'release.yml'

/** npm accepts a new package at once and serves it minutes later; it links only what it serves. */
const SERVE_TIMEOUT_MS = 15 * 60_000
const POLL_MS = 15_000

export interface BootstrapFlags {
  dryRun: boolean
  /** Packages to link, already on npm or not; empty for the rule above. */
  only: string[]
}

async function isOnNpm(name: string, cwd: string): Promise<boolean> {
  const out = await capture('npm', ['view', name, 'name'], { cwd })
  if (out.code === 0) {
    return true
  }
  if (/E404|404 Not Found/.test(out.stderr)) {
    return false
  }
  throw new ReleaseError(
    `Could not ask npm about ${name}.`,
    out.stderr.trim().split('\n').at(-1) ?? 'Check the network.',
  )
}

/** Waits until npm serves each of `names`; returns those it still does not when time runs out. */
async function waitServed(names: string[], cwd: string): Promise<string[]> {
  const deadline = Date.now() + SERVE_TIMEOUT_MS
  print('', dim('Waiting for npm to serve the new packages; this usually takes a few minutes.'))
  let pending = names
  for (;;) {
    const served = await mapLimit(pending, 6, name => isOnNpm(name, cwd))
    const still = pending.filter((_, index) => !served[index])
    if (still.length !== pending.length) {
      print(dim(`  ${names.length - still.length} of ${names.length} served`))
    }
    pending = still
    if (pending.length === 0 || Date.now() > deadline) {
      return pending
    }
    await sleep(POLL_MS)
  }
}

function placeholderNote(name: string, ws: Workspace): string {
  return ws.pre?.mode === 'pre'
    ? `Placeholder. Install ${name}@${ws.pre.tag}.`
    : `Placeholder; the first release is on its way.`
}

async function publishPlaceholder(pkg: Package, ws: Workspace, repo: string): Promise<boolean> {
  const name = pkg.packageJson.name
  const note = placeholderNote(name, ws)
  const dir = await mkdtemp(join(tmpdir(), 'ji-placeholder-'))
  try {
    const manifest = {
      name,
      version: '0.0.0',
      description: note,
      repository: { type: 'git', url: `git+https://github.com/${repo}.git`, directory: pkg.relativeDir },
    }
    await writeFileAtomic(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await writeFileAtomic(join(dir, 'README.md'), `# ${name}\n\n${note}\n`)
    print('', strong(`${name}@0.0.0`))
    return (await attach('npm', ['publish', '--access', 'public'], { cwd: dir })) === 0
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function link(name: string, repo: string, cwd: string): Promise<boolean> {
  print('', strong(`${name}  trust ${repo} ${WORKFLOW}`))
  const args = ['trust', 'github', name, '--repository', repo, '--file', WORKFLOW, '--allow-publish', '--yes']
  return (await attach('npm', args, { cwd })) === 0
}

/** The packages named, by full name or by the part after the scope; an unknown name stops the run. */
function named(packages: Package[], only: string[]): Package[] {
  const byName = (wanted: string): Package | undefined =>
    packages.find(pkg => pkg.packageJson.name === wanted || pkg.packageJson.name.endsWith(`/${wanted}`))
  const unknown = only.filter(wanted => byName(wanted) === undefined)
  if (unknown.length > 0) {
    throw new ReleaseError(
      `No published package named ${unknown.join(', ')}.`,
      `One of: ${packages.map(pkg => pkg.packageJson.name).join(', ')}`,
      2,
    )
  }
  return [...new Set(only.map(wanted => byName(wanted)!))]
}

function confirmations(count: number): string {
  return count === 1 ? 'one confirmation' : `${count} confirmations`
}

export async function bootstrap(ws: Workspace, flags: BootstrapFlags): Promise<void> {
  const all = published(ws)
  const scope = flags.only.length > 0 ? named(all, flags.only) : all
  const repo = githubRepo(ws)
  print(header(ws, await currentBranch(ws), 'Ji release bootstrap'), '')

  const onNpm = await mapLimit(scope, 6, pkg => isOnNpm(pkg.packageJson.name, ws.root))
  const missing = scope.filter((_, index) => !onNpm[index])
  // The rule in the header: the packages named, else what this run publishes, else every package
  const toLink = flags.only.length > 0 || missing.length === 0 ? scope : missing

  if (missing.length > 0) {
    print(
      `${missing.length} of ${scope.length} packages are not on npm yet:`,
      ...columns(missing.map(pkg => [pkg.packageJson.name, dim(placeholderNote(pkg.packageJson.name, ws))])),
      dim('Published in the last few minutes? npm may not serve them yet: wait, then run this again.'),
      '',
    )
  } else {
    print(`${scope.length === all.length ? 'All' : 'The'} ${scope.length} packages are on npm.`)
  }
  print(
    `${toLink.length} to link to ${repo} ${WORKFLOW}. npm asks you to confirm each publish and each link in the ` +
      `browser: ${confirmations(missing.length + toLink.length)} in all.`,
  )
  if (flags.dryRun) {
    print('', dim('Dry run: nothing written to npm.'))
    return
  }
  if (!isInteractive()) {
    throw new ReleaseError('bootstrap publishes under your npm account, so it runs in a terminal only.', undefined, 2)
  }

  const whoami = await capture('npm', ['whoami'], { cwd: ws.root })
  if (whoami.code !== 0) {
    throw new ReleaseError('Not logged in to npm.', 'Run `npm login`, then `pnpm release bootstrap` again.')
  }
  const user = whoami.stdout.trim()

  const failed: string[] = []
  let unserved: string[] = []
  if (missing.length > 0) {
    const go = await confirm({
      message: `Publish ${missing.length} placeholder packages as ${user}? Their names become yours on npm for good.`,
      initialValue: false,
    })
    if (isCancel(go) || !go) {
      print('Nothing published.')
      return
    }
    const fresh: string[] = []
    for (const pkg of missing) {
      if (await publishPlaceholder(pkg, ws, repo)) {
        fresh.push(pkg.packageJson.name)
      } else {
        failed.push(pkg.packageJson.name)
      }
    }
    unserved = await waitServed(fresh, ws.root)
  }

  // Linking changes no package and repeats harmlessly, so it goes ahead without asking
  for (const pkg of toLink) {
    const name = pkg.packageJson.name
    if (failed.includes(name) || unserved.includes(name)) {
      continue
    }
    if (!(await link(name, repo, ws.root))) {
      failed.push(name)
    }
  }

  print('')
  const left = [...failed, ...unserved]
  if (left.length > 0) {
    if (failed.length > 0) {
      print(blocking(`✖ Not done: ${failed.join(', ')}`))
    }
    if (unserved.length > 0) {
      print(notice(`npm does not serve ${unserved.join(', ')} yet; give it a few more minutes.`))
    }
    print(dim(`Finish them with ${command(`pnpm release bootstrap ${left.join(' ')}`)}`))
    process.exitCode = 1
    return
  }
  print(
    done(`✔ ${toLink.length} packages linked: ${repo} ${WORKFLOW} can publish them, and nothing else can.`),
    'Next: merge a Version Packages PR to publish the first real versions.',
  )
}
