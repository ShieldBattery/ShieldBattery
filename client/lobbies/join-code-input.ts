import { ALL_DEEP_LINK_SCHEMES } from '../../common/deep-links'
import { isValidJoinCode, normalizeJoinCode } from '../../common/lobbies/join-code'
import { lobbyIdFromPath } from '../../common/lobbies/lobby-url'
import { makeSbLobbyId, SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { isPrettyId } from '../../common/pretty-id'
import { lobbyIdFromMessageLink } from './lobby-invite-card'

/**
 * What a piece of raw user input to the "enter a join code" flow turned out to be: a join code to
 * resolve against the server, or a lobby id to navigate to directly (already known from the input
 * itself, with no resolution needed).
 */
export type JoinCodeInput = { kind: 'code'; code: string } | { kind: 'lobbyId'; id: SbLobbyId }

/**
 * Classifies raw text typed or pasted into the "enter a join code" input, trying each accepted
 * shape in turn: a join code, an absolute lobby URL (either the app/server's https origin or any
 * channel's registered deep-link scheme), or a bare lobby id. Returns `undefined` if none of
 * those match.
 *
 * A scheme URL's authority becomes its `host` rather than a leading path segment (e.g.
 * `shieldbattery://lobbies/<id>` parses with `host === 'lobbies'`), so its path is rebuilt as
 * `/<host><pathname>` before reusing the same path parser as an https link.
 */
export function parseJoinCodeInput(input: string): JoinCodeInput | undefined {
  const normalizedCode = normalizeJoinCode(input)
  if (isValidJoinCode(normalizedCode)) {
    return { kind: 'code', code: normalizedCode }
  }

  const trimmed = input.trim()

  let url: URL | undefined
  try {
    url = new URL(trimmed)
  } catch {
    url = undefined
  }

  if (url) {
    if (url.protocol === 'https:') {
      const id = lobbyIdFromMessageLink(trimmed)
      if (id) {
        return { kind: 'lobbyId', id }
      }
    } else if (ALL_DEEP_LINK_SCHEMES.includes(url.protocol.slice(0, -1))) {
      // `URL` lowercases the protocol while parsing (and leaves a trailing `:` to strip), so this
      // is an exact, case-insensitive match against the schemes the app actually registers --
      // resembling them isn't enough.
      const id = lobbyIdFromPath('/' + url.host + url.pathname)
      if (id) {
        return { kind: 'lobbyId', id }
      }
    }
  }

  if (isPrettyId(trimmed)) {
    return { kind: 'lobbyId', id: makeSbLobbyId(trimmed) }
  }

  return undefined
}
