/** Keys shared by distinct items, in order of first appearance; the same item listed twice is not a duplicate. */
export function duplicatesBy<T, K>(items: Iterable<T>, key: (item: T) => K): K[] {
  return [...Map.groupBy(new Set(items), key)].filter(([, group]) => group.length > 1).map(([k]) => k)
}
