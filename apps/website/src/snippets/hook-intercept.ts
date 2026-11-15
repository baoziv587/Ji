import { definePlugin, intercept, toolError } from '@ji.dev/llm'

const blockShell = definePlugin({
  name: 'block-shell',
  toolCall: intercept(call =>
    call.name === 'shell' ? toolError(call, 'Shell access is disabled.') : undefined,
  ),
})
