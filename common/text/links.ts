/**
 * Regex for detecting and parsing URLs. Not 100% exhaustive, but good enough for our use cases. The
 * main part of the regex is that the URL must start with a "http(s)://" to be considered a URL.
 */
const URL_REGEX = /(?<g1>https?:\/\/)(?:[^\s)"\].]|(?:\.(?=\S))|(?<=\k<g1>.*\([^)]*)\)){2,}/gi

export interface LinkMatch {
  type: 'link'
  text: string
  index: number
}

/** Returns a generator of matches for links within the specified `text`. */
export function* matchLinks(text: string): Generator<LinkMatch> {
  const matches: IterableIterator<RegExpMatchArray> = text.matchAll(URL_REGEX)

  for (const match of matches) {
    yield {
      type: 'link',
      text: match[0],
      index: match.index!,
    }
  }
}
