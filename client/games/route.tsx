import React from 'react'
import styled from 'styled-components'
import { useRoute } from 'wouter'
import { ComingSoon } from '../coming-soon/coming-soon'
import { ConnectedGameResultsPage } from './results'
import { ALL_RESULTS_SUB_PAGES, ResultsSubPage } from './results-sub-page'
import { fromRouteGameId, makeRouteGameId } from './route-game-id'

const ComingSoonContainer = styled.div`
  margin-top: 24px;
  text-align: center;
`

export function GamesRouteComponent() {
  const [matches, params] = useRoute('/games/:routeId?/:subPage?')

  if (!matches) {
    return null
  }

  if (!params.routeId) {
    return (
      <ComingSoonContainer>
        <ComingSoon />
      </ComingSoonContainer>
    )
  }

  const gameId = fromRouteGameId(makeRouteGameId(params.routeId))

  const subPage = ALL_RESULTS_SUB_PAGES.includes(params.subPage as ResultsSubPage)
    ? (params.subPage as ResultsSubPage)
    : undefined

  return <ConnectedGameResultsPage gameId={gameId} subPage={subPage} />
}
