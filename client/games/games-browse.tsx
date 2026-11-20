import { useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { encodeMatchup, GameDurationFilter, GameSortOption } from '../../common/games/game-filters'
import {
  GameBrowseMapCount,
  GameBrowseShelf,
  GameBrowseShelfId,
  GetGamesBrowseResponse,
  GetMyGamesBrowseResponse,
} from '../../common/games/games'
import { raceCharToLabel } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { useContextMenu } from '../dom/use-context-menu'
import { useMediaQuery } from '../dom/use-media-query'
import { graphql } from '../gql'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { IconButton } from '../material/button'
import { Popover, usePopoverController } from '../material/popover'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodyLarge, bodySmall, labelMedium, singleLine, titleMedium } from '../styles/typography'
import {
  browseGames,
  browseMyGames,
  getGameResultsUrl,
  navigateToGameResults,
} from './action-creators'
import { GameCardSize, GameRecordCard, getResultFor } from './game-card'
import { GameContextMenuContent } from './game-context-menu'
import { GameRecordSidePanel } from './game-record-side-panel'
import { GameShelf } from './game-shelf'
import { LiveGameCard } from './live-game-card'
import { SaveReplayMenuContent } from './save-replay-menu'

/** Viewport width below which there's no room for the side panel, so a card opens its game. */
const COMPACT_LAYOUT_QUERY = '(width < 1000px)'

/** How many of the viewer's most recent games the My games summary covers. */
const SUMMARY_GAMES = 10

export type GamesTab = 'all' | 'mine'

/** Where a shelf's "See all" leads: the games list with these URL params. */
export interface SeeAllTarget {
  tab: GamesTab
  params: Readonly<Record<string, string>>
}

const GamesBrowseLiveGamesQuery = graphql(/* GraphQL */ `
  query GamesBrowseLiveGames {
    liveGames {
      id
      ...GamesBrowse_LiveGameFragment
    }
  }
`)

const BrowseRoot = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 24px;
`

const ShelvesColumn = styled.div`
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 28px;
`

const PanelColumn = styled.div`
  flex-shrink: 0;
  width: 340px;
  position: sticky;
  top: 24px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const PanelClose = styled(IconButton)`
  align-self: flex-end;
`

const StyledSidePanel = styled(GameRecordSidePanel)`
  position: static;
  width: 100%;
`

const StateText = styled.div`
  ${bodyLarge};
  padding: 48px 0;
  text-align: center;
  color: var(--theme-on-surface-variant);
`

const MapTile = styled.button`
  position: relative;
  width: 196px;
  height: 150px;
  flex-shrink: 0;
  padding: 0;
  overflow: hidden;

  display: flex;
  flex-direction: column;
  justify-content: flex-end;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  background-color: var(--theme-container-low);
  background-size: cover;
  background-position: center;
  color: var(--theme-on-surface);
  text-align: left;
  cursor: pointer;

  &:hover {
    border-color: var(--theme-outline);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
    outline-offset: 2px;
  }
`

const MapTileInfo = styled.div`
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  background-color: rgb(from var(--theme-surface) r g b / 0.82);
`

const MapTileName = styled.div`
  ${titleMedium};
  ${singleLine};
`

const MapTileCount = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const SummaryRoot = styled.div`
  padding: 16px 24px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 24px;

  border-radius: 8px;
  background-color: var(--theme-container-low);
`

const SummaryRecord = styled.div`
  ${titleMedium};
  font-size: 32px;
  line-height: 40px;
  font-variant-numeric: tabular-nums;
`

const SummaryWins = styled.span`
  color: var(--theme-positive);
`

const SummaryLosses = styled.span`
  color: var(--theme-negative);
`

const SummaryLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const SummaryPips = styled.div`
  margin-left: auto;
  display: flex;
  gap: 4px;
`

