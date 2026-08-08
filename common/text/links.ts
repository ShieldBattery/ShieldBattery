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
 * Trailing characters that end a sentence rather than a URL. '?' and ',' are deliberately left
 * out: they routinely show up as meaningful trailing characters in query strings and lists of
 * URLs, so stripping them unconditionally would corrupt valid links.
 */
function isSentenceEndingPunctuation(char: string | undefined): boolean {
  return char === '.' || char === '!'
}

/**
 * Strips trailing characters from a matched URL that more likely close out the surrounding text
 * than belong to the URL itself: closing parens that don't pair with an opening paren earlier in
 * the URL (e.g. the ")" wrapping a URL in "(http://example.org/)"), and sentence-ending
 * punctuation (e.g. the "." ending a sentence in "check http://example.org."). Both are stripped
 * repeatedly, in either order, until neither applies, so e.g. a period after an unbalanced
 * closing paren ("(http://example.org/foo).") has both trimmed rather than just the period.
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
  let didTrim = true
  while (didTrim) {
    didTrim = false
    if (unclosedParens < 0 && url[end - 1] === ')') {
      end--
      unclosedParens++
      didTrim = true
    } else if (isSentenceEndingPunctuation(url[end - 1])) {
      end--
      didTrim = true
    }
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
