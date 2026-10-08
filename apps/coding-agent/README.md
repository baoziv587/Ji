# Coding agent

**English** · [简体中文](README.zh-CN.md)

Use natural language in your terminal to read code, edit files, and run tests and commands. Follow the work as it happens, send additional instructions during a reply, or stop it at any time.

Still in development: features and keys may change.

![Coding agent: a reply with highlighted code, usage and execution status at the bottom](docs/screen.webp)

## Get started

You need Node.js 24+, pnpm, and an interactive terminal. Install dependencies in this repository first:

```bash
pnpm install
pnpm coding-agent
```

The default provider is DeepSeek. Enter `/login deepseek` and follow the prompts to save your API key. You can also set `DEEPSEEK_API_KEY` before starting.

Then type a task, for example:

```text
Explain the entry point and main directories of this project.
Fix this failing test and run the relevant tests.
```

Press Enter to send. By default, file reads, edits, and commands wait for approval. The `grep` tool searches file contents without approval.

**The directory you start from is the working directory.** To work on another project, open that directory and run this command, replacing the path with this repository's absolute path:

```bash
node /path/to/pi-rsi/apps/coding-agent/src/main.ts
```

## Supported features

| Feature                              | Current support                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| File access                          | Read text files; create files, replace text, or rewrite files; preview changes as a diff                                 |
| Code search                          | Search with regular expressions or literal text, file filters, and context lines; requires ripgrep (`rg`)                |
| Commands                             | Run Bash commands in the working directory for tests, builds, Git, and other tasks                                       |
| Approvals                            | `ask`, `auto`, and `--yolo`; approval prompts can also allow later operations                                            |
| Additional instructions and stopping | Send instructions during a reply; Ctrl+C stops the current reply                                                         |
| Execution details                    | Stream replies, tool calls, and results; Ctrl+O expands thinking, arguments, and results                                 |
| Models and sign-in                   | Choose a model at startup with `--model provider/id`; use `/login`, `/logout`, or API key environment variables          |
| Thinking levels                      | `/think` switches between levels supported by the current model                                                          |
| Fast mode                            | `/fast` requests the priority service tier for `openai` and `openai-codex`; availability depends on the model and server |
| Skills                               | Load `SKILL.md` files from `~/.agents/skills`, invoke them with `/folder-name`, and reload without restarting            |
| Conversation compaction              | Long conversations compact automatically; `/compact` summarizes earlier conversation manually                            |
| Usage display                        | Context size, input/output tokens, cache hit rate, output speed, and cost calculated from model prices                   |
| Headless                             | Run a single task without an interactive terminal, with stdin, JSONL logs, timeouts, and step limits                     |

Interactive sessions currently have no command to save and resume a conversation. Headless JSONL logs record run events.

## Approve, guide, and stop work

### Choose what needs approval

The default mode is `ask`. The bottom bar shows the current mode and any commands or directories you have allowed.

| Mode     | File tools                                                                              | Commands             |
| -------- | --------------------------------------------------------------------------------------- | -------------------- |
| `ask`    | Approve each read or edit                                                               | Approve each command |
| `auto`   | Reads and edits inside the working directory proceed; outside files still need approval | Approve each command |
| `--yolo` | Proceed directly, including outside files                                               | Proceed directly     |

Press Shift+Tab to switch between `ask` and `auto`. Approval prompts can also stop asking about reads inside the working directory, switch to `auto`, allow all future commands, or allow reads in a specified outside directory.

Switching back to `ask` revokes allowed commands and outside-directory reads. The setting to skip approval for reads inside the working directory stays in effect. Outside-file prompts default to No; Esc dismisses an approval as a refusal. The `grep` search tool bypasses these file approvals, and command approval does not restrict which paths a command can access.

`pnpm coding-agent --yolo` skips operation approvals for the entire session. Shift+Tab cannot leave this mode. Use it in a sandbox or a disposable project copy.

### Send additional instructions

Type your instructions during a reply and press Enter. They appear as queued until the current step finishes and the model receives them.

### Stop or retry

Ctrl+C stops the current reply. The conversation returns to before you sent it, and your original message and additional instructions return to the input for editing and resending. Failed replies also return your messages and prompt you to press Enter to retry.

