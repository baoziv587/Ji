// The questions a session waits on: an approval, the model's ask_user, a login's prompt. Each goes to the client as an
// 'ask' event and waits for its answer, or for the reply that asked it to stop; either way an 'ask_closed' follows.

import type { Reply } from '@ji.dev/plugin-choices'
import type { QuestionView, Unnumbered } from './events.ts'

/**
 * What a question asked is about: the tool whose call waits for a yes, whether it is a command or a change of the file
 * at a path, and whether it reaches outside the folder.
 */
export interface Asked {
  tool?: string
  command?: boolean
  path?: string
  outside: boolean
}

type QuestionEvent = Extract<Unnumbered, { type: 'ask' | 'ask_closed' }>

export class PendingQuestions {
  private readonly waiting = new Map<string, (reply: Reply) => void>()
  private readonly announce: (e: QuestionEvent) => void
  private count = 0

  /** `announce` is told each question as it is asked and as it closes. */
  constructor(announce: (e: QuestionEvent) => void) {
    this.announce = announce
  }

  /** The ids of the questions waiting for an answer, oldest first. */
  ids(): string[] {
    return [...this.waiting.keys()]
  }

  /** Waits for the client's answer; rejects with `signal`'s reason when it is aborted first. */
  ask(questions: QuestionView[], signal?: AbortSignal, asked: Asked = { outside: false }): Promise<Reply> {
    const id = String(++this.count)
    const { promise, resolve, reject } = Promise.withResolvers<Reply>()

    const close = (): void => {
      this.waiting.delete(id)
      this.announce({ type: 'ask_closed', id })
    }
    const cancel = (): void => {
      close()
      reject(signal?.reason)
    }

    signal?.addEventListener('abort', cancel, { once: true })
    this.waiting.set(id, reply => {
      signal?.removeEventListener('abort', cancel)
      close()
      resolve(reply)
    })

    this.announce({ type: 'ask', id, ...asked, questions })
    return promise
  }

  /** False when no question has this id: answered already, or closed with its reply. */
  answer(id: string, reply: Reply): boolean {
    const resolve = this.waiting.get(id)
    resolve?.(reply)
    return resolve !== undefined
  }
}
