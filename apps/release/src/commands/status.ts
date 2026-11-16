// `pnpm release`: where the repository stands, then what the next release holds, then what needs a look. A package
// released only because one it depends on moved says so, so a cascade never comes as a surprise.

import type { ReleasePlan } from '@changesets/types'
import type { Workspace } from '../workspace.ts'
import { columns, command, dim, notice, print, strong } from '../ui.ts'
import { changedPackages, currentBranch, releasePlan, versioned } from '../workspace.ts'

const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

export function header(ws: Workspace, branch: string | undefined, title = 'Ji release'): string {
  const parts = [strong(title), branch ?? 'no git']
  if (ws.pre?.mode === 'pre') {
    parts.push(`prerelease: ${ws.pre.tag}`)
  } else if (ws.pre?.mode === 'exit') {
    parts.push(`leaving prerelease: ${ws.pre.tag}`)
  }
  return parts.join(dim(' · '))
}

/** The packages the next release publishes or tags, each with its version change and, for a dependent, why. */
export function nextReleaseLines(ws: Workspace, plan: ReleasePlan): string[] {
  const releases = plan.releases.filter(release => release.type !== 'none').sort((a, b) => a.name.localeCompare(b.name))
  const moving = new Set(releases.map(release => release.name))

  const reasonOf = (name: string, direct: boolean): string => {
    if (direct) {
      return ''
    }
    const manifest = ws.packages.packages.find(pkg => pkg.packageJson.name === name)?.packageJson
    const on = DEPENDENCY_FIELDS.flatMap(field => Object.keys(manifest?.[field] ?? {})).find(dep => moving.has(dep))
    return on === undefined ? 'dependent' : `depends on ${on}`
  }

  return columns(
    releases.map(release => [
      release.name,
      `${release.oldVersion} → ${release.newVersion}   ${dim(reasonOf(release.name, release.changesets.length > 0))}`,
    ]),
  )
}

/** What a changeset releases, in a line: names while they are few, a count beyond that. */
function releasesOf(releases: ReadonlyArray<{ name: string; type: string }>): string {
  if (releases.length === 0) {
    return dim('releases nothing')
  }
  const byType = Map.groupBy(releases, release => release.type)
  return [...byType]
    .map(([type, group]) =>
      group.length > 3
        ? `${group.length} packages ${type}`
        : group.map(release => `${release.name} ${type}`).join(', '),
    )
    .join(', ')
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? ''
}

export async function status(ws: Workspace): Promise<void> {
  const [plan, changed, branch] = await Promise.all([releasePlan(ws), changedPackages(ws), currentBranch(ws)])
  const lines = [header(ws, branch), '']

  if (plan.changesets.length === 0) {
    lines.push(`Nothing to release. Run ${command('pnpm release add')} after a change users will notice.`)
  } else {
    lines.push(strong(`Pending changesets (${plan.changesets.length})`))
    lines.push(
      ...columns(
        plan.changesets.map(changeset => [
          changeset.id,
          `${releasesOf(changeset.releases)}   ${dim(firstLine(changeset.summary))}`,
        ]),
      ),
    )
    lines.push('', strong('Next release'), ...nextReleaseLines(ws, plan))
  }

  const covered = new Set(plan.changesets.flatMap(changeset => changeset.releases.map(release => release.name)))
  const names = new Set(versioned(ws).map(pkg => pkg.packageJson.name))
  const uncovered = [...(changed ?? [])].filter(name => names.has(name) && !covered.has(name)).sort()
  if (uncovered.length > 0) {
    lines.push('', notice('Changed without a changeset'), ...uncovered.map(name => `  ${name}`))
    lines.push(dim(`  Run ${command('pnpm release add')} if users will notice.`))
  }

  print(...lines)
}
