import { useEffect, useRef } from 'react'
import { useForceUpdate } from '../state-hooks'

/**
 * A hook which creates an object URL out of the received file, while also making sure that stale
 * object URLs are revoked.
 *
 * If the received argument is already a string, this hook is basically a noop which just returns
 * the received string.
 */
export function useObjectUrl(file?: Blob | string): string | undefined {
  const objectUrlRef = useRef<string>()
  const forceUpdate = useForceUpdate()

  useEffect(() => {
    if (typeof file !== 'string') {
      objectUrlRef.current = file ? URL.createObjectURL(file) : undefined
      forceUpdate()
    }

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
    }
  }, [file, forceUpdate])

  return typeof file === 'string' ? file : objectUrlRef.current
}
