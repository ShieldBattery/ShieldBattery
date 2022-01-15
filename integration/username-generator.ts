import cuid from 'cuid'

/**
 * Generates a username. Intended for tests that need to sign up for new accounts that get a fresh
 * state. It sacrifices a bit of determinism for the sake of getting names that will work for test
 * re-runs.
 *
 * This will return a different value each time it is called, so make sure to save the result in a
 * variable if you need to reference it again.
 */
export function generateUsername() {
  return cuid.slug()
}
