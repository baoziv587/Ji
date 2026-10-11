// /login in a session of the service: its prompts are questions to the client, what it says goes out as notices, and
// the browser opens here, where the service runs.

import type { AuthInteraction, AuthPrompt } from '@ji.dev/llm'
import type { Reply } from '@ji.dev/plugin-choices'
import type { Say } from '../agent/commands.ts'
import type { QuestionView } from './events.ts'
import { DISMISSED } from '@ji.dev/plugin-choices'
import { describeAuthEvent, openBrowser } from '../features/auth.ts'

/** `ask` puts a question to the client and waits for its answer. */
export function loginInteraction(
  ask: (questions: QuestionView[], signal?: AbortSignal) => Promise<Reply>,
  say: Say,
): AuthInteraction {
  return {
    prompt: async p => {
      const reply = await ask([questionOf(p)], p.signal)
      if (reply === DISMISSED) {
        throw new Error('Login cancelled')
      }
      return reply[0]?.[0] ?? ''
    },
    notify: e => {
      if (e.type === 'auth_url') {
        openBrowser(e.url)
      }
      say.info(describeAuthEvent(e))
    },
  }
}

/** A login's prompt as a question: a choice, or a line to type, a key's in dots. */
function questionOf(p: AuthPrompt): QuestionView {
  if (p.type === 'select') {
    const options = p.options.map(o => ({ value: o.id, label: o.label, hint: o.description }))
    return { title: p.message, options, multiple: false, other: false }
  }

  return {
    title: p.message,
    options: [],
    multiple: false,
    other: true,
    placeholder: p.placeholder,
    secret: p.type === 'secret',
  }
}
