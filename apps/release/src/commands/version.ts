// `pnpm release version`: what CI runs to make the Version Packages PR. Changesets bumps versions and writes the
// changelogs; then the desktop app's version follows its package into mygo.json.

import type { Workspace } from '../workspace.ts'
import { syncDesktop } from '../desktop.ts'
import { attach } from '../run.ts'
import { print, ReleaseError } from '../ui.ts'

export async function version(ws: Workspace): Promise<void> {
  const code = await attach('pnpm', ['exec', 'changeset', 'version'], { cwd: ws.root })
  if (code !== 0) {
    throw new ReleaseError(`changeset version exited with ${code}.`)
  }
  const synced = await syncDesktop(ws.root)
  if (synced !== undefined) {
    print(`Desktop app: mygo.json ${synced.from} → ${synced.to}`)
  }
}
