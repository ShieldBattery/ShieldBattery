import React from 'react'
import { useRoute } from 'wouter'
import { ALL_RESULTS_SUB_PAGES, ResultsSubPage } from './results-sub-page.js'
import { ConnectedGameResultsPage } from './results.js'
import { fromRouteGameId, makeRouteGameId } from './route-game-id.js'

export function GamesRouteComponent() {
  const [matches, params] = useRoute('/games/:routeId/:subPage?')

  if (!matches) {
    return null
  }

  const gameId = fromRouteGameId(makeRouteGameId(params.routeId))

  const subPage = ALL_RESULTS_SUB_PAGES.includes(params.subPage as ResultsSubPage)
    ? (params.subPage as ResultsSubPage)
    : undefined

  return <ConnectedGameResultsPage gameId={gameId} subPage={subPage} />
}
