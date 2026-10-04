// @ji.dev/plugin-files: read and edit tools with strict matching, version checks and atomic writes
// (rfcs/tools/edit-tool-algebra.md)
//
//   createAgent({ model, plugins: [files(localWorkspace(root))] })
//
//   Workspace   the IO port: resolve, read, publish. localWorkspace for the file system, memWorkspace for tests
//   Transform   the file's new text from its current text: editTransform, writeTransform, chain, or your own
//   commit      publish ∘ transform ∘ read; prepare is commit without the publish
//   fileTool    a tool as a schema and a Transform; files is the plugin: read + file tools + the ledger
//   approval    another plugin: approval({ previews: [fileTools.preview] }) of @ji.dev/plugin-approval

export { type Applied, commit, prepare, type Prepared } from './commit.ts'
export type { Edit } from './core/plan.ts'
export { err, ok, type Result } from './core/result.ts'
export { type Candidate, defaultHinters, type Hinter, lineHinter } from './hints.ts'
export { type LocalOptions, localWorkspace } from './node.ts'
export { type ChangePreview, files, type FilesOptions, type FilesPlugin, type Ledger } from './plugin.ts'
export { diff } from './render.ts'
export { type EditOptions, editTool, type FileTool, fileTool, readTool } from './tools.ts'
export { chain, type EditError, editTransform, type Transform, writeTransform } from './transform.ts'
export {
  type Expected,
  FileError,
  type MemWorkspace,
  memWorkspace,
  type Publisher,
  type Reader,
  type Resolver,
  type Snapshot,
  type Version,
  type Workspace,
} from './workspace.ts'
