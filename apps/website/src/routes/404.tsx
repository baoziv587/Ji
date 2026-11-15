import { createFileRoute } from '@tanstack/react-router'
import { NotFound } from '~/components/not-found'

/** Prerendered to /404.html, which the static server returns for unknown paths. */
export const Route = createFileRoute('/404')({
  head: () => ({
    meta: [{ title: 'JI · Not found' }, { name: 'robots', content: 'noindex' }],
  }),
  component: NotFound,
})
