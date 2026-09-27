import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{packages,plugins,apps}/*/tests/**/*.test.ts'],
    coverage: {
      include: ['{packages,plugins}/*/src/**/*.ts'],
    },
  },
})
