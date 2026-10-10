import { decodePrettyId, isPrettyId } from '../pretty-id'
import { ALL_RESULTS_SUB_PAGES, ResultsSubPage } from './results-sub-page'

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
