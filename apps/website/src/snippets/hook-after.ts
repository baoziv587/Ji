import { after, definePlugin } from '@ji.dev/llm'

const trimOutput = definePlugin({
  name: 'trim-output',
  toolCall: after(result => ({
    ...result,
    content: result.content.map(part =>
      part.type === 'text' ? { ...part, text: part.text.slice(0, 2_000) } : part,
    ),
  })),
})
