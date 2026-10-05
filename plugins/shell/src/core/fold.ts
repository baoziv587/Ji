// What a command's stream carries, how it ends, and what a tool keeps of it (RFC §5.1, §5.2).

/** What one tool asks of a stream: where keeping starts, how one item is kept, and when enough has been kept. */
export interface Fold<D, M> {
  readonly empty: M
  step: (kept: M, item: D) => M
  /** True once nothing more is needed: the stream is closed, and whatever produces it stops. */
  full?: (kept: M) => boolean
}

/** Text a command wrote, as it arrived. */
export interface Chunk {
  /** 1 is stdout, 2 is stderr. */
  fd: 1 | 2
  text: string
}

/** How a process ended by itself, or by a signal. */
export type Exit = { kind: 'exit'; code: number } | { kind: 'signal'; signal: string }

export interface Timeout {
  kind: 'timeout'
  clock: 'total' | 'idle'
  ms: number
}

/** How a command ended: its own exit, or the clock that stopped it. */
export type Outcome = Exit | Timeout
