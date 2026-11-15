import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

/** `''` is the docs home; every other slug is a page under /docs. */
export function DocPageLink({ slug, className, children }: { slug: string; className?: string; children: ReactNode }) {
  // The router marks the current page with data-status="active"; style it with data-[status=active]:.
  return slug ? (
    <Link to="/docs/$slug" params={{ slug }} className={className}>
      {children}
    </Link>
  ) : (
    <Link to="/docs" activeOptions={{ exact: true }} className={className}>
      {children}
    </Link>
  )
}
