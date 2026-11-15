import { createFileRoute } from '@tanstack/react-router'
import { DocArticle } from '~/components/docs/doc-article'
import { loadDoc } from '~/lib/docs'

export const Route = createFileRoute('/docs/$slug')({
  loader: ({ params }) => loadDoc(params.slug),
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.title ?? 'Docs'} · JI docs` }] }),
  component: DocPage,
})

function DocPage() {
  return <DocArticle doc={Route.useLoaderData()} />
}
