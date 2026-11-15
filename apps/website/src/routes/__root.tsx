import type { ReactNode } from 'react'
import { createRootRoute, HeadContent, Link, Scripts } from '@tanstack/react-router'
import { Seal } from '~/components/seal'
import { themeScript } from '~/lib/theme'
import stylesUrl from '~/styles.css?url'

const title = 'JI · A small, extensible TypeScript runtime for LLM agents'
const description =
  'JI (极) keeps the agent core as small as it can be. One hook model, before, after and intercept, takes it as far as you need.'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title },
      { name: 'description', content: description },
      { name: 'theme-color', content: '#19191b', media: '(prefers-color-scheme: dark)' },
      { name: 'theme-color', content: '#f8f5f0', media: '(prefers-color-scheme: light)' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
    ],
    links: [
      { rel: 'stylesheet', href: stylesUrl },
      { rel: 'icon', href: '/seal.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // The theme script sets data-theme on <html> before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* A constant string from ~/lib/theme, never user input. */}
        {/* eslint-disable-next-line react/dom-no-dangerously-set-innerhtml */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-[40rem] content-center gap-6 px-6">
      <Seal size={56} alt="" />
      <h1 className="text-4xl font-extrabold tracking-[-0.03em]">Nothing was carved here.</h1>
      <p className="text-paper-dim">The page you followed does not exist.</p>
      <Link to="/" className="text-paper underline decoration-ink-4 underline-offset-[0.3em] hover:decoration-paper">
        Back to ji.dev
      </Link>
    </main>
  )
}
