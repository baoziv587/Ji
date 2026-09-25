import type { Plugin } from '@gaoxiang.ai/llm'
import { after, definePlugin } from '@gaoxiang.ai/llm'

export interface TruncateOptions {
  /** 每段文本最多保留多少字符 */
  maxChars?: number
}

/**
 * 剔除体积过大的工具结果：超过 maxChars 的文本保留开头和结尾，中间换成一行说明。
 *
 * 只改工具的输出，所以用 after。原始长度记在 result.details.truncated 里：
 * details 只保存在历史中，不会发给模型，可以给 UI 或日志用。
 */
export function truncateToolResults({ maxChars = 8_000 }: TruncateOptions = {}): Plugin {
  return definePlugin({
    name: 'truncate-tool-results',

    tool: after(result => {
      const originalChars = result.content.reduce((n, c) => n + (c.type === 'text' ? c.text.length : 0), 0)
      if (originalChars <= maxChars) {
        return result
      }

      return {
        ...result,
        content: result.content.map(c => (c.type === 'text' ? { ...c, text: truncate(c.text, maxChars) } : c)),
        details: { ...result.details, truncated: { originalChars } },
      }
    }),
  })
}

/** 保留开头约 70% 和结尾约 20%：开头通常有结构信息，结尾通常有汇总或错误 */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }

  const head = text.slice(0, Math.floor(maxChars * 0.7))
  const tail = text.slice(-Math.floor(maxChars * 0.2))
  const omitted = text.length - head.length - tail.length
  return `${head}\n\n[... ${omitted} characters omitted ...]\n\n${tail}`
}
