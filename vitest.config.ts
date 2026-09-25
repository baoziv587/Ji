import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{packages,apps}/*/src/**/*.test.ts'],
    coverage: {
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
    },
  },
})
