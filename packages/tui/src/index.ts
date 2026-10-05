// A full-screen terminal chat's parts, none of them knowing what is said in it:
//
//   screen     the alternate screen: a bar on top, one at the bottom, and the content between them, scrolled with the
//              wheel and PgUp/PgDn, its live rows changing in place; a status that spins and counts the seconds
//   editing    the line typed in a bar, and how it is drawn
//   markdown   Markdown as it streams in, in rows that fit; plain text the same way
//   rail       rows written beside clack's rail
//   highlight  code in color, a line at a time; diff     a diff in the colors of its file
//   layout     a line fitted to its width: the first version that fits, a path shortened, a rule with labels; help
//   output     the tail of a running command's output
//   text       text cut and wrapped by the columns it shows in; dim text, key hints, counts

export { paintDiff } from './diff.ts'
export type { Editing, InputLine, InputLineOptions, Keypress } from './editing.ts'
export { applyKey, editingText, EMPTY_EDITING, renderInputLine } from './editing.ts'
export type { Background, PaintLine } from './highlight.ts'
export { detectLanguage, DIFF_COLORS, highlightCode, loadCodePainter } from './highlight.ts'
export type { HelpSection } from './layout.ts'
export {
  abbreviateHomePath,
  drawRuleWithLabels,
  formatHelpSections,
  leftTruncatedPaths,
  pickFirstThatFits,
} from './layout.ts'
export type { Rows } from './markdown/flow.ts'
export type { Format } from './markdown/inline.ts'
export { Markdown } from './markdown/markdown.ts'
export { PlainText } from './markdown/plain.ts'
export { OutputTail } from './output.ts'
export { createRailRows, paintRail, widthBesideRail } from './rail.ts'
export type { LiveRows } from './screen/live.ts'
export { SPINNER_FRAMES } from './screen/live.ts'
export type { Frame, View } from './screen/screen.ts'
export { Screen } from './screen/screen.ts'
export { Status } from './status.ts'
export type { KeyHint } from './text.ts'
export {
  clipToLine,
  dimText,
  displayWidth,
  fitToWidth,
  formatCount,
  formatKeyHint,
  formatKeyHints,
  splitWords,
  tailToWidth,
  wrapToRows,
} from './text.ts'
