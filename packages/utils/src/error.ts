/** An Error's message; anything else thrown, as a string. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
