import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { bundleVersion, syncDesktop } from '../src/desktop.ts'

async function repoWith(packageVersion: string, appVersion: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ji-desktop-'))
  await mkdir(join(root, 'apps', 'desktop'), { recursive: true })
  await writeFile(join(root, 'apps', 'desktop', 'package.json'), JSON.stringify({ version: packageVersion }))
  await writeFile(join(root, 'apps', 'desktop', 'mygo.json'), JSON.stringify({ name: 'Ji Agent', version: appVersion }))
  return root
}

const appVersionIn = async (root: string) =>
  (JSON.parse(await readFile(join(root, 'apps', 'desktop', 'mygo.json'), 'utf8')) as { version: string }).version

describe('bundleVersion', () => {
  it('keeps x.y.z and drops a prerelease or build suffix', () => {
    expect(bundleVersion('0.2.0-alpha.3')).toBe('0.2.0')
    expect(bundleVersion('1.4.2')).toBe('1.4.2')
    fc.assert(
      fc.property(fc.nat(99), fc.nat(99), fc.nat(99), fc.stringMatching(/^[a-z]+\.\d$/), (a, b, c, pre) => {
        expect(bundleVersion(`${a}.${b}.${c}-${pre}`)).toBe(`${a}.${b}.${c}`)
      }),
    )
  })
})

describe('syncDesktop', () => {
  it('moves mygo.json up to the released version, and keeps its other fields', async () => {
    const root = await repoWith('0.2.0-alpha.1', '0.1.0')
    expect(await syncDesktop(root)).toEqual({ from: '0.1.0', to: '0.2.0' })
    const app = JSON.parse(await readFile(join(root, 'apps', 'desktop', 'mygo.json'), 'utf8'))
    expect(app).toEqual({ name: 'Ji Agent', version: '0.2.0' })
  })

  it('leaves it alone before the first release, when it matches, and never moves it back', async () => {
    for (const [pkg, app] of [
      ['0.0.0', '0.1.0'],
      ['0.1.0-alpha.4', '0.1.0'],
      ['0.1.0', '0.3.0'],
    ] as const) {
      const root = await repoWith(pkg, app)
      expect(await syncDesktop(root)).toBeUndefined()
      expect(await appVersionIn(root)).toBe(app)
    }
  })
})
