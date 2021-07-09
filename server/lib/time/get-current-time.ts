/**
 * Returns the current time, in milliseconds. This function mainly exists so it can be injected into
 * classes that needs to get the current time and also be easily testable.
 */
export function getCurrentTime(): number {
  return Date.now()
}
