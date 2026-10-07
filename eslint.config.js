import antfu from '@antfu/eslint-config'
import { createSlopConfig } from 'eslint-plugin-slop'

// ESLint's flat config replaces a rule's options block by block instead of merging them, so each block below that
// restricts imports lists every pattern that applies to its files.

/** Dependencies only point down: packages/ <- plugins/ <- apps/ (RFC-0005 §4.3). */
const NO_PLUGINS = { group: ['@ji.dev/plugin-*', '**/plugins/**'], message: 'packages/ must not depend on plugins/.' }

/**
 * pi-ai is reached through two packages only: @ji.dev/llm runs it and @ji.dev/testing fakes it (RFC-0005 promise 9).
 * An upgrade then touches those two and no test, plugin or app.
 */
const NO_PI_AI = {
  group: ['@earendil-works/pi-ai', '@earendil-works/pi-ai/*'],
  message: 'Import types and Type from @ji.dev/llm, and a scripted model from @ji.dev/testing.',
}

/** Where pi-ai is allowed. */
const PI_AI_USERS = ['packages/llm/src/**', 'packages/testing/src/**']

export default antfu(
  {
    type: 'lib',
    typescript: true,
    // oxfmt owns formatting; ESLint only checks code quality
    stylistic: false,
    // eval/ is a Python project with its own linter (ruff); its .venv ships JavaScript of its own
    ignores: ['eval/**'],
  },
  ...createSlopConfig({
    cwd: import.meta.dirname,
  }),
  {
    // CLIs and examples print straight to the terminal
    files: ['apps/replay/**', 'apps/demo/**', 'apps/examples/**', 'packages/**', 'plugins/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.ts'],
    ignores: PI_AI_USERS,
    rules: { 'no-restricted-imports': ['error', { patterns: [NO_PI_AI] }] },
  },
  {
    files: ['packages/**'],
    ignores: PI_AI_USERS,
    rules: { 'no-restricted-imports': ['error', { patterns: [NO_PLUGINS, NO_PI_AI] }] },
  },
  {
    files: PI_AI_USERS,
    rules: { 'no-restricted-imports': ['error', { patterns: [NO_PLUGINS] }] },
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
    // A README's code is an app using the plugins, which may import them all
    ignores: ['plugins/*/tests/**', 'plugins/**/*.md/**'],
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
              group: ['@ji.dev/llm/*', '@ji.dev/kernel', '@ji.dev/kernel/*', '**/packages/**'],
              message: 'Plugins use only the public entry of @ji.dev/llm.',
            },
            NO_PI_AI,
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
    // The shell core is pure and import-free too: it never starts a process (rfcs/tools/bash-grep-algebra.md §4, X1)
    files: ['plugins/shell/src/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '^(?!\\./)', message: 'The shell core imports only its own modules.' }] },
      ],
    },
  },
  {
    // The demo, examples, coding agent and replay CLI are run directly by node, so the entry uses top-level await
    files: ['apps/replay/src/cli.ts', 'apps/demo/src/**', 'apps/examples/src/**', 'apps/coding-agent/src/main.ts'],
    rules: { 'antfu/no-top-level-await': 'off' },
  },
)
