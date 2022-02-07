import React from 'react'
import { useRoute } from 'wouter'
import { replace } from '../navigation/routing'
import { ConnectedGameResultsPage } from './results'
import { ALL_RESULTS_SUB_PAGES, ResultsSubPage } from './results-sub-page'

export function GamesRouteComponent(props: { params: any }) {
  const [matches, params] = useRoute<{ gameId: string; subPage?: string }>(
    '/games/:gameId/:subPage?',
  )

  if (!matches) {
    queueMicrotask(() => {
      replace('/')
    })
    return null
  }

  const subPage = ALL_RESULTS_SUB_PAGES.includes(params!.subPage as ResultsSubPage)
    ? (params!.subPage as ResultsSubPage)
    : undefined

  return <ConnectedGameResultsPage gameId={params!.gameId} subPage={subPage} />
}
