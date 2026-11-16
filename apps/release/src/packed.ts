// What a package looks like once packed, judged as npm and its users will meet it: no workspace: ranges left, every
// export and command pointing at a built file that ships, nothing shipped but the build and its papers, and the
// fields npm provenance and a license need. Pure: the caller packs and lists the files.

export interface Problem {
  /** What is wrong, naming the field or file. */
  message: string
  /** What to do about it, one line. */
  fix: string
}

export interface PackedManifest {
  name?: string
  license?: string
  repository?: string | { url?: string; directory?: string }
  exports?: unknown
  bin?: string | Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

export interface Expected {
  /** The package's folder in the repository, as `repository.directory` must name it. */
  directory: string
  /** `owner/name` on GitHub, which the published provenance has to match. */
  repo: string
}

const SHIPPED = /^(?:dist\/|package\.json$|readme|licen[cs]e|changelog)/i
const SOURCE = /\.(?:[cm]?ts|tsx)$/
const DECLARATION = /\.d\.[cm]?ts$/

function targets(value: unknown, at: string): Array<[string, string]> {
  if (typeof value === 'string') {
    return [[at, value]]
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => targets(inner, `${at}[${JSON.stringify(key)}]`))
  }
  return []
}

function normalize(path: string): string {
  return path.replace(/^\.\//, '')
}

function repositoryOf(manifest: PackedManifest): { url: string; directory?: string } {
  const { repository } = manifest
  return typeof repository === 'string'
    ? { url: repository }
    : { url: repository?.url ?? '', directory: repository?.directory }
}

export function checkPacked(manifest: PackedManifest, files: readonly string[], expected: Expected): Problem[] {
  const problems: Problem[] = []
  const shipped = new Set(files)

  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (range.startsWith('workspace:')) {
        problems.push({
          message: `${field}.${name} is still ${range}`,
          fix: 'Pack with pnpm, which turns workspace: ranges into versions.',
        })
      }
    }
  }

  const bin = typeof manifest.bin === 'string' ? { [manifest.name ?? 'bin']: manifest.bin } : manifest.bin
  const entries = [...targets(manifest.exports, 'exports'), ...targets(bin, 'bin')]
  for (const [field, target] of entries) {
    const file = normalize(target)
    if (file.includes('*')) {
      continue
    }
    if (SOURCE.test(file) && !DECLARATION.test(file)) {
      problems.push({
        message: `${field} points to ${target}, a source file`,
        fix: 'Run the package build; publishConfig should point into dist/.',
      })
    } else if (!shipped.has(file)) {
      problems.push({
        message: `${field} points to ${target}, which is not in the package`,
        fix: 'Build before packing.',
      })
    }
  }

  const strays = files.filter(file => !SHIPPED.test(file))
  if (strays.length > 0) {
    const listed = strays.slice(0, 3).join(', ') + (strays.length > 3 ? ` and ${strays.length - 3} more` : '')
    problems.push({ message: `ships ${listed}`, fix: 'Keep "files" to ["dist"].' })
  }

  const repository = repositoryOf(manifest)
  if (!repository.url.toLowerCase().includes(`github.com/${expected.repo.toLowerCase()}`)) {
    problems.push({
      message: `repository.url is "${repository.url}"`,
      fix: `Point it at https://github.com/${expected.repo}; npm provenance checks it.`,
    })
  }
  if (repository.directory !== expected.directory) {
    problems.push({
      message: `repository.directory is ${repository.directory === undefined ? 'missing' : `"${repository.directory}"`}`,
      fix: `Set it to "${expected.directory}".`,
    })
  }

  if (manifest.license === undefined || manifest.license === '') {
    problems.push({ message: 'no license', fix: 'Add a LICENSE file and a "license" field before the first release.' })
  }

  return problems
}
