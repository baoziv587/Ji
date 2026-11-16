import fc from 'fast-check'
import semver from 'semver'
import { describe, expect, it } from 'vitest'
import { bumpOptions, suggestBump, summaryFromSubject } from '../src/bump.ts'

const version = fc
  .tuple(fc.nat(20), fc.nat(20), fc.nat(20))
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`)

describe('suggestBump', () => {
  it('makes a never-released package 0.1.0', () => {
    expect(suggestBump('0.0.0', [])).toBe('minor')
    expect(suggestBump('0.0.0', ['fix: typo'])).toBe('minor')
  })

  it('in 0.x, breaking is minor and everything else patch', () => {
    expect(suggestBump('0.3.1', ['feat(llm)!: rename send'])).toBe('minor')
    expect(suggestBump('0.3.1', ['refactor: x', 'BREAKING CHANGE: y'])).toBe('minor')
    expect(suggestBump('0.3.1', ['feat: add hook'])).toBe('patch')
    expect(suggestBump('0.3.1', ['fix: race'])).toBe('patch')
  })

  it('past 1.0, breaking is major, a feature minor, the rest patch', () => {
    expect(suggestBump('1.2.0', ['feat!: drop node 22'])).toBe('major')
    expect(suggestBump('1.2.0', ['feat(tui): colours'])).toBe('minor')
    expect(suggestBump('1.2.0', ['chore: deps'])).toBe('patch')
  })

  it('never suggests leaving 0.x', () => {
    fc.assert(
      fc.property(version, fc.array(fc.string()), (v, subjects) => {
        fc.pre(semver.major(v) === 0)
        expect(suggestBump(v, subjects)).not.toBe('major')
      }),
    )
  })
})

describe('bumpOptions', () => {
  it('offers all three bumps, and names the version each leads to', () => {
    fc.assert(
      fc.property(version, v => {
        const options = bumpOptions(v)
        expect(options.map(option => option.value).sort()).toEqual(['major', 'minor', 'patch'])
        for (const option of options) {
          expect(option.hint).toContain(semver.inc(v, option.value))
        }
      }),
    )
  })

  it('names no exact version for a prerelease, whose next one depends on the prerelease state', () => {
    const hints = bumpOptions('0.2.0-alpha.3').map(option => option.hint)
    expect(hints).toEqual(['fixes and additions', 'breaking changes while in 0.x', 'leaves 0.x for 1.0.0'])
  })
})

describe('summaryFromSubject', () => {
  it('drops the conventional prefix and capitalises', () => {
    expect(summaryFromSubject('feat(tui)!: add a rail')).toBe('Add a rail')
    expect(summaryFromSubject('fix: handle EOF')).toBe('Handle EOF')
    expect(summaryFromSubject('Plain subject')).toBe('Plain subject')
  })
})
