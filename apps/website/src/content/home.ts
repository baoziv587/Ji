const repo = 'https://github.com/baoziv587/Ji'
const blob = (path: string) => `${repo}/blob/main/${path}`
const tree = (path: string) => `${repo}/tree/main/${path}`

export const links = {
  repo,
  compaction: blob('apps/examples/src/plugins/compaction.ts'),
  throttle: blob('plugins/throttle-updates/src/index.ts'),
  codingAgent: tree('apps/coding-agent'),
  examples: tree('apps/examples'),
}

export interface Note {
  /** 1-based line in the snippet the note sits beside. */
  readonly line: number
  readonly text: string
}

export const agentNotes: readonly Note[] = [
  { line: 3, text: 'Plugins are plain values. Lists nest, so presets are just arrays.' },
  { line: 5, text: 'send returns a run immediately.' },
  { line: 7, text: 'Stream text as it arrives…' },
  { line: 9, text: '…and await the summary when the run settles.' },
]

export type HookId = 'before' | 'after' | 'intercept'

export const hooks: readonly { id: HookId; effect: string; detail: string }[] = [
  {
    id: 'before',
    effect: 'changes input',
    detail: 'Rewrite what goes in. Here every request is pinned to temperature 0.',
  },
  {
    id: 'after',
    effect: 'changes results',
    detail: 'Rewrite what comes out. Here long tool output is cut to 2,000 characters.',
  },
  {
    id: 'intercept',
    effect: 'returns early',
    detail: 'Answer without calling through. Return undefined to continue; here shell calls fail before they run.',
  },
]

export const compactionNotes: readonly Note[] = [
  { line: 3, text: 'decide is middleware: take the state, call next to continue.' },
  { line: 7, text: 'Under budget, step aside.' },
  { line: 9, text: 'complete runs through your request plugins, so temperature and fallback still apply.' },
  { line: 14, text: 'rewriteHistory replaces the transcript; record commits it.' },
]

export const progressNotes: readonly Note[] = [
  { line: 5, text: 'The tool is an async generator.' },
  { line: 11, text: 'yield reports progress while the tool works.' },
  { line: 14, text: 'return delivers the final result.' },
  { line: 19, text: 'Progress arrives in the run as tool_update events.' },
]

export const capabilities: readonly { area: string; items: readonly { label: string; href: string }[] }[] = [
  {
    area: 'Manage context',
    items: [
      { label: 'Compaction', href: links.compaction },
      {
        label: 'Shorter tool results',
        href: blob('apps/examples/src/plugins/truncate-tool-results.ts'),
      },
    ],
  },
  {
    area: 'Keep work moving',
    items: [
      {
        label: 'Auto-continue',
        href: blob('apps/examples/src/plugins/keep-going.ts'),
      },
      {
        label: 'Retrieval and fallback',
        href: blob('apps/examples/src/hooks.ts'),
      },
    ],
  },
  {
    area: 'Control tools',
    items: [
      {
        label: 'Sequential execution',
        href: blob('apps/examples/src/plugins/sequential-tools.ts'),
      },
      { label: 'Progress throttling', href: links.throttle },
      {
        label: 'Approval before a call',
        href: blob('plugins/choices/README.md'),
      },
    ],
  },
  {
    area: 'Export events',
    items: [
      {
        label: 'OpenTelemetry',
        href: blob('plugins/otel/src/index.ts'),
      },
      {
        label: 'JSONL',
        href: blob('plugins/jsonl/src/index.ts'),
      },
    ],
  },
]

export const packages: readonly { name: string; role: string; href: string }[] = [
  {
    name: '@ji.dev/llm',
    role: 'Agents, sessions, plugins.',
    href: tree('packages/llm'),
  },
  {
    name: '@ji.dev/kernel',
    role: 'The dependency-free decide → act → record loop.',
    href: tree('packages/kernel'),
  },
  {
    name: '@ji.dev/testing',
    role: 'A scripted model for testing agents and plugins.',
    href: tree('packages/testing'),
  },
]

/** Footer shortcuts into the docs pages, which the site renders from docs/*.md. */
export const docs: readonly { label: string; slug: string }[] = [
  { label: 'Sessions & Runs', slug: 'sessions-and-runs' },
  { label: 'Concepts', slug: 'concepts' },
  { label: 'Writing Plugins', slug: 'plugins' },
]
