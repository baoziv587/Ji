// `ji app`: a folder's sessions in the desktop app. From the repository it runs the app from its source (apps/desktop,
// with Go), else the app installed; either way a window already open takes the folder (its single-instance lock), and
// the command returns at once. What the source run prints goes to ~/.ji/desktop.log.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** apps/desktop, next to this package. */
const SOURCE = fileURLToPath(new URL('../../desktop/', import.meta.url))

const APP_NAME = 'Ji Agent.app'

const LOG = join(homedir(), '.ji', 'desktop.log')

/** Throws when `folder` is no folder, or there is no desktop app to open it in. */
export function openInDesktop(folder: string): void {
  const root = folderOf(folder)
  // The terminal reads INIT_CWD as where it was started; the app should not take it for the folder
  const { INIT_CWD: _, ...env } = process.env

  if (existsSync(join(SOURCE, 'main.go')) && hasGo()) {
    mkdirSync(join(homedir(), '.ji'), { recursive: true })
    const out = openSync(LOG, 'a')
    spawn('go', ['run', '.', root], { cwd: SOURCE, env, detached: true, stdio: ['ignore', out, out] }).unref()
    process.stdout.write(`Opening ${root} in Ji Agent, from its source (log: ${LOG})\n`)
    return
  }

  const app = installedApp()
  if (app === undefined) {
    throw new Error(`no ${APP_NAME} in /Applications, and no apps/desktop with Go to run it from`)
  }
  // -n starts one more, which hands the folder to the window open, if any, and quits
  spawn('open', ['-n', '-a', app, '--args', root], { env, detached: true, stdio: 'ignore' }).unref()
  process.stdout.write(`Opening ${root} in Ji Agent\n`)
}

/** The folder as the terminal names the one it works in: absolute, its links resolved. */
function folderOf(folder: string): string {
  let root: string
  try {
    root = realpathSync(resolve(folder))
  } catch {
    throw new Error(`no such folder: ${folder}`)
  }
  if (!statSync(root).isDirectory()) {
    throw new Error(`not a folder: ${folder}`)
  }
  return root
}

function hasGo(): boolean {
  return spawnSync('go', ['version'], { stdio: 'ignore' }).status === 0
}

function installedApp(): string | undefined {
  if (process.platform !== 'darwin') {
    return undefined
  }
  return [join('/Applications', APP_NAME), join(homedir(), 'Applications', APP_NAME)].find(existsSync)
}
