// `pnpm release bootstrap`, once per new package: npm only lets CI publish through trusted publishing (no token
// anywhere) to a package that already exists, so this puts a 0.0.0 placeholder under each new name from this machine,
// deprecates it to point at the real channel, and links the package to the release workflow. Publishing takes a name
// for good, the one step here that cannot be undone, so it shows exactly what it will publish and asks once.
//
// npm accepts a new package at once but serves it only minutes later, and refuses to deprecate or link it until then.
// So each step looks at what npm holds now rather than at what an earlier run did: run again, it does only what is
// left, and waits for packages it has just published before going on.

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

export interface BootstrapFlags {
  dryRun: boolean
}

/** What npm serves for a package: nothing yet, its placeholder still to deprecate, or nothing left to do. */
type RegistryState = 'missing' | 'placeholder' | 'ready'

async function registryState(name: string, cwd: string): Promise<RegistryState> {
  const out = await capture('npm', ['view', `${name}@0.0.0`, 'version', 'deprecated', '--json'], { cwd })
  if (out.code === 0) {
    const view = JSON.parse(out.stdout || 'null') as string | { deprecated?: string } | null
    return typeof view === 'object' && view?.deprecated !== undefined ? 'ready' : 'placeholder'
  }
  // The package is there, released without a placeholder
  if (/No match found for version/.test(out.stderr)) {
    return 'ready'
  }
  if (/E404|404 Not Found/.test(out.stderr)) {
    return 'missing'
  }
  throw new ReleaseError(
    `Could not ask npm about ${name}.`,
    out.stderr.trim().split('\n').at(-1) ?? 'Check the network.',
  )
}

/** Minutes npm took to serve a new package, at most, when this was written; past them, a run later picks up. */
const SERVE_TIMEOUT_MS = 15 * 60_000
const POLL_MS = 15_000

/** Waits until npm serves each of `names`; returns the states, `missing` for those it still does not serve. */
async function waitServed(names: string[], cwd: string): Promise<Map<string, RegistryState>> {
  const states = new Map<string, RegistryState>(names.map(name => [name, 'missing']))
  const deadline = Date.now() + SERVE_TIMEOUT_MS
  print('', dim(`Waiting for npm to serve the new packages; this usually takes a few minutes.`))
  let served = 0
  for (;;) {
    const pending = [...states].filter(([, state]) => state === 'missing').map(([name]) => name)
    const now = await mapLimit(pending, 6, name => registryState(name, cwd))
    pending.forEach((name, index) => states.set(name, now[index]!))
    const count = [...states.values()].filter(state => state !== 'missing').length
    if (count !== served) {
      served = count
      print(dim(`  ${served} of ${names.length} served`))
    }
    if (served === names.length || Date.now() > deadline) {
      return states
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

async function deprecate(name: string, ws: Workspace): Promise<boolean> {
  print('', strong(`${name}@0.0.0  deprecate`))
  return (await attach('npm', ['deprecate', `${name}@0.0.0`, placeholderNote(name, ws)], { cwd: ws.root })) === 0
}

/**
 * Whether the package already trusts the workflow; undefined when npm will not say without two-factor authentication,
 * which it asks for in a terminal only (and this reads npm's answer, so runs it without one).
 */
async function isLinked(name: string, repo: string, cwd: string): Promise<boolean | undefined> {
  const out = await capture('npm', ['trust', 'list', name, '--json'], { cwd })
  if (out.code !== 0) {
    return /EOTP|one-time password/.test(out.stderr + out.stdout) ? undefined : false
  }
  return out.stdout.includes(WORKFLOW) && out.stdout.toLowerCase().includes(repo.toLowerCase())
}

async function link(name: string, repo: string, cwd: string): Promise<boolean> {
  print('', strong(`${name}  trust ${repo} ${WORKFLOW}`))
  const args = ['trust', 'github', name, '--repository', repo, '--file', WORKFLOW, '--allow-publish', '--yes']
  return (await attach('npm', args, { cwd })) === 0
}

export async function bootstrap(ws: Workspace, flags: BootstrapFlags): Promise<void> {
  const packages = published(ws)
  const names = packages.map(pkg => pkg.packageJson.name)
  const repo = githubRepo(ws)
  print(header(ws, await currentBranch(ws), 'Ji release bootstrap'), '')

  const states = new Map(
    (await mapLimit(names, 6, name => registryState(name, ws.root))).map((state, index) => [names[index]!, state]),
  )
  const missing = packages.filter(pkg => states.get(pkg.packageJson.name) === 'missing')

  if (missing.length === 0) {
    print(`All ${packages.length} packages are on npm.`)
  } else {
    print(
      `${missing.length} of ${packages.length} packages are not on npm yet:`,
      ...columns(missing.map(pkg => [pkg.packageJson.name, dim(placeholderNote(pkg.packageJson.name, ws))])),
      dim('Published in the last few minutes? npm may not serve them yet: wait, then run this again.'),
    )
  }
  if (flags.dryRun) {
    const toDeprecate = names.filter(name => states.get(name) === 'placeholder')
    print(
      `${toDeprecate.length} placeholders to deprecate.`,
      `Then each package on npm is linked to ${repo} ${WORKFLOW}, unless it is already.`,
      '',
      dim('Dry run: nothing written to npm. Whether a package is linked takes two-factor authentication to read,'),
      dim('so the real run checks it, asking in the browser.'),
    )
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

  const failed = new Set<string>()
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
        failed.add(pkg.packageJson.name)
      }
    }
    for (const [name, state] of await waitServed(fresh, ws.root)) {
      states.set(name, state)
    }
  }

  // Deprecating and linking change no code and repeat harmlessly, so they go ahead without asking
  for (const name of names.filter(name => states.get(name) === 'placeholder')) {
    if (!(await deprecate(name, ws))) {
      failed.add(name)
    }
  }
  // npm may answer "linked?" only after two-factor authentication: then link, and let npm ask for it in the terminal
  const present = names.filter(name => states.get(name) !== 'missing')
  const linked = await mapLimit(present, 6, name => isLinked(name, repo, ws.root))
  for (const name of present.filter((_, index) => linked[index] !== true)) {
    if (!(await link(name, repo, ws.root))) {
      failed.add(name)
    }
  }

  const unserved = names.filter(name => states.get(name) === 'missing' && !failed.has(name))
  print('')
  if (failed.size > 0 || unserved.length > 0) {
    if (failed.size > 0) {
      print(blocking(`✖ Not done: ${[...failed].join(', ')}`))
    }
    if (unserved.length > 0) {
      print(notice(`npm does not serve ${unserved.length} of them yet: ${unserved.join(', ')}`))
    }
    print(dim(`Run ${command('pnpm release bootstrap')} again to finish them; it does only what is left.`))
    process.exitCode = 1
    return
  }
  print(
    done(`✔ ${packages.length} packages on npm, each publishable by ${repo} ${WORKFLOW} only.`),
    'Next: merge a Version Packages PR to publish the first real versions.',
  )
}
