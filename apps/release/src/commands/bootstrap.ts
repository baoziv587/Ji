// `pnpm release bootstrap`, once per new package: npm only lets CI publish through trusted publishing (no token
// anywhere) to a package that already exists, so this puts a 0.0.0 placeholder under each new name from this machine,
// deprecates it to point at the real channel, and links the package to the release workflow. Publishing takes a name
// for good, the one step here that cannot be undone, so it shows exactly what it will publish and asks once. Run again,
// it does only what is left: placeholders for names still missing, links for packages without one.

import type { Package } from '@manypkg/get-packages'
import type { Workspace } from '../workspace.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { confirm, isCancel } from '@clack/prompts'
import writeFileAtomic from 'write-file-atomic'
import { attach, capture, mapLimit } from '../run.ts'
import { blocking, columns, command, dim, done, isInteractive, print, ReleaseError, strong } from '../ui.ts'
import { currentBranch, githubRepo, published } from '../workspace.ts'
import { header } from './status.ts'

/** The workflow npm lets publish, by its file name under .github/workflows. */
const WORKFLOW = 'release.yml'

export interface BootstrapFlags {
  dryRun: boolean
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
    if ((await attach('npm', ['publish', '--access', 'public'], { cwd: dir })) !== 0) {
      return false
    }
    return (await attach('npm', ['deprecate', `${name}@0.0.0`, note], { cwd: dir })) === 0
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function isLinked(name: string, repo: string, cwd: string): Promise<boolean> {
  const out = await capture('npm', ['trust', 'list', name, '--json'], { cwd })
  return out.code === 0 && out.stdout.includes(WORKFLOW) && out.stdout.toLowerCase().includes(repo.toLowerCase())
}

async function link(name: string, repo: string, cwd: string): Promise<boolean> {
  print('', strong(`${name}  trust ${repo} ${WORKFLOW}`))
  const args = ['trust', 'github', name, '--repository', repo, '--file', WORKFLOW, '--allow-publish', '--yes']
  return (await attach('npm', args, { cwd })) === 0
}

export async function bootstrap(ws: Workspace, flags: BootstrapFlags): Promise<void> {
  const packages = published(ws)
  const repo = githubRepo(ws)
  print(header(ws, await currentBranch(ws), 'Ji release bootstrap'), '')

  const onNpm = await mapLimit(packages, 6, pkg => isOnNpm(pkg.packageJson.name, ws.root))
  const missing = packages.filter((_, index) => !onNpm[index])

  if (missing.length === 0) {
    print(`All ${packages.length} packages are on npm.`)
  } else {
    print(
      `${missing.length} of ${packages.length} packages are not on npm yet:`,
      ...columns(missing.map(pkg => [pkg.packageJson.name, dim(placeholderNote(pkg.packageJson.name, ws))])),
    )
  }
  if (flags.dryRun) {
    print(
      '',
      dim(`Dry run: nothing published. Each would then be linked to ${repo} ${WORKFLOW} for trusted publishing.`),
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

  const failed: string[] = []
  if (missing.length > 0) {
    const go = await confirm({
      message: `Publish ${missing.length} placeholder packages as ${user}? Their names become yours on npm for good.`,
      initialValue: false,
    })
    if (isCancel(go) || !go) {
      print('Nothing published.')
      return
    }
    for (const pkg of missing) {
      if (!(await publishPlaceholder(pkg, ws, repo))) {
        failed.push(pkg.packageJson.name)
      }
    }
  }

  // Linking changes no package and repeats harmlessly, so it goes ahead without asking
  const present = packages.filter(pkg => !failed.includes(pkg.packageJson.name))
  const linked = await mapLimit(present, 6, pkg => isLinked(pkg.packageJson.name, repo, ws.root))
  for (const pkg of present.filter((_, index) => !linked[index])) {
    if (!(await link(pkg.packageJson.name, repo, ws.root))) {
      failed.push(pkg.packageJson.name)
    }
  }

  print('')
  if (failed.length > 0) {
    print(
      blocking(`✖ Not done: ${failed.join(', ')}`),
      dim(`Run ${command('pnpm release bootstrap')} again to finish them.`),
    )
    process.exitCode = 1
    return
  }
  print(
    done(`✔ ${packages.length} packages on npm, each publishable by ${repo} ${WORKFLOW} only.`),
    'Next: merge a Version Packages PR to publish the first real versions.',
  )
}
