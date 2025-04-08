import UFuzzy from '@leeoniya/ufuzzy'
import { useMemo } from 'react'

/**
 * Returns a fuzzy-filtered array of data. The filtered data will be ordered in the same way as it
 * is given (e.g. it will not be ranked/sorted by rank).
 */
export function useFuzzyFilter<T>(
  data: ReadonlyArray<T>,
  filter: string,
  toString: (value: T) => string = String,
  opts: UFuzzy.Options = { intraIns: Infinity, intraChars: '.' },
): T[] {
  const fuzzy = useMemo(() => new UFuzzy(opts), [opts])
  const haystack = data.map(toString)
  const indexes = fuzzy.filter(haystack, filter)

  return indexes?.map(index => data[index]) ?? data.slice(0)
}
