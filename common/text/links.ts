// The regexes below are sticky (`y`) so they only match at the `lastIndex` they're given. They're
// only used synchronously between a generator's yields, so sharing them across calls is safe.

/**
 * A run of characters that can make up a hostname: letters, combining marks and digits from any
 * script (so internationalized domain names match as written), hyphens and dots.
 */
const HOST_REGEX = /[\p{L}\p{M}\p{Nd}.-]+/uy
const PORT_REGEX = /:\d+/y
/**
 * The path, query and fragment, which must start right after the host (or port). Angle brackets
 * are never part of a URL as typed, so a link written as `<http://example.org>` stops before `>`.
 */
const PATH_REGEX = /[/?#][^\s"\]<>]*/y

const MAX_HOST_LENGTH = 253
const MAX_LABEL_LENGTH = 63
const ASCII_DIGITS_REGEX = /^[0-9]+$/

/**
 * Returns whether `host` is a hostname a link can point at: an IPv4 address, `localhost`, or at
 * least two dot-separated labels of 1-63 characters that don't start or end with a hyphen, the last
 * of which (the TLD) is at least 2 characters and not all digits.
 */
function isValidHost(host: string): boolean {
  if (host.length > MAX_HOST_LENGTH) {
    return false
  }

  const labels = host.split('.')
  if (labels.every(label => ASCII_DIGITS_REGEX.test(label))) {
    return labels.length === 4 && labels.every(label => label.length <= 3 && Number(label) <= 255)
  }
  if (labels.length < 2) {
    return host.toLowerCase() === 'localhost'
  }

  const tld = labels[labels.length - 1]
  if (tld.length < 2 || ASCII_DIGITS_REGEX.test(tld)) {
    return false
  }

  return labels.every(
    label =>
      label.length > 0 &&
      label.length <= MAX_LABEL_LENGTH &&
      !label.startsWith('-') &&
      !label.endsWith('-'),
  )
}

/**
 * Strips trailing characters from a matched URL that more likely close out the surrounding text
 * than belong to the URL itself: any run of trailing sentence-ending punctuation ('.' and '!',
 * covering "check http://example.org." and "http://example.org!!!" alike — real URLs essentially
 * never end in either), and everything from the first closing paren that doesn't pair with an
 * opening paren earlier in the URL (e.g. the ")" wrapping a URL in "(http://example.org/)").
 *
 * '?' and ',' stay part of the URL: both show up legitimately at the end of real URLs (a bare
 * query string, comma-shaped path segments) often enough that stripping would corrupt more links
 * than it fixes. A period that isn't at the very end (e.g. before the ")" in
 * "(http://example.org.)") also stays.
 */
function trimTrailingPunctuation(url: string): string {
  let end = url.length
  while (url[end - 1] === '.' || url[end - 1] === '!') {
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

/**
 * Returns a generator of matches for links within the specified `text`. A link must start with
 * "http(s)://", followed by a hostname that passes `isValidHost`, then an optional port and the
 * broad run of URL-ish characters after it. Trailing punctuation that more likely belongs to the
 * surrounding sentence (an unbalanced closing paren, a sentence-ending period) is trimmed off
 * afterwards by `trimTrailingPunctuation` rather than handled inside a regex, since doing it with a
 * backreference-in-lookbehind is quadratic on paren-heavy input. Every step is linear in the
 * length of `text`.
 */
export function* matchLinks(text: string): Generator<LinkMatch> {
  // Local rather than module-level: its `lastIndex` has to survive across this generator's yields.
  const schemeRegex = /https?:\/\//gi

  let scheme: RegExpExecArray | null
  while ((scheme = schemeRegex.exec(text))) {
    const hostStart = schemeRegex.lastIndex
    HOST_REGEX.lastIndex = hostStart
    const hostRun = HOST_REGEX.exec(text)?.[0] ?? ''

    // A trailing dot ends the sentence rather than the hostname, and nothing after it belongs to
    // the link.
    let hostLength = hostRun.length
    while (hostRun[hostLength - 1] === '.') {
      hostLength--
    }
    if (!isValidHost(hostRun.slice(0, hostLength))) {
      continue
    }

    let end = hostStart + hostLength
    if (hostLength === hostRun.length) {
      PORT_REGEX.lastIndex = end
      if (PORT_REGEX.exec(text)) {
        end = PORT_REGEX.lastIndex
      }
      PATH_REGEX.lastIndex = end
      if (PATH_REGEX.exec(text)) {
        end = PATH_REGEX.lastIndex
      }
    }

    yield {
      type: 'link',
      text: trimTrailingPunctuation(text.slice(scheme.index, end)),
      index: scheme.index,
    }
    schemeRegex.lastIndex = end
  }
}
