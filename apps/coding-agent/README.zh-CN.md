# Coding agent

[English](README.md) · **简体中文**

在终端里用自然语言读代码、修改文件、运行测试和命令。你可以查看执行过程，在回答途中补充要求，或随时停止。

仍在开发中，功能和按键可能变化。

![Coding agent：代码高亮的回答，底部显示用量和执行状态](docs/screen.webp)

## 开始使用

需要 Node.js 24+、pnpm 和交互式终端。先在本仓库安装依赖：

```bash
pnpm install
pnpm coding-agent --model openai-codex/gpt-6.1-sol
```

上面的命令选择 Codex。进入后输入 `/login openai-codex`，按提示在浏览器中用 ChatGPT 登录，即可使用订阅服务，无需 API key。

如果使用 DeepSeek，运行 `pnpm coding-agent`，再输入 `/login deepseek` 保存 API key；也可以在启动前设置 `DEEPSEEK_API_KEY`。

然后直接输入任务，例如：

```text
解释这个项目的入口和主要目录。
修复这个测试失败，并运行相关测试。
```

按 Enter 发送。默认会在读取文件、修改文件或运行命令前请求确认；搜索文件内容的 `grep` 工具不需要确认。

**启动目录就是工作目录。** 在其他项目中使用时，先进入那个项目，再运行以下命令（将路径换成本仓库的绝对路径）：

```bash
node /path/to/pi-rsi/apps/coding-agent/src/main.ts --model openai-codex/gpt-6.1-sol
```

## 当前支持的功能

| 功能           | 当前支持情况                                                                             |
| -------------- | ---------------------------------------------------------------------------------------- |
| 读写文件       | 读取文本文件，创建文件、替换文本或重写文件；修改前可查看差异                             |
| 搜索代码       | 按正则表达式或普通文本搜索，支持文件过滤和上下文行；需要安装 ripgrep（`rg`）             |
| 运行命令       | 在工作目录运行 Bash 命令，可用于测试、构建和 Git 等操作                                  |
| 执行前确认     | 支持 `ask`、`auto` 和 `--yolo`，也可在确认时放行后续同类操作                             |
| 补充要求与停止 | 回答途中发送补充要求；Ctrl+C 停止当前回答                                                |
| 查看过程       | 流式显示回答、工具调用和结果；Ctrl+O 展开思考、参数与结果                                |
| 模型与登录     | 启动时用 `--model provider/id` 选择模型；支持 `/login`、`/logout` 和环境变量中的 API key |
| 思考档位       | `/think` 切换当前模型支持的档位                                                          |
| Fast mode      | `/fast` 为 `openai`、`openai-codex` 请求 priority 服务档位；是否生效取决于模型与服务端   |
| Skills         | 从 `~/.agents/skills` 加载 `SKILL.md`，通过 `/技能目录名` 调用；支持重新加载             |
| 对话压缩       | 长对话自动压缩，也可用 `/compact` 将此前对话整理成摘要                                   |
| 用量显示       | 显示上下文大小、输入输出 token、缓存命中率、输出速度和按模型价格计算的费用               |
| Headless       | 无需交互式终端运行单次任务，支持标准输入、JSONL 日志、超时和步数限制                     |

交互式会话目前没有保存后恢复的命令。Headless 的 JSONL 日志用于记录运行事件。

## 确认、补充要求和停止

### 决定哪些操作需要确认

启动后默认是 `ask`。底栏显示当前模式和已放行的命令或目录。

| 模式     | 文件工具                                 | 命令     |
| -------- | ---------------------------------------- | -------- |
| `ask`    | 每次读取或修改都确认                     | 每次确认 |
| `auto`   | 工作目录内直接读取和修改；目录外仍需确认 | 每次确认 |
| `--yolo` | 直接执行，包括工作目录外                 | 直接执行 |

按 Shift+Tab 切换 `ask` / `auto`。确认时还可以选择：不再询问工作目录内的读取、切到 `auto`、允许后续所有命令，或允许读取指定外部目录。

切回 `ask` 会收回已放行的命令和外部目录读取权限；“不再询问工作目录内的读取”会保留。目录外的文件确认默认选中 No；按 Esc 关闭确认也视为拒绝。搜索工具 `grep` 不经过上述文件确认，命令的确认也不会限制命令本身能访问哪些路径。

`pnpm coding-agent --yolo` 整个会话不再请求操作确认，Shift+Tab 不能退出此模式。适合沙箱或可丢弃的项目副本。

### 回答途中改变要求

在回答进行中输入补充要求并按 Enter。消息会先显示为排队，当前步骤结束后交给模型。

