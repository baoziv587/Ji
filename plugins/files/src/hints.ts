// Hinters find text that would match old_text after normalizing each line. Their results are only shown to the model;
// they are never applied (RFC E3).

export interface Candidate {
  /** 1-based line where the similar text starts. */
  line: number
  reason: string
}

export type Hinter = (text: string, needle: string) => Candidate[]

/** Candidates one hinter reports for one old_text. */
const MAX_CANDIDATES = 3

/**
 * Compares lines after `normalize`. A one-line needle may sit anywhere in a line; a longer one must end its first
 * line, fill the middle lines and start its last line, as an exact match would.
 */
export function lineHinter(reason: string, normalize: (line: string) => string): Hinter {
  return (text, needle) => {
    const want = needle.replaceAll('\r\n', '\n').split('\n').map(normalize)
    if (want.every(l => l === '')) {
      return []
    }

    const lines = text.split('\n').map(normalize)
    const found: Candidate[] = []
    for (let i = 0; i + want.length <= lines.length && found.length < MAX_CANDIDATES; i++) {
      if (matchesAt(lines, i, want)) {
        found.push({ line: i + 1, reason })
      }
    }
    return found
  }
}

export const defaultHinters: Hinter[] = [
  lineHinter('differs only in indentation or trailing spaces', l => l.trim()),
  lineHinter('differs in spacing within lines', collapse),
  lineHinter('differs in quotes, dashes or other Unicode forms', l => collapse(unicode(l))),
]

function matchesAt(lines: readonly string[], i: number, want: readonly string[]): boolean {
  if (want.length === 1) {
    return lines[i].includes(want[0])
  }
  const last = want.length - 1
  for (let k = 1; k < last; k++) {
    if (lines[i + k] !== want[k]) {
      return false
    }
  }
  return lines[i].endsWith(want[0]) && lines[i + last].startsWith(want[last])
}

/** U+2010 to U+2015: hyphen, non-breaking hyphen, figure dash, en dash, em dash, horizontal bar. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015)}]`, 'g')

function collapse(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

function unicode(line: string): string {
  return line
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(DASHES, '-')
}
