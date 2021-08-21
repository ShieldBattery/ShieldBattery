/**
 * Returns an iterator that will generate numbers starting at `start` (inclusive) until it reaches
 * `end` (exclusive), increasing or decreasing by `step` each time. Handles positive or negative
 * step values, provided the step value will make progress towards the end value (throws otherwise).
 *
 * @example
 * for (const i of range(4, 10, 2)) {
 *   console.log(i)
 * }
 *
 * // Logs:
 * // 4
 * // 6
 * // 8
 */
export function* range(start = 0, end = Number.MAX_SAFE_INTEGER, step = start <= end ? 1 : -1) {
  if ((start < end && step <= 0) || (start > end && step >= 0)) {
    throw new Error(
      `range was passed parameters that do not make progress: ` +
        `[start: ${start}, end: ${end}, step: ${step}]`,
    )
  }

  const numIterations = Math.ceil(Math.abs((end - start) / step))
  for (let i = 0, value = start; i < numIterations; i++, value += step) {
    yield value
  }
}
