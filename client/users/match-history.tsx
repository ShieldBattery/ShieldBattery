import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { GameListFilters, GameListView } from '../games/game-list-view'
import { GameListSearchPage } from '../games/use-game-list-search'
import { useAppDispatch } from '../redux-hooks'
import { getMatchHistory } from './action-creators'

const MatchHistoryContainer = styled.div`
  width: 100%;
  padding: 0 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

export function ConnectedMatchHistory({ userId }: { userId: SbUserId }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const loadPage = (
    filters: GameListFilters,
    offset: number,
    signal: AbortSignal,
  ): Promise<GameListSearchPage> => {
    return new Promise((resolve, reject) => {
      dispatch(
        getMatchHistory(
          userId,
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
    <MatchHistoryContainer>
      <GameListView
        loadPage={loadPage}
        showRankedCustom={true}
        showResult={true}
        forUserId={userId}
        noResultsText={t('user.matchHistory.noMatchingGames', 'No matching games.')}
        errorText={t(
          'user.matchHistory.retrievingError',
          'There was an error retrieving the match history.',
        )}
      />
    </MatchHistoryContainer>
  )
}
