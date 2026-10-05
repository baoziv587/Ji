// @ji.dev/plugin-shell: bash and grep as bounded folds over a process stream (rfcs/tools/bash-grep-algebra.md)
//
//   createAgent({ model, plugins: [createShellPlugin(host), createSearchPlugin(host), files(workspace)] })
//
//   Host         the process port, spawn: Spec → Chunk* · Exit. createLocalHost, createMemoryHost, wrapHost
//   runProcess   a host's stream with clocks on it: the earliest clock is the outcome
//   Fold         what a tool keeps of the stream: createOutputFold (bash), createHitsFold (grep), or your own
//   foldStream   run = foldStream ∘ runProcess; a full fold closes the stream, and the process stops
//   plugins      createShellPlugin (bash, which runs alone in its turn) and createSearchPlugin (grep)
//   approval     another plugin: choices({ answer, approve: [shellPlugin.preview] }) of @ji.dev/plugin-choices

export type { Chunk, Fold } from './core/fold.ts'
export { type Budget, createOutputFold, type OutputFold, type OutputState, truncateLine } from './core/output.ts'
export { createHitsFold, type Found, type Hit, parseRipgrepEvent, type Query, ripgrepArgs } from './core/ripgrep.ts'
export { type Clip, createWindow, omittedLines, type Window } from './core/window.ts'
export { type Clocks, foldStream, type Outcome, runProcess, streamResult, tapStream, type Timeout } from './exec.ts'
export {
  CommandNotFoundError,
  createMemoryHost,
  type Exit,
  type Host,
  type Log,
  type MemoryHost,
  type MemoryProcess,
  type Spec,
  wrapHost,
} from './host.ts'
export { createFileLog, createLocalHost, type LocalHostOptions } from './node.ts'
export { type CommandPreview, createSearchPlugin, createShellPlugin, type ShellPlugin } from './plugin.ts'
export { type BashOptions, createBashTool, createGrepTool, type GrepOptions } from './tools.ts'
