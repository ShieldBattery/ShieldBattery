/**
 * Returns a promise that resolves after `timeoutMs` milliseconds.
 *
 * @returns a tuple of [the Promise, a function to clear the timeout and reject the promise]
 */
export function timeoutPromise(
  timeoutMs: number,
): [promise: Promise<void>, clearTimeout: (rejectReason?: any) => void] {
  let id: ReturnType<typeof setTimeout> | undefined
  let reject: (reason?: any) => void

  return [
    new Promise((resolve, _reject) => {
      reject = _reject
      id = setTimeout(() => {
        resolve()
        id = undefined
      }, timeoutMs)
    }),
    reason => {
      if (id) {
        reject(reason)
        clearTimeout(id)
        id = undefined
      }
    },
  ]
}
