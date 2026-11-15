import type { Doc } from '~/lib/docs-types'
import { notFound } from '@tanstack/react-router'
import { loaders, pages } from 'virtual:docs'

export { pages }

/** Loads one doc's prerendered HTML; runs at build time and on client-side navigation alike. */
export async function loadDoc(slug: string): Promise<Doc> {
  const load = loaders[slug]
  if (!load) throw notFound()
  return (await load()).default
}

/** The docs before and after this one in sidebar order. */
export function neighbours(slug: string) {
  const at = pages.findIndex(page => page.slug === slug)
  return { previous: pages[at - 1], next: at === -1 ? undefined : pages[at + 1] }
}
