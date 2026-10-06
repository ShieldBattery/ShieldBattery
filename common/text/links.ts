// The regexes below are sticky (`y`) so they only match at the `lastIndex` they're given. They're
// only used synchronously between a generator's yields, so sharing them across calls is safe.

/**
 * A run of characters that can make up a hostname: letters, combining marks and digits from any
 * script (so internationalized domain names match as written), hyphens and dots.
 */
const HOST_REGEX = /[\p{L}\p{M}\p{Nd}.-]+/uy
/**
 * An IPv6 address in brackets (RFC 3986). 45 characters is the longest an IPv6 address can be
 * written (eight groups with an IPv4 tail). Zone identifiers (`[fe80::1%25en0]`, RFC 6874) aren't
 * matched: the WHATWG URL parser browsers use rejects them, so such a link couldn't be opened.
 */
const IPV6_HOST_REGEX = /\[([0-9a-f:.]{2,45})\]/iy
const PORT_REGEX = /:\d+/y
/**
 * The path, query and fragment, which must start right after the host (or port). Angle brackets
 * are never part of a URL as typed, so a link written as `<http://example.org>` stops before `>`.
 */
const PATH_REGEX = /[/?#][^\s"\]<>]*/y

const MAX_HOST_LENGTH = 253
const MAX_LABEL_LENGTH = 63
const ASCII_DIGITS_REGEX = /^[0-9]+$/
const IPV6_GROUP_REGEX = /^[0-9a-f]{1,4}$/i
/** A decimal IPv4 octet, without the leading zeros the WHATWG IPv6 parser rejects. */
const IPV4_IN_IPV6_OCTET_REGEX = /^(0|[1-9][0-9]{0,2})$/

function isValidIpv4(labels: string[]): boolean {
  return labels.length === 4 && labels.every(label => label.length <= 3 && Number(label) <= 255)
}

/**
 * Returns whether `address` (without its brackets) is an IPv6 address: up to eight groups of 1-4
 * hex digits separated by colons, at most one `::` standing in for one or more zero groups, and
 * optionally a dotted IPv4 address in place of the last two groups (`::ffff:192.0.2.1`).
 */
function isValidIpv6(address: string): boolean {
  const halves = address.split('::')
  if (halves.length > 2) {
    return false
  }

  let groups = halves.flatMap(half => (half === '' ? [] : half.split(':')))
  let groupCount = groups.length
  const lastGroup = groups.at(-1)
  if (lastGroup?.includes('.') && !address.endsWith(':')) {
    const octets = lastGroup.split('.')
    if (!isValidIpv4(octets) || !octets.every(octet => IPV4_IN_IPV6_OCTET_REGEX.test(octet))) {
      return false
    }
    groups = groups.slice(0, -1)
    groupCount++
  }
  if (!groups.every(group => IPV6_GROUP_REGEX.test(group))) {
    return false
  }

  return halves.length === 2 ? groupCount <= 7 : groupCount === 8
}

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
    return isValidIpv4(labels)
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

/**
 * Matches the host of a link starting at `start`: either a bracketed IPv6 address or a hostname
 * that passes `isValidHost`. Returns the index just past it, and whether the link ends there (a
 * hostname followed by a sentence-ending dot, which belongs to neither the host nor anything after
 * it), or undefined if there's no valid host at `start`.
 */
function matchHost(text: string, start: number): { end: number; endsLink: boolean } | undefined {
  if (text[start] === '[') {
    IPV6_HOST_REGEX.lastIndex = start
    const address = IPV6_HOST_REGEX.exec(text)?.[1]
    return address !== undefined && isValidIpv6(address)
      ? { end: IPV6_HOST_REGEX.lastIndex, endsLink: false }
      : undefined
  }

  HOST_REGEX.lastIndex = start
  const hostRun = HOST_REGEX.exec(text)?.[0] ?? ''
  let hostLength = hostRun.length
  while (hostRun[hostLength - 1] === '.') {
    hostLength--
  }
  return isValidHost(hostRun.slice(0, hostLength))
    ? { end: start + hostLength, endsLink: hostLength < hostRun.length }
    : undefined
}

export interface LinkMatch {
  type: 'link'
  text: string
  index: number
}

/**
 * Returns a generator of matches for links within the specified `text`. A link must start with
 * "http(s)://", followed by a host (see `matchHost`), then an optional port and the broad run of
 * URL-ish characters after it. Trailing punctuation that more likely belongs to the surrounding
 * sentence (an unbalanced closing paren, a sentence-ending period) is trimmed off afterwards by
 * `trimTrailingPunctuation` rather than handled inside a regex, since doing it with a
 * backreference-in-lookbehind is quadratic on paren-heavy input. Every step is linear in the
 * length of `text`.
 */
export function* matchLinks(text: string): Generator<LinkMatch> {
  // Local rather than module-level: its `lastIndex` has to survive across this generator's yields.
  const schemeRegex = /https?:\/\//gi

  let scheme: RegExpExecArray | null
  while ((scheme = schemeRegex.exec(text))) {
    const host = matchHost(text, schemeRegex.lastIndex)
    if (!host) {
      continue
    }

    let end = host.end
    if (!host.endsLink) {
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
