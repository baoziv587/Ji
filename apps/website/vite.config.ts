import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { links } from './src/content/home.ts'
import { docs, listDocs, pathOfDoc } from './vite-plugins/docs.ts'
import { highlight } from './vite-plugins/highlight.ts'

const docsOptions = {
  dir: fileURLToPath(new URL('../../docs', import.meta.url)),
  repo: links.repo,
  // The learning path from docs/README.md: usage, then how a run works, then extension.
  order: ['README', 'sessions-and-runs', 'concepts', 'plugins'],
  // The site is for getting started; the kernel internals stay on GitHub, where links to them lead.
  exclude: ['kernel'],
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    highlight(),
    docs(docsOptions),
    tailwindcss(),
    tanstackStart({
      // Every route is rendered to HTML at build time; dist/client is the whole site,
      // served as plain files (see Dockerfile). Nothing runs on a server.
      prerender: {
        enabled: true,
        crawlLinks: true,
        failOnError: true,
        // Download links point at files in publicDir; crawling them would
        // overwrite the copied originals with re-fetched bytes. Links to a
        // heading (`/docs/plugins#ordering`) are the same page as their path.
        filter: ({ path }) => !/\.\w+$/.test(path) && !path.includes('#'),
      },
      pages: [
        // Listed explicitly so a doc is published even if nothing links to it yet.
        ...listDocs(docsOptions).map(name => ({ path: pathOfDoc(name) })),
        // The static server answers unknown paths with this page (see nginx.conf).
        { path: '/404', prerender: { enabled: true, outputPath: '/404', autoSubfolderIndex: false } },
      ],
    }),
    react(),
  ],
})
