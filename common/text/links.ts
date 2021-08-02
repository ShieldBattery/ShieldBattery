const URL_REGEX = /(?<g1>https?:\/\/)(?:[^\s)"\].]|(?:\.(?=\S))|(?<=\k<g1>.*\([^)]*)\)){2,}/gi

/** Returns an iterator of matches for links within the specified `text`. */
export function matchLinks(text: string): IterableIterator<RegExpMatchArray> {
  return text.matchAll(URL_REGEX)
}
