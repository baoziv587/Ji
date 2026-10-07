# Coding agent

[English](README.md) · **简体中文**

> 仍在开发中，行为和按键可能变化。

在终端里和模型一起读代码、改文件、跑命令。动手前先问你；随时可以插话或叫停。

![终端里的 coding agent：带代码高亮的回答，底部是用量和状态](docs/screen.webp)

```bash
export DEEPSEEK_API_KEY=sk-...
pnpm coding-agent
```

需要 Node 24+。**在哪个目录启动，就在哪个目录工作**；要用在别的项目上，在那个项目里运行 `node <本仓库>/apps/coding-agent/src/main.ts`。

## 登录

`/login openai` 在浏览器里用 ChatGPT 登录，Plus 或 Pro 订阅直接可用，不需要 API key；`/login deepseek` 则让你输入 key 并记住它。两者都存在 `~/.ji/auth.json`，只有你本人可读，`/logout <provider>` 忘掉它。用 `pnpm coding-agent --model openai/gpt-5.5` 选模型；headless 读的是同一个文件。

## 安全

- 默认每条命令、每次读写文件都先问你。**Shift+Tab** 切到 auto：工作区内的读写不再问，命令照样问。
- **工作区外的文件无论哪种模式都要问**，默认选中 No。
- 确认时可以选“以后不再问”；放行了什么一直写在底栏，切回 ask 全部收回。
- `pnpm coding-agent --yolo` 整个会话什么都不问，工作区外也不问。只在沙箱或可以丢弃的检出里用。

## 叫停

**Ctrl+C** 停下这次回答：对话回到发送前，你的消息回到输入框。**已经写进磁盘的文件不会撤销**，提示里会列出改过的文件，需要时用 git 恢复。

## 按键

| 按键            | 作用                                         |
| --------------- | -------------------------------------------- |
| Enter           | 发送；回答进行中是插话，当前这一步结束后送达 |
| Ctrl+C          | 叫停回答 / 清空输入框 / 退出                 |
| Esc             | 关掉眼前的问题，确认算 No                    |
| Shift+Tab       | 切换 ask / auto（yolo 下无效）               |
| Ctrl+O          | 详细视图：完整的思考、调用的参数和结果       |
| `/think <档位>` | `off` / `high` / `xhigh`                     |
| `/help`         | 列出按键、命令和工具                         |
| `/exit`         | 退出                                         |

`DEEPSEEK_MODEL`（默认 `deepseek-flash`）和 `DEEPSEEK_THINKING`（默认 `high`）设置模型和思考档位。鼠标滚轮用来滚动，选字要按住 Option；退出后整段对话会打印回终端。

[代码结构 →](docs/zh-CN/architecture.md)
