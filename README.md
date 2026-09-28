# JI (极)

_极 (jí) means "the utmost", as in 极简 (minimal to the extreme) and 极限 (the limit): a core kept as small as it can be, taken as far as you need by plugins._

> In development. APIs may change; packages are not published to npm yet.

<br>

**English** · [简体中文](README.zh-CN.md)

**A small, extensible TypeScript runtime for LLM agents.**

```ts
import { createAgent, createSession } from '@ji.dev/llm'

const agent = createAgent({ model, plugins: [lowTemperature, toolPlugins] })
const chat = createSession(agent)
const run = chat.send('Explain middleware in one sentence.')

for await (const chunk of run.text) process.stdout.write(chunk)

console.log(await run.summary)
```

<br>

## Highlights

**One consistent hook API, from small transforms to full middleware. Write plugins independently, then compose them.**

Long-running tools can report progress as they work: `yield` in the tool, receive `tool_update` in the run.

<br>

### One hook model, three ways to intervene

**The hook chooses where; the helper chooses how.**

`before` changes input · `after` changes results · `intercept` returns early. All three work with `decide`, `request`, `toolCalls` and `toolCall`.

```ts
import { after, before, definePlugin, intercept, toolError } from '@ji.dev/llm'

const lowTemperature = definePlugin({
  name: 'low-temperature',
  request: before(req => ({ ...req, options: { ...req.options, temperature: 0 } })),
})

const trimOutput = definePlugin({
  name: 'trim-output',
  toolCall: after(result => ({
    ...result,
    content: result.content.map(part =>
      part.type === 'text' ? { ...part, text: part.text.slice(0, 2_000) } : part,
    ),
  })),
})

const blockShell = definePlugin({
  name: 'block-shell',
  toolCall: intercept(call =>
    call.name === 'shell' ? toolError(call, 'Shell access is disabled.') : undefined,
  ),
})
```

`intercept` returns `undefined` to continue. For retries, sequential execution or custom events, use `(input, next, ctx)` and delegate with `yield* next(input)`.

<br>

### Write independently, compose as needed

Each plugin does one job. Group plugins into reusable presets, then nest them:

```ts
const toolPlugins = [trimOutput, blockShell]
const plugins = [lowTemperature, toolPlugins]
```

Pass them to `createAgent({ model, plugins })`. On the same hook, the list wraps outside in: inputs flow forward, results return in reverse. [Composition order →](docs/plugins.md#ordering)

<br>

### Compact context with middleware

**Complex behavior uses the same middleware model.** Call `complete` inside `decide` to summarize, then use `rewriteHistory` to replace history.

```ts
import { definePlugin, rewriteHistory, textOf, user } from '@ji.dev/llm'

const compactHistory = definePlugin({
  name: 'compaction',
  async *decide(state, next, { complete }) {
    const { messages } = state
    const cut = cutIndex(messages, 6)

    if (estimateTokens(messages) <= 100_000 || cut < 2) return yield* next(state)

    const summary = yield* complete({
      systemPrompt:
        'Summarize facts, decisions, open tasks and important tool results.',
      messages: [user(transcript(messages.slice(0, cut)))],
    })

    return rewriteHistory([user(textOf(summary)), ...messages.slice(cut)])
  },
})
```

The summary call runs through the existing `request` plugins, reusing temperature settings and fallback behavior. `record` commits the new history.

[Full implementation →](apps/examples/src/plugins/compaction.ts) includes the token-estimation, tool-call pairing and transcript helpers used above.

<br>

### Live progress from long-running tools

**Show progress before the tool finishes.**

Write an async generator: `yield` reports progress and `return` delivers the final result, with no separate callback or event channel. For example, check a batch of URLs:

```ts
import { createAgent, createSession, tool, Type } from '@ji.dev/llm'

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
```

Read progress from the run’s event stream:

```ts
const checking = createSession(
  createAgent({ model, tools: [checkUrls], plugins: toolPlugins }),
)

for await (const event of checking.send('Check https://example.com')) {
  if (event.type === 'tool_update') console.log(event.call.name, event.data)
}
```

Compose result trimming, call interception and [progress throttling](plugins/throttle-updates/src/index.ts) around the same tool. `toolCall` middleware wraps its execution stream; `observe` can log events across runs.

<br>

### More capabilities, ready to compose

| Capability       | Examples                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Manage context   | [Compaction](apps/examples/src/plugins/compaction.ts), [shorter tool results](apps/examples/src/plugins/truncate-tool-results.ts)   |
| Keep work moving | [Auto-continue](apps/examples/src/plugins/keep-going.ts), [retrieval and fallback](apps/examples/src/hooks.ts)                      |
| Control tools    | [Sequential execution](apps/examples/src/plugins/sequential-tools.ts), [progress throttling](plugins/throttle-updates/src/index.ts) |
| Export events    | [OpenTelemetry](plugins/otel/src/index.ts), [JSONL](plugins/jsonl/src/index.ts)                                                     |

<br>

## Quick start

Requires **Node ≥ 24** and **pnpm**. From the repository root:

```bash
pnpm install
pnpm demo
```

The demo runs offline with a calculator; no API key is needed.

For a real model, set your provider's API key and run `MODEL=provider/model pnpm demo`, replacing `provider/model` with a supported model.

Queue, steer or interrupt a running agent, and save conversation and plugin state together as JSON. [Sessions & Runs →](docs/sessions-and-runs.md)

Find more offline scenarios in [apps/examples](apps/examples/README.md).

<br>

## Documentation

- [Sessions & Runs](docs/sessions-and-runs.md) — streaming, interjections, cancellation and recovery
- [Writing Plugins](docs/plugins.md) — hooks, ordering and middleware
- [Concepts](docs/concepts.md) · [Kernel API](docs/kernel.md) — the underlying agent loop
- [Runnable examples](apps/examples/README.md) — start from a working scenario

Use [`@ji.dev/llm`](packages/llm) for LLM agents, or the dependency-free [`@ji.dev/kernel`](packages/kernel) for your own decide → act → record loop.

<br>

## Development

```bash
pnpm test
pnpm typecheck
pnpm lint
```
