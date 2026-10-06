// Where the two views hold the same content: a line in one finds its place in the other
import type { Marker } from '../src/screen/anchors.ts'
import { describe, expect, it } from 'vitest'
import { Anchors } from '../src/screen/anchors.ts'

describe('anchors', () => {
  it('should find a line as far below the same pair in the other view', () => {
    // Arrange
    const anchors = anchorsOf([0, 0], [3, 10])

    // Act
    const found = anchors.find(5, 'brief', 'full')

    // Assert
    expect(found).toBe(12)
  })

  it("should stop short of the next pair, when what lies between is one view's own", () => {
    // Arrange: lines 2 to 11 of full are its own, its thinking in full; brief has a line for it
    const anchors = anchorsOf([0, 0], [3, 12])

    // Act
    const found = anchors.find(8, 'full', 'brief')

    // Assert
    expect(found).toBe(2)
  })

  it('should leave out a pair on the same lines as the last one', () => {
    // Arrange
    const anchors = new Anchors()
    const repeated = { brief: markerAt(3), full: markerAt(10) }

    // Act
    anchors.add({ brief: markerAt(3), full: markerAt(10) })
    anchors.add(repeated)

    // Assert
    expect(repeated.brief.isDisposed).toBe(true)
    expect(anchors.find(4, 'brief', 'full')).toBe(11)
  })

  it('should skip a pair whose line was trimmed from the scrollback', () => {
    // Arrange
    const trimmed = markerAt(0)
    const anchors = new Anchors()
    anchors.add({ brief: trimmed, full: markerAt(0) })
    anchors.add({ brief: markerAt(4), full: markerAt(9) })

    // Act
    trimmed.dispose()
    const found = anchors.find(2, 'full', 'brief')

    // Assert: with nothing at or above it, the other view's first line
    expect(found).toBe(0)
  })
})

function anchorsOf(...pairs: [brief: number, full: number][]): Anchors {
  const anchors = new Anchors()
  for (const [brief, full] of pairs) {
    anchors.add({ brief: markerAt(brief), full: markerAt(full) })
  }
  return anchors
}

function markerAt(line: number): Marker & { isDisposed: boolean } {
  const marker = {
    line,
    isDisposed: false,
    dispose: () => {
      marker.isDisposed = true
      marker.line = -1
    },
  }
  return marker
}
