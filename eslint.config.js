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
    files: ['apps/replay/**', 'apps/demo/**', 'apps/examples/**', 'packages/**', 'plugins/**'],
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
            { group: ['@ji.dev/plugin-*', '**/plugins/**'], message: 'packages/ must not depend on plugins/.' },
          ],
        },
      ],
    },
  },
  {
    // src/ holds source only; tests live in each workspace's tests/
    files: ['{packages,plugins,apps}/*/src/**/*.{test,spec}.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'Program', message: 'Move test files out of src/ into <workspace>/tests/.' },
      ],
    },
  },
  {
    files: ['plugins/**'],
    ignores: ['plugins/*/tests/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ji.dev/plugin-*'],
              message: 'Plugins do not import each other; depend on the event protocol instead (RFC-0005 §8.3).',
            },
            {
              group: ['@ji.dev/llm/*', '@ji.dev/kernel', '@ji.dev/kernel/*', '@mariozechner/pi-ai', '**/packages/**'],
              message: 'Plugins use only the public entry of @ji.dev/llm.',
            },
          ],
        },
      ],
    },
  },
  {
    // The edit core is pure and import-free, like the kernel (rfcs/tools/edit-tool-algebra.md §4)
    files: ['plugins/files/src/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '^(?!\\./)', message: 'The edit core imports only its own modules.' }] },
      ],
    },
  },
  {
    // RFC-0005 promise 9: the REPL needs nothing from pi-ai directly
    files: ['apps/repl/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: '@mariozechner/pi-ai', message: 'Import it from @ji.dev/llm.' }] },
      ],
    },
  },
  {
    // The demo, examples, REPL and replay CLI are scripts run directly by node, so the entry uses top-level await
    files: ['apps/replay/src/cli.ts', 'apps/demo/src/**', 'apps/examples/src/**', 'apps/repl/src/repl.ts'],
    rules: { 'antfu/no-top-level-await': 'off' },
  },
)