const SummaryPip = styled.div<{ $win: boolean }>`
  ${labelMedium};
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  font-weight: 700;
  color: ${props => (props.$win ? 'var(--theme-positive)' : 'var(--theme-negative)')};
  background: color-mix(in srgb, currentColor 16%, transparent);
`

type BrowseData<T> = { status: 'loading' } | { status: 'error' } | { status: 'loaded'; data: T }

/** Loads one of the browse endpoints when mounted, aborting it if unmounted first. */
function useBrowseData<T>(
  load: (spec: { signal: AbortSignal; onSuccess: (data: T) => void; onError: () => void }) => void,
): BrowseData<T> {
  const [state, setState] = useState<BrowseData<T>>({ status: 'loading' })
  // Loaded once per mount; the parent remounts the view to load it again.
  const startLoad = useEffectEvent((signal: AbortSignal) => {
    load({
      signal,
      onSuccess: data => setState({ status: 'loaded', data }),
      onError: () => setState({ status: 'error' }),
    })
  })
  useEffect(() => {
    const controller = new AbortController()
    startLoad(controller.signal)
    return () => controller.abort()
  }, [])
  return state
}

/** The shelves a games tab shows: cards for its games plus selection, menus and the side panel. */
function useCardInteractions() {
  const { t } = useTranslation()
  const compactLayout = useMediaQuery(COMPACT_LAYOUT_QUERY)
  const [selectedId, setSelectedId] = useState<string>()
  const selectedGame = useAppSelector(s => (selectedId ? s.games.byId.get(selectedId) : undefined))
  const selectedReplayInfo = useAppSelector(s =>
    selectedId ? s.games.replayInfoById.get(selectedId) : undefined,
  )
  const { onContextMenu, contextMenuPopoverProps } = useContextMenu()
  const [saveMenuOpen, openSaveMenu, closeSaveMenu] = usePopoverController()

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === 'Escape' && selectedId) {
        setSelectedId(undefined)
        return true
      }
      return false
    },
  })

  const cardProps = {
    onSelect: (gameId: string) => {
      if (compactLayout) {
        navigateToGameResults(gameId)
      } else {
        setSelectedId(gameId)
      }
    },
    onOpen: (gameId: string) => navigateToGameResults(gameId),
    onContextMenu: (gameId: string, event: React.MouseEvent) => {
      setSelectedId(gameId)
      onContextMenu(event)
    },
  }

  return {
    compactLayout,
    selectedId,
    cardProps,
    overlays: (
      <>
        {selectedGame ? (
          <Popover {...contextMenuPopoverProps}>
            <GameContextMenuContent
              game={selectedGame}
              onDismiss={contextMenuPopoverProps.onDismiss}
              onOpenSaveMenu={openSaveMenu}
            />
          </Popover>
        ) : null}
        {selectedGame && selectedReplayInfo && IS_ELECTRON ? (
          <Popover
            open={saveMenuOpen}
            onDismiss={closeSaveMenu}
            anchorX={contextMenuPopoverProps.anchorX}
            anchorY={contextMenuPopoverProps.anchorY}
            originX={contextMenuPopoverProps.originX}
            originY={contextMenuPopoverProps.originY}>
            <SaveReplayMenuContent replayInfo={selectedReplayInfo} onDismiss={closeSaveMenu} />
          </Popover>
        ) : null}
      </>
    ),
    panel: (forUserId: SbUserId | undefined, spoilerFree: boolean) =>
      selectedGame && !compactLayout ? (
        <PanelColumn>
          <PanelClose
            icon={<MaterialIcon icon='close' />}
            title={t('common.actions.close', 'Close')}
            onClick={() => setSelectedId(undefined)}
          />
          <StyledSidePanel
            game={selectedGame}
            forUserId={forUserId}
            spoilerFree={spoilerFree}
            onViewResults={gameId => navigateToGameResults(gameId)}
          />
        </PanelColumn>
      ) : null,
  }
}

