// The whole terminal, taken over like a full-screen program (the alternate screen), and drawn from a tree of elements
// the program builds again for every frame (RFC-0008). One of them is `content`: everything the program writes to
// stdout, kept by a headless terminal with its own scrollback and drawn a window at a time, with a scrollbar in its last
// column; the wheel and PgUp/PgDn scroll it. It is as big as the tree gives it room, and the headless terminal takes
// that size, as on a resize of the terminal.
//
// To the program, stdout is the content area: its writes go to the headless terminal, and its columns and rows are
// that terminal's, so clack wraps and redraws there as in any terminal of that size. Keys come from `keys`, which is
// stdin without the mouse's reports and PgUp/PgDn, and emits readline's keypress events; the screen is drawn again after
// each. On stop, or when the process exits, the content is printed to the normal screen and stays in its scrollback.
//
// The content comes in two views, each its own headless terminal, and toggle() shows the other one. stdout writes
// to both; `brief` and `full` write to one only, for what each view shows its own way. A prompt redraws in both
// alike, so switching never needs the content written again. Where each write to both starts is marked in both, so
// switching keeps the line at the top of the window in its place.
//
// `live` keeps a few rows at the end of the content, in both views: every write goes in above them.

import type { IBufferCell, IMarker, Terminal } from '@xterm/headless'
import type { Element, Rendered } from '../elements/element.ts'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { emitKeypressEvents } from 'node:readline'
import { PassThrough, Writable } from 'node:stream'
import xterm from '@xterm/headless'
import { Anchors } from './anchors.ts'
import { lineOf, textOf } from './cells.ts'
import { Live } from './live.ts'

/** brief leaves out what full shows in detail. */
export type View = 'brief' | 'full'

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

