# Configure questions and approval

[← Quick start](../README.md) · **English** · [简体中文](zh-CN/advanced.md)

Read this page when you need to change how questions work.
Start with the task you need:

- [Choose which calls need approval](#choose-which-calls-need-approval).
- [Ask from your own tool](#ask-from-your-own-tool).
- [Connect another UI or write a test reply](#provide-your-own-replies).
- [Answer some questions automatically](#combine-answer-functions).
- [Send a question event from another plugin](#ask-without-importing-this-package).

## Choose which calls need approval

`approve` is a list of preview functions. Before a tool call, `choices` tries them in list order.
The first result other than `undefined` decides what happens.

| Preview result              | What happens                                                                  |
| --------------------------- | ----------------------------------------------------------------------------- |
| `undefined`                 | Try the next preview. If all return `undefined`, run the call without asking. |
| `{ title, detail? }`        | Show an approval question. Run the call only after Yes.                       |
| `toolError(call, 'reason')` | Stop the call without asking. Send the error to the model.                    |

`ask_user` skips this list. The plugin does not ask for approval to ask a question.

### Select tools by name

Use `named` when a tool has no preview function. It shows the tool name and arguments.
This configuration asks before calls to a tool named `deploy`:

```ts
import { choices, named } from '@ji.dev/plugin-choices'
import { terminal } from '@ji.dev/plugin-choices/terminal'

const approval = choices({ answer: terminal(), approve: [named('deploy')] })
```

Add `approval` to your agent's plugins. Add your `deploy` tool separately.
Use `approve: [everyCall]` to ask before every tool call except `ask_user`.
Import `everyCall` from `@ji.dev/plugin-choices`.

### Start an approval question on No

Approval questions start on Yes by default. Set `initial: 'no'` when an action needs a deliberate Yes.
A preview can explain the consequence in `detail`:

```ts
import type { Preview } from '@ji.dev/plugin-choices'

const production: Preview = call => {
  if (call.name !== 'deploy' || call.arguments.to !== 'production') return undefined
  return {
    title: 'Deploy to production?',
    detail: 'This will replace the version that your users use.',
    initial: 'no',
  }
}
```

Put this preview before a general rule: `approve: [production, named('deploy')]`.
The production rule handles production calls. The general rule handles other deployment calls.
Only ask when the person needs to make a decision. For changes your app can undo, consider an Undo action.

### Stop asking about file changes

In the [quick start's file example](../README.md#ask-before-commands-and-file-changes), replace the `approve` list with this configuration:

```ts
import type { Preview } from '@ji.dev/plugin-choices'

let auto = false
const fileChanges: Preview = (call, signal) => (auto ? undefined : fileTools.preview(call, signal))

const approval = choices({ answer: terminal(), approve: [fileChanges, shell.preview] })

function setAutoMode(enabled: boolean): void {
  auto = enabled
}
```

Connect `setAutoMode` to a visible control in your app. Show whether the mode is on or off.
With this list, `true` lets file changes run without asking. `false` restores the approval questions.
Shell commands still need approval in either mode.
If you add another file preview later in the list, it can still ask.

### Run exactly the call shown in the preview

A preview can return `call` with `{ title, detail }`.
After Yes, `choices` runs that call instead of the original call.
The files plugin uses this field to keep the approved file content on the call.
If you omit `call`, the original call runs.

## Ask from your own tool

Use `yield* ask(...)` inside an `async *run` function.
This example asks for an output format and returns the chosen value:

```ts
import { createAgent, tool, Type } from '@ji.dev/llm'
import { ask, choices, DISMISSED } from '@ji.dev/plugin-choices'
import { terminal } from '@ji.dev/plugin-choices/terminal'

const chooseFormat = tool({
  name: 'choose_format',
  description: 'Ask the user which output format to use.',
  parameters: Type.Object({}),
  async *run(_, signal) {
    const reply = yield* ask(
      {
        questions: [
          {
            title: 'Which output format should I use?',
            options: [
              { value: 'text', label: 'Plain text' },
              { value: 'json', label: 'JSON' },
            ],
          },
        ],
      },
      signal,
    )
    if (reply === DISMISSED) return 'The user did not choose a format.'
    return `Selected format: ${reply[0][0]}`
  },
})

const agent = createAgent({
  model: 'deepseek/deepseek-flash',
  tools: [chooseFormat],
  plugins: [choices({ answer: terminal() })],
})
```

When the model calls `choose_format`, the tool waits for your answer.
For Plain text, `ask` returns `[['text']]`. For Esc, it returns `DISMISSED`.
Your tool must handle dismissal before it uses the answer.

### Question fields

Each question has a required `title` and `options` list. The other fields are optional.

| Field      | Meaning                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------- |
| `title`    | The decision the person must make. Use a complete question.                                  |
| `options`  | Choices with `{ value, label, hint? }`. `label` is visible text. The reply contains `value`. |
| `detail`   | Information needed for the decision, such as a command or a file diff.                       |
| `multiple` | `true` allows zero or more selections. The default requires exactly one answer.              |
| `other`    | `true` lets the person type an answer. The default allows only listed values.                |
| `initial`  | The option value where the cursor starts. The default is the first option.                   |
| `header`   | A short tab label for this question when there are several questions.                        |

`initial` sets the cursor position. It does not submit an answer or select a checkbox.
The model's `ask_user` tool always allows a typed answer.

### Question controls

`terminal()` uses these controls:

| Situation         | Controls                                                                                |
| ----------------- | --------------------------------------------------------------------------------------- |
| Single choice     | ↑ / ↓ moves the cursor. Enter submits the current option.                               |
| Multiple choices  | ↑ / ↓ moves the cursor. Space selects or clears an option. Enter accepts the selection. |
| Several questions | ← / → switches tabs. Enter saves the current answer and moves forward.                  |
| Send tab          | Review the answers. Press Enter to send them together.                                  |
| Other row         | Type your answer. Press Enter to accept it.                                             |
| Any question      | Esc closes all questions without sending answers.                                       |

For several questions, saving one answer does not send the group.
The Send tab shows missing answers. You must answer all questions before you can send the group.

## Provide your own replies

`answer` is the function that receives questions and returns a reply.
`terminal()` provides this function for a terminal. You can write one for another UI or for tests.

A reply contains one array per question, in question order.
For two questions, `[['text'], ['en']]` means text format for the first and English for the second.

| Return value | Meaning                                                                     |
| ------------ | --------------------------------------------------------------------------- |
| `string[][]` | The chosen option values or allowed typed answers.                          |
| `DISMISSED`  | Close the whole group without answers. For approval, this rejects the call. |
| `undefined`  | Let an outer plugin answer. This does not reject or dismiss the question.   |

For tests that only contain approval questions, this function returns Yes for each question:

```ts
import type { Answer } from '@ji.dev/plugin-choices'

const approveInTests: Answer = ({ questions }) => questions.map(() => ['yes'])
```

Pass it as `answer: approveInTests` in your test's `choices` configuration.
It does not show a prompt. Use it only when the test intends to approve every call.

`ask` checks each reply. It throws `TypeError` for an invalid reply.
Examples include a missing answer, two values for a single choice, or an unlisted value without `other: true`.
Your UI should let the person correct an invalid answer before it sends the reply.

## Combine answer functions

Use `answerer` to handle some questions before they reach another answer function.
It only provides replies. It does not add `ask_user` or approval rules.

This example approves the exact command `pnpm test` automatically. It asks you about other shell commands:

```ts
import { createAgent } from '@ji.dev/llm'
import { answerer, choices } from '@ji.dev/plugin-choices'
import { terminal } from '@ji.dev/plugin-choices/terminal'
import { createLocalExecutor, createShellPlugin } from '@ji.dev/plugin-shell'

const shell = createShellPlugin(createLocalExecutor({ cwd: '/path/to/your/project' }))
const tests = answerer({
  name: 'approve-tests',
  answer: ({ call }) => (call?.name === 'bash' && call.arguments.command === 'pnpm test' ? [['yes']] : undefined),
})

const agent = createAgent({
  model: 'deepseek/deepseek-flash',
  plugins: [shell, choices({ answer: terminal(), approve: [shell.preview] }), tests],
})
```

For replies, later plugins get the question first. Here, `tests` sees the approval question before `terminal()`.
It returns Yes for `pnpm test`. It returns `undefined` for other questions, which then reach the terminal.
Give each `answerer` a distinct name when you use more than one.

While an answer function waits, processing inside that plugin waits too.
If no plugin answers, `ask` waits until the step is cancelled.
Check the plugin order and ensure a function returns a reply for every question you need to handle.

## Ask without importing this package

Another plugin can send an `ask:choices` event without importing `plugin-choices`.
Declare the event in `@ji.dev/llm` with your own `Questions` type:

```ts
declare module '@ji.dev/llm' {
  interface Events {
    'ask:choices': Questions
  }
}
```

Define `Questions` with the question fields above. Then yield an event with `type: 'ask:choices'` and a `questions` array.
The declaration alone does not send a question. A plugin must still provide the reply.
See [RFC-0007 §5](../../../rfcs/007-stream-replies.md) for the event and reply protocol.
