import type { Plugin } from '@ji.dev/llm'
import { after, definePlugin } from '@ji.dev/llm'

export interface TruncateOptions {
  /** Maximum characters kept per text block. */
  maxChars?: number
}

/**
 * Trims oversized tool results: text over maxChars keeps its head and tail, with a one-line note in between.
 *
 * Only the tool's output changes, so `after` is enough. The original length goes in result.details.truncated:
 * details stay in the history and are never sent to the model, so UIs and logs can use them.
 */
export function truncateToolResults({ maxChars = 8_000 }: TruncateOptions = {}): Plugin {
  return definePlugin({
    name: 'truncate-tool-results',

    toolCall: after(result => {
      const originalChars = result.content.reduce((n, c) => n + (c.type === 'text' ? c.text.length : 0), 0)
      if (originalChars <= maxChars) {
        return result
      }

      return {
        ...result,
        content: result.content.map(c => (c.type === 'text' ? { ...c, text: truncate(c.text, maxChars) } : c)),
        details: { ...(isObject(result.details) ? result.details : {}), truncated: { originalChars } },
      }
    }),
  })
}

/** Keeps ~70% from the head and ~20% from the tail: heads usually carry structure, tails a summary or the error. */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }

  const head = text.slice(0, Math.floor(maxChars * 0.7))
  const tail = text.slice(-Math.floor(maxChars * 0.2))
  const omitted = text.length - head.length - tail.length
  return `${head}\n\n[... ${omitted} characters omitted ...]\n\n${tail}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
