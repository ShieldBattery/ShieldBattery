import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { GameSourceFilter } from '../../common/games/game-filters'
import { FragmentType, graphql, useFragment } from '../gql'
import { elevationPlus1 } from '../material/shadows'
import { useLocationSearchParam, useScrollMemory } from '../navigation/router-hooks'
import { useAppDispatch } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { singleLine, titleLarge } from '../styles/typography'
import { getGames } from './action-creators'
import { parseSource } from './game-filter-url'
import { GameListFilters, GameListView } from './game-list-view'
import { LiveGameEntry, LiveGames_FeedFragment } from './live-game-entry'
import { GameListSearchPage } from './use-game-list-search'

// ---- Layout ----------------------------------------------------------------------------------

const PageColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 100%;
  padding: 24px 0;
`

const Title = styled.div`
  ${titleLarge};
  ${singleLine};
`

const GameEntriesRoot = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  padding-top: 8px;
`

const StyledLiveGameEntry = styled(LiveGameEntry)`
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};
`

const GamesListQuery = graphql(/* GraphQL */ `
  query GamesPageContent {
    ...LiveGames_FeedFragment
  }
`)

function LiveGamesFeed({ query }: { query?: FragmentType<typeof LiveGames_FeedFragment> }) {
  const { t } = useTranslation()
  const { liveGames } = useFragment(LiveGames_FeedFragment, query) ?? { liveGames: [] }

  return liveGames.length > 0 ? (
    <div>
      <Title>{t('games.liveGames.title', 'Live games')}</Title>
      <GameEntriesRoot>
        {liveGames.map(liveGame => (
          <StyledLiveGameEntry key={liveGame.id} query={liveGame} />
        ))}
      </GameEntriesRoot>
    </div>
  ) : null
}

// ---- Main component --------------------------------------------------------------------------

export function GameList() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const scrollerRef = useRef<HTMLDivElement>(null)
  useScrollMemory(scrollerRef)

  // TODO(marko): Figure out if we particularly care about the errors when loading this, since we're
  // hiding the live games feed if there are no live games anyway.
  // TODO(marko): This is a one-shot query (nothing re-executes it), so finished games linger in the
  // "Live games" section and can briefly show up in both sections. Matches the home feed for now,
  // but if this page is meant to feel live we should re-run it periodically.
  const [{ data }] = useQuery({ query: GamesListQuery, context: { ttl: 10 * 1000 } })

  // The live-games feed is matchmaking-only (`load_live_games` filters by source server-side), so
  // showing it above a list filtered to custom games would contradict the filter.
  const [sourceParam] = useLocationSearchParam('source')
  const showLiveGames = parseSource(sourceParam) !== GameSourceFilter.Custom

  const loadPage = (
    filters: GameListFilters,
    offset: number,
    signal: AbortSignal,
  ): Promise<GameListSearchPage> => {
    return new Promise((resolve, reject) => {
      dispatch(
        getGames(
          { ...filters, offset },
          {
            signal,
            onSuccess: result => {
              resolve({ gameIds: result.games.map(g => g.id), hasMoreGames: result.hasMoreGames })
            },
            onError: err => reject(err),
          },
        ),
      )
    })
  }

  return (
    <CenteredContentContainer $fullWidth={true} data-content-fullbleed='' ref={scrollerRef}>
      <PageColumn>
        {showLiveGames ? <LiveGamesFeed query={data} /> : null}

        <GameListView
          loadPage={loadPage}
          showSourceFilter={true}
          showResult={true}
          noResultsText={t('games.list.noMatchingGames', 'No matching games.')}
          errorText={t('games.list.retrievingError', 'There was an error retrieving the games.')}
        />
      </PageColumn>
    </CenteredContentContainer>
  )
}
