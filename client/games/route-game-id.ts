import { Tagged } from 'type-fest'
import { decodePrettyId, encodePrettyId, isPrettyId } from '../../common/pretty-id'
import { ALL_RESULTS_SUB_PAGES, ResultsSubPage } from './results-sub-page'

/**
 * The ID of a game as used in routes (equivalent to the DB one, just encoded in a way that
 * looks more friendly in URLs).
 */
export type RouteGameId = Tagged<string, 'RouteGameId'>

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

/**
 * Returns the game a results page path (`/games/<routeId>` or `/games/<routeId>/<subPage>`) points
 * at, or undefined if the path isn't a game results path or its id segment doesn't decode.
 */
export function gameFromPath(
  pathname: string,
): { gameId: string; subPage: ResultsSubPage | undefined } | undefined {
  const segments = pathname.split('/').filter(segment => segment.length > 0)
  if (segments.length < 2 || segments.length > 3 || segments[0] !== 'games') {
    return undefined
  }

  const routeId = segments[1]
  if (!isPrettyId(routeId)) {
    return undefined
  }

  const subPage = ALL_RESULTS_SUB_PAGES.includes(segments[2] as ResultsSubPage)
    ? (segments[2] as ResultsSubPage)
    : undefined
  return { gameId: decodePrettyId(routeId), subPage }
}
