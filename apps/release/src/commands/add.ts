// `pnpm release add`: one changeset, the way `changeset add` writes it. Asked step by step in a terminal, or taken
// whole from flags (the same ones `changeset` takes) anywhere else, so a script or CI never waits on a prompt. Writing
// a changeset is undone by deleting the file, so nothing here asks to confirm; it never commits either.

import type { Package } from '@manypkg/get-packages'
import type { Bump } from '../bump.ts'
import type { Workspace } from '../workspace.ts'
import process from 'node:process'
import { writeChangeset } from '@changesets/write'
import { cancel, isCancel, multiselect, select, text } from '@clack/prompts'
import { bumpOptions, suggestBump, summaryFromSubject } from '../bump.ts'
import { dim, done, isInteractive, print, ReleaseError, strong } from '../ui.ts'
import { changedPackages, releasePlan, subjectsSince, versioned } from '../workspace.ts'
import { nextReleaseLines } from './status.ts'

export interface AddFlags {
  empty: boolean
  message?: string
  patch?: string
  minor?: string
  major?: string
}

const USAGE = 'pnpm release add --patch <pkg,...> [--minor <pkg,...>] [--major <pkg,...>] -m "Summary"'

interface Release {
  name: string
  type: Bump
}

function cancelled(): never {
  cancel('Nothing written.')
  process.exit(130)
}

function namesIn(list: string | undefined): string[] {
  return (list ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
}

function fromFlags(ws: Workspace, flags: AddFlags): Release[] {
  const known = new Set(versioned(ws).map(pkg => pkg.packageJson.name))
  const releases = (['major', 'minor', 'patch'] as const).flatMap(type =>
    namesIn(flags[type]).map(name => ({ name, type })),
  )
  const unknown = releases.filter(release => !known.has(release.name)).map(release => release.name)
  if (unknown.length > 0) {
    throw new ReleaseError(
      `Not a versioned package: ${unknown.join(', ')}`,
      'Run `pnpm release` to see the packages.',
      2,
    )
  }
  if (releases.length === 0 || flags.message === undefined || flags.message.trim() === '') {
    throw new ReleaseError('Without a terminal, say what to release and why.', USAGE, 2)
  }
  return releases
}

async function ask(ws: Workspace): Promise<{ releases: Release[]; summary: string }> {
  const packages = versioned(ws)
  const changed = await changedPackages(ws)

  const picked = await multiselect({
    message:
      changed === undefined
        ? 'Which packages does this change? (git could not tell which changed)'
        : 'Which packages does this change?',
    options: packages.map(pkg => ({
      value: pkg.packageJson.name,
      label: pkg.packageJson.name,
      hint: changed?.has(pkg.packageJson.name) === true ? 'changed' : undefined,
    })),
    initialValues: packages.map(pkg => pkg.packageJson.name).filter(name => changed?.has(name) === true),
    required: true,
  })
  if (isCancel(picked)) {
    cancelled()
  }

  const releases: Release[] = []
  let lastSubject: string | undefined
  for (const name of picked) {
    const pkg = packages.find(candidate => candidate.packageJson.name === name) as Package
    const subjects = await subjectsSince(ws, pkg)
    lastSubject ??= subjects[0]
    const { version } = pkg.packageJson
    const type = await select<Bump>({
      message: `${name} ${dim(`now ${version}`)}`,
      options: bumpOptions(version),
      initialValue: suggestBump(version, subjects),
    })
    if (isCancel(type)) {
      cancelled()
    }
    releases.push({ name, type })
  }

  const summary = await text({
    message: 'Summary for the changelog',
    placeholder: 'What users will notice, in one line',
    initialValue: lastSubject === undefined ? undefined : summaryFromSubject(lastSubject),
    validate: value =>
      value === undefined || value.trim() === '' ? 'Write the line users will read in the changelog.' : undefined,
  })
  if (isCancel(summary)) {
    cancelled()
  }
  return { releases, summary: summary.trim() }
}

export async function add(ws: Workspace, flags: AddFlags): Promise<void> {
  const flagged = flags.empty || flags.message !== undefined || [flags.patch, flags.minor, flags.major].some(Boolean)
  if (!flagged && !isInteractive()) {
    throw new ReleaseError('No terminal to ask in.', USAGE, 2)
  }

  const { releases, summary } = flags.empty
    ? { releases: [], summary: flags.message ?? '' }
    : flagged
      ? { releases: fromFlags(ws, flags), summary: (flags.message ?? '').trim() }
      : await ask(ws)

  const id = await writeChangeset({ releases, summary }, ws.root, { format: ws.config.format })

  const lines = [`${done('Wrote')} .changeset/${id}.md`]
  if (releases.length > 0) {
    const plan = await releasePlan(ws)
    lines.push('', strong('Next release'), ...nextReleaseLines(ws, plan))
  }
  lines.push('', 'Next: commit it with your change.', dim('Edit the file for a longer note; delete it to undo.'))
  print(...lines)
}
