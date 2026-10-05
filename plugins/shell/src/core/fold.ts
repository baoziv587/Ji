// What a tool keeps of a stream (RFC §5.1): a fold, and the one kind of item every process stream carries.

/** What one tool asks of a stream: where keeping starts, how one item is kept, and when enough has been kept. */
export interface Fold<D, M> {
  readonly empty: M
  step: (kept: M, item: D) => M
  /** True once nothing more is needed: the stream is closed, and whatever produces it stops. */
  full?: (kept: M) => boolean
}

/** Text a process wrote, as it arrived. */
export interface Chunk {
  /** 1 is stdout, 2 is stderr. */
  fd: 1 | 2
  text: string
}
