// Which code a service runs: when the sources it is made of last changed, so a client started on newer code can tell
// that the service it finds is older than itself. In the repository that is the newest of the coding agent's sources
// and its packages' and plugins'; in a bundle, the bundle's own time.

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** The repository, were this file in it: apps/coding-agent/src/server. */
const REPO = join(import.meta.dirname, '..', '..', '..', '..')

/** The folders of sources in the repository, under it: a package's or a plugin's src, by its parent. */
const SOURCES = [['apps', 'coding-agent'], ['packages'], ['plugins']]

export function codeVersion(): string {
  if (import.meta.filename !== join(REPO, 'apps', 'coding-agent', 'src', 'server', 'version.ts')) {
    return String(Math.floor(statSync(import.meta.filename).mtimeMs))
  }
  return String(Math.floor(Math.max(...sourceFolders().map(newestIn))))
}

function sourceFolders(): string[] {
  return SOURCES.flatMap(([top, only]) => {
    const parents = only === undefined ? subfolders(join(REPO, top)) : [join(REPO, top, only)]
    return parents.map(parent => join(parent, 'src'))
  })
}

function subfolders(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(dir, entry.name))
}

/** When a file in the folder last changed, or the folder itself: a file removed changes only it. */
function newestIn(dir: string): number {
  let newest = 0
  try {
    newest = statSync(dir).mtimeMs
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      newest = Math.max(newest, statSync(join(entry.parentPath, entry.name)).mtimeMs)
    }
  } catch {
    // A package without sources of its own
  }
  return newest
}