/** PgUp, `ESC [ 5 ~`, and PgDn, `ESC [ 6 ~`. */
// eslint-disable-next-line no-control-regex -- the key starts with ESC
const PAGE = /\x1B\[([56])~/g
const PAGE_UP = '5'

const THUMB = '\x1B[90m┃\x1B[0m'
const TRACK = '\x1B[2m│\x1B[0m'

/** What the screen holds while it is on. */
interface Running {
  terms: Record<View, Terminal>
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
  /** Writes to one view only. */
  readonly brief = this.only('brief')
  readonly full = this.only('full')
  /** The rows at the end of the content that show what is being waited on. */
  readonly live = new Live(
    text => this.raw(text),
    () => ({ columns: process.stdout.columns, rows: process.stdout.rows }),
  )

  /** The conversation's part of the screen: it fills, and takes the size it is given. */
  readonly content: Element = {
    fill: true,
    render: (width, height) => ({ rows: this.contentRows(width, height) }),
  }

  /** The tree drawn over the whole terminal, built again for every frame. */
  private readonly tree: () => Element
  private running: Running | undefined
  private shownView: View = 'brief'
  /** Where the two views hold the same content. */
  private readonly anchors = new Anchors()

  /** The first line shown, while scrolled back; undefined while following the end. */
  private top: number | undefined
  /** What the real terminal shows, row by row, so a frame writes only the rows that changed. */
  private shown: string[] = []
  /**
   * The content's rows as last read from the headless terminal: read again only after it changed, so the rest can
   * redraw (a spinner's turn, a key) without going over every cell of the content.
   */
  private window: string[] = []
  private stale = true
  /** The real terminal's size: stdout's own columns and rows are the content's while the screen is on. */
  private size = { columns: 80, rows: 24 }
  private scheduled = false

  constructor(tree: () => Element) {
    this.tree = tree
    emitKeypressEvents(this.keys)
    // A key changes what is on screen, or may: drawn once the program has handled it
    this.keys.on('keypress', () => this.draw())
  }

  /** Whether the screen can take over: stdin and stdout are both a terminal. */
  static isSupported(): boolean {
    return process.stdin.isTTY && process.stdout.isTTY
  }

  start(): void {
    const out = process.stdout
    const { stdin } = process
    const { columns, rows } = out
    this.size = { columns, rows }

    // A CommonJS package, so its classes come from the default export. A terminal's driver turns \n into \r\n, and
    // convertEol does the same; buffer is a proposed API
    const view = (): Terminal =>
      new xterm.Terminal({
        cols: columns - 1,
        rows,
        scrollback: 10_000,
        convertEol: true,
        allowProposedApi: true,
      })
    const terms = { brief: view(), full: view() }

    const write = out.write.bind(out)
    const original = out.write
    // Node sets columns and rows to the real size on a resize, and getWindowSize reads them back: the setters keep it
    Object.defineProperties(out, {
      columns: { get: () => terms.brief.cols, set: (n: number) => (this.size.columns = n), configurable: true },
      rows: { get: () => terms.brief.rows, set: (n: number) => (this.size.rows = n), configurable: true },
    })
    out.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      const callback = rest.find(arg => typeof arg === 'function') as (() => void) | undefined
      this.put(['brief', 'full'], typeof chunk === 'string' ? chunk : Buffer.from(chunk), callback)
      return true
    }) as typeof out.write
    out.on('resize', this.resize)

    stdin.setRawMode(true)
    stdin.on('data', this.read)
    stdin.resume()
    // Whatever ends the process, the terminal is given back
    process.on('exit', this.exit)

    const restore = (): void => {
      out.write = original
      out.off('resize', this.resize)
      for (const name of ['columns', 'rows'] as const) {
        Object.defineProperty(out, name, { value: this.size[name], writable: true, configurable: true })
      }

      stdin.off('data', this.read)
      stdin.setRawMode(false)
      stdin.pause()
      process.off('exit', this.exit)
    }

    this.running = { terms, cell: terms.brief.buffer.active.getNullCell(), write, restore }
    // The content takes its size before anything is written to it
    this.layout()
    write(ENTER)
    this.changed()
  }

  /** Resolves once everything written so far is in the content. */
  async settled(): Promise<void> {
    if (this.running === undefined) {
      return
    }

    const { brief, full } = this.running.terms
    await Promise.all([brief, full].map(term => new Promise<void>(resolve => term.write('', resolve))))
  }

  /**
   * Back to the normal screen, with the content printed there in the view on screen; whatever is still unparsed is
   * left out.
   */
  stop(): void {
    if (this.running === undefined) {
      return
    }

    const { terms, cell, write, restore } = this.running
    this.running = undefined
    restore()

    const buffer = terms[this.shownView].buffer.active
    const lines = Array.from({ length: buffer.length }, (_, y) => buffer.getLine(y))
    const text = textOf(lines, cell)
    write(`${LEAVE}${text}${text === '' ? '' : '\n'}`)
    terms.brief.dispose()
    terms.full.dispose()
    this.anchors.clear()
  }

  /** The view on screen. */
  get view(): View {
    return this.shownView
  }

  /**
   * Shows the other view with what was at the top of the window still there, what one view shows and the other does
   * not opening or closing below it; it follows the end only once the end is in the window.
   */
  toggle(): void {
    const from = this.shownView
    const to = from === 'brief' ? 'full' : 'brief'
    this.shownView = to
    if (this.running === undefined) {
      return
    }

    const { terms } = this.running
    const top = this.anchors.find(this.top ?? terms[from].buffer.active.baseY, from, to)
    const end = terms[to].buffer.active.baseY
    this.top = top >= end ? undefined : top
    this.changed()
  }

  /**
   * Redraws on the next turn of the event loop, once for everything that changed until then. The content is drawn as
   * it was, unless it changed itself. Keys draw by themselves; what else changes the program's state calls this.
   */
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

    const end = this.running.terms[this.shownView].buffer.active.baseY
    const top = Math.min(Math.max((this.top ?? end) + lines, 0), end)
    this.top = top === end ? undefined : top
    this.changed()
  }

  /** Scrolls by a page, keeping a line of the last one. */
  private page(direction: 1 | -1): void {
    this.scroll(direction * Math.max(1, (this.running?.terms.brief.rows ?? 1) - 1))
  }

  /** Follows the end again. */
  follow(): void {
    this.top = undefined
    this.changed()
  }

  /** How many lines are below the window, while scrolled back. */
  get below(): number {
    if (this.running === undefined || this.top === undefined) {
      return 0
    }
    return this.running.terms[this.shownView].buffer.active.baseY - this.top
  }

  private paint(): void {
    if (this.running === undefined) {
      return
    }

    const frame = this.layout()
    const lines = Array.from({ length: this.size.rows }, (_, y) => frame.rows[y] ?? '')

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
      out += `\x1B[${frame.cursor.row + 1};${frame.cursor.column + 1}H\x1B[?25h`
    }
    this.running.write(`${BEGIN}${out}${END}`)
  }

  /** The tree drawn over the whole terminal; the content takes the size it is given in it. */
  private layout(): Rendered {
    const { columns, rows } = this.size
    return this.tree().render(columns, rows)
  }

  /**
   * The content's window, `width` columns with the scrollbar's: the headless terminals take its size first, reflowing
   * as on a resize of the terminal.
   */
  private contentRows(width: number, height = this.size.rows): string[] {
    if (this.running === undefined) {
      return []
    }

    const { terms } = this.running
    const columns = Math.max(1, width - 1)
    const rows = Math.max(1, height)
    if (terms.brief.cols !== columns || terms.brief.rows !== rows) {
      for (const term of Object.values(terms)) {
        term.resize(columns, rows)
      }
      this.stale = true
    }

    if (this.stale) {
      this.window = this.readWindow(this.running)
      this.stale = false
    }
    return this.window.slice(0, height)
  }

  /** The window of the content, each row with its piece of the scrollbar. */
  private readWindow({ terms, cell }: Running): string[] {
    const term = terms[this.shownView]
    const buffer = term.buffer.active
    const top = Math.min(this.top ?? buffer.baseY, buffer.baseY)
    const bar = scrollbar(term.rows, buffer.length, top)
    return bar.map((piece, y) => lineOf(buffer.getLine(top + y), term.cols, cell) + piece)
  }

  /** The content changed, or what of it is on screen: it is read again for the next frame. */
  private changed(): void {
    this.stale = true
    this.draw()
  }

  /** A stream into one view, for clack's `output`; it wraps at the content's width as stdout does. */
  private only(view: View): Writable {
    const stream = new Writable({
      write: (chunk: Buffer, _encoding, done) => {
        this.put([view], chunk)
        // At once, so the next write is not held back behind this one, out of order with stdout's
        done()
      },
    })
    Object.defineProperty(stream, 'columns', { get: () => process.stdout.columns })
    return stream
  }

  /**
   * Writes `text` to `views`, above the live rows: they are taken away from both views first, and drawn again after
   * it. `written` is called once the text is in the content.
   */
  private put(views: View[], text: string | Buffer, written?: () => void): void {
    if (this.running === undefined) {
      return
    }

    const { terms } = this.running
    this.raw(this.live.erase())
    if (views.length === 2) {
      this.anchor(terms)
    }
    for (const view of views) {
      terms[view].write(text, () => this.changed())
    }
    this.raw(this.live.after(text.toString(), views))
    // Each terminal parses its writes in order, so this comes after all of them
    terms.full.write('', () => {
      written?.()
      this.changed()
    })
  }

  /** Marks the line each view's cursor is on once it has parsed what came before: the next write starts there. */
  private anchor(terms: Record<View, Terminal>): void {
    const pair: Partial<Record<View, IMarker>> = {}
    for (const view of ['brief', 'full'] as const) {
      terms[view].write('', () => {
        pair[view] = terms[view].registerMarker(0)
        if (pair.brief !== undefined && pair.full !== undefined) {
          this.anchors.add({ brief: pair.brief, full: pair.full })
        }
      })
    }
  }

  /** Writes to both views as it is: the live rows' own drawing. */
  private raw(text: string): void {
    if (this.running === undefined || text === '') {
      return
    }
    for (const term of Object.values(this.running.terms)) {
      term.write(text, () => this.changed())
    }
  }

  /** Takes the wheel and PgUp/PgDn out of stdin; the rest are keys. */
  private readonly read = (data: Buffer): void => {
    const withoutMouse = data.toString().replaceAll(MOUSE, (_, button: string) => {
      if (button === WHEEL_UP) {
        this.scroll(-WHEEL)
      } else if (button === WHEEL_DOWN) {
        this.scroll(WHEEL)
      }
      return ''
    })

    const keys = withoutMouse.replaceAll(PAGE, (_, key: string) => {
      this.page(key === PAGE_UP ? -1 : 1)
      return ''
    })

    if (keys !== '') {
      this.keys.write(keys)
    }
  }

  private readonly exit = (): void => {
    this.stop()
  }

  /** The content reflows to the new width, and every row is drawn again. */
  private readonly resize = (): void => {
    if (this.running === undefined) {
      return
    }

    // At once, before the program's own listeners read stdout's new size
    this.layout()
    this.shown = []
    this.running.write('\x1B[2J')
    this.changed()
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
