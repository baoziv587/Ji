// grep's two halves (RFC §3.4, §5.1): the arguments ripgrep gets, and the fold over the JSON events it writes back.
//
//   Every value the model wrote is exactly one argv element, as --flag=value or after `--`: no content can turn it into
//   an option, and no shell reads the array. Results come from `rg --json` events, never from path:line:text, so a
//   colon in a path cannot shift anything.

import type { Chunk, Fold } from './fold.ts'
import { truncateLine } from './output.ts'

export interface Query {
  /** A regular expression; plain text when `literal`. */
  pattern: string
  /** The file or directory searched. */
  path: string
  /** Only files that match it, e.g. `*.ts` or `!*.test.ts`. */
  glob?: string
  literal?: boolean
  ignoreCase?: boolean
  /** Lines shown before and after each matching line. */
  context?: number
}

export interface Hit {
  path: string
  /** Counting from 1. */
  line: number
  text: string
  /** False for a context line. */
  match: boolean
}

export interface Found {
  readonly hits: readonly Hit[]
  /** Matching lines seen; limit + 1 once the fold is full. */
  readonly matches: number
  /** The start of ripgrep's stderr: what it says when it fails. */
  readonly stderr: string
  /** The event line still being written. */
  readonly partial: string
}

/** The most of ripgrep's stderr kept: enough for the message, never a flood. */
const STDERR_CHARS = 2000

/**
 * The arguments after the ripgrep executable. Hidden files are searched, the repository itself (.git) is not, and
 * .gitignore applies; the user's ripgrep config changes nothing.
 */
export function ripgrepArgs(q: Query): string[] {
  return [
    '--json',
    '--no-config',
    '--hidden',
    '--glob=!.git',
    ...(q.ignoreCase ? ['--ignore-case'] : []),
    ...(q.literal ? ['--fixed-strings'] : []),
    ...(q.glob === undefined ? [] : [`--glob=${q.glob}`]),
    ...(q.context ? [`--context=${q.context}`] : []),
    `--regexp=${q.pattern}`,
    '--',
    q.path,
  ]
}

/**
 * Keeps the first `limit` matching lines and stops at the one after: seeing it is what proves there are more, so
 * exactly `limit` matches are never reported as cut. Context lines are kept but not counted.
 */
export function createHitsFold(limit: number, lineChars: number): Fold<Chunk, Found> {
  const add = (found: Found, hit: Hit | undefined): Found => {
    if (hit === undefined || found.matches > limit) {
      return found
    }
    const matches = found.matches + (hit.match ? 1 : 0)
    return { ...found, matches, hits: matches > limit ? found.hits : [...found.hits, hit] }
  }

  return {
    empty: { hits: [], matches: 0, stderr: '', partial: '' },
    step(found, { fd, text }) {
      if (fd === 2) {
        return { ...found, stderr: (found.stderr + text).slice(0, STDERR_CHARS) }
      }

      const lines = (found.partial + text).split('\n')
      const partial = lines.pop()!
      return { ...lines.map(line => parseRipgrepEvent(line, lineChars)).reduce(add, found), partial }
    },
    full: found => found.matches > limit,
  }
}

/** One line of `rg --json`: the hit of a match or context event, undefined for every other event. */
export function parseRipgrepEvent(line: string, lineChars: number): Hit | undefined {
  const event = parseJson(line) as RipgrepEvent | undefined
  if (event?.type !== 'match' && event?.type !== 'context') {
    return undefined
  }

  const { path, lines, line_number } = event.data
  return {
    path: textOf(path),
    line: line_number,
    text: truncateLine(textOf(lines).replace(/\n$/, ''), lineChars),
    match: event.type === 'match',
  }
}

/** The parts of a match or context event used here; ripgrep sends `bytes` (base64) for text that is not UTF-8. */
interface RipgrepEvent {
  type: string
  data: {
    path: RipgrepData
    lines: RipgrepData
    line_number: number
  }
}

type RipgrepData = { text: string } | { bytes: string }

function textOf(data: RipgrepData): string {
  if ('text' in data) {
    return data.text
  }
  const bytes = Uint8Array.from(atob(data.bytes), c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}