function RecordShelf({
  shelf,
  title,
  subtitle,
  size = 'regular',
  forUserId,
  spoilerFree,
  selectedId,
  cardProps,
  onSeeAll,
}: {
  shelf: GameBrowseShelf | undefined
  title: string
  subtitle?: string
  size?: GameCardSize
  forUserId?: SbUserId
  spoilerFree: boolean
  selectedId: string | undefined
  cardProps: ReturnType<typeof useCardInteractions>['cardProps']
  onSeeAll?: () => void
}) {
  if (!shelf?.gameIds.length) {
    return null
  }
  return (
    <GameShelf title={title} subtitle={subtitle} onSeeAll={onSeeAll}>
      {shelf.gameIds.map(id => (
        <GameRecordCard
          key={id}
          gameId={id}
          size={size}
          forUserId={forUserId}
          spoilerFree={spoilerFree}
          selected={id === selectedId}
          {...cardProps}
        />
      ))}
    </GameShelf>
  )
}

function MapShelf({
  topMaps,
  onOpenMap,
}: {
  topMaps: ReadonlyArray<GameBrowseMapCount>
  onOpenMap: (mapName: string) => void
}) {
  const { t } = useTranslation()
  const maps = useAppSelector(s => s.maps.byId)
  if (!topMaps.length) {
    return null
  }
  return (
    <GameShelf title={t('games.browse.shelf.maps', 'Browse by map')}>
      {topMaps.map(({ mapId, gameCount }) => {
        const map = maps.get(mapId)
        if (!map) {
          return null
        }
        return (
          <MapTile
            key={mapId}
            type='button'
            style={map.image256Url ? { backgroundImage: `url("${map.image256Url}")` } : undefined}
            onClick={() => onOpenMap(map.name)}>
            <MapTileInfo>
              <MapTileName>{map.name}</MapTileName>
              <MapTileCount>
                {t('games.browse.mapGameCount', {
                  defaultValue_one: '{{count}} game this week',
                  defaultValue_other: '{{count}} games this week',
                  count: gameCount,
                })}
              </MapTileCount>
            </MapTileInfo>
          </MapTile>
        )
      })}
    </GameShelf>
  )
}

function LiveGamesShelf() {
  const { t } = useTranslation()
  // TODO(marko): Figure out if we particularly care about the errors when loading this, since we're
  // hiding the live games feed if there are no live games anyway.
  // Fetched once per visit to the page, never from the cache, so a game that finished since the
  // last visit doesn't linger. It isn't refreshed while the page stays open.
  const [{ data }] = useQuery({
    query: GamesBrowseLiveGamesQuery,
    requestPolicy: 'network-only',
  })

  const liveGames = data?.liveGames ?? []
  if (!liveGames.length) {
    return null
  }
  return (
    <GameShelf
      title={t('games.browse.shelf.live', 'Live games')}
      subtitle={t('games.browse.liveCount', {
        defaultValue_one: '{{count}} in progress',
        defaultValue_other: '{{count}} in progress',
        count: liveGames.length,
      })}
      live={true}>
      {liveGames.map(game => (
        <LiveGameCard
          key={game.id}
          query={game}
          size='large'
          onOpen={gameId => push(getGameResultsUrl(gameId))}
        />
      ))}
    </GameShelf>
  )
}

const shelfById = (shelves: ReadonlyArray<GameBrowseShelf>, id: GameBrowseShelfId) =>
  shelves.find(s => s.id === id)

