import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useRoute } from 'wouter'
import { CenteredContentContainer } from '../styles/centered-container'
import { bodyLarge } from '../styles/typography'
import { GameList } from './game-list'
import { ConnectedGameResultsPage } from './results'
import { ALL_RESULTS_SUB_PAGES, ResultsSubPage } from './results-sub-page'
import { fromRouteGameId, makeRouteGameId } from './route-game-id'

const NotFoundText = styled.div`
  ${bodyLarge};
  padding: 32px 16px;
  color: var(--theme-on-surface-variant);
  text-align: center;
`

export function GamesRouteComponent() {
  const { t } = useTranslation()
  const [matches, params] = useRoute('/games/:routeId?/:subPage?')

  if (!matches) {
    return null
  }

  if (!params.routeId) {
    return (
      <CenteredContentContainer>
        <GameList />
      </CenteredContentContainer>
    )
  }

  // Game route ids are encoded ("pretty") game ids, so an arbitrary/mistyped URL segment may not
  // decode at all — that's an unknown game, not an application error.
  let gameId: string
  try {
    gameId = fromRouteGameId(makeRouteGameId(params.routeId))
  } catch (err) {
    return (
      <CenteredContentContainer>
        <NotFoundText>{t('gameDetails.notFound', 'This game could not be found.')}</NotFoundText>
      </CenteredContentContainer>
    )
  }

  const subPage = ALL_RESULTS_SUB_PAGES.includes(params.subPage as ResultsSubPage)
    ? (params.subPage as ResultsSubPage)
    : undefined

  return <ConnectedGameResultsPage gameId={gameId} subPage={subPage} />
}
