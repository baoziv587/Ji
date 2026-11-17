import { createAgent, createSession } from '@ji.dev/llm'

const agent = createAgent({
  model: 'anthropic/claude-sonnet-5-5',
})
const run = createSession(agent).send('Hi! Who are you?')

for await (const text of run.text) {
  process.stdout.write(text)
}
