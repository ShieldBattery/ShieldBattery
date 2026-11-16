import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useSelfUser } from '../auth/auth-utils'
import { OutlinedButton, TextButton } from '../material/button'
import { TabItem, Tabs } from '../material/tabs'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { getMatchHistory } from '../users/action-creators'
import { getGames } from './action-creators'
import { GameListFilters, GameListView } from './game-list-view'
import { AllGamesBrowse, GamesTab, MyGamesBrowse, SeeAllTarget } from './games-browse'
import { GameListSearchPage } from './use-game-list-search'

// ---- Layout ----------------------------------------------------------------------------------

const PageColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
  padding: 24px 0;
`

const PageHeader = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 16px;
`

const TabsArea = styled.div`
  flex: 1 1 360px;
  max-width: 480px;
`

const HeaderActions = styled.div`
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
`

/** The URL `view` param's value for the filtered list (absent means the browse view). */
const LIST_VIEW = 'list'

/** Builds the games page URL for a tab and view, with the given list filters. */
function gamesPageUrl(tab: GamesTab, list: boolean, params: Readonly<Record<string, string>> = {}) {
  const search = new URLSearchParams()
  if (tab === 'mine') {
    search.set('tab', 'mine')
  }
  if (list) {
    search.set('view', LIST_VIEW)
  }
  for (const [key, value] of Object.entries(params)) {
    search.set(key, value)
  }
  const searchString = search.toString()
  return '/games' + (searchString ? `?${searchString}` : '')
}

// ---- Main component --------------------------------------------------------------------------

/**
 * The games page: a browse view of shelves (All games, and My games when signed in), and behind
 * it the filtered list that "See all" and the Filters button open. Which one shows, and the
 * list's filters, live in the URL, so back and forward move between them.
 */
export function GameList() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const [tabParam] = useLocationSearchParam('tab')
  const [viewParam] = useLocationSearchParam('view')
  const tab: GamesTab = tabParam === 'mine' && selfUser ? 'mine' : 'all'
  const showList = viewParam === LIST_VIEW

  // The games list virtualizes against this container and remembers its scroll position itself.
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null)

  const loadAllGamesPage = (
    filters: GameListFilters,
    offset: number,
    signal: AbortSignal,
  ): Promise<GameListSearchPage> =>
    new Promise((resolve, reject) => {
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

  const loadMyGamesPage = (
    filters: GameListFilters,
    offset: number,
    signal: AbortSignal,
  ): Promise<GameListSearchPage> =>
    new Promise((resolve, reject) => {
      dispatch(
        getMatchHistory(
          selfUser!.id,
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

  const onSeeAll = (target: SeeAllTarget) => push(gamesPageUrl(target.tab, true, target.params))

  let content: React.ReactNode
  if (showList && tab === 'mine') {
    content = (
      <GameListView
        key='mine'
        loadPage={loadMyGamesPage}
        surface='matchHistory'
        scrollParent={scrollParent}
        showRankedCustom={true}
        showResult={true}
        forUserId={selfUser!.id}
        noResultsText={t('user.matchHistory.noMatchingGames', 'No matching games.')}
        errorText={t(
          'user.matchHistory.retrievingError',
          'There was an error retrieving the match history.',
        )}
      />
    )
  } else if (showList) {
    content = (
      <GameListView
        key='all'
        loadPage={loadAllGamesPage}
        surface='games'
        scrollParent={scrollParent}
        showSourceFilter={true}
        showResult={true}
        noResultsText={t('games.list.noMatchingGames', 'No matching games.')}
        errorText={t('games.list.retrievingError', 'There was an error retrieving the games.')}
      />
    )
  } else if (tab === 'mine') {
    content = <MyGamesBrowse key='mine' onSeeAll={onSeeAll} />
  } else {
    content = <AllGamesBrowse key='all' onSeeAll={onSeeAll} />
  }

  return (
    <CenteredContentContainer $fullWidth={true} data-content-fullbleed='' ref={setScrollParent}>
      <PageColumn>
        <PageHeader>
          <TabsArea>
            <Tabs activeTab={tab} onChange={value => push(gamesPageUrl(value, false))}>
              <TabItem text={t('games.browse.tabs.all', 'All games')} value='all' />
              {selfUser ? (
                <TabItem text={t('games.browse.tabs.mine', 'My games')} value='mine' />
              ) : null}
            </Tabs>
          </TabsArea>
          <HeaderActions>
            {showList ? (
              <TextButton
                label={t('games.browse.back', 'Browse')}
                iconStart='arrow_back'
                onClick={() => push(gamesPageUrl(tab, false))}
              />
            ) : (
              <OutlinedButton
                label={t('games.browse.searchAndFilter', 'Search and filter')}
                iconStart='search'
                onClick={() => push(gamesPageUrl(tab, true))}
              />
            )}
          </HeaderActions>
        </PageHeader>

        {content}
      </PageColumn>
    </CenteredContentContainer>
  )
}
