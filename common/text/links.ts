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
 * than belong to the URL itself: a single sentence-ending period (e.g. the "." ending "check
 * http://example.org."), and everything from the first closing paren that doesn't pair with an
 * opening paren earlier in the URL (e.g. the ")" wrapping a URL in "(http://example.org/)").
 *
 * These are exactly the two exclusions the original backreference-in-lookbehind regex made, in the
 * order it effectively applied them: strip the period first, then truncate at the unbalanced
 * paren. Other punctuation ('!', '?', ',', extra dots of an ellipsis, a dot followed by ')') stays
 * part of the URL, matching what that regex accepted.
 */
function trimTrailingPunctuation(url: string): string {
  let end = url.length
  if (url[end - 1] === '.') {
    end--
  }

  let unclosedParens = 0
  for (let i = 0; i < end; i++) {
    if (url[i] === '(') {
      unclosedParens++
    } else if (url[i] === ')') {
      if (unclosedParens === 0) {
        end = i
        break
      }
      unclosedParens--
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
