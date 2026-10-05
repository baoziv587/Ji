# @ji.dev/plugin-choices

**English** · [简体中文](README.zh-CN.md)

Let your agent ask a person before it continues.
Use this plugin for two tasks:

- **Ask a question.** Let the person choose what the agent should do.
- **Ask for approval.** Show a planned tool call and wait for Yes or No.

> This package is in development. The API can change. It is not published to npm yet.
> Use the examples in this repository's workspace.

## Let the model ask a question

Add `choices` to the agent. Use `terminal()` to show questions in the terminal.
`terminal()` needs `@clack/core`, `@clack/prompts`, and `fast-wrap-ansi` installed in your app.

```ts
import process from 'node:process'
import { createAgent, createSession } from '@ji.dev/llm'
import { choices } from '@ji.dev/plugin-choices'
import { terminal } from '@ji.dev/plugin-choices/terminal'

const agent = createAgent({
  model: 'deepseek/deepseek-v4-flash',
  plugins: [choices({ answer: terminal() })],
})

const chat = createSession(agent)
const run = chat.send('Ask me which language to use for a greeting.')
for await (const text of run.text) process.stdout.write(text)
```

The model gets a tool named `ask_user`. It can use this tool when it needs your decision.
The model writes the question and options. You can choose an option or type your own answer under **Other**.
The model then receives your answer and continues. Adding the plugin does not force the model to ask.

| Key   | Action                                 |
| ----- | -------------------------------------- |
| ↑ / ↓ | Move to an option or Other.            |
| Enter | Send the answer for a single question. |
| Esc   | Close the questions without an answer. |

If you press Esc, the model receives a dismissal message. It can ask what you want to do instead.
For several questions or multiple choices, see [question controls](docs/advanced.md#question-controls).

## Ask before commands and file changes

Add `approve` to choose which calls need approval.
A **preview** is a function that checks a planned call. It provides the title and details for the approval question.

The shell plugin provides a command preview. The files plugin provides a diff: the lines that will change.

```ts
import { createAgent } from '@ji.dev/llm'
import { choices } from '@ji.dev/plugin-choices'
import { terminal } from '@ji.dev/plugin-choices/terminal'
import { files, localWorkspace } from '@ji.dev/plugin-files'
import { createLocalExecutor, createShellPlugin } from '@ji.dev/plugin-shell'

const root = '/path/to/your/project'
const shell = createShellPlugin(createLocalExecutor({ cwd: root }))
const fileTools = files(localWorkspace(root))

const agent = createAgent({
  model: 'deepseek/deepseek-v4-flash',
  plugins: [
    shell,
    fileTools,
    choices({ answer: terminal(), approve: [shell.preview, fileTools.preview] }),
  ],
})
```

Replace `root` with your project path. Use this agent in a session, as in the first example.
Keep the plugin order shown above. It lets the files plugin prepare each change before the approval question.

When the model requests `pnpm test`, the terminal shows:

```text
│  pnpm test
│
◆  Run command
│  ● Yes
│  ○ No
│  ↑/↓ choose · Enter confirms · Esc dismisses
```

**The call waits while this question is open.** The cursor starts on Yes, but the call needs Enter to proceed.

| Your action                | Result                                                                |
| -------------------------- | --------------------------------------------------------------------- |
| Choose Yes and press Enter | The tool runs. The model receives its result.                         |
| Choose No and press Enter  | The tool does not run. The model receives a rejection message.        |
| Press Esc                  | The tool does not run. The model receives the same rejection message. |

The rejection message tells the model to ask what you want instead.
A rejection stops this call. It does not end the whole session.

This example asks before shell commands and file changes. It does not ask before file reads.
Calls that no preview handles run without approval. With no `approve` list, only the model's questions are enabled.

## Next steps

- [Approval rules](docs/advanced.md#choose-which-calls-need-approval): select tools, block calls, or stop asking about file changes.
- [Custom questions and replies](docs/advanced.md#ask-from-your-own-tool): ask inside a tool or use another interface.
- [Coding agent example](../../apps/coding-agent): see [setup](../../apps/coding-agent/src/main.ts), [approval rules](../../apps/coding-agent/src/plugins/permissions.ts), and [question UI](../../apps/coding-agent/src/ui/questions/answering.ts).
