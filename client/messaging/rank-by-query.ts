import UFuzzy from '@leeoniya/ufuzzy'

// Same options as the emote matcher: the query's characters in order, anything between them,
// without regard to case. A UFuzzy instance holds no per-search state, so one instance serves every
// call.
const fuzzy = new UFuzzy({ intraIns: Infinity, intraChars: '.' })

/**
 * Orders `items` by how well any of their names answers `query`: exact matches, then prefix
 * matches, then substring matches, then fuzzy ones (the query's characters appear in order,
 * anything between, like the emote matcher), each tier in the order given. Matching ignores case.
 * An empty query keeps every item in the order given. Items that match nothing are left out.
 */
export function rankByQuery<T>(
  items: ReadonlyArray<T>,
  getNames: (item: T) => ReadonlyArray<string>,
  query: string,
): T[] {
  if (query.length === 0) {
    return items.slice()
  }

  const lowered = query.toLowerCase()
  const exact: T[] = []
  const prefix: T[] = []
  const substring: T[] = []
  // Everything that missed the other tiers gets one more shot at matching fuzzily. Names are
  // flattened so a single fuzzy pass covers every item's names at once; rows come back in haystack
  // order, which is item order, so deduping by first occurrence keeps the items in the order given.
  const rest: T[] = []
  const restNames: string[] = []
  const restNameItem: number[] = []

  for (const item of items) {
    const names = getNames(item).map(name => name.toLowerCase())
    if (names.some(name => name === lowered)) {
      exact.push(item)
    } else if (names.some(name => name.startsWith(lowered))) {
      prefix.push(item)
    } else if (names.some(name => name.includes(lowered))) {
      substring.push(item)
    } else {
      const itemIndex = rest.length
      rest.push(item)
      for (const name of names) {
        restNames.push(name)
        restNameItem.push(itemIndex)
      }
    }
  }

  const fuzzyMatches: T[] = []
  const seen = new Set<number>()
  for (const row of fuzzy.filter(restNames, lowered) ?? []) {
    const itemIndex = restNameItem[row]
    if (seen.has(itemIndex)) {
      continue
    }
    seen.add(itemIndex)
    fuzzyMatches.push(rest[itemIndex])
  }

  return exact.concat(prefix, substring, fuzzyMatches)
}
