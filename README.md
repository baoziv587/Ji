# JI (极)

**English** · [简体中文](README.zh-CN.md)

**A small, extensible TypeScript runtime for LLM agents.**

JI handles model calls, tools and conversation state. Add behavior through plugins; stream answers and read usage from the same Run.

> In development. APIs may change; packages are not published to npm yet.

## Highlights

- **Consistent hooks.** `before` changes input, `after` changes the result, `intercept` returns early. The same helpers wrap `decide`, `request`, `toolCalls` and `toolCall`.
- **Compaction is a plugin.** Summarize older messages with `ctx.complete`, then commit the new history with `rewriteHistory`. Existing request plugins, cancellation and usage tracking still apply. [Implementation →](apps/examples/src/plugins/compaction.ts)
- **Control while running.** Queue messages, steer at the next step or interrupt immediately. Save conversation and plugin state together as JSON.
- **Built-in visibility.** Stream text, inspect each step and read tokens, cost and timing without extra plugins.

**The hook chooses where; the helper chooses how.** Three independent plugins change requests, transform tool results and block calls:

```ts
import { after, before, definePlugin, intercept, toolError } from '@gaoxiang.ai/llm'

const lowTemperature = definePlugin({
  name: 'low-temperature',
  request: before(req => ({ ...req, options: { ...req.options, temperature: 0 } })),
})

const trimOutput = definePlugin({
  name: 'trim-output',
  toolCall: after(result => ({
    ...result,
    content: result.content.map(part => (part.type === 'text' ? { ...part, text: part.text.slice(0, 2_000) } : part)),
  })),
})

const blockShell = definePlugin({
  name: 'block-shell',
  toolCall: intercept(call => (call.name === 'shell' ? toolError(call, 'Shell access is disabled.') : undefined)),
})

const toolPlugins = [trimOutput, blockShell]
```

Reuse plugins individually or group them into array presets. On the same hook, the list wraps outside in; `intercept` returns `undefined` to continue. For retries, sequential execution or custom events, write `(input, next, ctx)` middleware and delegate with `yield* next(input)`.

### Compact context with middleware

The core flow below uses helpers for token estimates, tool-call pairing and transcript formatting from the [full implementation](apps/examples/src/plugins/compaction.ts).

```ts
import { definePlugin, rewriteHistory, textOf, user } from '@gaoxiang.ai/llm'

const compactHistory = definePlugin({
  name: 'compaction',
  async *decide(state, next, { complete }) {
    const { messages } = state
    const cut = cutIndex(messages, 6)
    if (estimateTokens(messages) <= 100_000 || cut < 2) return yield* next(state)

    const summary = yield* complete({
      systemPrompt: 'Summarize facts, decisions, open tasks and important tool results.',
      messages: [user(transcript(messages.slice(0, cut)))],
    })
    return rewriteHistory([user(textOf(summary)), ...messages.slice(cut)])
  },
})
```

Add it to `plugins`. The summary call reuses request plugins, cancellation and usage tracking; `record` commits the new history.

### Stream progress from tools

A tool’s `yield` becomes a `tool_update`; its `return` is the final result sent to the model:

```ts
import { createAgent, createSession, tool, Type } from '@gaoxiang.ai/llm'

const checkUrls = tool({
  name: 'check_urls',
  description: 'Check HTTP status codes for a list of URLs.',
  parameters: Type.Object({ urls: Type.Array(Type.String()) }),
  async *run({ urls }, signal) {
    const results = []
    for (const [i, url] of urls.entries()) {
      const response = await fetch(url, { method: 'HEAD', signal })
      results.push({ url, status: response.status })
      yield { done: i + 1, total: urls.length, url, status: response.status }
    }
    return JSON.stringify(results)
  },
})

const checking = createSession(createAgent({ model, tools: [checkUrls] }))
for await (const event of checking.send('Check https://example.com')) {
  if (event.type === 'tool_update') console.log(event.call.name, event.data)
}
```

The same stream carries text and tool start/end events. Add [throttleUpdates](plugins/throttle-updates/src/index.ts) to reduce progress update frequency.

More capabilities, built with the same hooks:

| Capability       | Examples                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Manage context   | [Compaction](apps/examples/src/plugins/compaction.ts), [shorter tool results](apps/examples/src/plugins/truncate-tool-results.ts)   |
| Keep work moving | [Auto-continue](apps/examples/src/plugins/keep-going.ts), [retrieval and fallback](apps/examples/src/hooks.ts)                      |
| Control tools    | [Sequential execution](apps/examples/src/plugins/sequential-tools.ts), [progress throttling](plugins/throttle-updates/src/index.ts) |
| Export events    | [OpenTelemetry](plugins/otel/src/index.ts), [JSONL](plugins/jsonl/src/index.ts)                                                     |

## Quick start

Requires **Node ≥ 24** and **pnpm**. From the repository root:

```bash
pnpm install
pnpm demo
```

The demo runs offline with a calculator; no API key is needed. For a real model, set your provider's API key and run `MODEL=provider/model pnpm demo`, replacing `provider/model` with a supported model.

Application code, with your selected `model` and plugins:

```ts
import { createAgent, createSession } from '@gaoxiang.ai/llm'

const agent = createAgent({ model, plugins: [lowTemperature, toolPlugins] })
const chat = createSession(agent)
const run = chat.send('Explain middleware in one sentence.')

for await (const chunk of run.text) process.stdout.write(chunk)
console.log(await run.summary)
```

Find more offline scenarios in [apps/examples](apps/examples/README.md).

## Documentation

[Sessions & Runs](docs/sessions-and-runs.md) · [Writing Plugins](docs/plugins.md) · [Concepts](docs/concepts.md) · [Kernel API](docs/kernel.md) · [Runnable examples](apps/examples/README.md)

Use [`@gaoxiang.ai/llm`](packages/llm) for LLM agents, or the dependency-free [`@gaoxiang.ai/kernel`](packages/kernel) for your own decide → act → record loop.

## Development

```bash
pnpm test
pnpm typecheck
pnpm lint
```
