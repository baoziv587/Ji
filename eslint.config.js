import antfu from '@antfu/eslint-config'
import { createSlopConfig } from 'eslint-plugin-slop'

export default antfu(
  {
    type: 'lib',
    typescript: true,
    // oxfmt owns formatting; ESLint only checks code quality
    stylistic: false,
  },
  ...createSlopConfig({
    cwd: import.meta.dirname,
  }),
  {
    // CLIs and examples print straight to the terminal
    files: ['apps/demo/**', 'apps/examples/**', 'packages/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // The demo and examples are scripts run directly by node, so the entry uses top-level await
    files: ['apps/demo/src/**', 'apps/examples/src/**'],
    rules: { 'antfu/no-top-level-await': 'off' },
  },
)
