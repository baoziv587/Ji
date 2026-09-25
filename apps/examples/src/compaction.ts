// Context compaction: pnpm --filter @gaoxiang.ai/examples compaction
//
// The agent reads two large files in a row. Once the context exceeds maxTokens, the compaction plugin
// has the model write a summary, replaces the history with "summary + recent messages", and keeps working.
import { createAgent, createSession, tool } from '@gaoxiang.ai/llm'
import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from '@mariozechner/pi-ai'
import { compaction, SUMMARY_PREFIX } from './plugins/compaction.ts'
import { pickModel, show } from './shared.ts'

const readFile = tool({
  name: 'read_file',
  description: 'Read a file from the project.',
  parameters: Type.Object({ path: Type.String() }),
  run: ({ path }) => `// ${path}\n${'export const value = 42\n'.repeat(40)}`,
})

const model = pickModel([
  fauxAssistantMessage([fauxText('Reading a.ts first.'), fauxToolCall('read_file', { path: 'a.ts' })], {
    stopReason: 'toolUse',
  }),
  fauxAssistantMessage([fauxText('Now b.ts.'), fauxToolCall('read_file', { path: 'b.ts' })], {
    stopReason: 'toolUse',
  }),
  // The compaction plugin consumes this one as the summary
  fauxAssistantMessage('The user wants to know what a.ts and b.ts export. a.ts has been read; both export value = 42.'),
  ctx => {
    const first = ctx.messages[0]
    const compacted =
      first.role === 'user' && typeof first.content === 'string' && first.content.startsWith(SUMMARY_PREFIX)
    return fauxAssistantMessage(
      compacted
        ? '(Continuing in the compacted context) Both files export value = 42.'
        : 'Both files export value = 42.',
    )
  },
])

const agent = createAgent({
  model,
  tools: [readFile],
  plugins: [compaction({ model, maxTokens: 600, keepRecent: 2 })],
})

await show(createSession(agent).send('What does each of a.ts and b.ts export?'))
