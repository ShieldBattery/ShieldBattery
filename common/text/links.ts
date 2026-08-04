/**
 * Regex for detecting and parsing URLs. Not 100% exhaustive, but good enough for our use cases. The
 * main part of the regex is that the URL must start with a "http(s)://" to be considered a URL.
 *
 * This only matches the broad run of URL-ish characters; trailing punctuation that more likely
 * belongs to the surrounding sentence (an unbalanced closing paren, a sentence-ending period) is
 * trimmed off by `trimTrailingPunctuation` below rather than handled inside the regex, since
 * doing it with a backreference-in-lookbehind is quadratic on paren-heavy input.
 */
const URL_REGEX = /https?:\/\/[^\s"\]]+/gi

/**
 * Strips trailing characters from a matched URL that more likely close out the surrounding text
 * than belong to the URL itself: closing parens that don't pair with an opening paren earlier in
 * the URL (e.g. the ")" wrapping a URL in "(http://example.org/)"), and a single trailing period
 * (e.g. the "." ending a sentence in "check http://example.org.").
 */
function trimTrailingPunctuation(url: string): string {
  let unclosedParens = 0
  for (const char of url) {
    if (char === '(') {
      unclosedParens++
    } else if (char === ')') {
      unclosedParens--
    }
  }

  let end = url.length
  while (unclosedParens < 0 && url[end - 1] === ')') {
    end--
    unclosedParens++
  }
  if (url[end - 1] === '.') {
    end--
  }

  return end === url.length ? url : url.slice(0, end)
}

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
      text: trimTrailingPunctuation(match[0]),
      index: match.index!,
    }
  }
}
