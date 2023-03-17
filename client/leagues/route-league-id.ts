import { Opaque } from 'type-fest'
import { LeagueId } from '../../common/leagues'
import { decodePrettyId, encodePrettyId } from '../../common/pretty-id'

/**
 * The ID of a league as used in routes (equivalent to the DB one, just encoded in a way that
 * looks more friendly in URLs).
 */
export type RouteLeagueId = Opaque<string, 'RouteLeagueId'>

export function toRouteLeagueId(id: LeagueId): RouteLeagueId {
  return encodePrettyId(id) as RouteLeagueId
}

export function fromRouteLeagueId(id: RouteLeagueId): LeagueId {
  return decodePrettyId(id) as LeagueId
}

/**
 * Converts a client league ID string to a properly typed version. Prefer better ways of getting a
 * typed version, such as retrieving the value from the database or using a Joi validator. This
 * method should mainly be considered for testing and internal behavior.
 */
export function makeRouteLeagueId(id: string): RouteLeagueId {
  return id as RouteLeagueId
}
