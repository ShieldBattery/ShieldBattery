/**
 * Regex for detecting and parsing URLs. Not 100% exhaustive, but good enough for our use cases. The
 * main part of the regex is that the URL must start with a "http(s)://" to be considered a URL.
 *
 * Also, the whole regex is encapsulated in a "link" capture group, so it can be grouped with other
 * markup regexes.
 */
const URL_REGEX =
  /(?<link>(?<g1>https?:\/\/)(?:[^\s)"\].]|(?:\.(?=\S))|(?<=\k<g1>.*\([^)]*)\)){2,})/gi

/** Returns an iterator of matches for links within the specified `text`. */
export function matchLinks(text: string): IterableIterator<RegExpMatchArray> {
  return text.matchAll(URL_REGEX)
}
