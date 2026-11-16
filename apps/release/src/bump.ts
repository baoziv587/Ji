// What a bump means for one package, as the person writing the changeset reads it. In 0.x a minor is the breaking
// release and a patch carries fixes and additions alike; past 1.0 the usual three apply. 0.0.0 has never been
// released, so its first changeset is the minor that makes it 0.1.0.

import semver from 'semver'

export type Bump = 'patch' | 'minor' | 'major'

export interface BumpOption {
  value: Bump
  label: string
  hint: string
}

const BREAKING = /^\w+(?:\([^)]*\))?!:|BREAKING[ -]CHANGE/
const FEATURE = /^feat(?:\([^)]*\))?:/
const PREFIX = /^\w+(?:\([^)]*\))?!?:\s*/

function isUnreleased(version: string): boolean {
  return version === '0.0.0'
}

function inZero(version: string): boolean {
  return semver.major(version) === 0
}

/** The bump the commit subjects that touched a package point to, for the default choice. */
export function suggestBump(version: string, subjects: readonly string[]): Bump {
  if (isUnreleased(version)) {
    return 'minor'
  }
  const breaking = subjects.some(subject => BREAKING.test(subject))
  if (inZero(version)) {
    return breaking ? 'minor' : 'patch'
  }
  if (breaking) {
    return 'major'
  }
  return subjects.some(subject => FEATURE.test(subject)) ? 'minor' : 'patch'
}

/**
 * The three choices, each saying what it does to a package now at `version`. A prerelease's next version depends on
 * the prerelease state, which Changesets works out, so its choices give the meaning only.
 */
export function bumpOptions(version: string): BumpOption[] {
  const exact = semver.prerelease(version) === null
  const to = (bump: Bump): string => (exact ? (semver.inc(version, bump) ?? '') : '')
  const hint = (meaning: string, bump: Bump): string => [meaning, to(bump)].filter(Boolean).join(', ')

  if (isUnreleased(version)) {
    return [
      { value: 'minor', label: 'minor', hint: hint('first release', 'minor') },
      { value: 'patch', label: 'patch', hint: hint('first release', 'patch') },
      { value: 'major', label: 'major', hint: hint('first release with a stable API', 'major') },
    ]
  }
  if (inZero(version)) {
    return [
      { value: 'patch', label: 'patch', hint: hint('fixes and additions', 'patch') },
      { value: 'minor', label: 'minor', hint: hint('breaking changes while in 0.x', 'minor') },
      { value: 'major', label: 'major', hint: exact ? `leaves 0.x for ${to('major')}` : 'leaves 0.x for 1.0.0' },
    ]
  }
  return [
    { value: 'patch', label: 'patch', hint: hint('fixes', 'patch') },
    { value: 'minor', label: 'minor', hint: hint('additions', 'minor') },
    { value: 'major', label: 'major', hint: hint('breaking changes', 'major') },
  ]
}

/** A commit subject as a changelog line: no conventional prefix, a capital first letter. */
export function summaryFromSubject(subject: string): string {
  const text = subject.replace(PREFIX, '').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}
