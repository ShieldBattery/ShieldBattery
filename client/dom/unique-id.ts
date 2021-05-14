import { useRef } from 'react'

let id = 0

/**
 * Returns an ID that is unique for each call, intended to be used for UI elements that need to be
 * referenced from elsewhere (e.g. form inputs that need to be referenced by a label element).
 */
export default function genId(): string {
  return 'sb_id_' + id++
}

/**
 * Hook that returns an ID that is unique for each component that uses it, intended to be used for
 * UI elements that need to be referenced from elsewhere (e.g. form inputs that need to be
 * referenced by a label element).
 */
export function useId(): string {
  const idRef = useRef<string>()
  if (!idRef.current) {
    idRef.current = genId()
  }

  return idRef.current!
}
