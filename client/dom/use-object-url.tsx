import { useEffect, useState } from 'react'
import { useValueAsRef } from '../state-hooks'

/**
 * A hook which creates an object URL out of the received file, while also making sure that stale
 * object URLs are revoked.
 *
 * If the received argument is already a string, this hook is basically a noop which just returns
 * the received string.
 */
export function useObjectUrl(file?: Blob | string): string | undefined {
  const [objectUrl, setObjectUrl] = useState<string>()
  const objectUrlRef = useValueAsRef(objectUrl)

  useEffect(() => {
    if (typeof file === 'string') {
      return
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
    }

    setObjectUrl(file ? URL.createObjectURL(file) : undefined)
  }, [file, objectUrlRef])

  return typeof file === 'string' ? file : objectUrl
}
