import type { ComponentProps, ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { gutter } from '~/lib/layout'
import { cn } from '~/lib/utils'

export function Section({ className, children, ...props }: ComponentProps<'section'>) {
  return (
    <section className={cn(gutter, 'py-[clamp(5rem,11vw,9rem)]', className)} {...props}>
      {children}
    </section>
  )
}

export function Heading({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-12 max-w-[42rem] md:mb-16">
      <h2
        id={id}
        className="text-[clamp(1.875rem,3.4vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.025em] text-balance"
      >
        {title}
      </h2>
      {children && <div className="mt-5 text-pretty text-paper-dim">{children}</div>}
    </header>
  )
}

export function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm bg-ink-0 px-1.5 py-0.5 font-mono text-[0.875em] text-paper whitespace-nowrap">
      {children}
    </code>
  )
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      className={cn(
        'text-paper underline decoration-ink-4 decoration-1 underline-offset-[0.3em] transition-[text-decoration-color] hover:decoration-paper',
        className,
      )}
    >
      {children}
      <ArrowUpRight aria-hidden className="ml-1 inline size-[0.9em] align-[-0.1em] text-paper-faint" />
    </a>
  )
}
