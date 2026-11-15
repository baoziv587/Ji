# Concepts

**English** · [简体中文](zh-CN/concepts.md) · [Documentation index](README.md)

How JI works, in plain terms. You don't need this to send your first message. It helps when you want to know why a run behaves the way it does, or before you write a plugin.

<br>

## Four objects

| Object  | What it is                                                                     | Created with           |
| ------- | ------------------------------------------------------------------------------ | ---------------------- |
| Agent   | The setup: which model, which tools, which plugins. Make it once, reuse it.    | `createAgent(...)`     |
| Session | One conversation. It keeps the history and any messages waiting to be sent.    | `createSession(agent)` |
| Run     | The work done for one message, until the agent has answered. You read it live. | `chat.send(...)`       |
| Plugin  | Your own code, called at fixed points while the agent works.                   | `definePlugin(...)`    |

```ts
const agent = createAgent({ model, tools: [calculator] }) // Agent
const chat = createSession(agent) // Session
const r = chat.send('What is 17 × 23?') // Run
console.log(await r.result)
```

<br>

## Follow one message

An agent works in **steps**. Here is what happens to the message above:

1. **Your message is added** to the history.
2. **The model asks for a tool.** It wants the calculator. JI runs it, the tool returns `391`, and both the request and the result are added to the history.
3. **The model answers.** It reads `391` and replies without asking for a tool, so the answer is added to the history.
4. **The run ends.** The model has answered and no message is waiting, so there is nothing left to do.

Each step does one of two things, then saves what happened:

```text
messages waiting?   yes → add them to the history
                    no  → ask the model, then run the tools it asked for
save the step to the history, then start the next step
stop once the model answers without asking for a tool
```

A run can take one step or many. The model decides which tools to call and when it is done. `maxSteps` caps the number of steps, so a run can never loop forever ([Limits](sessions-and-runs.md#limits)).

<br>

## Talking to a busy agent

You can send another message while a run is still working. It joins the same run instead of starting a new one. You choose when it is delivered: after the answer, after the current step, or right away, cancelling the step in progress ([Interjecting](sessions-and-runs.md#interjecting-while-the-agent-works)).

A cancelled step is thrown away. Nothing from it reaches the history, so the conversation never holds half a step.

<br>

## Where plugins fit

A plugin attaches to named points in the loop, called **hooks**. A few examples:

| You want to…                      | Hook       | When it runs                  |
| --------------------------------- | ---------- | ----------------------------- |
| Add retrieved documents to a call | `request`  | Before each call to the model |
| Shorten a long tool result        | `toolCall` | Around each tool call         |
| Summarize a history that got long | `decide`   | At the start of each step     |
| Log or trace everything           | `observe`  | For every event, read-only    |

[Writing Plugins](plugins.md) lists every hook and where it sits in a step.

<br>

## What gets saved

A session's state is plain JSON: the messages, plus whatever each plugin keeps. Save it with `JSON.stringify(chat.state)` and pass it back to `createSession` to continue later ([Save and restore](sessions-and-runs.md#save-and-restore)).

The state only changes when a step completes. If a run fails or is cancelled, you still have the state from the last finished step, and you can continue from there.

<br>

## Going deeper

None of this is needed to build with JI. If you are curious how the loop is put together:

- [The agent loop](plugins.md#the-agent-loop): each step hook by hook, and the kinds of turns it records
- [Kernel API](kernel.md): the three functions every agent is built from, and the layers on top of them
