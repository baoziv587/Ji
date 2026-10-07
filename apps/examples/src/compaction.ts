// Context compaction: pnpm --filter @ji.dev/examples compaction
//
// The agent reads two large files in a row. Once the context exceeds maxTokens, the compaction plugin
// has the model write a summary through ctx.complete, replaces the history with "summary + recent messages", and keeps
// working. The summary's own text never reaches r.text; its model events carry by: 'compaction'.
import { createAgent, createSession, tool, Type } from '@ji.dev/llm'
import { assistantMessage, textBlock, toolUse } from '@ji.dev/testing'
import { compaction, SUMMARY_PREFIX } from './plugins/compaction.ts'
import { pickModel, show } from './shared.ts'

const readFile = tool({
  name: 'read_file',
  description: 'Read a file from the project.',
  parameters: Type.Object({ path: Type.String() }),
  run: ({ path }) => `// ${path}\n${'export const value = 42\n'.repeat(40)}`,
})

const model = pickModel([
  assistantMessage([textBlock('Reading a.ts first.'), toolUse('read_file', { path: 'a.ts' })]),
  assistantMessage([textBlock('Now b.ts.'), toolUse('read_file', { path: 'b.ts' })]),
  // The compaction plugin consumes this one as the summary
  assistantMessage('The user wants to know what a.ts and b.ts export. a.ts has been read; both export value = 42.'),
  ({ messages }) => {
    const first = messages[0]
    const compacted =
      first.role === 'user' && typeof first.content === 'string' && first.content.startsWith(SUMMARY_PREFIX)
    return assistantMessage(
      compacted
        ? '(Continuing in the compacted context) Both files export value = 42.'
        : 'Both files export value = 42.',
    )
  },
])

const agent = createAgent({
  model,
  tools: [readFile],
  plugins: [compaction({ maxTokens: 600, keepRecent: 2, timeoutMs: 30_000 })],
})

await show(createSession(agent).send('What does each of a.ts and b.ts export?'))
