// What a message says, as a person reads it: in the terminal's conversation, or in a client's window.

import type { Message } from '@ji.dev/llm'
import { commandLineOf, parseSkillCall } from '@ji.dev/plugin-skills'

/** A message's text, a skill call as the line that was typed; images and other parts by their type. */
export function contentOf(m: Message): string {
  if (typeof m.content === 'string') {
    const call = parseSkillCall(m.content)
    return call === undefined ? m.content : commandLineOf(call)
  }

  return m.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('')
}
