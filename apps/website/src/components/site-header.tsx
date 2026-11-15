import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { HeaderMark } from '~/components/header-mark'
import { ThemeToggle } from '~/components/theme-toggle'
import { links } from '~/content/home'
import { gutter } from '~/lib/layout'
import { cn } from '~/lib/utils'

const tab =
  'inline-flex h-10 items-center border-b-2 border-transparent text-[0.9375rem] text-paper-dim transition-colors hover:text-paper focus-visible:-outline-offset-2 data-[status=active]:border-paper data-[status=active]:text-paper'

/** The JI mark goes home; the one tab goes to the docs. Same row on every page. */
export function SiteHeader({ className }: { className?: string }) {
  return (
    <header className={cn(gutter, 'flex items-center justify-between gap-6 pt-(--header-pt)', className)}>
      <Link to="/" aria-label="JI home" className="rounded-sm">
        <HeaderMark />
      </Link>
      <nav aria-label="Site" className="flex items-center gap-6">
        <Link to="/docs" className={tab}>
          Docs
        </Link>
        <a href={links.repo} className={cn(tab, 'gap-1')}>
          GitHub
          <ArrowUpRight aria-hidden className="size-3.5 text-paper-faint" />
        </a>
        <ThemeToggle className="-mr-2" />
      </nav>
    </header>
  )
}
