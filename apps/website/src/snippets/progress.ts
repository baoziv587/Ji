import { tool, Type } from '@ji.dev/llm'
import { session } from './context.ts'
// @snippet
const checkUrls = tool({
  name: 'check_urls',
  description: 'Check HTTP status codes for a list of URLs.',
  parameters: Type.Object({ urls: Type.Array(Type.String()) }),
  async *run({ urls }, signal) {
    const results = []

    for (const [i, url] of urls.entries()) {
      const response = await fetch(url, { method: 'HEAD', signal })
      results.push({ url, status: response.status })
      yield { done: i + 1, total: urls.length, url, status: response.status }
    }

    return JSON.stringify(results)
  },
})

for await (const event of session.send('Check https://example.com')) {
  if (event.type === 'tool_update') console.log(event.call.name, event.data)
}
