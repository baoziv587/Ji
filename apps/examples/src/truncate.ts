// 剔除过大的工具结果：pnpm --filter @pi-rsi/examples truncate
//
// fetch_page 返回 50,000 个字符的页面；truncateToolResults 把它截到 2,000 个字符再交给模型。
import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from '@mariozechner/pi-ai'
import { createAgent, stream, tool, user } from '@pi-rsi/llm'
import { truncateToolResults } from './plugins/truncate-tool-results.ts'
import { pickModel, print } from './shared.ts'

const fetchPage = tool({
  name: 'fetch_page',
  description: 'Fetch a web page and return its text.',
  parameters: Type.Object({ url: Type.String() }),
  run: ({ url }) => `<title>${url}</title>\n${'lorem ipsum '.repeat(4_000)}\n<footer>© 2026</footer>`,
})

const model = pickModel([
  fauxAssistantMessage([fauxText('抓一下这个页面。'), fauxToolCall('fetch_page', { url: 'https://example.com' })], { stopReason: 'toolUse' }),
  (ctx) => {
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

for await (const e of stream(agent, [user('example.com 上写了什么？')])) {
  print(e)

  if (e.tag === 'act') {
    for (const r of e.obs) {
      console.log(`  details: ${JSON.stringify(r.details)}`)
    }
  }
}
