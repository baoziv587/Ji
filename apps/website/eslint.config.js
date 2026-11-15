import antfu from '@antfu/eslint-config'

/**
 * The site has its own config because it is a React app; the root config is for the libraries. Formatting belongs to
 * oxfmt, as in the rest of the repo, so stylistic rules stay off.
 */
export default antfu(
  {
    react: true,
    antislop: true,
    stylistic: false,
    ignores: ['public/**', 'src/routeTree.gen.ts', 'src/snippets/**', '**/*.css'],
  },
  {
    // Route files must export `Route`; shadcn files export variant helpers.
    files: ['src/routes/**/*.tsx', 'src/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
)
