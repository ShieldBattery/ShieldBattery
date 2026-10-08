/** A YouTube video referenced by a URL, normalized to what an embed needs. */
export interface YoutubeVideo {
  id: string
  /** Where playback should start, in seconds, if the URL specified one. */
  startSeconds?: number
}

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const NOCOOKIE_HOSTS = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com'])
/** Path prefixes on the watch hosts whose next segment is the video ID. */
const ID_PATH_PREFIXES = new Set(['embed', 'shorts', 'live'])

/**
 * Parses a YouTube start time, which is either plain seconds (`90`, `90s`) or an `XhYmZs`
 * duration (`1m30s`). Returns `undefined` for anything else, including a zero start.
 */
function parseStartTime(value: string | null): number | undefined {
  if (!value) {
    return undefined
  }
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value)
  if (!match) {
    return undefined
  }
  const [, hours = '0', minutes = '0', seconds = '0'] = match
  const total = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
  return total > 0 ? total : undefined
}

/**
 * Returns the YouTube video a URL points at, or `undefined` if it isn't a recognized YouTube
 * video URL. Handles watch, short-link (`youtu.be`), Shorts, live, and embed URLs, including any
 * start time given in a `t` or `start` query param.
 */
export function parseYoutubeUrl(src: string): YoutubeVideo | undefined {
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return undefined
  }

  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(s => s.length > 0)
  let id: string | null | undefined
  if (host === 'youtu.be') {
    id = segments.length === 1 ? segments[0] : undefined
  } else if (WATCH_HOSTS.has(host)) {
    if (segments.length === 1 && segments[0] === 'watch') {
      id = url.searchParams.get('v')
    } else if (segments.length === 2 && ID_PATH_PREFIXES.has(segments[0])) {
      id = segments[1]
    }
  } else if (NOCOOKIE_HOSTS.has(host)) {
    id = segments.length === 2 && segments[0] === 'embed' ? segments[1] : undefined
  }

  if (!id || !VIDEO_ID_PATTERN.test(id)) {
    return undefined
  }

  const startSeconds = parseStartTime(url.searchParams.get('t') ?? url.searchParams.get('start'))
  return startSeconds !== undefined ? { id, startSeconds } : { id }
}
