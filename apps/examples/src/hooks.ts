import type { Plugin } from '@gaoxiang.ai/llm'
// 细粒度钩子：pnpm --filter @gaoxiang.ai/examples hooks
//
//   input    agent 空闲但任务没完成时自动继续（keepGoing 插件）
//   context  给这一次请求加上检索结果，不改历史
//   request  出错时换兜底模型
//   policy   超出预算就结束（budget 插件）
import type { Api, Model } from '@mariozechner/pi-ai'
import { before, createAgent, createSession, definePlugin, textOf, user } from '@gaoxiang.ai/llm'
import { fauxAssistantMessage, fauxText } from '@mariozechner/pi-ai'
import { budget } from './plugins/budget.ts'
import { keepGoing } from './plugins/keep-going.ts'
import { pickModel, show } from './shared.ts'

/** context：把检索结果放在最前面。只影响发给模型的消息，历史里没有它 */
const retrieval = definePlugin({
  name: 'retrieval',
  context: messages => [user('[docs] The project uses pnpm and vitest.'), ...messages],
})

/** request：主模型出错时换兜底模型重试。只在还没有输出内容时重试，否则使用者已经看到了部分输出 */
function fallbackTo(fallback: Model<Api>): Plugin {
  return definePlugin({
    name: 'fallback',
    async* request(req, next) {
      try {
        return yield* next(req)
      }
      catch (error) {
        console.log(`\n  [request] ${String(error)} → fallback`)
        return yield* next({ ...req, model: fallback })
      }
    },
  })
}

/** request：用 before 改请求的一个字段 */
const lowTemperature = definePlugin({
  name: 'low-temperature',
  request: before(req => ({ ...req, options: { ...req.options, temperature: 0 } })),
})

const main = pickModel([
  fauxAssistantMessage([fauxText('')], { stopReason: 'error', errorMessage: 'overloaded' }),
  ctx => fauxAssistantMessage(`第一步完成（模型看到 ${ctx.messages.length} 条消息，含检索结果）。`),
  fauxAssistantMessage('第二步完成。DONE'),
])
const fallback = pickModel([fauxAssistantMessage('兜底模型：已读取文档，开始第一步。')])

const agent = createAgent({
  model: main,
  plugins: [
    retrieval,
    lowTemperature,
    fallbackTo(fallback),
    keepGoing({ isDone: state => state.messages.some(m => m.role === 'assistant' && textOf(m).includes('DONE')) }),
    budget({ maxTokens: 100_000 }),
  ],
})

const chat = createSession(agent)
await show(chat.send('分两步完成任务，完成后说 DONE'))
console.log(`\n  history: ${chat.state.messages.length} messages (retrieval results are not in the history)`)
