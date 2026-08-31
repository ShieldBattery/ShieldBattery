import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LeagueId } from '../../common/leagues/leagues'
import { GameListFilters, GameListView } from '../games/game-list-view'
import { GameListSearchPage } from '../games/use-game-list-search'
import { useAppDispatch } from '../redux-hooks'
import { getLeagueGames } from './action-creators'

const LeagueGamesContainer = styled.div`
  width: 100%;
  padding: 0 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

/**
 * The "Games" tab of a league's details page: a paginated, filterable list of games played in
 * that league, backed by the shared games-list UI (the same one the games page and match history
 * use).
 */
export function LeagueGames({ leagueId }: { leagueId: LeagueId }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const loadPage = (
    filters: GameListFilters,
    offset: number,
    signal: AbortSignal,
  ): Promise<GameListSearchPage> => {
    return new Promise((resolve, reject) => {
      dispatch(
        getLeagueGames(
          leagueId,
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
    <LeagueGamesContainer>
      <GameListView
        loadPage={loadPage}
        surface='league'
        showResult={true}
        noResultsText={t('leagues.leagueGames.noMatchingGames', 'No matching games.')}
        errorText={t(
          'leagues.leagueGames.retrievingError',
          'There was an error retrieving the games.',
        )}
      />
    </LeagueGamesContainer>
  )
}
