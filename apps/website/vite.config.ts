import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { highlight } from './vite-plugins/highlight.ts'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    highlight(),
    tailwindcss(),
    tanstackStart({
      // Every route is rendered to HTML at build time; dist/client is the whole site.
      prerender: {
        enabled: true,
        crawlLinks: true,
        failOnError: true,
        // Download links point at files in publicDir; crawling them would
        // overwrite the copied originals with re-fetched bytes.
        filter: ({ path }) => !/\.\w+$/.test(path),
      },
    }),
    react(),
  ],
})
