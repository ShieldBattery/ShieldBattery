/**
 * Determines whether or not the code is currently running in a test (useful for disabling
 * top-level failures on things like environment variables missing).
 */
export function isTestRun() {
  return typeof jest !== 'undefined'
}
