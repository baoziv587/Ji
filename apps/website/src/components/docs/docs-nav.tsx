import { DocPageLink } from '~/components/docs/doc-link'
import { pages } from '~/lib/docs'

/** The doc list: a wrapped row on small screens, a sticky column beside the article on large ones. */
export function DocsNav() {
  return (
    <nav aria-label="Documentation" className="border-b border-ink-3 pb-5 lg:sticky lg:top-8 lg:self-start lg:border-0">
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[0.9375rem] lg:grid lg:gap-1">
        {pages.map(page => (
          <li key={page.slug}>
            <DocPageLink
              slug={page.slug}
              className="block py-1 text-paper-dim transition-colors hover:text-paper data-[status=active]:font-semibold data-[status=active]:text-paper"
            >
              {page.slug ? page.title : 'Overview'}
            </DocPageLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
