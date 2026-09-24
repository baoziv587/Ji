# JI (极)

**English** · [简体中文](README.zh-CN.md)

> **JI** (*jí*, 极) means *limit*, as in 极限: the core is kept to the smallest set of pieces, and an agent repeats one step until it reaches its result.

> [!WARNING]
> JI is still in development. The API may change, and the packages are not published to npm yet.

A small core for building LLM agents, plus a ready-to-use agent.

Every agent step comes down to three functions: **decide**, **act** and **record**. Everything else, such as shortening long history, retries, spending limits, redirecting the agent and usage stats, is a plugin wrapped around one of them. Recording has no side effects, so a conversation's state is plain JSON that you can save, load and run again.

```ts
import { createAgent, createSession } from '@gaoxiang.ai/llm'

const agent = createAgent({
  model,
  system: 'Be concise.',
  tools: [readFile],
  plugins: [compaction({ model, maxTokens: 100_000 })],
})
const chat = createSession(agent)

const r = chat.send('Summarize the README')
for await (const chunk of r.text) process.stdout.write(chunk)

const { usage, tools } = await r.summary
// plain JSON: createSession(agent, { state }) picks up from here
save(chat.state)
```

## Why JI

- **Four objects:** `Agent`, `Session`, `Run` and `Plugin`. A session has a single method, `send`.
- **Plugins act at fixed points in a step.** Two plugins that use different hooks don't depend on each other's order.
- **Send messages while it runs.** A message can wait until the agent is idle, arrive after the current tool finishes, or stop the current step.
- **Built-in stats.** Streamed text, a record of each step, timing, tokens and cost all come from the run, with no extra plugins.
- **Stopping really stops.** Breaking out of any `for await` also closes the HTTP request.

## Quick start

Requires **Node ≥ 24** (runs `.ts` directly) and **pnpm**.

```bash
pnpm install

# offline: plays back a scripted reply, no API key needed
pnpm demo

# real model; API key read from env
MODEL=anthropic/claude-sonnet-5 pnpm demo
```

Any supported `provider/model` works. More runnable scenarios are in [apps/examples](apps/examples/README.md):

```bash
cd apps/examples
pnpm compaction  # shorten long history
pnpm interject   # send messages while the agent runs
pnpm hooks       # auto-continue, search, backup model, spending limit
```

## Packages

| Package | What it is | When you touch it |
| --- | --- | --- |
| [`@gaoxiang.ai/llm`](packages/llm) | The LLM agent: `createAgent`, `createSession`, `definePlugin`, `tool` | Almost always |
| [`@gaoxiang.ai/kernel`](packages/kernel) | The core, not tied to any model: `unfold`, `extend` and helpers. Has no dependencies. | Only for non-LLM agents or building new layers |
| [`apps/demo`](apps/demo) | Minimal end-to-end example | Starting point |
| [`apps/examples`](apps/examples) | Scenarios and copy-pasteable plugins | When writing your own plugin |

## Documentation

| Read this | To learn |
| --- | --- |
| [Concepts](docs/concepts.md) | How a step works, how the layers fit together, and the rules the design relies on |
| [Sessions & Runs](docs/sessions-and-runs.md) | Streaming, sending messages mid-run, stopping, save/load, stats |
| [Writing Plugins](docs/plugins.md) | Every hook, its execution order, and which hook fits your task |
| [Kernel API](docs/kernel.md) | `unfold`, `extend` and the other core helpers |

## Development

```bash
pnpm test         # vitest
pnpm typecheck    # tsc across all workspaces
pnpm lint         # eslint (@antfu/eslint-config)
```

Source is TypeScript that Node runs directly, with no build step. Code comments are written in Chinese.
