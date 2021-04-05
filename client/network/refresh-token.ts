import { useCallback, useState } from 'react'

/**
 * React hook that returns an opaque value that can be triggered to change. Suitable for using as a
 * dependency for React hooks to trigger them to re-run.
 */
export function useRefreshToken(): [token: number, triggerRefresh: () => void] {
  const [value, setValue] = useState<number>(0)
  const triggerRefresh = useCallback(() => {
    setValue(v => v + 1)
  }, [])

  return [value, triggerRefresh]
}
