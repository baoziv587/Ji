# JI documentation

**English** · [简体中文](zh-CN/README.md) · [Project home](../README.md)

New to JI? Run the offline demo in the [quick start](../README.md#quick-start), with no API key, then connect your own model.

<br>

## Find your task

| You want to…                                  | Read                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| Send a message and stream the answer          | [Send and read an answer](sessions-and-runs.md#send-and-read-an-answer) |
| Stop, handle errors and recover               | [Cancellation](sessions-and-runs.md#cancellation)                       |
| Redirect an agent while it works              | [Interjecting](sessions-and-runs.md#interjecting-while-the-agent-works) |
| Save a conversation and resume later          | [Save and restore](sessions-and-runs.md#save-and-restore)               |
| Change inputs, results or intercept execution | [Writing Plugins](plugins.md)                                           |
| Find a hook and a working example             | [Which hook?](plugins.md#which-hook)                                    |
| Understand how a run progresses               | [Concepts](concepts.md)                                                 |
| Implement your own agent loop                 | [Kernel API](kernel.md)                                                 |

<br>

## A learning path

[Sessions & Runs](sessions-and-runs.md) → [Writing Plugins](plugins.md) → [Concepts](concepts.md). Read the Kernel API when you need to customize the underlying loop.

Sessions covers usage, plugins covers extension, and concepts explains execution. Each page also works as a reference; you do not need to read them all in order.

<br>

## Runnable examples

The [examples guide](../apps/examples/README.md) (Chinese) includes a chat REPL, compaction, interjections and plugin scenarios. Copy and adapt the [example plugins](../apps/examples/src/plugins), or use the reusable workspace packages in [`plugins/`](../plugins). These packages are not published to npm yet.
