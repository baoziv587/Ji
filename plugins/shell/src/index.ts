// @ji.dev/plugin-shell: bash and grep as bounded folds over a command's stream (rfcs/tools/bash-grep-algebra.md)
//
//   createAgent({ model, plugins: [createShellPlugin(executor), createSearchPlugin(executor), files(workspace)] })
//
//   CommandExecutor  the one interface, execute: Command → Chunk* · Outcome. createLocalExecutor, createMemoryExecutor;
//                    for writing another: runWithClocks, quoteArgv
//   Fold             what a tool keeps of the stream: createOutputFold (bash), createHitsFold (grep), or your own
//   foldStream       run = foldStream ∘ execute; a full fold closes the stream, and the command stops
//   core             pure functions: the window, ripgrep's arguments and events, what the model reads
//   plugins          createShellPlugin (bash, which runs alone in its turn) and createSearchPlugin (grep)
//   approval         another plugin: choices({ answer, approve: [shellPlugin.preview] }) of @ji.dev/plugin-choices
//
//   Extending needs nothing new (RFC §5.6): implement CommandExecutor's one method, wrap or spread a plain object, or
//   copy createBashTool's dozen lines and compose the same pure functions.

export type { Chunk, Exit, Fold, Outcome, Timeout } from './core/fold.ts'
export { type Budget, createOutputFold, type OutputFold, type OutputState, truncateLine } from './core/output.ts'
export { quoteArgv } from './core/quote.ts'
export { type Rendered, renderFound, renderOutput } from './core/render.ts'
export { createHitsFold, type Found, type Hit, parseRipgrepEvent, type Query, ripgrepArgs } from './core/ripgrep.ts'
export { type Clip, createWindow, omittedLines, type Window } from './core/window.ts'
export {
  type Command,
  type CommandExecutor,
  CommandNotFoundError,
  createMemoryExecutor,
  type ExecuteOptions,
  type Log,
  type MemoryExecutor,
  type MemoryProcess,
  runWithClocks,
} from './executor.ts'
export { createFileLog, createLocalExecutor, type LocalExecutorOptions } from './node.ts'
export {
  type CommandPreview,
  createSearchPlugin,
  createShellPlugin,
  type ShellPlugin,
  splitAtBarriers,
} from './plugin.ts'
export { foldStream, type Stream, streamResult, tapStream } from './stream.ts'
export { type BashOptions, createBashTool, createGrepTool, type GrepOptions } from './tools.ts'
