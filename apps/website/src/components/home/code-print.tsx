import type { CSSProperties, ReactNode } from 'react'
import type { Note } from '~/content/home'
import { cn } from '~/lib/utils'

interface CodePrintProps {
  /** Build-time highlighted HTML from a `?highlight` import. */
  html: string
  label: string
  notes?: readonly Note[]
  /** A header row above the code, e.g. a copy button. */
  toolbar?: ReactNode
  className?: string
}

const lineOffset = (line: number) => ({ '--line': line - 1 }) as CSSProperties

/**
 * A code block laid out like a page from a seal catalogue: the code is the
 * impression, and short notes sit beside the lines they explain, the way side
 * inscriptions annotate a seal.
 */
export function CodePrint({ html, label, notes = [], toolbar, className }: CodePrintProps) {
  return (
    <figure
      className={cn('grid gap-x-10 gap-y-6', notes.length > 0 && 'lg:grid-cols-[minmax(0,1fr)_16rem]', className)}
    >
      <div className="min-w-0 rounded-md bg-ink-0 ring-1 ring-ink-3/60">
        {toolbar && (
          <div className="flex items-center justify-between border-b border-ink-3/60 py-1 pl-6 pr-1">{toolbar}</div>
        )}
        <div className="relative">
          <div
            className="code"
            role="region"
            aria-label={label}
            tabIndex={0}
            // Our own build-time output from vite-plugins/highlight.ts, never user input.
            // eslint-disable-next-line react/dom-no-dangerously-set-innerhtml
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {notes.map((note, index) => (
            <span
              key={note.line}
              aria-hidden
              style={lineOffset(note.line)}
              className="pointer-events-none absolute left-1.5 top-[calc(var(--code-pad)+var(--line)*var(--code-lh))] font-mono text-[0.6875rem] leading-(--code-lh) text-paper-faint"
            >
              {index + 1}
            </span>
          ))}
        </div>
      </div>
      {notes.length > 0 && (
        <figcaption className="relative">
          <ol className="grid gap-3 text-[0.9375rem] leading-relaxed text-paper-dim lg:block">
            {notes.map((note, index) => (
              <li
                key={note.line}
                style={lineOffset(note.line)}
                className="flex gap-3 lg:absolute lg:top-[calc(var(--code-pad)+var(--line)*var(--code-lh))] lg:leading-(--code-lh)"
              >
                <span className="font-mono text-[0.6875rem] text-paper-faint lg:leading-(--code-lh)">{index + 1}</span>
                <span className="lg:leading-snug lg:pt-1">{note.text}</span>
              </li>
            ))}
          </ol>
        </figcaption>
      )}
    </figure>
  )
}
