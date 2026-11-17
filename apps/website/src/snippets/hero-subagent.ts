import { researcher } from './context.ts'
// @snippet
import {
  createSession, textOf, tool, Type,
} from '@ji.dev/llm'

const research = tool({
  name: 'research',
  description: 'Hand a question to the researcher.',
  parameters: Type.Object({ question: Type.String() }),
  async *run({ question }, signal) {
    const run = createSession(researcher).send(question)
    signal.addEventListener('abort', () => run.abort())
    for await (const event of run) {
      if (event.type === 'tool_start') yield event.call.name
    }
    return textOf(await run.result)
  },
})
