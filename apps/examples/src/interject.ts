// Interjecting mid-run: pnpm --filter @gaoxiang.ai/examples interject
//
//   chat.send(text, { when: 'step' })   steer: inserted at the next step boundary (after the running tool finishes)
//   chat.send(text)                     follow-up: inserted once the agent is idle
//   chat.send(text, { when: 'now' })    interrupt: cancels the current step and inserts right away
//
// While the agent is working, all of these join the current run and return the same Run.
import type { Context } from '@mariozechner/pi-ai'
import { setTimeout as sleep } from 'node:timers/promises'
import { createAgent, createSession, tool } from '@gaoxiang.ai/llm'
import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from '@mariozechner/pi-ai'
import { pickModel, show } from './shared.ts'

const runTests = tool({
  name: 'run_tests',
  description: 'Run the test suite.',
  parameters: Type.Object({ runner: Type.String() }),
  run: async ({ runner }, signal) => {
    await sleep(400, undefined, { signal })
    return `${runner}: 12 passed`
  },
})

function reply(ctx: Context): ReturnType<typeof fauxAssistantMessage> {
  const last = ctx.messages.findLast(m => m.role === 'user')
  return fauxAssistantMessage(`OK: ${last?.content}.`)
}

const model = pickModel(
  [
    fauxAssistantMessage([fauxText('Running the tests first.'), fauxToolCall('run_tests', { runner: 'jest' })], {
      stopReason: 'toolUse',
    }),
    reply, // sees the steer "Use vitest instead"
    // handles the follow-up "Then update the changelog"; interrupted halfway through
    fauxAssistantMessage(`## Changelog\n${Array.from({ length: 40 }, (_, i) => `- Change ${i + 1}`).join('\n')}`),
    reply, // sees the interrupt "Stop, outline it first"
  ],
  60,
)

const chat = createSession(createAgent({ model, tools: [runTests] }))
const r = chat.send('Fix the failing tests')

// While the tool runs: the steer lands as soon as the tool finishes; the follow-up waits until the agent is idle
setTimeout(() => {
  chat.send('Use vitest instead', { when: 'step' })
  chat.send('Then update the changelog')
}, 100)

// While the model writes the changelog: interrupt cancels the step, and the cancelled output never reaches the state
const interrupt = setInterval(() => {
  const last = chat.state.messages.at(-1)
  if (last?.role === 'user' && last.content === 'Then update the changelog') {
    clearInterval(interrupt)
    setTimeout(() => chat.send('Stop, outline it first', { when: 'now' }), 200)
  }
}, 20)

await show(r)
clearInterval(interrupt)
console.log(
  '\nfinal history:',
  chat.state.messages.map(
    m =>
      `${m.role}: ${typeof m.content === 'string' ? m.content : m.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('')}`,
  ),
)
