import { Link } from '@tanstack/react-router'
import { docs, links, packages } from '~/content/home'
import { rubbing } from '~/lib/catalog'
import { gutter } from '~/lib/layout'
import { cn } from '~/lib/utils'

const linkClass =
  'text-paper-dim underline decoration-transparent underline-offset-[0.3em] transition-colors hover:text-paper hover:decoration-paper-faint'

export function SiteFooter() {
  return (
    <footer className="border-t border-ink-3 bg-ink-0">
      <div className={cn(gutter, 'grid gap-12 py-16 md:grid-cols-[1.2fr_1.6fr_1fr] md:gap-10')}>
        <div>
          <img
            src={rubbing.webp}
            width={rubbing.width}
            height={rubbing.height}
            alt="JI, the etched logo pulled as a rubbing"
            loading="lazy"
            className="rubbing mb-6 h-36 w-auto"
          />
          <p className="max-w-[18rem] text-sm leading-relaxed text-paper-dim">
            <span className="font-semibold text-paper">JI</span> <span lang="zh-CN">极</span>
            <br />
            A small, extensible TypeScript runtime for LLM agents.
          </p>
        </div>

        <div>
          <h2 className="mb-4 text-sm font-semibold text-paper">Packages</h2>
          <ul className="grid gap-3 text-sm">
            {packages.map(pkg => (
              <li key={pkg.name}>
                <a href={pkg.href} className={cn(linkClass, 'font-mono text-paper')}>
                  {pkg.name}
                </a>
                <p className="text-paper-faint">{pkg.role}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid content-start gap-8 text-sm">
          <div>
            <h2 className="mb-4 font-semibold text-paper">Docs</h2>
            <ul className="grid gap-2">
              {docs.map(doc => (
                <li key={doc.slug}>
                  <Link to="/docs/$slug" params={{ slug: doc.slug }} className={linkClass}>
                    {doc.label}
                  </Link>
                </li>
              ))}
              <li>
                <a href={links.examples} className={linkClass}>
                  Runnable examples
                </a>
              </li>
            </ul>
          </div>
          <ul className="grid gap-2">
            <li>
              <a href={links.repo} className={linkClass}>
                GitHub
              </a>
            </li>
            <li>
              <Link to="/brand" className={linkClass}>
                Brand assets
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  )
}
