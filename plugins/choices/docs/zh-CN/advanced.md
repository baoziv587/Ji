# 配置提问和批准规则

[← 返回入门](../../README.zh-CN.md) · [English](../advanced.md) · **简体中文**

需要改变提问方式时，再读这一页。按你要做的事选择：

- [设置批准规则](#设置批准规则)。
- [在自己的工具里提问](#在自己的工具里提问)。
- [接入其他界面，或在测试中回答](#自己提供回答)。
- [自动回答部分问题](#组合多个回答函数)。
- [让其他插件发送问题事件](#不引入本包也能提问)。

## 设置批准规则

`approve` 是一组预览函数。工具执行前，`choices` 按列表顺序调用它们。
遇到第一个不是 `undefined` 的结果，就按这个结果处理。

| 预览函数返回              | 接下来会怎样                                                 |
| ------------------------- | ------------------------------------------------------------ |
| `undefined`               | 继续检查下一个。如果全部返回 `undefined`，直接执行，不提问。 |
| `{ title, detail? }`      | 显示批准问题。只有回答 Yes，才执行。                         |
| `toolError(call, '原因')` | 不提问，直接阻止调用，把错误交给模型。                       |

`ask_user` 不经过这组规则。插件不会为了“能否提问”再问一次。

### 按工具名指定

工具没有自带预览函数时，可以用 `named`。它会展示工具名和参数。
下面的配置会在名为 `deploy` 的工具执行前提问：

```ts
import { choices, named } from '@ji.dev/plugin-choices'
import { terminal } from '@ji.dev/plugin-choices/terminal'

const approval = choices({ answer: terminal(), approve: [named('deploy')] })
```

把 `approval` 加到 agent 的插件列表，再单独添加你自己的 `deploy` 工具。
要在所有工具调用前提问，可改为 `approve: [everyCall]`，但 `ask_user` 除外。
从 `@ji.dev/plugin-choices` 导入 `everyCall` 即可。

### 默认停在 No

批准问题的光标默认停在 Yes。对于需要慎重确认的操作，可设置 `initial: 'no'`。
用 `detail` 说明同意后的影响：

```ts
import type { Preview } from '@ji.dev/plugin-choices'

const production: Preview = call => {
  if (call.name !== 'deploy' || call.arguments.to !== 'production') return undefined
  return {
    title: '部署到生产环境？',
    detail: '这会替换用户正在使用的版本。',
    initial: 'no',
  }
}
```

把这条规则放在通用规则前面：`approve: [production, named('deploy')]`。
第一条处理生产环境部署，第二条处理其他部署。
只有需要用户做决定时才提问。对于应用可以撤销的改动，可以考虑提供“撤销”操作。

### 关闭文件修改前的提问

在[入门的文件示例](../../README.zh-CN.md#执行命令修改文件前先问你)中，用下面的配置替换 `approve` 列表：

```ts
import type { Preview } from '@ji.dev/plugin-choices'

let auto = false
const fileChanges: Preview = (call, signal) => (auto ? undefined : fileTools.preview(call, signal))

const approval = choices({ answer: terminal(), approve: [fileChanges, shell.preview] })

function setAutoMode(enabled: boolean): void {
  auto = enabled
}
```

把 `setAutoMode` 接到界面上可见的控件，并显示当前是开还是关。
在这组规则中，传入 `true` 后，文件修改直接执行；传入 `false` 后，恢复提问。
shell 命令在两种模式下都需要批准。
如果你在列表后面再加一条文件预览规则，它仍然可能提问。

### 确保执行的是预览中的调用

预览函数除了返回 `{ title, detail }`，还可以返回 `call`。
用户同意后，`choices` 会执行这个 `call`，替代原来的调用。
files 插件用这个字段保存用户批准的文件内容。
不提供 `call` 时，就执行原来的调用。

## 在自己的工具里提问

把工具的执行函数写成 `async *run`，在里面使用 `yield* ask(...)`。
下面的工具会询问输出格式，然后返回选中的值：

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
            title: '使用哪种输出格式？',
            options: [
              { value: 'text', label: '纯文本' },
              { value: 'json', label: 'JSON' },
            ],
          },
        ],
      },
      signal,
    )
    if (reply === DISMISSED) return '用户没有选择格式。'
    return `选中的格式：${reply[0][0]}`
  },
})

