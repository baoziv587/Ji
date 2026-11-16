// `pnpm release check`: every package that goes to npm, built and packed as npm will get it, then judged from the
// tarball: the manifest rules (packed.ts), publint, whether TypeScript resolves its types (attw, ESM only), and last
// what a user would run into: the tarballs installed fresh from npm, every export imported. Only that last step sees a
// dependency range that lets npm pick a newer version than the lockfile, one the code was never run against. CI runs
// the same command. A problem shared by several packages is told once, with the packages it hits.

import type { Package } from '@manypkg/get-packages'
import type { Problem } from '../packed.ts'
import type { Workspace } from '../workspace.ts'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import process from 'node:process'
import { publint } from 'publint'
import { formatMessage } from 'publint/utils'
import writeFileAtomic from 'write-file-atomic'
import { checkPacked } from '../packed.ts'
import { capture, mapLimit } from '../run.ts'
import { blocking, dim, done, notice, print, ReleaseError } from '../ui.ts'
import { currentBranch, githubRepo, published, releasePlan } from '../workspace.ts'
import { header } from './status.ts'

interface Finding extends Problem {
  name: string
  /** Shown, but passes. */
  warning?: boolean
}

const RESOLUTIONS_CHECKED = new Set(['node16-esm', 'bundler'])

/** This package, where `pnpm exec` finds attw. */
const HERE = join(import.meta.dirname, '..', '..')

async function build(ws: Workspace, packages: Package[]): Promise<Finding[]> {
  const before = await Promise.all(packages.map(pkg => readFile(join(pkg.dir, 'package.json'), 'utf8')))
  const filters = packages.flatMap(pkg => ['--filter', pkg.packageJson.name])
  const out = await capture('pnpm', [...filters, 'run', 'build'], { cwd: ws.root })
  if (out.code !== 0) {
    const tail = `${out.stdout}${out.stderr}`.trim().split('\n').slice(-20).join('\n')
    throw new ReleaseError(`Build failed:\n${tail}`, 'Fix the build, then run the check again.')
  }

  // The build writes publishConfig from the exports; a manifest it changed was committed out of date
  const after = await Promise.all(packages.map(pkg => readFile(join(pkg.dir, 'package.json'), 'utf8')))
  return packages.flatMap((pkg, index) =>
    before[index] === after[index]
      ? []
      : [
          {
            name: pkg.packageJson.name,
            message: 'the build rewrote publishConfig in package.json',
            fix: 'Commit the rewritten package.json.',
            warning: process.env.CI === undefined,
          },
        ],
  )
}

async function filesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries.filter(entry => entry.isFile()).map(entry => relative(dir, join(entry.parentPath, entry.name)))
}

async function typesProblems(tarball: string): Promise<Problem[]> {
  const out = await capture(
    'pnpm',
    ['exec', 'attw', tarball, '--profile', 'esm-only', '--format', 'json', '--no-emoji'],
    { cwd: HERE },
  )
  if (out.code === 0) {
    return []
  }
  let kinds: string[] = []
  try {
    const { problems } = JSON.parse(out.stdout) as {
      problems?: Record<string, Array<{ entrypoint?: string; resolutionKind?: string }>>
    }
    kinds = Object.entries(problems ?? {})
      .filter(([, found]) => found.some(problem => RESOLUTIONS_CHECKED.has(problem.resolutionKind ?? '')))
      .map(([kind, found]) => `${kind} at ${[...new Set(found.map(problem => problem.entrypoint))].join(', ')}`)
  } catch {
    kinds = [out.stderr.trim() || 'attw failed']
  }
  return [
    {
      message: `types: ${kinds.join('; ')}`,
      fix: 'Run `npx attw --pack <package> --profile esm-only` for the details.',
    },
  ]
}

interface Packed {
  pkg: Package
  /** Undefined when packing failed. */
  tarball?: string
  findings: Finding[]
}

async function checkPackage(pkg: Package, repo: string, scratch: string): Promise<Packed> {
  const name = pkg.packageJson.name
  const dir = await mkdtemp(join(scratch, 'pkg-'))
  const packed = await capture('pnpm', ['pack', '--pack-destination', dir, '--json'], { cwd: pkg.dir })
  if (packed.code !== 0) {
    const fix = packed.stderr.trim().split('\n')[0] ?? 'Run `pnpm pack` in the package.'
    return { pkg, findings: [{ name, message: 'pnpm pack failed', fix }] }
  }
  const tarball = (JSON.parse(packed.stdout) as { filename: string }).filename
  const unpacked = join(dir, 'unpacked')
  await mkdir(unpacked)
  await capture('tar', ['-xzf', tarball, '-C', unpacked], { cwd: dir })
  const root = join(unpacked, 'package')

  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const problems = checkPacked(manifest, await filesIn(root), { directory: pkg.relativeDir, repo })

  const lint = await publint({ pkgDir: root, pack: false, level: 'warning' })
  for (const message of lint.messages) {
    problems.push({
      message: `publint: ${formatMessage(message, lint.pkg) ?? message.code}`,
      fix: 'See https://publint.dev/rules.',
    })
  }
  problems.push(...(await typesProblems(tarball)))

  return { pkg, tarball, findings: problems.map(problem => ({ name, ...problem })) }
}

/** Imports each specifier and prints the ones that throw, as JSON: [specifier, first line of the error][]. */
const IMPORT_ALL = `
const failed = []
for (const spec of JSON.parse(process.argv[1])) {
  try { await import(spec) } catch (error) { failed.push([spec, String(error?.message ?? error).split('\\n')[0]]) }
}
process.stdout.write(JSON.stringify(failed))
`

