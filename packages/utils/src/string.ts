/**
 * The candidate nearest to `target` by edit distance, if it is close enough to be a typo. `key` picks the part of each
 * candidate to compare; the whole candidate is returned.
 */
export function closest(target: string, candidates: string[], key: (c: string) => string = c => c): string | undefined {
  let best: { candidate: string; distance: number } | undefined
  for (const candidate of candidates) {
    const distance = editDistance(target, key(candidate))
    if (best === undefined || distance < best.distance) {
      best = { candidate, distance }
    }
  }
  return best !== undefined && best.distance <= Math.max(2, Math.floor(target.length / 3)) ? best.candidate : undefined
}

/** Levenshtein distance: the fewest single-character insertions, deletions and substitutions from a to b. */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]
}
