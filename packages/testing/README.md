# @ji.dev/testing

A model that replies as scripted, for tests and offline examples. It is the one place in the repo that knows pi-ai's faux provider: tests, plugins and apps never import pi-ai, so an upgrade of pi-ai reaches `@ji.dev/llm` and this package only.

```ts
import { createAgent, createSession } from '@ji.dev/llm'
import { assistantMessage, createFakeModel, toolUse } from '@ji.dev/testing'

const fake = createFakeModel([
  assistantMessage([toolUse('echo', { text: 'hi' })]), // stops for tool use
  assistantMessage('done'),
])
const run = createSession(createAgent({ model: fake.model, tools: [echo] })).send('go')
await run.result
fake.dispose()
```

A reply can be a function of the request, to assert on what the model was sent or to answer differently each call:

```ts
createFakeModel([
  ({ messages, system, tools, thinking, signal }) =>
    assistantMessage(`saw ${messages.length} messages`),
])
```

|                                                                          |                                                                                              |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `createFakeModel(replies, { id, reasoning, tokensPerSecond, provider })` | the model, `script(...)` to replace the replies to come, `calls()`, `pending()`, `dispose()` |
| `assistantMessage(content, { stopReason, errorMessage })`                | a text, or blocks from `textBlock`, `thinkingBlock` and `toolUse`                            |
| `toolUse(name, args, { id })`                                            | one tool call                                                                                |

The model streams in microtasks; with `tokensPerSecond` it yields between tokens, as a network stream would.
