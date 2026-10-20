import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { urlForMap } from '../../common/map-url'
import { SbMapId } from '../../common/maps'
import { GameListFilters, GameListView } from '../games/game-list-view'
import { GameListSearchPage } from '../games/use-game-list-search'
import { TextButton } from '../material/button'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { singleLine, titleLarge } from '../styles/typography'
import { getMapGames } from './action-creators'

const Root = styled.div`
  padding-block: 16px 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Header = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
`

const Title = styled.div`
  ${titleLarge};
  ${singleLine};
  max-width: 100%;
`

/**
 * The "games" sub-page of a map's page: every game played on the map, in the shared games-list UI
 * (the same one the games page and a league's games use).
 */
export function MapGamesPage({
  mapId,
  mapName,
  scrollParent,
}: {
  mapId: SbMapId
  /** The map's name, with color codes already removed. */
  mapName: string
  /** The page's scroll container, which the games list is virtualized against. */
  scrollParent: HTMLElement | null
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const loadPage = (
    filters: GameListFilters,
    offset: number,
    signal: AbortSignal,
  ): Promise<GameListSearchPage> => {
    return new Promise((resolve, reject) => {
      dispatch(
        getMapGames(
          mapId,
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
    <Root>
      <Header>
        <TextButton
          label={mapName}
          iconStart='arrow_back'
          onClick={() => push(urlForMap(mapId, mapName))}
        />
        <Title>{t('maps.page.gamesTitle', 'Games on this map')}</Title>
      </Header>
      <GameListView
        loadPage={loadPage}
        surface='map'
        scrollParent={scrollParent}
        showResult={true}
        showMapNameFilter={false}
        noResultsText={t('maps.page.noMatchingGames', 'No matching games.')}
        errorText={t('maps.page.gamesError', 'There was an error retrieving the games.')}
      />
    </Root>
  )
}
