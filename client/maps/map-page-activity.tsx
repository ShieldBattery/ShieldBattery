import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { getErrorStack } from '../../common/errors'
import { MapPageSubPage, urlForMap } from '../../common/map-url'
import { SbMapId } from '../../common/maps'
import { navigateToGameResults } from '../games/action-creators'
import { GameListEntry } from '../games/game-list-entry'
import { LiveGameEntry } from '../games/live-game-entry'
import { graphql } from '../gql'
import { LoadErrorRow } from '../lists/load-error-row'
import { LobbyRow } from '../lobbies/browser/lobby-row'
import { compareSummaries, LobbyBrowserSort } from '../lobbies/browser/summary-utils'
import { navigateToLobby } from '../lobbies/lobby-url'
import { SectionLabel } from '../lobbies/room/room-parts'
import logger from '../logging/logger'
import { TextButton } from '../material/button'
import { elevationPlus1 } from '../material/shadows'
import { push } from '../navigation/routing'
import siteSocket from '../network/site-socket'
import { LoadingDotsArea } from '../progress/dots'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { getMapGames } from './action-creators'

/** How many of a map's latest games its page lists before linking to all of them. */
const RECENT_GAMES_COUNT = 5

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionHeader = styled.div`
  min-height: 36px;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const GameRows = styled.div`
  /* The rows adapt their cells to the width they're given, see game-list-entry.tsx. */
  container: game-list-rows / inline-size;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

/** The latest games played on a map, linking to the full, filterable list. */
export function MapRecentGames({ mapId, mapName }: { mapId: SbMapId; mapName: string }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [gameIds, setGameIds] = useState<ReadonlyArray<string>>()
  const [loadError, setLoadError] = useState<Error>()
  const [retries, setRetries] = useState(0)
  const gamesById = useAppSelector(s => s.games.byId)
  // Shared with every games list: hides game lengths and results for people avoiding spoilers.
  const [spoilerFree] = useUserLocalStorageValue('gamesSpoilerFree', false)

  useEffect(() => {
    const controller = new AbortController()
    dispatch(
      getMapGames(
        mapId,
        {},
        {
          signal: controller.signal,
          onSuccess: result => {
            setLoadError(undefined)
            setGameIds(result.games.slice(0, RECENT_GAMES_COUNT).map(g => g.id))
          },
          onError: err => {
            logger.error(`Failed to load the games played on map ${mapId}: ${getErrorStack(err)}`)
            setLoadError(err)
          },
        },
      ),
    )

    return () => controller.abort()
  }, [dispatch, mapId, retries])

  let content: React.ReactNode
  if (loadError && !gameIds) {
    content = (
      <LoadErrorRow
        message={t('maps.page.recentGamesError', "Couldn't load the games played on this map")}
        onRetry={() => setRetries(r => r + 1)}
      />
    )
  } else if (!gameIds) {
    content = <LoadingDotsArea />
  } else if (!gameIds.length) {
    return null
  } else {
    content = (
      <GameRows>
        {gameIds.map(id => {
          const game = gamesById.get(id)
          return game ? (
            <GameListEntry
              key={id}
              game={game}
              showResult={true}
              spoilerFree={spoilerFree}
              onClick={gameId => navigateToGameResults(gameId)}
            />
          ) : null
        })}
      </GameRows>
    )
  }

  return (
    <Section>
      <SectionHeader>
        <SectionLabel>{t('maps.page.recentGames', 'Recent games')}</SectionLabel>
        {gameIds?.length ? (
          <TextButton
            label={t('maps.page.allGames', 'All games on this map')}
            iconEnd='arrow_forward'
            onClick={() => push(urlForMap(mapId, mapName, MapPageSubPage.Games))}
          />
        ) : null}
      </SectionHeader>
      {content}
    </Section>
  )
}

const LobbyRows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

/**
 * The open lobbies currently playing a map, from the lobby list. Needs the site socket, so it's
 * only there for logged-in viewers.
 */
export function MapOpenLobbies({ mapId }: { mapId: SbMapId }) {
  const { t } = useTranslation()
  const isConnected = useAppSelector(s => s.network.isConnected)
  const lobbyList = useAppSelector(s => s.lobbyList.list)
  const lobbiesById = useAppSelector(s => s.lobbyList.byId)
  const currentLobbyId = useAppSelector(s => s.lobby.info.id)

  useEffect(() => {
    if (!isConnected) {
      return () => {}
    }

    siteSocket.invoke('/lobbies/subscribe').catch(err => {
      logger.error(`Failed to subscribe to lobbies list: ${getErrorStack(err)}`)
    })
    return () => {
      siteSocket.invoke('/lobbies/unsubscribe').catch(err => {
        logger.warning(`Failed to unsubscribe from lobbies: ${getErrorStack(err)}`)
      })
    }
  }, [isConnected])

  if (!isConnected) {
    return null
  }

  const lobbies = lobbyList
    .map(id => lobbiesById.get(id))
    .filter(summary => summary?.map.id === mapId)
    .map(summary => summary!)
    .sort((a, b) => compareSummaries(a, b, LobbyBrowserSort.Newest))
  if (!lobbies.length) {
    return null
  }

  return (
    <Section>
      <SectionHeader>
        <SectionLabel>{t('maps.page.openLobbies', 'Open lobbies')}</SectionLabel>
      </SectionHeader>
      <LobbyRows>
        {lobbies.map(summary => (
          <LobbyRow
            key={summary.id}
            summary={summary}
            selected={false}
            friendIds={[]}
            isOwn={summary.id === currentLobbyId}
            joinDisabled={false}
            onSelect={() => navigateToLobby(summary.id, summary.name)}
            onJoin={() => navigateToLobby(summary.id, summary.name)}
          />
        ))}
      </LobbyRows>
    </Section>
  )
}

const MapLiveGamesQuery = graphql(/* GraphQL */ `
  query MapLiveGames {
    liveGames {
      id
      map {
        id
      }
      ...LiveGames_FeedEntryFragment
    }
  }
`)

/**
 * The live games change by the minute, so they're refetched after a short while. Doesn't suspend, as
 * the section just appears once there's something to show. Module-level so the query sees the same
 * context every render (a new object would make it start over).
 */
const LIVE_GAMES_CONTEXT = { ttl: 10 * 1000, suspense: false }

const LiveGameEntries = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
`

const StyledLiveGameEntry = styled(LiveGameEntry)`
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};
  border-radius: 4px;
`

/** The ranked games being played on a map right now, among the live games the site features. */
export function MapLiveGames({ mapIds }: { mapIds: ReadonlyArray<SbMapId> }) {
  const { t } = useTranslation()
  const [{ data }] = useQuery({
    query: MapLiveGamesQuery,
    context: LIVE_GAMES_CONTEXT,
  })

  const games = data?.liveGames.filter(game => mapIds.includes(game.map.id)) ?? []
  if (!games.length) {
    return null
  }

  return (
    <Section>
      <SectionHeader>
        <SectionLabel>{t('maps.page.liveNow', 'Live now')}</SectionLabel>
      </SectionHeader>
      <LiveGameEntries>
        {games.map(game => (
          <StyledLiveGameEntry key={game.id} query={game} />
        ))}
      </LiveGameEntries>
    </Section>
  )
}
