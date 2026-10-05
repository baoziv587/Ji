// argv through an executor that takes only a command line (RFC §5.1, L10). Nothing has a special meaning inside single
// quotes and a single quote itself is written '\'', so a POSIX shell reads back exactly the words it was given.

/** argv as one POSIX shell word list: a shell that reads it starts exactly argv. No value can add a word. */
export function quoteArgv(argv: readonly string[]): string {
  return argv.map(arg => `'${arg.replaceAll("'", `'\\''`)}'`).join(' ')
}
