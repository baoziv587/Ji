# Architecture

**English** · [简体中文](zh-CN/architecture.md)

Built on [`@ji.dev/llm`](../../../packages/llm), drawn with [`@ji.dev/tui`](../../../packages/tui), with tools from [`plugin-files`](../../../plugins/files), [`plugin-shell`](../../../plugins/shell) and [`plugin-choices`](../../../plugins/choices). `src/` holds only the entry, [`main.ts`](../src/main.ts); the rest is in a folder per layer. `agent/` and `plugins/` know nothing of the terminal; `ui/` decides what the conversation shows, and leaves how it is drawn to `@ji.dev/tui`.

| File                                              | What it does                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`agent/`**                                      | **The model and the conversation**                                                                                                                |
| [`agent.ts`](../src/agent/agent.ts)               | Creates the agent: model, thinking level, system prompt, plugins                                                                                  |
| [`conversation.ts`](../src/agent/conversation.ts) | Sending and steering; a reply that does not finish goes back to before it was sent, and gives back its messages                                   |
| **`plugins/`**                                    | **The coding agent's own**                                                                                                                        |
| [`tools.ts`](../src/plugins/tools.ts)             | Two small tools, calc and now                                                                                                                     |
| [`permissions.ts`](../src/plugins/permissions.ts) | Which calls wait for a yes: ask/auto modes, the shortcuts in a question, the commands and folders a yes allowed. Policy only, not how it is shown |
| **`ui/`**                                         | **What the conversation shows**                                                                                                                   |
| [`bars.ts`](../src/ui/bars.ts)                    | What the bars say: the model and its thinking, the usage, the status, the mode, the keys that matter now. Pure functions                          |
| [`usage.ts`](../src/ui/usage.ts)                  | Adds up the session's usage                                                                                                                       |
| [`answering.ts`](../src/ui/answering.ts)          | Puts a question to the person: the approval's title, mode and shortcuts; draws it again when the mode switches                                    |
| [`reply/render.ts`](../src/ui/reply/render.ts)    | Turns a run's events into rows in the two views, and into the status                                                                              |
| [`reply/gutter.ts`](../src/ui/reply/gutter.ts)    | A reply's thinking and text beside the rail: the text as Markdown, the thinking dim, and a line for it in brief once it ends                      |
| [`reply/calls.ts`](../src/ui/reply/calls.ts)      | A call and its result in the two views; a call being written or run, and its last lines of output                                                 |

The screen, Markdown, colors, the input line and cutting text to width are [`@ji.dev/tui`](../../../packages/tui)'s: see its README for its parts.
