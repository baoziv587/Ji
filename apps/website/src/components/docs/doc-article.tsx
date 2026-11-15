import type { MouseEvent } from 'react'
import type { Doc } from '~/lib/docs-types'
import { useRouter } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { DocPageLink } from '~/components/docs/doc-link'
import { neighbours } from '~/lib/docs'

/**
 * Links inside the rendered Markdown are plain anchors. Route the ones that
 * stay on the site through the router, so moving between docs keeps the page.
 */
function useInternalNavigation() {
  const router = useRouter()
  return (event: MouseEvent<HTMLElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    const anchor = (event.target as Element).closest('a')
    const href = anchor?.getAttribute('href')
    if (!href?.startsWith('/')) return
    event.preventDefault()
    void router.navigate({ href })
  }
}

export function DocArticle({ doc }: { doc: Doc }) {
  const onClick = useInternalNavigation()
  const { previous, next } = neighbours(doc.slug)
  const outline = doc.headings.filter(heading => heading.depth === 2 || heading.depth === 3)

  return (
    <div className="grid min-w-0 gap-12 xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-16">
      <article className="min-w-0 max-w-[48rem]">
        <h1 className="text-[clamp(2.25rem,3.6vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.035em] text-balance">
          {doc.title}
        </h1>
        <div
          className="doc mt-8"
          onClick={onClick}
          // Build-time output of vite-plugins/docs.ts from the repository's own docs, never user input.
          // eslint-disable-next-line react/dom-no-dangerously-set-innerhtml
          dangerouslySetInnerHTML={{ __html: doc.html }}
        />

        {(previous || next) && (
          <nav aria-label="Previous and next" className="mt-16 grid gap-4 border-t border-ink-3 pt-8 sm:grid-cols-2">
            {previous && (
              <DocPageLink slug={previous.slug} className="group grid gap-1">
                <span className="flex items-center gap-1.5 text-sm text-paper-faint">
                  <ArrowLeft aria-hidden className="size-3.5" /> Previous
                </span>
                <span className="font-semibold text-paper underline decoration-transparent underline-offset-[0.3em] transition-colors group-hover:decoration-paper">
                  {previous.slug ? previous.title : 'Overview'}
                </span>
              </DocPageLink>
            )}
            {next && (
              <DocPageLink slug={next.slug} className="group grid gap-1 sm:col-start-2 sm:text-right">
                <span className="flex items-center gap-1.5 text-sm text-paper-faint sm:justify-end">
                  Next <ArrowRight aria-hidden className="size-3.5" />
                </span>
                <span className="font-semibold text-paper underline decoration-transparent underline-offset-[0.3em] transition-colors group-hover:decoration-paper">
                  {next.title}
                </span>
              </DocPageLink>
            )}
          </nav>
        )}
      </article>

      {outline.length > 0 && (
        <nav aria-label="On this page" className="hidden xl:sticky xl:top-8 xl:block xl:self-start">
          <p className="mb-3 text-sm font-semibold text-paper">On this page</p>
          <ul className="grid gap-1.5 text-sm">
            {outline.map(heading => (
              <li key={heading.id} className={heading.depth === 3 ? 'pl-3' : undefined}>
                <a href={`#${heading.id}`} className="text-paper-dim transition-colors hover:text-paper">
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
