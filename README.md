# pi-rsi

**English** · [简体中文](README.zh-CN.md)

A small, algebraic core for LLM agents, plus a ready-to-use agent built on [pi-ai](https://github.com/badlogic/pi-mono/tree/main/packages/ai).

Every agent step comes down to three functions: **decide**, **act** and **record**. Everything else, including compaction, retries, budgets, steering and metrics, is a middleware wrapped around one of them. Because recording is pure, a conversation's state is plain JSON that you can save, restore and replay.

```ts
import { createAgent, createSession } from '@pi-rsi/llm'

const agent = createAgent({ model, system: 'Be concise.', tools: [readFile], plugins: [compaction(...)] })
const chat = createSession(agent)

const r = chat.send('Summarize the README')
for await (const chunk of r.text) process.stdout.write(chunk)

const { usage, tools } = await r.summary
save(chat.state) // plain JSON: createSession(agent, { state }) picks up from here
```

## Why pi-rsi

- **Four objects:** `Agent`, `Session`, `Run` and `Plugin`. A session has a single method, `send`.
- **Plugins act at fixed points in a step.** Two plugins that use different hooks don't depend on each other's order.
- **Interject mid-run.** A message can wait until the agent is idle, arrive after the current tool finishes, or interrupt the current step.
- **Built-in observability.** Text deltas, per-step records, timing, tokens and cost all come from the run, with no extra plugins.
- **Cancellation reaches the network.** Breaking out of any `for await` aborts the underlying HTTP stream.

## Quick start

Requires **Node ≥ 24** (runs `.ts` directly) and **pnpm**.

```bash
pnpm install
pnpm demo                                       # offline: replays a script via pi-ai's faux provider
MODEL=anthropic/claude-sonnet-5 pnpm demo       # real model; API key read from env
```

Every `provider/model` that pi-ai supports works. More runnable scenarios are in [apps/examples](apps/examples/README.md):

```bash
pnpm --filter @pi-rsi/examples compaction   # context compaction
pnpm --filter @pi-rsi/examples interject    # steer / follow-up / interrupt
pnpm --filter @pi-rsi/examples hooks        # auto-continue, retrieval, fallback model, budget
```

## Packages

| Package | What it is | When you touch it |
| --- | --- | --- |
| [`@pi-rsi/llm`](packages/llm) | The LLM agent: `createAgent`, `createSession`, `definePlugin`, `tool` | Almost always |
| [`@pi-rsi/kernel`](packages/kernel) | A model-agnostic core: `unfold`, `extend`, lenses, reducers. Has no dependencies. | Only for non-LLM agents or building new layers |
| [`apps/demo`](apps/demo) | Minimal end-to-end example | Starting point |
| [`apps/examples`](apps/examples) | Scenarios and copy-pasteable plugins | When writing your own plugin |

## Documentation

| Read this | To learn |
| --- | --- |
| [Concepts](docs/concepts.md) | The step model, how the layers fit together, and the invariants the design depends on |
| [Sessions & Runs](docs/sessions-and-runs.md) | Streaming, interjection, cancellation, save/restore, metrics |
| [Writing Plugins](docs/plugins.md) | Every hook, its execution order, and which hook fits your task |
| [Kernel API](docs/kernel.md) | `unfold` / `extend` and type-changing transforms (`withState`, `widen`, ...) |

## Development

```bash
pnpm test         # vitest, includes property-based tests (fast-check)
pnpm typecheck    # tsc across all workspaces
pnpm lint         # eslint (@antfu/eslint-config)
```

Source is TypeScript that Node runs directly, with no build step. Code comments are written in Chinese.

## Status

Experimental. All packages are `0.0.0` and private, and the API may still change.
