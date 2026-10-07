// A skill call, in its two text forms: `/name args` as typed, `skill://name@hash args` as the history keeps it

/** A user message calling a skill: `/review the diff`, kept as `skill://review@<hash> the diff`. */
export interface SkillCall {
  name: string
  hash: string
  /** Trimmed; empty when there were none. */
  args: string
}

const CALL = /^skill:\/\/([^\s@/]+)@([0-9a-f]{12})(?:\s([\s\S]*))?$/
const COMMAND = /^\/([^\s/]+)(?:\s([\s\S]*))?$/

export function formatSkillCall({ name, hash, args }: SkillCall): string {
  const head = `skill://${name}@${hash}`
  return args === '' ? head : `${head} ${args}`
}

/** The call a stored line says; undefined for any other text, a /name line as typed included. */
export function parseSkillCall(text: string): SkillCall | undefined {
  const match = CALL.exec(text)
  if (match === null) {
    return undefined
  }

  return { name: match[1], hash: match[2], args: (match[3] ?? '').trim() }
}

/** The name and arguments of a `/name args` line; undefined for any other text, `/usr/bin` included. */
export function parseCommandLine(text: string): Pick<SkillCall, 'name' | 'args'> | undefined {
  const match = COMMAND.exec(text)
  if (match === null) {
    return undefined
  }

  return { name: match[1], args: (match[2] ?? '').trim() }
}

/** The call as it was typed, `/name args`, for showing it to people. */
export function commandLineOf({ name, args }: SkillCall): string {
  const command = `/${name}`
  return args === '' ? command : `${command} ${args}`
}
