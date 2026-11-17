import { fetchPage, model, search, task, ui } from './context.ts'
// @snippet
import { createAgent, createSession, textOf, tool, Type } from '@ji.dev/llm'

const researcher = createAgent({ model, tools: [search, fetchPage] })

const research = tool({
  name: 'research',
  description: 'Research a question and report the findings.',
  parameters: Type.Object({ question: Type.String() }),
  async *run({ question }, signal) {
    const run = createSession(researcher).send(question)
    signal.addEventListener('abort', () => run.abort())

    for await (const event of run) {
      if (event.type === 'tool_start') yield { step: event.call.name, args: event.call.arguments }
    }
    return textOf(await run.result)
  },
})

const lead = createAgent({ model, tools: [research] })

for await (const event of createSession(lead).send(task)) {
  if (event.type === 'tool_update') ui.progress(event.call.id, event.data)
}
