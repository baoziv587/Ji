// Demo: an agent with a calc tool and a history-trimming plugin.
//   pnpm demo                                    offline: pi-ai's built-in faux provider (streams token by token)
//   MODEL=anthropic/claude-sonnet-4-6 pnpm demo   real: any provider/model pi-ai supports, API key read from env
import type { Plugin } from '@gaoxiang.ai/llm'
import type { Api, KnownProvider, Model } from '@mariozechner/pi-ai'
import process from 'node:process'
import { createAgent, createSession, definePlugin, textOf, tool } from '@gaoxiang.ai/llm'
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  getModels,
  registerFauxProvider,
  Type,
} from '@mariozechner/pi-ai'

const calc = tool({
  name: 'calc',
  description: 'Evaluate an arithmetic expression, e.g. "2*(3+4)".',
  parameters: Type.Object({ expr: Type.String() }),
  run: ({ expr }) => {
    // expr is typed as string, inferred from the schema
    if (!/^[\d\s+\-*/().]+$/.test(expr)) {
      throw new Error(`bad expr: ${expr}`)
    }
    // eslint-disable-next-line no-new-func -- the allowlist regex above limits expr to plain arithmetic
    return String(new Function(`return (${expr})`)())
  },
})

/** Update middleware that keeps the first message and the most recent n - 1. It runs on every Turn. */
function keepLast(n: number): Plugin {
  return definePlugin({
    name: 'keep-last',
    update: (state, turn, next) => {
      const updated = next(state, turn)
      const { messages } = updated
      if (messages.length <= n) {
        return updated
      }

      return { ...updated, messages: [messages[0], ...messages.slice(-(n - 1))] }
    },
  })
}

const agent = createAgent({
  model: pickModel(),
  system: 'Use the calc tool for arithmetic.',
  tools: [calc],
  plugins: [keepLast(20)],
})

const r = createSession(agent).send('Compute 17*23, then add 9 to the result.')

// Read two streams at once: text is printed as it streams, tool results at the end of each step
const printing = (async () => {
  for await (const chunk of r.text) {
    process.stdout.write(chunk)
  }
})()

for await (const { t, turn } of r.turns) {
  if (turn.kind === 'model' && turn.results.length > 0) {
    const results = turn.results.map(
      res => (res.isError ? '✗ ' : '') + res.content.map(c => (c.type === 'text' ? c.text : '')).join(''),
    )
    console.log(`\n  [t=${t}] tools →`, JSON.stringify(results))
  }
}
await printing

const [final, state, summary] = await Promise.all([r.result, r.state, r.summary])
console.log(
  `\n  done: "${textOf(final)}"  (|S| = ${state.messages.length}, ${summary.turns} model turns, ${summary.usage.input + summary.usage.output} tokens)`,
)

function pickModel(): Model<Api> {
  const spec = process.env.MODEL
  if (spec) {
    const i = spec.indexOf('/')
    const [provider, id] = [spec.slice(0, i), spec.slice(i + 1)]
    const m = getModels(provider as KnownProvider).find(m => m.id === id)
    if (!m) {
      throw new Error(`unknown model: ${spec}`)
    }
    return m as Model<Api>
  }

  const faux = registerFauxProvider({ tokensPerSecond: 80 })
  faux.setResponses([
    fauxAssistantMessage([fauxText('Multiply first.'), fauxToolCall('calc', { expr: '17*23' })], {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage([fauxText('Leaving out the argument on purpose.'), fauxToolCall('calc', {})], {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage([fauxText('Now add 9.'), fauxToolCall('calc', { expr: '391+9' })], {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('17*23 = 391, plus 9 is 400.'),
  ])
  return faux.getModel()
}
