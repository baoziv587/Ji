// How much the history holds now, against where it is compacted; then what the session has spent so far, as the
// service counted it (agent/meter.ts): in short under the input line, in full on exit.

import type { ContextSize, UsageReading } from '../agent/meter.ts'
import { styleText } from 'node:util'
import { dimText, formatCount } from '@ji.dev/tui'

/** The share of the limit past which the history shows in the warning color, and then in the error color. */
const NEAR = 0.7
const FULL = 0.9

/**
 * `ctx 32k/200k`, `$0.0123`, `in 48.2k · out 3.1k`, `cache 86%`, `41 tok/s`: most important first, so a narrow line
 * drops from the end. Dim, all but a history near the limit. Empty before any call has ended.
 */
export function describeUsage(usage: UsageReading): string[] {
  if (usage.calls === 0) {
    return []
  }

  const parts = [
    `$${usage.cost.toFixed(4)}`,
    `in ${formatCount(usage.input)} · out ${formatCount(usage.output)}`,
    `cache ${usage.cache}%`,
  ]
  if (usage.speed !== undefined) {
    parts.push(`${usage.speed} tok/s`)
  }

  const dimmed = parts.map(dimText)
  return usage.context === undefined ? dimmed : [describeContext(usage.context), ...dimmed]
}

/** The whole session for the exit, every token counted: `48,213 in (86% cached) · 3,104 out · 12 model calls · …`. */
export function summarizeUsage(usage: UsageReading): string {
  if (usage.calls === 0) {
    return 'No model calls'
  }

  const calls = usage.calls === 1 ? '1 model call' : `${usage.calls} model calls`
  const parts = [`${exact(usage.input)} in (${usage.cache}% cached)`, `${exact(usage.output)} out`, calls]
  if (usage.speed !== undefined) {
    parts.push(`${usage.speed} tok/s`)
  }
  parts.push(`$${usage.cost.toFixed(4)}`)
  return `Tokens: ${parts.join(' · ')}`
}

/** `ctx 32k/200k`, `~` before an estimate; dim, but in the warning color near the limit, the error color nearly at it. */
function describeContext({ tokens, estimated, limit }: ContextSize & { limit: number }): string {
  const text = `ctx ${estimated ? '~' : ''}${formatCount(tokens)}/${formatCount(limit)}`
  if (tokens >= limit * FULL) {
    return styleText('red', text)
  }
  if (tokens >= limit * NEAR) {
    return styleText('yellow', text)
  }
  return dimText(text)
}

/** Every digit, grouped by thousands: `48,213`. */
function exact(n: number): string {
  return n.toLocaleString('en-US')
}
