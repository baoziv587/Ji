// Trimming oversized tool results: pnpm --filter @ji.dev/examples truncate
//
// fetch_page returns a 50,000-character page; truncateToolResults cuts it to 2,000 characters before the model sees it.
import { createAgent, createSession, tool, Type } from '@ji.dev/llm'
import { assistantMessage, textBlock, toolUse } from '@ji.dev/testing'
import { truncateToolResults } from './plugins/truncate-tool-results.ts'
import { pickModel, show } from './shared.ts'

const fetchPage = tool({
  name: 'fetch_page',
  description: 'Fetch a web page and return its text.',
  parameters: Type.Object({ url: Type.String() }),
  run: ({ url }) => `<title>${url}</title>\n${'lorem ipsum '.repeat(4_000)}\n<footer>© 2026</footer>`,
})

const model = pickModel([
  assistantMessage([textBlock('Fetching the page.'), toolUse('fetch_page', { url: 'https://example.com' })]),
  ({ messages }) => {
    const result = messages.at(-1)
    const size = result?.role === 'toolResult' ? JSON.stringify(result.content).length : 0
    return assistantMessage(`The page content I received is about ${size} characters.`)
  },
])

const agent = createAgent({
  model,
  tools: [fetchPage],
  plugins: [truncateToolResults({ maxChars: 2_000 })],
})

const r = createSession(agent).send('What does example.com say?')
await show(r)

// The original length lives in details, which is never sent to the model
for (const m of (await r.state).messages) {
  if (m.role === 'toolResult') {
    console.log(`  ${m.toolName} details: ${JSON.stringify(m.details)}`)
  }
}
