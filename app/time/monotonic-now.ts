/**
 * Returns a monotonically increasing number corresponding to a time in milliseconds.
 */
export function monotonicNow(): number {
  const [seconds, nanos] = process.hrtime()
  return seconds * 1000 + nanos / 1000000
}
