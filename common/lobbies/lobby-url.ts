import slug from 'slug'
import { isPrettyId } from '../pretty-id'
import { urlPath } from '../urls'
import { makeSbLobbyId, SbLobbyId } from './sb-lobby-id'

/**
 * Returns the URL slug for a lobby name, falling back to a `_` placeholder when the name is
 * unknown/empty or slugs to nothing (`slug`'s default config base64-encodes otherwise-unsluggable
 * names rather than returning an empty string, but this guard doesn't rely on that). Both URL
 * construction and slug correction must use this so they can't disagree and cause a redirect loop.
 */
export function lobbySlug(name: string | undefined): string {
  return (name ? slug(name) : '') || '_'
}

/**
 * Returns the URL for a particular lobby. If the lobby's name is available, the URL will include
 * a slug (otherwise there will be a redirect once the data has loaded).
 */
export function urlForLobby(id: SbLobbyId, name?: string): string {
  return urlPath`/lobbies/${id}/${lobbySlug(name)}`
}

/**
 * Returns the lobby id from a lobby URL path (`/lobbies/<id>` or `/lobbies/<id>/<slug>`), or
 * undefined if the path isn't a lobby path or the id segment isn't a valid pretty id.
 */
export function lobbyIdFromPath(pathname: string): SbLobbyId | undefined {
  const segments = pathname.split('/').filter(segment => segment.length > 0)
  if (segments.length < 2 || segments[0] !== 'lobbies') {
    return undefined
  }

  const id = segments[1]
  return isPrettyId(id) ? makeSbLobbyId(id) : undefined
}
