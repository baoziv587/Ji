---
name: codex-computer-use-verify
description: 通过 Codex 桌面版的 app-server 控制 socket，把真机 GUI 验证交给 Codex：它用 Computer Use 操作打包好的原生应用（看窗口、点按钮、按键、截图），逐步汇报 PASS/FAIL。用于需要在真实电脑上验证桌面应用（如 apps/desktop 的 Ji Agent），而当前终端没有屏幕录制或辅助功能权限、离屏截图不够用的时候。
---

# 让 Codex 做 Computer Use 验证

Claude Code 所在的终端截不了真实窗口。Codex 桌面版有 Computer Use，可以通过它的 app-server 把验证任务交给它：只告诉它验证什么、每步期望看到什么，由它自己操作并汇报。

离屏截图（mygo Tester）抓不到的问题，真机能抓到，比如系统强调色、透明的 toast、文字被过度截断、真实服务端的数据缺失。所以两者都要做。

## 快速开始

```sh
S=<scratchpad>   # 报告、prompt、日志都放在这里
node .agents/skills/codex-computer-use-verify/scripts/codex-verify.mjs $S/prompt.txt \
  --app "Ji Agent,dev.ji.agent" --out $S/report.txt > $S/run.log 2>&1
tail -c 4000 $S/run.log   # 最后一条 [agent] 就是汇总表
```

- Bash 调用要设 `timeout: 420000`。脚本默认 6 分钟超时，`--minutes` 可以改。
- 需要 Codex 桌面版正在运行，socket 在 `~/.codex/app-server-control/app-server-control.sock`。
- 用户确认 Codex 已打开、并同意操作该应用以后，再发任务。

## 流程

1. **准备被测应用**
   - Codex 只认打包好的 `.app`，它按应用名或 bundle id 找窗口。mygo 用 `go tool mygo build` 打包。
   - 先 `pgrep -fl "<应用名>"`。如果有旧实例，请用户退出，或者由你结束你自己启动的那个。否则新进程会立即退出，验到的其实是旧版本。
   - 从 shell 直接运行包里的可执行文件（`".../X.app/Contents/MacOS/X" &`），这样才能继承 API key 等环境变量。用 `open` 启动拿不到这些变量。
   - 数据目录指向临时位置，不要碰用户的真实数据。例如 `JI_AGENT_SESSIONS=$S/sessions JI_AGENT_ROOT=$S/project`。
   - 用 `defaults read -g AppleInterfaceStyle` 确认系统外观，写进 prompt，免得 Codex 把深色当成 FAIL。
2. **写 prompt**：用中文写成编号步骤，每步说清楚怎么操作、期望看到什么。模板见 [references/prompt.md](references/prompt.md)。
3. **运行脚本，读汇总。** 遇到 FAIL 先判断：是代码问题，还是期望写错了（比如应用本来的行为就和期望不同）。
4. **修复，然后复查。** 修完重新打包、重启应用。第二轮 prompt 只写失败项和受影响的步骤，不要整套重跑。
5. **告诉用户**：哪些步骤通过、修了什么、哪些步骤没能验证。验证用的实例如果还开着，说明它连的是临时数据，提醒用户先退出再正常使用。

## 安全边界

脚本已经内置这些规则，不要放宽：

- 线程设成 `sandbox: 'read-only'`、`approvalPolicy: 'on-request'`。用户全局配置是 `approval_policy = "never"`，不改线程策略的话，Computer Use 会直接报 "not approved"。
- 只批准参数里点名 `--app` 的 `mcpServer/elicitation/request`，其它请求（shell 命令、其它应用）一律拒绝。"完全访问加自动批准一切"会被安全策略拦下，也不应该这么做。
- prompt 里写明：只操作目标应用，不运行 shell，不改文件，不发真实消息，不提交凭据（登录走到填 key 那一步就 Dismiss），不点退出类命令。

## 常见问题

| 现象                                     | 原因                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `Computer Use was not approved to use X` | 线程没设成 on-request，或者 `--app` 没写对应用名或 bundle id                         |
| 验到的是旧界面                           | 旧实例还在，新进程启动后立即退出了                                                   |
| 模型报缺 key                             | 应用是用 `open` 启动的，没从 shell 继承环境变量                                      |
| 日志里全是 base64                        | 用的是旧脚本。新脚本只记录文字，截图会过滤掉                                         |
| Codex 报某项"未验证"                     | 前置条件没满足（比如第一个 provider 不需要填 key）。复查时在 prompt 里指定具体的选项 |
