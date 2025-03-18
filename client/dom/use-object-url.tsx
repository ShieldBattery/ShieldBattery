import { useEffect, useState } from 'react'

/**
 * A hook which creates an object URL out of the received file, while also making sure that stale
 * object URLs are revoked.
 */
export function useObjectUrl(file?: Blob): string | undefined {
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined)

  useEffect(() => {
    const url = file ? URL.createObjectURL(file) : undefined
    setObjectUrl(url)

    return () => {
      if (url) {
        URL.revokeObjectURL(url)
      }
    }
  }, [file])

  return objectUrl
}
