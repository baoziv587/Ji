// The whole terminal, taken over like a full-screen program (the alternate screen), in three parts:
//
//   top bar      fixed rows, drawn by the caller
//   content      everything the program writes to stdout, kept by a headless terminal with its own scrollback and
//                drawn a window at a time, with a scrollbar in the last column; the wheel and PgUp/PgDn scroll it
//   bottom bar   fixed rows, drawn by the caller, with the cursor where it says
//
// To the program, stdout is the content area: its writes go to the headless terminal, and its columns and rows are
// that terminal's, so clack wraps and redraws there as in any terminal of that size. Keys come from `keys`, which is
// stdin without the mouse's reports. On stop, the content is printed to the normal screen and stays in its scrollback.

import type { IBufferCell, Terminal } from '@xterm/headless'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { PassThrough } from 'node:stream'
import xterm from '@xterm/headless'
import { lineOf, textOf } from './cells.ts'

/** What the bars show: their lines, each narrower than the terminal, and the cursor in the bottom one. */
export interface Frame {
  top: string[]
  bottom: string[]
  /** Row and column in the bottom bar; without one the cursor is hidden. */
  cursor?: { row: number; column: number }
}

/** Lines the wheel scrolls per notch. */
const WHEEL = 3

/** Draws a frame at once where the terminal supports it; others ignore it. */
const BEGIN = '\x1B[?2026h'
const END = '\x1B[?2026l'

/** Alternate screen, mouse buttons and wheel in SGR encoding, bracketed paste. */
const ENTER = '\x1B[?1049h\x1B[?1000h\x1B[?1006h\x1B[?2004h'
const LEAVE = '\x1B[?2004l\x1B[?1006l\x1B[?1000l\x1B[?1049l\x1B[?25h'

