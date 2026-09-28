// Fine-grained hooks: pnpm --filter @ji.dev/examples hooks
//
//   input    keep going automatically while the agent is idle but the task is unfinished (keepGoing plugin)
//   request  add retrieval results to this one request without touching the history; switch to a fallback model on
//            error
//   decide   stop once over budget (budget plugin)
//
// The list reads outside in: lowTemperature comes before fallback, so both the first try and the fallback run at
// temperature 0.
import type { AssistantMessage, ModelRequest, Plugin, RequestContext } from '@ji.dev/llm'
import type { Api, Model } from '@mariozechner/pi-ai'
import { before, createAgent, createSession, definePlugin, mapEvents, textOf, user } from '@ji.dev/llm'
import { fauxAssistantMessage, fauxText } from '@mariozechner/pi-ai'
import { budget } from './plugins/budget.ts'
import { keepGoing } from './plugins/keep-going.ts'
import { pickModel, show } from './shared.ts'

/**
 * Only affects the messages this request sends; the history never contains the retrieval results. Requests a plugin
 * makes with ctx.complete (ctx.by is its name) are left alone: a summary does not need the docs.
 */
const retrieval = definePlugin({
  name: 'retrieval',
  request: before((req, { by }) =>
    by === undefined ? { ...req, messages: [user('[docs] The project uses pnpm and vitest.'), ...req.messages] } : req,
  ),
})

/**
 * Retries on the fallback model when a call fails. Only before any output has streamed: after that the user has
 * already seen part of a reply, and a second answer would be appended to it. A cancelled step is never retried.
 */
function fallbackTo(fallback: Model<Api>): Plugin {
  return definePlugin({
    name: 'fallback',
    async *request(req, next, ctx) {
      let streamed = false
      const noteOutput = mapEvents<ModelRequest, AssistantMessage, RequestContext>(e => {
        streamed ||= (e.type === 'text' && e.delta !== '') || e.type === 'tool_call'
        return e
      })

      try {
        return yield* noteOutput(req, next, ctx)
      } catch (error) {
        ctx.signal.throwIfAborted()
        if (streamed) {
          throw error
        }

        console.log(`\n  [request] ${String(error)} → fallback`)
        return yield* next({ ...req, model: fallback })
      }
    },
  })
}

const lowTemperature = definePlugin({
  name: 'low-temperature',
  request: before(req => ({ ...req, options: { ...req.options, temperature: 0 } })),
})

const main = pickModel([
  fauxAssistantMessage([fauxText('')], { stopReason: 'error', errorMessage: 'overloaded' }),
  ctx =>
    fauxAssistantMessage(
      `Step 1 done (the model sees ${ctx.messages.length} messages, including the retrieval results).`,
    ),
  fauxAssistantMessage('Step 2 done. DONE'),
])
const fallback = pickModel([fauxAssistantMessage('Fallback model: read the docs, starting step 1.')])

const agent = createAgent({
  model: main,
  plugins: [
    retrieval,
    lowTemperature,
    fallbackTo(fallback),
    keepGoing({
      isDone: state => state.messages.some(m => m.role === 'assistant' && textOf(m).includes('DONE')),
    }),
    budget({ maxTokens: 100_000 }),
  ],
})

const chat = createSession(agent)
await show(chat.send('Do the task in two steps and say DONE when finished'))
console.log(`\n  history: ${chat.state.messages.length} messages (retrieval results are not in the history)`)
