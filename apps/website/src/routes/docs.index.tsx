import { createFileRoute } from '@tanstack/react-router'
import { DocArticle } from '~/components/docs/doc-article'
import { loadDoc } from '~/lib/docs'

export const Route = createFileRoute('/docs/')({
  loader: () => loadDoc(''),
  head: () => ({ meta: [{ title: 'JI · Documentation' }] }),
  component: DocsHome,
})

function DocsHome() {
  return <DocArticle doc={Route.useLoaderData()} />
}
