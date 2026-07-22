/**
 * Returns the stack trace for a given error, if it is an object that has one. If it doesn't, the
 * object itself will be converted to a string.
 */
export function getErrorStack(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'stack' in err) {
    return (err as any).stack
  }

  return String(err)
}
