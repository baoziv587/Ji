import type { PackedManifest } from '../src/packed.ts'
import { describe, expect, it } from 'vitest'
import { checkPacked } from '../src/packed.ts'

const expected = { directory: 'packages/kernel', repo: 'baoziv587/Ji' }

const good: PackedManifest = {
  name: '@ji.dev/kernel',
  license: 'MIT',
  repository: { url: 'git+https://github.com/baoziv587/Ji.git', directory: 'packages/kernel' },
  exports: { '.': './dist/index.mjs', './package.json': './package.json' },
  dependencies: { '@ji.dev/utils': '^0.1.0' },
}
const files = ['package.json', 'README.md', 'LICENSE', 'dist/index.mjs', 'dist/index.d.mts']

const messages = (manifest: PackedManifest, shipped = files) =>
  checkPacked(manifest, shipped, expected).map(p => p.message)

describe('checkPacked', () => {
  it('catches a workspace: range pnpm did not rewrite', () => {
    expect(messages({ ...good, peerDependencies: { '@ji.dev/llm': 'workspace:^' } })).toEqual([
      'peerDependencies.@ji.dev/llm is still workspace:^',
    ])
  })

  it('catches exports and bin pointing at sources or at files not shipped', () => {
    expect(messages({ ...good, exports: { '.': { import: './src/index.ts' } } })).toEqual([
      'exports["."]["import"] points to ./src/index.ts, a source file',
    ])
    expect(messages({ ...good, bin: { ji: './dist/cli.mjs' } })).toEqual([
      'bin["ji"] points to ./dist/cli.mjs, which is not in the package',
    ])
  })

  it('catches files beyond the build and its papers', () => {
    expect(messages(good, [...files, 'tests/kernel.test.ts', 'src/index.ts'])).toEqual([
      'ships tests/kernel.test.ts, src/index.ts',
    ])
  })

  it('keeps Chinese out of the manifest npm shows', () => {
    expect(messages({ ...good, description: '代数内核：policy' })).toEqual(['package.json has Chinese ("代数内核：")'])
  })

  it('wants the repository provenance checks, and a license', () => {
    expect(messages({ ...good, repository: 'https://github.com/someone/else' })).toEqual([
      'repository.url is "https://github.com/someone/else"',
      'repository.directory is missing',
    ])
    expect(messages({ ...good, license: undefined })).toEqual(['no license'])
    expect(
      messages(
        good,
        files.filter(file => file !== 'LICENSE'),
      ),
    ).toEqual(['ships no LICENSE file'])
  })
})
