import { TypedGroupRegExpMatchArray } from '../regex'

/**
 * Regex for detecting and parsing URLs. Not 100% exhaustive, but good enough for our use cases. The
 * main part of the regex is that the URL must start with a "http(s)://" to be considered a URL.
 *
 * Also, the whole regex is encapsulated in a "link" capture group, so it can be grouped with other
 * markup regexes.
 */
const URL_REGEX =
  /(?<link>(?<g1>https?:\/\/)(?:[^\s)"\].]|(?:\.(?=\S))|(?<=\k<g1>.*\([^)]*)\)){2,})/gi

/** Returns a generator of matches for links within the specified `text`. */
export function* matchLinks(text: string): Generator<{
  type: 'link'
  text: string
  index: number
  groups: Record<'link', string>
}> {
  const matches: IterableIterator<TypedGroupRegExpMatchArray<'link'>> = text.matchAll(
    URL_REGEX,
  ) as IterableIterator<any>

  for (const match of matches) {
    yield {
      type: 'link',
      text: match[0],
      index: match.index!,
      groups: match.groups,
    }
  }
}
