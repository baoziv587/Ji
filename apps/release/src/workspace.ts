// The repository as Changesets sees it: its packages, its config, whether a prerelease is on, and the release the
// pending changesets add up to. Which packages are versioned and which go to npm follows the config: ignored ones are
// neither, private ones are versioned (privatePackages.version) and tagged but never published.

import type { Config, PreState, ReleasePlan } from '@changesets/types'
import type { Package, Packages } from '@manypkg/get-packages'
import { assembleReleasePlan } from '@changesets/assemble-release-plan'
import { readConfig } from '@changesets/config'
import { getChangedPackagesSinceRef, getDivergedCommit } from '@changesets/git'
import { readPreState } from '@changesets/pre'
import { readChangesets } from '@changesets/read'
import { getPackages } from '@manypkg/get-packages'
import { capture } from './run.ts'
import { ReleaseError } from './ui.ts'

export interface Workspace {
  root: string
  packages: Packages
  config: Config
  pre: PreState | undefined
}

export async function loadWorkspace(cwd: string): Promise<Workspace> {
  const packages = await getPackages(cwd)
  const parsed = await readConfig(packages.rootDir, packages)
  if (parsed.errors !== undefined) {
    throw new ReleaseError(`.changeset/config.json: ${parsed.errors.join('; ')}`)
  }
  return { root: packages.rootDir, packages, config: parsed.config, pre: await readPreState(packages.rootDir) }
}

function isVersioned(pkg: Package, config: Config): boolean {
  return (
    !config.ignore.includes(pkg.packageJson.name) &&
    (pkg.packageJson.private !== true || config.privatePackages.version)
  )
}

function isPublished(pkg: Package, config: Config): boolean {
  return isVersioned(pkg, config) && pkg.packageJson.private !== true
}

export function versioned(ws: Workspace): Package[] {
  return ws.packages.packages.filter(pkg => isVersioned(pkg, ws.config)).sort(byName)
}

export function published(ws: Workspace): Package[] {
  return ws.packages.packages.filter(pkg => isPublished(pkg, ws.config)).sort(byName)
}

function byName(a: Package, b: Package): number {
  return a.packageJson.name.localeCompare(b.packageJson.name)
}

export async function releasePlan(ws: Workspace): Promise<ReleasePlan> {
  return assembleReleasePlan(await readChangesets(ws.root), ws.packages, ws.config, ws.pre)
}

/**
 * The packages changed since the base branch, or undefined when git cannot tell (no base branch, a shallow clone):
 * finding them is a convenience, so it never fails a command.
 */
export async function changedPackages(ws: Workspace): Promise<Set<string> | undefined> {
  try {
    const changed = await getChangedPackagesSinceRef({
      cwd: ws.root,
      ref: ws.config.baseBranch,
      changedFilePatterns: ws.config.changedFilePatterns,
    })
    return new Set(changed.map(pkg => pkg.packageJson.name))
  } catch {
    return undefined
  }
}

/** The subjects of the commits since the base branch that touched `pkg`, newest first. */
export async function subjectsSince(ws: Workspace, pkg: Package): Promise<string[]> {
  try {
    const base = await getDivergedCommit(ws.root, ws.config.baseBranch)
    const log = await capture('git', ['log', '--format=%s', `${base}..HEAD`, '--', pkg.relativeDir], { cwd: ws.root })
    return log.code === 0 ? log.stdout.split('\n').filter(Boolean) : []
  } catch {
    return []
  }
}

export async function currentBranch(ws: Workspace): Promise<string | undefined> {
  const out = await capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ws.root })
  return out.code === 0 ? out.stdout.trim() : undefined
}

/** `owner/name` of the GitHub repository the packages say they come from. */
export function githubRepo(ws: Workspace): string {
  for (const pkg of published(ws)) {
    const { repository } = pkg.packageJson as { repository?: string | { url?: string } }
    const url = typeof repository === 'string' ? repository : repository?.url
    const match = url?.match(/github\.com[/:]([^/]+\/[^/.]+)/)
    if (match?.[1] !== undefined) {
      return match[1]
    }
  }
  throw new ReleaseError('No published package names its GitHub repository.', 'Set "repository" in their package.json.')
}