### 停止或重试

Ctrl+C 停止当前回答：对话回到发送前，原消息和补充要求回到输入框，可以编辑后重发。回答失败时也会返回消息，并提示按 Enter 重试。

**停止不会撤销已发生的文件修改或命令效果。** 提示会列出文件工具改过的文件；需要撤销时，请查看 Git 差异并自行恢复。

## 常用操作

| 按键或命令            | 作用                                           |
| --------------------- | ---------------------------------------------- |
| Enter                 | 发送消息；回答过程中发送补充要求               |
| Ctrl+C                | 回答时停止；空闲时清空输入；输入为空时退出     |
| Esc                   | 关闭当前问题；操作确认视为拒绝                 |
| Shift+Tab             | 切换 `ask` / `auto`                            |
| Ctrl+O                | 切换简洁 / 详细视图                            |
| 鼠标滚轮、PgUp / PgDn | 滚动对话                                       |
| `/help`               | 查看按键、命令、当前模式和工具                 |
| `/think <档位>`       | 设置思考档位；不带参数时列出当前模型支持的档位 |
| `/fast [on\|off]`     | 开关 Fast mode；不带参数时切换                 |
| `/compact`            | 压缩此前对话                                   |
| `/reload-skills`      | 重新读取 Skills 目录                           |
| `/login <provider>`   | 登录或保存 API key                             |
| `/logout <provider>`  | 删除本地保存的登录凭据                         |
| `/exit`               | 退出                                           |

鼠标选字需要按住 Option。退出后，对话会打印回终端，并显示本次会话的用量汇总。

## 模型、登录和 Skills

### 选择模型

默认模型是 `deepseek/deepseek-flash`，默认思考档位是 `high`。启动时选择其他模型：

```bash
pnpm coding-agent --model openai/gpt-5.5
```

进入后用 `/login openai` 选择浏览器中的 ChatGPT 登录或 API key 登录。可用方式取决于 provider；输入未知 provider 时会列出支持登录的 provider。

`/login` 保存的凭据位于 `~/.ji/auth.json`，文件权限仅允许本人读写，交互式和 headless 共用。`/logout` 只删除保存的凭据；环境变量中的 API key 仍可使用。

交互式启动还支持 `DEEPSEEK_MODEL` 和 `DEEPSEEK_THINKING`。可用模型与思考档位以程序列出的选项为准。Fast mode 可能增加订阅用量或 API 费用，不保证固定加速比例。

### 使用 Skills

将技能放在 `~/.agents/skills/<技能目录名>/SKILL.md`。启动后输入 `/技能目录名`，也可以在后面附加任务要求。新增或修改技能后运行 `/reload-skills`，无需重启。

## Headless：在脚本中运行

Headless 接收一个任务，完成后退出。**它不提供操作确认或向用户提问，文件和命令会直接执行。**

在本仓库运行：

```bash
pnpm --filter @ji.dev/coding-agent headless --root /path/to/project --timeout 120 "解释项目结构"
```

也可从标准输入传入任务：

```bash
printf '%s\n' '解释项目结构' | node apps/coding-agent/src/headless.ts --root /path/to/project
```

回答写入 stdout；进度、用量汇总和错误写入 stderr。退出码：`0` 成功，`1` 运行失败，`2` 参数错误。

| 参数                                 | 作用                                             |
| ------------------------------------ | ------------------------------------------------ |
| `--model provider/id`                | 选择模型，默认 `deepseek/deepseek-flash`         |
| `--thinking <档位>`                  | 设置思考档位，默认 `high`                        |
| `--root <目录>`                      | 设置工作目录，默认启动目录                       |
| `--timeout <秒>`                     | 限制整个任务的运行时间                           |
| `--max-steps <次数>`                 | 限制执行步数，默认不限制                         |
| `--log <文件>`                       | 追加记录 JSONL 运行事件                          |
| `--skills <目录>`                    | 指定 Skills 目录，默认 `~/.agents/skills`        |
| `--quiet`                            | 隐藏进度，仍输出最终汇总或错误                   |
| `--base-url <URL>`                   | 使用自定义模型服务地址                           |
| `--like provider/id`                 | 为目录中未列出的模型指定同一 provider 的参考模型 |
| `--cost in,out,cacheRead,cacheWrite` | 设置每百万 token 的美元价格，用于费用统计        |

Headless 用 `--model` 和 `--thinking` 配置模型，不读取交互式入口的 `DEEPSEEK_MODEL`、`DEEPSEEK_THINKING`。

开发者可继续阅读[代码结构](docs/zh-CN/architecture.md)。
