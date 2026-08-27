import { lobbyIdFromPath } from '../common/lobbies/lobby-url'
import { SbLobbyId } from '../common/lobbies/sb-lobby-id'

/** Deep link argv entries over this length are dropped unparsed; no allowlisted route needs it. */
export const MAX_DEEP_LINK_ARG_LENGTH = 512

/**
 * Matches any argument carrying a URI scheme with an authority (RFC 3986 scheme grammar).
 * Deliberately broader than the app's own deep-link scheme: an argument that names ANY scheme is
 * never a filesystem path, so it must not reach filesystem-path handling (`path.resolve`, the
 * replay loader) no matter what its path portion ends with.
 */
const URI_ARG_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i

export interface LaunchArgs {
  /** Local replay file paths, exactly as passed (not resolved to absolute). */
  replayPaths: string[]
  /** The lobby id from the newest well-formed deep link argument, if there was one. */
  deepLinkLobbyId?: SbLobbyId
}

/**
 * Classifies untrusted launch arguments (an external process placed them on the command line)
 * into local replay paths and at most one deep-linked lobby id. Every argument lands in exactly
 * one bucket: a `--` flag (ignored here), a URI (only the app's own scheme with an allowlisted
 * route yields anything; all other URIs are dropped), or a candidate file path (only `.rep`
 * files are kept). The newest valid deep link wins: someone who clicked several lobby links in a
 * row wants the last one, not a queue of every click.
 */
export function classifyLaunchArgs(args: string[], deepLinkScheme: string): LaunchArgs {
  const expectedProtocol = `${deepLinkScheme}:`
  const replayPaths: string[] = []
  let deepLinkLobbyId: SbLobbyId | undefined

  for (const arg of args) {
    if (arg.startsWith('--')) {
      continue
    }
    if (URI_ARG_PATTERN.test(arg)) {
      const lobbyId = parseDeepLinkLobbyId(arg, expectedProtocol)
      if (lobbyId !== undefined) {
        deepLinkLobbyId = lobbyId
      }
      continue
    }
    if (arg.toLowerCase().endsWith('.rep')) {
      replayPaths.push(arg)
    }
  }

  return { replayPaths, deepLinkLobbyId }
}

/**
 * Parses one URI-shaped argument into a lobby id, or `undefined` unless it is this channel's own
 * scheme carrying a well-formed, allowlisted route. `URL` lowercases the scheme while parsing, so
 * the protocol comparison is case-insensitive by construction. The only output is an internal
 * lobby id -- never a URL or path handed onward.
 */
function parseDeepLinkLobbyId(arg: string, expectedProtocol: string): SbLobbyId | undefined {
  if (arg.length > MAX_DEEP_LINK_ARG_LENGTH) {
    return undefined
  }

  let url: URL
  try {
    url = new URL(arg)
  } catch {
    return undefined
  }
  if (url.protocol !== expectedProtocol) {
    return undefined
  }

  // A custom-scheme URL of the form `<scheme>://lobbies/<id>` parses with the `//`-authority
  // segment as `host` and the rest as `pathname`, so rebuild it into the path shape
  // `lobbyIdFromPath` already validates for the equivalent https lobby link.
  return lobbyIdFromPath('/' + url.host + url.pathname)
}
