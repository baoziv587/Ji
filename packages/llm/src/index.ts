// @pi-rsi/llm —— 用 pi-ai 实例化内核：厂商适配、消息格式、流式折叠全部交给 pi-ai
//
//   S = Message[]              pi-ai 的中立消息，可跨厂商续聊
//   A = AssistantMessage       带 toolCall 的助手回合
//   O = ToolResultMessage[]
//   R = AssistantMessage       最终回答（含 usage / cost / stopReason）
//   D = AssistantMessageEvent  text_delta / toolcall_delta / thinking_delta …
//
//   π 直接对应 pi-ai 的流：  for await (e of stream) → D*，  stream.result() → A + R

import type { Api, AssistantMessage, AssistantMessageEvent, Message, Model, SimpleStreamOptions, Static, Tool, ToolCall, ToolResultMessage, TSchema } from '@mariozechner/pi-ai'
import type { Agent } from '@pi-rsi/kernel'
import {
  streamSimple,
  validateToolCall,
} from '@mariozechner/pi-ai'
import { act, done } from '@pi-rsi/kernel'

/* ── 工具：pi-ai 的 Tool（TypeBox schema）+ 一个 run ────────────── */
/** run 用方法签名（而非函数属性）是有意的：参数双变，AgentTool<具体 schema> 才能放进 AgentTool[] */
// eslint-disable-next-line ts/method-signature-style
export type AgentTool<T extends TSchema = TSchema> = Tool<T> & { run(args: Static<T>): string | Promise<string> }
export const tool = <T extends TSchema>(t: AgentTool<T>): AgentTool<T> => t // 只为让 run 的参数从 schema 推断出类型

/* ── 小工具 ───────────────────────────────────────── */
export const user = (text: string): Message => ({ role: 'user', content: text, timestamp: Date.now() })
export const textOf = (m: AssistantMessage): string => m.content.flatMap(c => (c.type === 'text' ? [c.text] : [])).join('')
export const callsOf = (m: AssistantMessage): ToolCall[] => m.content.filter((c): c is ToolCall => c.type === 'toolCall')

export type LLMAgent = Agent<Message[], AssistantMessage, ToolResultMessage[], AssistantMessage, AssistantMessageEvent>
export type LLMOptions = SimpleStreamOptions & { systemPrompt?: string }

export function llmAgent<TApi extends Api>(model: Model<TApi>, tools: AgentTool[], opts: LLMOptions = {}): LLMAgent {
  const { systemPrompt, ...options } = opts
  const specs: Tool[] = tools.map(({ name, description, parameters }) => ({ name, description, parameters }))
  const byName = new Map(tools.map(t => [t.name, t]))

  return {
    // π：转发 pi-ai 的事件流；消费方 break（generator.return）→ abort 底层请求
    async* policy(messages) {
      const ctl = new AbortController()
      const signal = options.signal ? AbortSignal.any([options.signal, ctl.signal]) : ctl.signal
      const stream = streamSimple(model, { systemPrompt, messages, tools: specs }, { ...options, signal })
      let finished = false
      try {
        yield* stream
        finished = true
      }
      finally {
        if (!finished)
          ctl.abort()
      }
      const msg = await stream.result()
      if (msg.stopReason === 'error' || msg.stopReason === 'aborted')
        throw new Error(`${model.provider}/${model.id} ${msg.stopReason}: ${msg.errorMessage}`)
      return callsOf(msg).length ? act(msg) : done(msg)
    },

    // ε：并行执行；参数先按 schema 校验，失败/异常都变成 isError 观测交还模型
    env: msg =>
      Promise.all(
        callsOf(msg).map(async (call): Promise<ToolResultMessage> => {
          let text: string
          let isError = false
          try {
            const args = validateToolCall(specs, call)
            text = String(await byName.get(call.name)!.run(args))
          }
          catch (e) {
            text = e instanceof Error ? e.message : String(e)
            isError = true
          }
          return { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text }], isError, timestamp: Date.now() }
        }),
      ),

    // δ：只追加
    update: (s, msg, results) => [...s, msg, ...results],
  }
}
