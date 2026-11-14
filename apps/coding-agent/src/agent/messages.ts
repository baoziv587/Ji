// What a message says, as a person reads it: in the terminal's conversation, or in a client's window.

import type { Message } from '@ji.dev/llm'
import { commandLineOf, parseSkillCall } from '@ji.dev/plugin-skills'

/** A file attached to a message: by its path, which the tools read, and its picture when the model takes images. */
export interface Attachment {
  path: string
  image?: { data: string; mimeType: string }
}

/** Heads the part of a message that names its files, one path a line under it. */
const ATTACHED = 'Attached files:\n'

/** The message typed, with the files attached to it: their paths in a part of their own, then the pictures. */
export function messageWith(text: string, files: readonly Attachment[]): string | Message {
  if (files.length === 0) {
    return text
  }
  const parts: Exclude<Extract<Message, { role: 'user' }>['content'], string> = []
  if (text !== '') {
    parts.push({ type: 'text', text })
  }
  parts.push({ type: 'text', text: ATTACHED + files.map(f => f.path).join('\n') })
  for (const { image } of files) {
    if (image !== undefined) {
      parts.push({ type: 'image', ...image })
    }
  }
  return { role: 'user', content: parts, timestamp: Date.now() }
}

/** The paths of the files attached to a message, as messageWith put them. */
export function attachedTo(m: Message): string[] {
  if (m.role !== 'user' || typeof m.content === 'string') {
    return []
  }
  return m.content.flatMap(c =>
    c.type === 'text' && c.text.startsWith(ATTACHED) ? c.text.slice(ATTACHED.length).split('\n') : [],
  )
}

/** A message's text, a skill call as the line that was typed; images and other parts by their type, unless attached. */
export function contentOf(m: Message): string {
  if (typeof m.content === 'string') {
    const call = parseSkillCall(m.content)
    return call === undefined ? m.content : commandLineOf(call)
  }

  const attached = attachedTo(m).length > 0
  return m.content
    .flatMap(c => {
      if (c.type === 'text') {
        return attached && c.text.startsWith(ATTACHED) ? [] : [c.text]
      }
      return attached && c.type === 'image' ? [] : [`[${c.type}]`]
    })
    .join('')
}