const agent = createAgent({
  model: 'deepseek/deepseek-v4-flash',
  tools: [chooseFormat],
  plugins: [choices({ answer: terminal() })],
})
```

模型调用 `choose_format` 时，工具会等待你回答。
选“纯文本”时，`ask` 返回 `[['text']]`；按 Esc 时，返回 `DISMISSED`。
工具必须先处理关闭问题的情况，再读取答案。

### 问题字段

每个问题必须有 `title` 和 `options`，其他字段可选。

| 字段       | 含义                                                                             |
| ---------- | -------------------------------------------------------------------------------- |
| `title`    | 用户要做的决定。写成完整的问题。                                                 |
| `options`  | 选项列表，每项是 `{ value, label, hint? }`。界面显示 `label`，回答返回 `value`。 |
| `detail`   | 做决定需要的信息，例如命令或文件 diff。                                          |
| `multiple` | `true` 表示可以选零个或多个。默认必须回答一个。                                  |
| `other`    | `true` 表示可以输入自己的答案。默认只能选列表中的值。                            |
| `initial`  | 光标起始位置对应的选项值。默认停在第一个选项。                                   |
| `header`   | 多个问题一起显示时，这个问题的简短标签。                                         |

`initial` 只设置光标位置，不会提交答案，也不会勾选多选框。
模型的 `ask_user` 工具始终允许输入自己的答案。

### 问题操作

`terminal()` 使用以下按键：

| 场景       | 操作                                               |
| ---------- | -------------------------------------------------- |
| 单选题     | ↑ / ↓ 移动光标，Enter 提交当前选项。               |
| 多选题     | ↑ / ↓ 移动光标，Space 勾选或取消，Enter 确认选择。 |
| 多个问题   | ← / → 切换标签，Enter 保存当前答案并前进。         |
| Send 标签  | 检查所有答案，按 Enter 一起提交。                  |
| Other 一栏 | 输入自己的答案，按 Enter 确认。                    |
| 任意问题   | Esc 关闭所有问题，不提交答案。                     |

有多个问题时，保存一个答案还不会提交整组答案。
Send 标签会显示哪些问题还没回答。全部回答后，才能提交。

## 自己提供回答

`answer` 是接收问题、返回答案的函数。
`terminal()` 提供终端版本。你也可以写一个，用于其他界面或测试。

返回值中，每个问题对应一个数组，顺序与问题相同。
例如 `[['text'], ['en']]` 表示：第一题选文本格式，第二题选英语。

| 返回值       | 含义                                                 |
| ------------ | ---------------------------------------------------- |
| `string[][]` | 每题选中的选项值，或允许输入的文字。                 |
| `DISMISSED`  | 关闭整组问题，不回答。对于批准问题，这表示拒绝调用。 |
| `undefined`  | 交给外层插件回答，不表示拒绝或关闭。                 |

如果测试里只有批准问题，可以用下面的函数为每题返回 Yes：

```ts
import type { Answer } from '@ji.dev/plugin-choices'

const approveInTests: Answer = ({ questions }) => questions.map(() => ['yes'])
```

在测试的 `choices` 配置中，设置 `answer: approveInTests`。
它不会显示问题。只有测试明确需要批准所有调用时，才使用它。

`ask` 会检查回答。不符合要求时，它会抛出 `TypeError`。
例如少答了一题、单选题返回两个值，或未开启 `other: true` 却返回了列表外的值。
你的界面应让用户先修正无效答案，再提交。

## 组合多个回答函数

用 `answerer` 提前处理一部分问题，其余问题再交给另一个回答函数。
它只负责回答，不添加 `ask_user`，也不添加批准规则。

下面的例子会自动批准命令 `pnpm test`。其他 shell 命令仍会问你：

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
  model: 'deepseek/deepseek-v4-flash',
  plugins: [shell, choices({ answer: terminal(), approve: [shell.preview] }), tests],
})
```

回答问题时，列表里靠后的插件先收到问题。这里 `tests` 比 `terminal()` 先收到批准问题。
对于 `pnpm test`，它返回 Yes；对于其他问题，它返回 `undefined`，交给终端回答。
使用多个 `answerer` 时，为每个设置不同的名称。

回答函数等待时，该插件内部的处理也会等待。
如果没有任何插件回答，`ask` 会一直等到当前步骤被取消。
遇到这种情况，检查插件顺序，并确保每个需要处理的问题都有函数返回答案。

## 不引入本包也能提问

其他插件可以发送 `ask:choices` 事件，不必导入 `plugin-choices`。
用自己定义的 `Questions` 类型，在 `@ji.dev/llm` 中声明事件：

```ts
declare module '@ji.dev/llm' {
  interface Events {
    'ask:choices': Questions
  }
}
```

按上面的字段定义 `Questions`。再 yield 一个含 `type: 'ask:choices'` 和 `questions` 数组的事件。
只声明事件不会发出问题，仍然需要插件提供回答。
事件和回答协议见 [RFC-0007 §5](../../../../rfcs/007-stream-replies.md)。
