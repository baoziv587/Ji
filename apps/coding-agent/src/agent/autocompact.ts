// Where the history is compacted, as /autocompact and the service's autocompact take it: a number of tokens, as
// '400k', '1.5m', '400000' or '400,000', or 'default' for where the model compacts by itself (agent.ts' contextLimitOf).

/** Below this, a reply would be compacting more than it works. */
export const MIN_COMPACT_AT = 10_000

const UNITS: Record<string, number> = { '': 1, k: 1000, m: 1_000_000 }

/** The tokens the text names, or undefined for 'default'; throws on anything else, and on fewer than MIN_COMPACT_AT. */
export function parseCompactAt(text: string): number | undefined {
  const given = text.trim().toLowerCase()
  if (given === 'default') {
    return undefined
  }

  const match = /^(\d+(?:\.\d+)?)\s*([km]?)$/.exec(given.replaceAll(',', ''))
  if (match === null) {
    throw new Error(`"${text.trim()}" is not a number of tokens: try 400k, 1m or 400000, or default`)
  }

  const tokens = Math.round(Number(match[1]) * UNITS[match[2]])
  if (tokens < MIN_COMPACT_AT) {
    throw new Error(`Compacting below ${formatTokens(MIN_COMPACT_AT)} tokens would leave too little to work with`)
  }
  return tokens
}

/** 400000 as '400,000'. */
export function formatTokens(tokens: number): string {
  return tokens.toLocaleString('en-US')
}
