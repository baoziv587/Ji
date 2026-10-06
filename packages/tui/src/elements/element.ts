// The screen as a tree of elements, built again for every frame from the program's state (RFC-0008). An element draws
// itself into the width it is given, and the height if any; the stacks share out the room among their children:
//
//   element            the interface: an object with a `render`
//   vertical-stack     one above the other: each as tall as it draws, a `fill` one taking the rows left
//   horizontal-stack   side by side: each `width` columns, one without a width taking the columns left
//   pad                columns kept free on either side
//   text               lines cut to the width
//   wrapped-text       text wrapped to the width
//   first-that-fits    the first of several versions that fits
//   rule               a dim rule with labels
//   input              the input line, with the cursor in it
//
// An element is a plain object: `{ ...element, fill: true }` changes how it is laid out, and one with a `render` of its
// own is as good as any here. A child given as false or undefined is left out: `menu && createListElement(menu)`.

export interface Rendered {
  /** Each no wider than the width given, and no more of them than the height. */
  rows: string[]
  /** Where the cursor goes in these rows; without one it is hidden. In a stack, the first child's that has one. */
  cursor?: { row: number; column: number }
}

export interface Element {
  /** Draws into `width` columns: given a `height`, no taller; otherwise as tall as it needs. */
  render: (width: number, height?: number) => Rendered
  /** Takes the rows left in a vertical stack, shared with the other ones that fill. */
  fill?: boolean
  /** The columns it takes in a horizontal stack. */
  width?: number
}

/** A stack's child; false or undefined is left out. */
export type Child = Element | false | undefined

export function isShown(child: Child): child is Element {
  return child !== false && child !== undefined
}

/** The `index`th of `count` shares of `room`, as even as whole rows or columns allow. */
export function shareOf(room: number, count: number, index: number): number {
  return Math.floor((room * (index + 1)) / count) - Math.floor((room * index) / count)
}
