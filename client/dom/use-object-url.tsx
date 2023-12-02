import { useEffect, useRef } from 'react'
import { useForceUpdate } from '../state-hooks'

/**
 * A hook which creates an object URL out of the received file, while also making sure that stale
 * object URLs are revoked.
 */
export function useObjectUrl(file?: Blob): string | undefined {
  const objectUrlRef = useRef<string>()
  const forceUpdate = useForceUpdate()

  useEffect(() => {
    objectUrlRef.current = file ? URL.createObjectURL(file) : undefined
    forceUpdate()

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
    }
  }, [file, forceUpdate])

  return objectUrlRef.current
}