**Stopping does not undo file changes or command effects.** The notice lists files changed through the file tools. Review your Git diff and restore changes yourself when needed.

## Common controls

| Key or command           | Action                                                                        |
| ------------------------ | ----------------------------------------------------------------------------- |
| Enter                    | Send a message or additional instructions during a reply                      |
| Ctrl+C                   | Stop a reply; while idle, clear input; with empty input, exit                 |
| Esc                      | Dismiss the current question; an approval counts as a refusal                 |
| Shift+Tab                | Switch `ask` / `auto`                                                         |
| Ctrl+O                   | Switch between compact and detailed views                                     |
| Mouse wheel, PgUp / PgDn | Scroll the conversation                                                       |
| `/help`                  | Show keys, commands, current mode, and tools                                  |
| `/think <level>`         | Set thinking; without an argument, list levels supported by the current model |
| `/fast [on\|off]`        | Enable or disable Fast mode; without an argument, toggle it                   |
| `/compact`               | Compact earlier conversation                                                  |
| `/reload-skills`         | Read the Skills directory again                                               |
| `/login <provider>`      | Sign in or save an API key                                                    |
| `/logout <provider>`     | Remove stored credentials                                                     |
| `/exit`                  | Exit                                                                          |

Hold Option to select text with the mouse. On exit, the conversation is printed back to the terminal, followed by a session usage summary.

## Models, sign-in, and Skills

### Choose a model

The default model is `deepseek/deepseek-flash`, with thinking set to `high`. Choose another model at startup:

```bash
pnpm coding-agent --model openai/gpt-5.5
```

Enter `/login openai` to choose ChatGPT sign-in in the browser or API key sign-in. Available methods depend on the provider. An unknown provider lists providers that support login.

Credentials saved by `/login` live in `~/.ji/auth.json`, with owner-only read/write permissions. Interactive and headless runs share this file. `/logout` removes stored credentials; API keys in environment variables remain available.

Interactive startup also accepts `DEEPSEEK_MODEL` and `DEEPSEEK_THINKING`. Use the options listed by the program for available models and thinking levels. Fast mode may increase subscription usage or API cost and does not guarantee a fixed speedup.

### Use Skills

Place a skill at `~/.agents/skills/<folder-name>/SKILL.md`. Enter `/folder-name` to invoke it, optionally followed by task instructions. After adding or editing skills, run `/reload-skills` without restarting.

## Headless: run from scripts

Headless accepts one task and exits when it finishes. **It provides no operation approvals or user questions: file operations and commands execute directly.**

From this repository:

```bash
pnpm --filter @ji.dev/coding-agent headless --root /path/to/project --timeout 120 "Explain the project structure"
```

Or pass the task through stdin:

```bash
printf '%s\n' 'Explain the project structure' | node apps/coding-agent/src/headless.ts --root /path/to/project
```

The answer goes to stdout. Progress, usage summaries, and errors go to stderr. Exit codes: `0` success, `1` run failure, `2` invalid arguments.

| Option                               | Purpose                                                                |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `--model provider/id`                | Choose a model; default `deepseek/deepseek-flash`                      |
| `--thinking <level>`                 | Set thinking; default `high`                                           |
| `--root <directory>`                 | Set the working directory; default the startup directory               |
| `--timeout <seconds>`                | Limit the whole task's runtime                                         |
| `--max-steps <count>`                | Limit execution steps; unlimited by default                            |
| `--log <file>`                       | Append JSONL run events                                                |
| `--skills <directory>`               | Set the Skills directory; default `~/.agents/skills`                   |
| `--quiet`                            | Hide progress; keep the final summary or error                         |
| `--base-url <URL>`                   | Use a custom model endpoint                                            |
| `--like provider/id`                 | Use a model from the same provider as a template for an unlisted model |
| `--cost in,out,cacheRead,cacheWrite` | Set USD prices per million tokens for cost reporting                   |

Headless uses `--model` and `--thinking`; it does not read the interactive entry point's `DEEPSEEK_MODEL` or `DEEPSEEK_THINKING` settings.

For development details, see the [architecture](docs/architecture.md).
