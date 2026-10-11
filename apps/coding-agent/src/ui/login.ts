// A login's questions and news in the terminal: pi-ai's flow asks (a key, a choice, the URL the browser ended on) and
// tells (open this URL, exchanging the code); clack asks, the log tells, and the browser is opened for the person.

import type { AuthEvent, AuthInteraction, AuthPrompt } from '@ji.dev/llm'
import type { Readable } from 'node:stream'
import type { Answering } from './answering.ts'
import { isCancel, log, password, select, text } from '@clack/prompts'
import { describeAuthEvent, openBrowser } from '../features/auth.ts'

export function createLoginInteraction(answering: Answering): AuthInteraction {
  return {
    prompt: p => answering.hold(keys => askOnce(p, keys)),
    notify: tell,
  }
}

/** Esc or Ctrl+C at a question cancels the login. */
async function askOnce(p: AuthPrompt, input: Readable): Promise<string> {
  const answered = await ask(p, input)
  if (isCancel(answered)) {
    throw new Error('Login cancelled')
  }
  return String(answered)
}

function ask(p: AuthPrompt, input: Readable): Promise<unknown> {
  const common = { message: p.message, input, signal: p.signal }
  switch (p.type) {
    case 'secret':
      return password(common)
    case 'select':
      return select({
        ...common,
        options: p.options.map(o => ({ value: o.id, label: o.label, hint: o.description })),
      })
    default:
      return text({ ...common, placeholder: p.placeholder })
  }
}

function tell(event: AuthEvent): void {
  const text = describeAuthEvent(event)
  switch (event.type) {
    case 'auth_url':
      log.info(text)
      openBrowser(event.url)
      break
    case 'device_code':
    case 'info':
      log.info(text)
      break
    default:
      log.step(text)
  }
}