function specifiers(pkg: Package): string[] {
  const exports = (pkg.packageJson as { exports?: Record<string, unknown> }).exports ?? {}
  return Object.keys(exports)
    .filter(key => key !== './package.json' && !key.includes('*'))
    .map(key => (key === '.' ? pkg.packageJson.name : `${pkg.packageJson.name}${key.slice(1)}`))
}

/** The tarballs installed together from scratch, as a user's project gets them, and every export imported. */
async function installFresh(packed: Packed[], scratch: string): Promise<Finding[]> {
  const dir = await mkdtemp(join(scratch, 'install-'))
  const tarballs = Object.fromEntries(packed.map(({ pkg, tarball }) => [pkg.packageJson.name, `file:${tarball}`]))
  // overrides: a package's own @ji.dev dependencies come from these tarballs too, not from npm
  const manifest = {
    name: 'ji-release-install',
    private: true,
    type: 'module',
    dependencies: tarballs,
    overrides: tarballs,
  }
  await writeFileAtomic(join(dir, 'package.json'), JSON.stringify(manifest))

  const install = await capture(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'],
    { cwd: dir },
  )
  if (install.code !== 0) {
    const reason = install.stderr
      .trim()
      .split('\n')
      .filter(line => line.includes('ERR'))
      .slice(0, 2)
      .join(' ')
    return [
      {
        name: 'npm install',
        message: 'a fresh install of the packages fails',
        fix: reason || 'Run npm install on the packed tarballs.',
      },
    ]
  }

  const owner = new Map(packed.flatMap(({ pkg }) => specifiers(pkg).map(spec => [spec, pkg.packageJson.name] as const)))
  const out = await capture(
    process.execPath,
    ['--input-type=module', '-e', IMPORT_ALL, JSON.stringify([...owner.keys()])],
    { cwd: dir },
  )
  if (out.code !== 0) {
    return [
      {
        name: 'import',
        message: 'importing the installed packages crashed',
        fix: out.stderr.trim().split('\n')[0] ?? '',
      },
    ]
  }
  return (JSON.parse(out.stdout) as Array<[string, string]>).map(([spec, error]) => ({
    name: owner.get(spec) ?? spec,
    message: `import fails after a fresh install: ${error}`,
    fix: 'A dependency range lets npm pick a version this code never ran against: tighten it, or update the code.',
  }))
}

/** Versions the pending changesets would publish that npm already has: npm never takes a version twice. */
async function takenVersions(ws: Workspace, packages: Package[]): Promise<Finding[]> {
  const names = new Set(packages.map(pkg => pkg.packageJson.name))
  const plan = await releasePlan(ws)
  const releases = plan.releases.filter(release => release.type !== 'none' && names.has(release.name))
  const found = await mapLimit(releases, 6, async release => {
    const out = await capture('npm', ['view', `${release.name}@${release.newVersion}`, 'version'], { cwd: ws.root })
    return out.code === 0 && out.stdout.trim() === release.newVersion
      ? [
          {
            name: release.name,
            message: `${release.newVersion} is already on npm`,
            fix: 'Bump it once more with another changeset.',
          },
        ]
      : []
  })
  return found.flat()
}

function report(findings: Finding[], total: number): boolean {
  const groups = new Map<string, Finding[]>()
  for (const finding of findings) {
    const key = `${finding.message}\n${finding.fix}`
    groups.set(key, [...(groups.get(key) ?? []), finding])
  }

  const failing = new Set(findings.filter(finding => !finding.warning).map(finding => finding.name))
  const lines: string[] = []
  const ready = total - failing.size
  if (ready === total) {
    lines.push(done(`✔ All ${total} packages are ready for npm`))
  } else if (ready === 0) {
    lines.push(blocking(`✖ None of the ${total} packages is ready for npm`))
  } else {
    lines.push(`${done('✔')} ${ready} of ${total} packages ready for npm`)
  }

  for (const group of groups.values()) {
    const [first] = group as [Finding]
    const mark = first.warning ? notice('!') : blocking('✖')
    const who =
      group.length === total ? `all ${total} packages` : group.length === 1 ? first.name : `${group.length} packages`
    lines.push('', `${mark} ${first.message}  ${dim(`(${who})`)}`)
    if (group.length > 1 && group.length < total) {
      lines.push(`    ${group.map(finding => finding.name).join(', ')}`)
    }
    lines.push(`    ${first.fix}`)
  }
  print(...lines)
  return failing.size === 0
}

export async function check(ws: Workspace): Promise<void> {
  const packages = published(ws)
  const repo = githubRepo(ws)
  print(header(ws, await currentBranch(ws), 'Ji release check'), '')
  print(`Building ${packages.length} packages…`)
  const findings = await build(ws, packages)

  print(`Packing and checking…`)
  const scratch = await mkdtemp(join(tmpdir(), 'ji-release-'))
  try {
    const packed = await mapLimit(packages, 4, pkg => checkPackage(pkg, repo, scratch))
    findings.push(...packed.flatMap(result => result.findings))

    const installable = packed.filter(result => result.tarball !== undefined)
    if (installable.length > 0) {
      print('Installing them fresh from npm and importing every export…')
      findings.push(...(await installFresh(installable, scratch)))
    }
    findings.push(...(await takenVersions(ws, packages)))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }

  print('')
  if (!report(findings, packages.length)) {
    process.exitCode = 1
  }
}
