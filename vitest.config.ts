import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{packages,plugins,apps}/*/src/**/*.test.ts'],
    coverage: {
      include: ['{packages,plugins}/*/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
    },
  },
})
