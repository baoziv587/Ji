import { lowTemperature, model, toolPlugins } from './context.ts'
// @snippet
import { createAgent, createSession } from '@ji.dev/llm'

const agent = createAgent({ model, plugins: [lowTemperature, toolPlugins] })
const chat = createSession(agent)
const run = chat.send('Explain middleware in one sentence.')

for await (const chunk of run.text) process.stdout.write(chunk)

console.log(await run.summary)
