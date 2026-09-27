# JI 文档

[English](../README.md) · **简体中文** · [项目首页](../../README.zh-CN.md)

第一次使用？从[快速开始](../../README.zh-CN.md#快速开始)运行离线 demo，无需 API key，再接入自己的模型。

## 按任务阅读

| 你想完成的事             | 阅读位置                                               |
| ------------------------ | ------------------------------------------------------ |
| 发消息、显示流式回答     | [发送并读取回答](sessions-and-runs.md#发送并读取回答)  |
| 停止运行、处理错误并恢复 | [取消](sessions-and-runs.md#取消)                      |
| 在 agent 工作时改变方向  | [运行中插话](sessions-and-runs.md#在-agent-工作时插话) |
| 保存对话，下次继续       | [保存与恢复](sessions-and-runs.md#保存与恢复)          |
| 改请求、改结果或提前拦截 | [编写插件](plugins.md)                                 |
| 找到适合需求的钩子与示例 | [该用哪个钩子](plugins.md#该用哪个钩子)                |
| 理解一次运行如何推进     | [核心概念](concepts.md)                                |
| 实现自己的 agent 循环    | [内核 API](kernel.md)                                  |

## 一条学习路径

[会话与运行](sessions-and-runs.md) → [编写插件](plugins.md) → [核心概念](concepts.md)。只有需要自定义底层循环时才阅读内核 API。

会话页解决「怎么使用」，插件页解决「怎么扩展」，概念页解释「为什么这样运行」。每页都可以独立查阅，不必按顺序读完。

## 运行示例

[示例说明](../../apps/examples/README.md)包含聊天 REPL、上下文压缩、运行中插话和插件示例。[插件源码](../../apps/examples/src/plugins)可以复制到自己的项目中调整；[`plugins/`](../../plugins) 提供可复用的 workspace 包，目前尚未发布到 npm。
