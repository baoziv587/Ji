import { model } from './context.ts'
// @snippet
import {
  createAgent, definePlugin, intercept, toolError,
} from '@ji.dev/llm'

const blockShell = definePlugin({
  name: 'block-shell',
  toolCall: intercept(call =>
    call.name === 'shell'
      ? toolError(call, 'Shell access is disabled.')
      : undefined,
  ),
})

const agent = createAgent({ model, plugins: [blockShell] })
