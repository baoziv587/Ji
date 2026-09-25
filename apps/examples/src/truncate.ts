import { createAgent, createSession, tool } from '@gaoxiang.ai/llm'
// 剔除过大的工具结果：pnpm --filter @gaoxiang.ai/examples truncate
//
// fetch_page 返回 50,000 个字符的页面；truncateToolResults 把它截到 2,000 个字符再交给模型。
import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from '@mariozechner/pi-ai'
import { truncateToolResults } from './plugins/truncate-tool-results.ts'
import { pickModel, show } from './shared.ts'

const fetchPage = tool({
  name: 'fetch_page',
  description: 'Fetch a web page and return its text.',
  parameters: Type.Object({ url: Type.String() }),
  run: ({ url }) => `<title>${url}</title>\n${'lorem ipsum '.repeat(4_000)}\n<footer>© 2026</footer>`,
})

const model = pickModel([
  fauxAssistantMessage([fauxText('抓一下这个页面。'), fauxToolCall('fetch_page', { url: 'https://example.com' })], {
    stopReason: 'toolUse',
  }),
  ctx => {
    const result = ctx.messages.at(-1)
    const size = result?.role === 'toolResult' ? JSON.stringify(result.content).length : 0
    return fauxAssistantMessage(`我收到的页面内容约 ${size} 个字符。`)
  },
])

const agent = createAgent({
  model,
  tools: [fetchPage],
  plugins: [truncateToolResults({ maxChars: 2_000 })],
})

const r = createSession(agent).send('example.com 上写了什么？')
await show(r)

// 原始长度记在 details 里，不会发给模型
for (const m of (await r.state).messages) {
  if (m.role === 'toolResult') {
    console.log(`  ${m.toolName} details: ${JSON.stringify(m.details)}`)
  }
}
