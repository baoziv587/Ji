// The desktop app is versioned like any package, through apps/desktop/package.json, but builds from mygo.json. After
// Changesets versions, the version is copied there. A macOS bundle version is x.y.z only, so a prerelease drops its
// suffix: 0.2.0-alpha.3 builds as 0.2.0.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import semver from 'semver'
import writeFileAtomic from 'write-file-atomic'

const DESKTOP = join('apps', 'desktop')

/** The version a macOS bundle can carry for `version`. */
function bundleVersion(version: string): string {
  const parsed = semver.parse(version)
  if (parsed === null) {
    throw new Error(`not a version: ${version}`)
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`
}

export interface Synced {
  from: string
  to: string
}

/** Copies the desktop package's version into mygo.json; undefined when it already matches. */
export async function syncDesktop(root: string): Promise<Synced | undefined> {
  const manifest = JSON.parse(await readFile(join(root, DESKTOP, 'package.json'), 'utf8')) as { version: string }
  const file = join(root, DESKTOP, 'mygo.json')
  const app = JSON.parse(await readFile(file, 'utf8')) as { version?: string }

  const to = bundleVersion(manifest.version)
  const from = app.version ?? ''
  // 0.0.0 is the desktop package before its first release; the app keeps the version it has
  if (manifest.version === '0.0.0' || (semver.valid(from) !== null && semver.gte(from, to))) {
    return undefined
  }
  await writeFileAtomic(file, `${JSON.stringify({ ...app, version: to }, null, 2)}\n`)
  return { from, to }
}
