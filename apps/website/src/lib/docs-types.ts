/** Shapes produced by vite-plugins/docs.ts at build time. */
export interface DocHeading {
  readonly id: string
  readonly text: string
  readonly depth: number
}

export interface DocPage {
  /** `''` for the docs home. */
  readonly slug: string
  readonly title: string
}

export interface Doc extends DocPage {
  readonly html: string
  readonly headings: readonly DocHeading[]
}
