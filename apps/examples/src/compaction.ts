import { createAgent, createSession, tool } from '@gaoxiang.ai/llm'
// 上下文压缩：pnpm --filter @gaoxiang.ai/examples compaction
//
// agent 连续读两个大文件，上下文超过 maxTokens 后，compaction 插件先让模型写摘要，
// 再用「摘要 + 最近的消息」替换历史，然后继续工作。
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
  fauxAssistantMessage([fauxText('先看 a.ts。'), fauxToolCall('read_file', { path: 'a.ts' })], {
    stopReason: 'toolUse',
  }),
  fauxAssistantMessage([fauxText('再看 b.ts。'), fauxToolCall('read_file', { path: 'b.ts' })], {
    stopReason: 'toolUse',
  }),
  // ↓ 这一条被 compaction 插件用来写摘要
  fauxAssistantMessage('用户想知道 a.ts 和 b.ts 导出了什么；已读 a.ts，两者都导出 value = 42。'),
  ctx => {
    const first = ctx.messages[0]
    const compacted =
      first.role === 'user' && typeof first.content === 'string' && first.content.startsWith(SUMMARY_PREFIX)
    return fauxAssistantMessage(
      compacted ? '（在压缩后的上下文中继续）两个文件都导出 value = 42。' : '两个文件都导出 value = 42。',
    )
  },
])

const agent = createAgent({
  model,
  tools: [readFile],
  plugins: [compaction({ model, maxTokens: 600, keepRecent: 2 })],
})

await show(createSession(agent).send('a.ts 和 b.ts 分别导出了什么？'))
