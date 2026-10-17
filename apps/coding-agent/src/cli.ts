#!/usr/bin/env node
// ji: the coding agent from any folder, linked onto the PATH by `pnpm install` (scripts/link.ts).
//
//   ji [--model provider/id] [--yolo]   the terminal, working in the current folder
//   ji app [folder]                     the folder's sessions in the desktop app, the terminal's among them
//                                       (default: the current folder)

import process from 'node:process'
import { openInDesktop } from './desktop.ts'

const [command, ...rest] = process.argv.slice(2)

if (command === 'app') {
  try {
    openInDesktop(rest[0] ?? '.')
  } catch (error) {
    process.stderr.write(`ji app: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
} else {
  await import('./main.ts')
}