/** The All games tab: live games, then shelves by mode and category. */
export function AllGamesBrowse({ onSeeAll }: { onSeeAll: (target: SeeAllTarget) => void }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [spoilerFree] = useUserLocalStorageValue('gamesSpoilerFree', false)
  const browse = useBrowseData<GetGamesBrowseResponse>(spec => dispatch(browseGames(spec)))
  const { selectedId, cardProps, overlays, panel } = useCardInteractions()

  const seeAll = (params: Record<string, string>) => () =>
    // An explicit source pins the list's remembered filters, so it shows exactly this shelf.
    onSeeAll({ tab: 'all', params: { source: 'all', ...params } })

  let shelves: React.ReactNode
  if (browse.status === 'error') {
    shelves = (
      <StateText>
        {t('games.list.retrievingError', 'There was an error retrieving the games.')}
      </StateText>
    )
  } else if (browse.status === 'loading') {
    shelves = <LoadingDotsArea />
  } else {
    const { shelves: list, yourRace, topMaps } = browse.data
    const shelfProps = { spoilerFree, selectedId, cardProps }
    shelves = (
      <>
        <RecordShelf
          shelf={shelfById(list, GameBrowseShelfId.Ranked1v1)}
          title={t('games.browse.shelf.ranked1v1', 'Ranked 1v1')}
          onSeeAll={seeAll({ source: 'ranked', format: '1v1' })}
          {...shelfProps}
        />
        {yourRace ? (
          <RecordShelf
            shelf={shelfById(list, GameBrowseShelfId.YourRace)}
            title={t('games.browse.shelf.yourRace', {
              defaultValue: 'Because you play {{race}}',
              race: raceCharToLabel(yourRace, t),
            })}
            onSeeAll={seeAll({
              source: 'ranked',
              format: '1v1',
              matchup: encodeMatchup({ team1: [yourRace], team2: [undefined] }),
            })}
            {...shelfProps}
          />
        ) : null}
        <RecordShelf
          shelf={shelfById(list, GameBrowseShelfId.Ranked2v2)}
          title={t('games.browse.shelf.ranked2v2', 'Ranked 2v2')}
          onSeeAll={seeAll({ source: 'ranked', format: '2v2' })}
          {...shelfProps}
        />
        <RecordShelf
          shelf={shelfById(list, GameBrowseShelfId.Ranked3v3)}
          title={t('games.browse.shelf.ranked3v3', '3v3 BGH')}
          onSeeAll={seeAll({ source: 'ranked', format: '3v3' })}
          {...shelfProps}
        />
        <MapShelf topMaps={topMaps} onOpenMap={mapName => seeAll({ mapName })()} />
        <RecordShelf
          shelf={shelfById(list, GameBrowseShelfId.Marathons)}
          title={t('games.browse.shelf.marathons', 'Marathons')}
          subtitle={t('games.browse.shelf.marathonsSubtitle', 'Games that went past 30 minutes')}
          onSeeAll={seeAll({ duration: GameDurationFilter.Over30 })}
          {...shelfProps}
        />
        <RecordShelf
          shelf={shelfById(list, GameBrowseShelfId.Custom)}
          title={t('games.browse.shelf.custom', 'Custom games')}
          onSeeAll={seeAll({ source: 'custom' })}
          {...shelfProps}
        />
      </>
    )
  }

  return (
    <BrowseRoot>
      <ShelvesColumn>
        <LiveGamesShelf />
        {shelves}
      </ShelvesColumn>
      {panel(undefined, spoilerFree)}
      {overlays}
    </BrowseRoot>
  )
}

function RecentSummary({ gameIds, userId }: { gameIds: ReadonlyArray<string>; userId: SbUserId }) {
  const { t } = useTranslation()
  const gamesById = useAppSelector(s => s.games.byId)
  const results = gameIds
    .slice(0, SUMMARY_GAMES)
    .map(id => {
      const game = gamesById.get(id)
      return game ? getResultFor(game, userId) : undefined
    })
    .filter((r): r is 'win' | 'loss' => r !== undefined)
  if (!results.length) {
    return null
  }
  const wins = results.filter(r => r === 'win').length
  return (
    <SummaryRoot>
      <SummaryRecord>
        <SummaryWins>{wins}</SummaryWins>–<SummaryLosses>{results.length - wins}</SummaryLosses>
      </SummaryRecord>
      <SummaryLabel>
        {t('games.browse.summary', {
          defaultValue_one: 'Your last game',
          defaultValue_other: 'Your last {{count}} games',
          count: results.length,
        })}
      </SummaryLabel>
      <SummaryPips aria-hidden={true}>
        {results
          .slice()
          .reverse()
          .map((r, i) => (
            <SummaryPip key={i} $win={r === 'win'}>
              {r === 'win' ? t('games.browse.winShort', 'W') : t('games.browse.lossShort', 'L')}
            </SummaryPip>
          ))}
      </SummaryPips>
    </SummaryRoot>
  )
}