/** A mouse report, `ESC [ < button ; column ; row M` (m on release). */
// eslint-disable-next-line no-control-regex -- the report starts with ESC
const MOUSE = /\x1B\[<(\d+);\d+;\d+m/gi
const WHEEL_UP = '64'
const WHEEL_DOWN = '65'

const THUMB = '\x1B[90m┃\x1B[0m'
const TRACK = '\x1B[2m│\x1B[0m'

/** What the screen holds while it is on. */
interface Running {
  term: Terminal
  /** Reused for every cell read, to spare allocating one each time. */
  cell: IBufferCell
  /** stdout's own write. */
  write: (text: string) => boolean
  /** Gives stdout and stdin back as they were. */
  restore: () => void
}

export class Screen {
  /** stdin without the mouse's reports: what the program and its prompts read keys from. */
  readonly keys = new PassThrough()

  private readonly frame: (columns: number) => Frame
  private running: Running | undefined

  /** The first line shown, while scrolled back; undefined while following the end. */
  private top: number | undefined
  /** What the real terminal shows, row by row, so a frame writes only the rows that changed. */
  private shown: string[] = []
  /** The real terminal's size: stdout's own columns and rows are the content's while the screen is on. */
  private size = { columns: 80, rows: 24 }
  private scheduled = false

  constructor(frame: (columns: number) => Frame) {
    this.frame = frame
  }

  start(): void {
    const out = process.stdout
    const { stdin } = process
    const { columns, rows } = out
    this.size = { columns, rows }

    // A CommonJS package, so its classes come from the default export. A terminal's driver turns \n into \r\n, and
    // convertEol does the same; buffer is a proposed API
    const term = new xterm.Terminal({
      cols: columns - 1,
      rows: this.contentRows(columns, rows),
      scrollback: 10_000,
      convertEol: true,
      allowProposedApi: true,
    })

    const write = out.write.bind(out)
    const original = out.write
    // Node sets columns and rows to the real size on a resize, and getWindowSize reads them back: the setters keep it
    Object.defineProperties(out, {
      columns: { get: () => term.cols, set: (n: number) => (this.size.columns = n), configurable: true },
      rows: { get: () => term.rows, set: (n: number) => (this.size.rows = n), configurable: true },
    })
    out.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      const callback = rest.find(arg => typeof arg === 'function') as (() => void) | undefined
      term.write(typeof chunk === 'string' ? chunk : Buffer.from(chunk), () => {
        callback?.()
        this.draw()
      })
      return true
    }) as typeof out.write
    out.on('resize', this.resize)

    stdin.setRawMode(true)
    stdin.on('data', this.read)
    stdin.resume()

    const restore = (): void => {
      out.write = original
      out.off('resize', this.resize)
      for (const name of ['columns', 'rows'] as const) {
        Object.defineProperty(out, name, { value: this.size[name], writable: true, configurable: true })
      }

      stdin.off('data', this.read)
      stdin.setRawMode(false)
      stdin.pause()
    }

    this.running = { term, cell: term.buffer.active.getNullCell(), write, restore }
    write(ENTER)
    this.draw()
  }

  /** Resolves once everything written so far is in the content. */
  settled(): Promise<void> {
    const term = this.running?.term
    return new Promise(resolve => (term === undefined ? resolve() : term.write('', resolve)))
  }

  /** Back to the normal screen, with the content printed there; whatever is still unparsed is left out. */
  stop(): void {
    if (this.running === undefined) {
      return
    }

    const { term, cell, write, restore } = this.running
    this.running = undefined
    restore()

    const buffer = term.buffer.active
    const lines = Array.from({ length: buffer.length }, (_, y) => buffer.getLine(y))
    const text = textOf(lines, cell)
    write(`${LEAVE}${text}${text === '' ? '' : '\n'}`)
    term.dispose()
  }

  /** Redraws on the next turn of the event loop, once for everything that changed until then. */
  draw(): void {
    if (this.scheduled) {
      return
    }

    this.scheduled = true
    setImmediate(() => {
      this.scheduled = false
      this.paint()
    })
  }

  /** Scrolls the content by `lines`, back if negative; reaching the end follows it again. */
  scroll(lines: number): void {
    if (this.running === undefined) {
      return
    }

    const end = this.running.term.buffer.active.baseY
    const top = Math.min(Math.max((this.top ?? end) + lines, 0), end)
    this.top = top === end ? undefined : top
    this.draw()
  }

  /** Scrolls by a page, keeping a line of the last one. */
  page(direction: 1 | -1): void {
    this.scroll(direction * Math.max(1, (this.running?.term.rows ?? 1) - 1))
  }

  /** Follows the end again. */
  follow(): void {
    this.top = undefined
    this.draw()
  }

  /** How many lines are below the window, while scrolled back. */
  get below(): number {
    if (this.running === undefined || this.top === undefined) {
      return 0
    }
    return this.running.term.buffer.active.baseY - this.top
  }

  private paint(): void {
    if (this.running === undefined) {
      return
    }

    const { columns, rows } = this.size
    const frame = this.frame(columns)
    const lines = [...frame.top, ...this.content(this.running), ...frame.bottom].slice(0, rows)

    let out = ''
    for (const [i, line] of lines.entries()) {
      if (line !== this.shown[i]) {
        out += `\x1B[${i + 1};1H\x1B[2K${line}`
      }
    }
    this.shown = lines

    if (frame.cursor === undefined) {
      out += '\x1B[?25l'
    } else {
      const row = rows - frame.bottom.length + 1 + frame.cursor.row
      out += `\x1B[${row};${frame.cursor.column + 1}H\x1B[?25h`
    }
    this.running.write(`${BEGIN}${out}${END}`)
  }

  /** The window of the content, each row with its piece of the scrollbar. */
  private content({ term, cell }: Running): string[] {
    const buffer = term.buffer.active
    const top = Math.min(this.top ?? buffer.baseY, buffer.baseY)
    const bar = scrollbar(term.rows, buffer.length, top)
    return bar.map((piece, y) => lineOf(buffer.getLine(top + y), term.cols, cell) + piece)
  }

  private contentRows(columns: number, rows: number): number {
    const frame = this.frame(columns)
    return Math.max(1, rows - frame.top.length - frame.bottom.length)
  }

  /** Takes the wheel out of stdin; the rest are keys. */
  private readonly read = (data: Buffer): void => {
    const keys = data.toString().replaceAll(MOUSE, (_, button: string) => {
      if (button === WHEEL_UP) {
        this.scroll(-WHEEL)
      } else if (button === WHEEL_DOWN) {
        this.scroll(WHEEL)
      }
      return ''
    })
    if (keys !== '') {
      this.keys.write(keys)
    }
  }

  /** The content reflows to the new width, and every row is drawn again. */
  private readonly resize = (): void => {
    if (this.running === undefined) {
      return
    }

    const { columns, rows } = this.size
    this.running.term.resize(columns - 1, this.contentRows(columns, rows))
    this.shown = []
    this.running.write('\x1B[2J')
    this.draw()
  }
}

/** One piece per row: a thumb as tall as the window is of the whole, as far down as the window is. */
function scrollbar(rows: number, total: number, top: number): string[] {
  if (total <= rows) {
    return Array.from<string>({ length: rows }).fill(' ')
  }

  const thumb = Math.max(1, Math.round((rows * rows) / total))
  const start = Math.round((top / (total - rows)) * (rows - thumb))
  return Array.from({ length: rows }, (_, y) => (y >= start && y < start + thumb ? THUMB : TRACK))
}
