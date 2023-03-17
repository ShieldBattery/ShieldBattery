import { Opaque } from 'type-fest'
import { decodePrettyId, encodePrettyId } from '../../common/pretty-id'

/**
 * The ID of a game as used in routes (equivalent to the DB one, just encoded in a way that
 * looks more friendly in URLs).
 */
export type RouteGameId = Opaque<string, 'RouteGameId'>

export function toRouteGameId(id: string): RouteGameId {
  return encodePrettyId(id) as RouteGameId
}

export function fromRouteGameId(id: RouteGameId): string {
  return decodePrettyId(id)
}

/**
 * Converts a game route ID string to a properly typed version. Prefer better ways of getting a
 * typed version. This method should mainly be considered for testing and internal behavior.
 */
export function makeRouteGameId(id: string): RouteGameId {
  return id as RouteGameId
}
