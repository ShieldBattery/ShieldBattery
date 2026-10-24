import swallowNonBuiltins from '../../common/async/swallow-non-builtins'

/** Runs at most one check at a time and ignores results after the connection closes. */
export function watchGameConnection(
  check: () => Promise<boolean | undefined>,
  onUnavailable: () => void,
  onFailure: () => void,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = async () => {
    try {
      const result = await check()
      if (stopped) return
      if (result === false) {
        onFailure()
        return
      }
      if (result !== true) onUnavailable()
    } catch {
      if (!stopped) onUnavailable()
    }
    if (!stopped) timer = setTimeout(start, 120_000)
  }
  const start = () => {
    run().catch(swallowNonBuiltins)
  }
  start()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
