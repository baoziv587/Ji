import { createFileRoute, Outlet } from '@tanstack/react-router'
import { DocsNav } from '~/components/docs/docs-nav'
import { SiteFooter } from '~/components/home/site-footer'
import { SiteHeader } from '~/components/site-header'
import { gutter } from '~/lib/layout'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/docs')({
  component: DocsLayout,
})

function DocsLayout() {
  return (
    <>
      <SiteHeader />
      <main
        className={cn(
          gutter,
          'grid grid-cols-[minmax(0,1fr)] gap-10 pb-[clamp(5rem,11vw,9rem)] pt-[clamp(2.5rem,5vw,4rem)] lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-16',
        )}
      >
        <DocsNav />
        <Outlet />
      </main>
      <SiteFooter />
    </>
  )
}
