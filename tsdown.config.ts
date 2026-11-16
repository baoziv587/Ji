// The build of every package that goes to npm, run in the package's folder (its `build` script). A package's own
// `exports` and `bin` point at its sources, which is how the workspace runs it; the build turns those entries into
// dist/ and writes where they ended up into `publishConfig`, which pnpm swaps in when it packs. The output keeps the
// sources' layout (unbundle), so a file found by a path next to another, like the coding agent's server, is still
// there.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { defineConfig } from 'tsdown'

interface Manifest {
  exports?: Record<string, string>
  bin?: Record<string, string>
}

/** The build of the package in `cwd`, with `extraEntries` built too though no export names them. */
export function packageBuild(cwd = process.cwd(), extraEntries: string[] = []) {
  const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Manifest
  const exported = Object.values(manifest.exports ?? {}).filter(path => path.startsWith('./src/'))
  const bin = Object.values(manifest.bin ?? {})

  // A command or a file started by its path is no module to import: built, but not exported
  const unexported = [...bin, ...extraEntries].filter(path => !exported.includes(path))

  return defineConfig({
    cwd,
    entry: [...new Set([...exported, ...bin, ...extraEntries])],
    unbundle: true,
    platform: 'node',
    target: 'node24',
    dts: true,
    exports: {
      devExports: true,
      bin: manifest.bin,
      exclude: unexported.map(path => path.replace(/^\.\/src\//, '').replace(/\.ts$/, '')),
    },
  })
}

export default packageBuild()