/** The My games tab: the signed-in user's own games, by category. */
export function MyGamesBrowse({ onSeeAll }: { onSeeAll: (target: SeeAllTarget) => void }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfId = useSelfUser()?.id
  const [spoilerFree] = useUserLocalStorageValue('gamesSpoilerFree', false)
  const browse = useBrowseData<GetMyGamesBrowseResponse>(spec => dispatch(browseMyGames(spec)))
  const { selectedId, cardProps, overlays, panel } = useCardInteractions()

  let content: React.ReactNode
  if (browse.status === 'error') {
    content = (
      <StateText>
        {t('user.matchHistory.retrievingError', 'There was an error retrieving the match history.')}
      </StateText>
    )
  } else if (browse.status === 'loading') {
    content = <LoadingDotsArea />
  } else if (!browse.data.shelves.length) {
    content = (
      <StateText>{t('games.browse.noGamesYet', "You haven't played any games yet.")}</StateText>
    )
  } else {
    const list = browse.data.shelves
    const shelfProps = { forUserId: selfId, spoilerFree, selectedId, cardProps }
    const recent = shelfById(list, GameBrowseShelfId.Recent)
    content = (
      <>
        {recent && selfId !== undefined && !spoilerFree ? (
          <RecentSummary gameIds={recent.gameIds} userId={selfId} />
        ) : null}
        <RecordShelf
          shelf={recent}
          title={t('games.browse.shelf.recent', 'Recent games')}
          // An explicit sort pins the list's remembered filters, so it shows every game.
          onSeeAll={() => onSeeAll({ tab: 'mine', params: { sort: GameSortOption.LatestFirst } })}
          {...shelfProps}
        />
        {/* Losses give away results, so spoiler-free leaves them out. */}
        {spoilerFree ? null : (
          <RecordShelf
            shelf={shelfById(list, GameBrowseShelfId.Losses)}
            title={t('games.browse.shelf.losses', 'Losses worth a second look')}
            {...shelfProps}
          />
        )}
        <RecordShelf
          shelf={shelfById(list, GameBrowseShelfId.VsTerran)}
          title={t('games.browse.shelf.vsTerran', 'Against Terran')}
          {...shelfProps}
        />
        <RecordShelf
          shelf={shelfById(list, GameBrowseShelfId.VsZerg)}
          title={t('games.browse.shelf.vsZerg', 'Against Zerg')}
          {...shelfProps}
        />
        <RecordShelf
          shelf={shelfById(list, GameBrowseShelfId.VsProtoss)}
          title={t('games.browse.shelf.vsProtoss', 'Against Protoss')}
          {...shelfProps}
        />
        <RecordShelf
          shelf={shelfById(list, GameBrowseShelfId.TeamGames)}
          title={t('games.browse.shelf.teamGames', 'Team games')}
          {...shelfProps}
        />
        <RecordShelf
          shelf={shelfById(list, GameBrowseShelfId.Longest)}
          title={t('games.browse.shelf.longest', 'Your longest games')}
          onSeeAll={() => onSeeAll({ tab: 'mine', params: { sort: GameSortOption.LongestFirst } })}
          {...shelfProps}
        />
      </>
    )
  }

  return (
    <BrowseRoot>
      <ShelvesColumn>{content}</ShelvesColumn>
      {panel(selfId, spoilerFree)}
      {overlays}
    </BrowseRoot>
  )
}
