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
    files: ['apps/demo/**', 'apps/examples/**', 'packages/**', 'plugins/**'],
    rules: { 'no-console': 'off' },
  },
  // Dependencies only point down: packages/ <- plugins/ <- apps/ (RFC-0005 §4.3)
  {
    files: ['packages/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@gaoxiang.ai/plugin-*', '**/plugins/**'], message: 'packages/ must not depend on plugins/.' },
          ],
        },
      ],
    },
  },
  {
    files: ['plugins/**'],
    ignores: ['plugins/*/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gaoxiang.ai/plugin-*'],
              message: 'Plugins do not import each other; depend on the event protocol instead (RFC-0005 §8.3).',
            },
            {
              group: [
                '@gaoxiang.ai/llm/*',
                '@gaoxiang.ai/kernel',
                '@gaoxiang.ai/kernel/*',
                '@mariozechner/pi-ai',
                '**/packages/**',
              ],
              message: 'Plugins use only the public entry of @gaoxiang.ai/llm.',
            },
          ],
        },
      ],
    },
  },
  {
    // RFC-0005 promise 9: the REPL needs nothing from pi-ai directly
    files: ['apps/examples/src/repl.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: '@mariozechner/pi-ai', message: 'Import it from @gaoxiang.ai/llm.' }] },
      ],
    },
  },
  {
    // The demo and examples are scripts run directly by node, so the entry uses top-level await
    files: ['apps/demo/src/**', 'apps/examples/src/**'],
    rules: { 'antfu/no-top-level-await': 'off' },
  },
)
