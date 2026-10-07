# @ji.dev/plugin-choices

[English](README.md) · **简体中文**

让 agent（AI 助手）在继续之前，先问人。
这个插件支持两件事：

- **提问**：让你决定 agent 接下来做什么。
- **请求批准**：先展示工具准备做的事，等你同意后再执行。

> 包仍在开发中，API 可能变化，尚未发布到 npm。
> 以下示例需要在本仓库的工作区内使用。

## 让模型向你提问

把 `choices` 加到 agent 的插件列表。`terminal()` 负责在终端显示问题。
使用 `terminal()` 时，你的应用需要安装 `@clack/core`、`@clack/prompts` 和 `fast-wrap-ansi`。

```ts
import process from 'node:process'
import { createAgent, createSession } from '@ji.dev/llm'
import { choices } from '@ji.dev/plugin-choices'
import { terminal } from '@ji.dev/plugin-choices/terminal'

const agent = createAgent({
  model: 'deepseek/deepseek-flash',
  plugins: [choices({ answer: terminal() })],
})

const chat = createSession(agent)
const run = chat.send('请先问我想用哪种语言，再写一句问候。')
for await (const text of run.text) process.stdout.write(text)
```

模型会获得一个叫 `ask_user` 的工具。需要你做决定时，它可以用这个工具提问。
问题和选项由模型编写。你可以选一个，也可以在 **Other** 一栏输入自己的答案。
模型收到答案后继续处理任务。加上插件，不代表模型每次都会提问。

| 按键  | 作用                   |
| ----- | ---------------------- |
| ↑ / ↓ | 移到某个选项或 Other。 |
| Enter | 提交单个问题的答案。   |
| Esc   | 关闭问题，不提交答案。 |

按 Esc 后，模型会收到“用户未回答”的消息。它可以再问你想怎么做。
多个问题或多选题的操作见[问题操作](docs/zh-CN/advanced.md#问题操作)。

## 执行命令、修改文件前先问你

用 `approve` 指定哪些调用需要批准。
**preview（预览函数）**会检查准备执行的调用，提供批准问题的标题和详情。

shell 插件提供命令预览。files 插件提供 diff，也就是文件中准备改动的行。

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
  model: 'deepseek/deepseek-flash',
  plugins: [
    shell,
    fileTools,
    choices({ answer: terminal(), approve: [shell.preview, fileTools.preview] }),
  ],
})
```

把 `root` 换成你的项目路径。再按第一个示例创建会话并发送任务。
保留示例中的插件顺序。这样 files 插件才能先准备改动，再交给 choices 请求批准。

模型请求执行 `pnpm test` 时，终端会显示：

```text
│  pnpm test
│
◆  Run command
│  ● Yes
│  ○ No
│  ↑/↓ choose · Enter confirms · Esc dismisses
```

**问题打开时，这次调用会等待。** 光标默认停在 Yes，但必须按 Enter 才会执行。

| 你的操作           | 结果                                 |
| ------------------ | ------------------------------------ |
| 选 Yes，再按 Enter | 工具执行，模型收到执行结果。         |
| 选 No，再按 Enter  | 工具不执行，模型收到拒绝消息。       |
| 按 Esc             | 工具不执行，模型收到同样的拒绝消息。 |

拒绝消息会告诉模型：先问你想改成怎么做。
拒绝只会阻止这次调用，不会结束整个会话。

这个示例会在执行 shell 命令、修改文件前提问，读取文件时不会提问。
没有预览函数处理的调用会直接执行。不设置 `approve` 时，只启用模型提问。

## 接下来

- [设置批准规则](docs/zh-CN/advanced.md#设置批准规则)：指定工具、直接阻止调用，或关闭文件修改前的提问。
- [自定义问题和回答](docs/zh-CN/advanced.md#在自己的工具里提问)：在工具中提问，或接入其他界面。
- [coding agent 完整示例](../../apps/coding-agent/README.zh-CN.md)：查看[插件组装](../../apps/coding-agent/src/main.ts)、[批准规则](../../apps/coding-agent/src/plugins/permissions.ts)和[提问界面](../../apps/coding-agent/src/ui/questions/answering.ts)。
