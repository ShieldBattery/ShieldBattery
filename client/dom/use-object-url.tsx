import { useEffect, useState } from 'react'

/**
 * A hook which creates an object URL out of the received file, while also making sure that stale
 * object URLs are revoked.
 */
export function useObjectUrl(file?: Blob): string | undefined {
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined)

  if (file && !objectUrl) {
    setObjectUrl(URL.createObjectURL(file))
  }

  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
        setObjectUrl(v => (v === objectUrl ? undefined : v))
      }
    }
  }, [objectUrl, file])

  return objectUrl
}
