declare module 'virtual:docs' {
  import type { Doc, DocPage } from '~/lib/docs-types'

  /** Every doc in sidebar order. */
  export const pages: readonly DocPage[]
  /** One lazily loaded chunk per doc, keyed by slug. */
  export const loaders: Readonly<Record<string, () => Promise<{ default: Doc }>>>
}
