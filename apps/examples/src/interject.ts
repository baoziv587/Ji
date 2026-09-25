// 运行中插话：pnpm --filter @gaoxiang.ai/examples interject
//
//   chat.send(text, { when: 'step' })   steer：下一个步边界插入（等当前工具执行完）
//   chat.send(text)                     follow-up：等 agent 空闲时插入
//   chat.send(text, { when: 'now' })    interrupt：取消当前这一步，马上插入
//
// agent 工作时，这些消息都并入当前的运行，返回的是同一个 Run。
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

/** faux 模型：回答最后一条用户消息 */
function reply(ctx: Context): ReturnType<typeof fauxAssistantMessage> {
  const last = ctx.messages.findLast(m => m.role === 'user')
  return fauxAssistantMessage(`好的：${last?.content}。`)
}

const model = pickModel(
  [
    fauxAssistantMessage([fauxText('先跑一遍测试。'), fauxToolCall('run_tests', { runner: 'jest' })], {
      stopReason: 'toolUse',
    }),
    reply, // 看到 steer「改用 vitest」
    fauxAssistantMessage(`## Changelog\n${Array.from({ length: 40 }, (_, i) => `- 第 ${i + 1} 条修改`).join('\n')}`), // 处理 follow-up「然后更新 changelog」，写到一半被 interrupt
    reply, // 看到 interrupt「停，先列大纲」
  ],
  60,
)

const chat = createSession(createAgent({ model, tools: [runTests] }))
const r = chat.send('修复失败的测试')

// 工具执行期间：steer 等工具执行完就插入；follow-up 等 agent 空闲才插入
setTimeout(() => {
  chat.send('改用 vitest', { when: 'step' })
  chat.send('然后更新 changelog')
}, 100)

// 模型在写 changelog 时：interrupt 取消这一步，被取消的输出不写入状态
const interrupt = setInterval(() => {
  const last = chat.state.messages.at(-1)
  if (last?.role === 'user' && last.content === '然后更新 changelog') {
    clearInterval(interrupt)
    setTimeout(() => chat.send('停，先列大纲', { when: 'now' }), 200)
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
