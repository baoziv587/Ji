// A reply's streamed text, written to the right of clack's rail, lined up with the prompts above and below.

import type { Writable } from 'node:stream'
import type { Rows } from '../markdown/flow.ts'
import type { Format } from '../markdown/inline.ts'
import process from 'node:process'
import { styleText } from 'node:util'
import { Flow } from '../markdown/flow.ts'
import { Markdown } from '../markdown/markdown.ts'
import { bar, count, dim, room, tail } from '../paint/text.ts'

export type BlockKind = 'thinking' | 'text'

/** The two views: brief leaves out what full shows in detail. */
export interface Views {
  brief: Writable
  full: Writable
}

interface Block {
  title?: string
  rail: string
  output: Writable
}

/** What writes a block's text: the answer's as Markdown, the thinking's as it comes. */
interface Writer {
  write: (chunk: string) => Promise<void>
  end: () => void
}

/** Enough of the thinking's end to fill the status. */
const RECENT = 200

const THINKING: Format[] = ['dim', 'italic']

/**
 * Thinking and answer text each get their own block: the answer is Markdown, the thinking dim text as it comes. The
 * rail is written lazily, when a row gets its first text or a line turns out to be blank, so a chunk ending in '\n'
 * leaves no dangling rail.
 *
 * A line too long for the terminal goes on in rows of its own, each after the rail, instead of being wrapped by the
 * terminal back to its first column.
 */
export class Gutter {
  private readonly views: Views
  private readonly blocks: Record<BlockKind, Block>
  private open: { kind: BlockKind; writer: Writer } | undefined
  private atLineStart = true
  /** The thinking block in progress: how long and how much, and its last words for the status. */
  private thought: { since: number; chars: number; recent: string } | undefined
  /** The answer block in progress, to ask what it holds back. */
  private markdown: Markdown | undefined

  /** `both` is what the two views show alike: stdout, unless a test says otherwise. */
  constructor(views: Views, both: Writable = process.stdout) {
    this.views = views
    // Thinking is written in full to the full view only; the brief one gets a line for it once it ends
    this.blocks = {
      thinking: {
        title: `${styleText('gray', '◌')}  ${styleText(THINKING, 'Thinking')}`,
        rail: styleText('gray', '┊'),
        output: views.full,
      },
      text: { rail: bar(), output: both },
    }
  }

  async write(chunk: string, kind: BlockKind): Promise<void> {
    if (this.open?.kind !== kind) {
      this.end()
      const block = this.blocks[kind]
      block.output.write(`${bar()}\n${block.title === undefined ? '' : `${block.title}\n`}`)
      this.open = { kind, writer: this.writerOf(kind) }
    }

    if (kind === 'thinking') {
      this.thought ??= { since: performance.now(), chars: 0, recent: '' }
      this.thought.chars += [...chunk].length
      this.thought.recent = (this.thought.recent + chunk).slice(-RECENT)
    }

    await this.open.writer.write(chunk)
  }

  /** `1.2k chars · …so I'll call calc`: how much it has thought, and its last words; empty while not thinking. */
  describeThought(): string {
    if (this.thought === undefined) {
      return ''
    }

    const words = this.thought.recent.replaceAll(/\s+/g, ' ').trim()
    return dim(`${count(this.thought.chars)} chars · …${tail(words, 48)}`)
  }

  /** What the answer holds back until it ends: `table · 14 rows`; empty while it goes on as it comes. */
  held(): string {
    return this.markdown?.describe() ?? ''
  }

  /** Closes the current block so the next output starts on a fresh line; a thinking one gets its line in brief. */
  end(): void {
    this.open?.writer.end()
    this.open = undefined
    this.markdown = undefined
    this.atLineStart = true

    if (this.thought !== undefined) {
      const seconds = Math.max(1, Math.round((performance.now() - this.thought.since) / 1000))
      const title = styleText(THINKING, `Thought for ${seconds}s`)
      const length = dim(`· ${count(this.thought.chars)} chars`)
      this.views.brief.write(`${bar()}\n${styleText('gray', '◌')}  ${title} ${length}\n`)
      this.thought = undefined
    }
  }

  private writerOf(kind: BlockKind): Writer {
    const block = this.blocks[kind]
    const rows: Rows = {
      write: text => {
        if (this.atLineStart) {
          block.output.write(`${block.rail}  `)
          this.atLineStart = false
        }
        block.output.write(text)
      },
      // Blank lines get a rail too, so paragraphs stay connected
      newline: () => {
        block.output.write(this.atLineStart ? `${block.rail}\n` : '\n')
        this.atLineStart = true
      },
    }

    if (kind === 'text') {
      this.markdown = new Markdown(rows, room)
      return this.markdown
    }

    const flow = new Flow(rows, room)
    return {
      write: async chunk => {
        for (const [i, part] of chunk.split('\n').entries()) {
          if (i > 0) {
            flow.endLine()
          }
          flow.add(part, THINKING)
        }
      },
      end: () => flow.end(),
    }
  }
}
