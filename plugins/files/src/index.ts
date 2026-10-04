// @ji.dev/plugin-files: read and edit tools with strict matching, version checks and atomic writes
// (rfcs/tools/edit-tool-algebra.md)
//
//   const store = canonical(guarded(locked(localStore()), allow), realPath)
//   createAgent({ model, plugins: [files(store), matchHints(store)] })
//
//   core/     pure and import-free: locate, plan, batch, apply, invert, view
//   store     the IO port, memStore and the decorators; node: localStore, realPath
//   commit    prepare (no writing) and commit = prepare, then publish
//   tools     read and edit; plugin: files (tools + ledger) and matchHints

export {
  commit,
  type EditError,
  editTransform,
  type Outcome,
  prepare,
  type Prepared,
  type Transform,
  writeTransform,
} from './commit.ts'
export {
  apply,
  batch,
  type Batch,
  invert,
  type Overlap,
  type Range,
  rewrite,
  separable,
  type Splice,
} from './core/batch.ts'
export { type Edit, lineAt, locate, plan, type PlanError } from './core/plan.ts'
export { err, ok, type Result } from './core/result.ts'
export { decode, encode, type TextView, view } from './core/view.ts'
export { type Candidate, defaultHinters, type Hinter, lineHinter } from './hints.ts'
export { localStore, realPath } from './node.ts'
export { files, type HintOptions, type Ledger, matchHints } from './plugin.ts'
export { diff } from './render.ts'
export {
  canonical,
  type Commit,
  type Expected,
  guarded,
  locked,
  type MemStore,
  memStore,
  type Publisher,
  type Reader,
  type Snapshot,
  type Store,
  StoreError,
  type Version,
} from './store.ts'
export { editTool, readTool, type ToolOptions } from './tools.ts'
