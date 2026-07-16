import { debounce } from 'lodash-es'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GroupedVirtuoso, GroupedVirtuosoHandle, Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import {
  ALL_GAME_FORMATS,
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
  makeEncodedMatchupString,
} from '../../common/games/game-filters'
import { getGameDurationString } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import { filterColorCodes, MapInfoJson } from '../../common/maps'
import { replayGameTypeToLabel } from '../../common/replays'
import {
  ReplayLibraryEntry,
  ReplayLibraryFilters,
  ReplayLibraryStatus,
} from '../../common/replays-library'
import { viewGame } from '../games/action-creators'
import { DayHeader, formatDayHeaderLabel, getDayBoundaries } from '../games/day-header'
import { GameFilterBar } from '../games/game-filter-bar'
import {
  GameDate,
  GameListEntryLayout,
  MapNoImageContainer,
  ThumbnailContainer,
  WatchReplayOverlay,
} from '../games/game-list-entry'
import { PlayerTeamsDisplay, PlayerTeamsDisplayPlayer } from '../games/player-teams-display'
import { longTimestamp, narrowDuration } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import Logo from '../logos/logo-no-bg.svg'
import { MapNoImage } from '../maps/map-image'
import { ReduxMapThumbnail } from '../maps/map-thumbnail'
import {
  ButtonStateStyleProps,
  FilledButton,
  IconButton,
  TextButton,
  useButtonState,
} from '../material/button'
import { FilterChip } from '../material/filter-chip'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { SelectableMenuItem } from '../material/menu/selectable-item'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { Ripple } from '../material/ripple'
import { elevationPlus1 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import {
  bodyLarge,
  bodyMedium,
  labelMedium,
  singleLine,
  titleLarge,
  titleSmall,
} from '../styles/typography'
import { startReplay } from './action-creators'
import {
  getReplayDisplayTeams,
  groupReplaysByDay,
  ReplayTeamLayout,
  shouldShowTeamLabels,
} from './replay-library-helpers'

const ipcRenderer = new TypedIpcRenderer()

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

// Raw numeric game types offered in the Mode filter, mirroring `SupportedReplayGameType` in
// common/replays.ts (which isn't exported). Labeled via `replayGameTypeToLabel`.
const REPLAY_GAME_TYPES = [2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 15] as const

function parseDuration(value: string): GameDurationFilter {
  return Object.values(GameDurationFilter).includes(value as GameDurationFilter)
    ? (value as GameDurationFilter)
    : GameDurationFilter.All
}

function parseSort(value: string): GameSortOption {
  return Object.values(GameSortOption).includes(value as GameSortOption)
    ? (value as GameSortOption)
    : GameSortOption.LatestFirst
}

function parseFormat(value: string): GameFormat | undefined {
  return ALL_GAME_FORMATS.includes(value as GameFormat) ? (value as GameFormat) : undefined
}

function parseMatchup(value: string): EncodedMatchupString | undefined {
  return value ? makeEncodedMatchupString(value) : undefined
}

function parseGameType(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10)
  return (REPLAY_GAME_TYPES as readonly number[]).includes(parsed) ? parsed : undefined
}

function parseSource(value: string): 'sb' | 'bnet' | undefined {
  return value === 'sb' || value === 'bnet' ? value : undefined
}

// ---- Layout ----------------------------------------------------------------------------------

const PageColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 100%;
  padding: 24px 0;
`

const BodyRow = styled.div`
  display: flex;
  flex-direction: row;
  gap: 24px;
`

const ListColumn = styled.div`
  flex-grow: 1;
  min-width: 0;
`

const CountLine = styled.div`
  ${labelMedium};
  align-self: flex-end;
  padding: 0 6px;
  color: var(--theme-on-surface-variant);
`

// ---- Empty / loading states ------------------------------------------------------------------

const CenteredState = styled.div`
  ${bodyLarge};

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;

  min-height: 320px;
  padding: 32px;
  text-align: center;

  color: var(--theme-on-surface-variant);
`

const EmptyStateTitle = styled.div`
  ${titleLarge};
  color: var(--theme-on-surface);
`

const EmptyStatePath = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  word-break: break-all;
`

// ---- SB game map resolution -------------------------------------------------------------------

/** Game ids we've already tried to fetch this session, so unmount/remount cycles from the
 * virtualized list (and genuine 404s for games the server no longer knows) don't refetch. */
const requestedGameIds = new Set<string>()

function useSbGameMap(gameId: string | undefined): ReadonlyDeep<MapInfoJson> | undefined {
  const dispatch = useAppDispatch()
  const game = useAppSelector(s => (gameId ? s.games.byId.get(gameId) : undefined))
  const map = useAppSelector(s => (game?.mapId ? s.maps.byId.get(game.mapId) : undefined))

  useEffect(() => {
    if (!gameId || game || requestedGameIds.has(gameId)) return
    requestedGameIds.add(gameId)
    // Deliberately no abort on unmount: the response is tiny and caching it in the store is the
    // point. Errors fall back to the placeholder tile.
    dispatch(viewGame(gameId, { onSuccess: () => {}, onError: () => {} }))
  }, [gameId, game, dispatch])

  return map
}

// ---- Row -------------------------------------------------------------------------------------

const ReplayRowContainer = styled.div<ButtonStateStyleProps & { $selected: boolean }>`
  position: relative;
  width: 100%;

  border-radius: 8px;
  contain: content;
  cursor: pointer;

  background-color: ${props =>
    props.$selected ? 'rgb(from var(--theme-on-surface) r g b / 0.1)' : 'transparent'};

  &:hover {
    background-color: ${props =>
      props.$selected
        ? 'rgb(from var(--theme-on-surface) r g b / 0.12)'
        : 'rgb(from var(--theme-on-surface) r g b / 0.06)'};
  }
`

const PlaceholderIcon = styled(MaterialIcon)`
  opacity: 0.5;
`

const StyledMapThumbnail = styled(ReduxMapThumbnail)`
  ${elevationPlus1};
  width: 64px;
  height: 64px;
  flex-shrink: 0;
`

const ParseErrorPlayers = styled.div`
  ${titleSmall};

  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  color: var(--theme-on-surface-variant);
`

const ParseErrorFileName = styled.span`
  ${singleLine};
  min-width: 0;
`

const RowErrorIcon = styledWithAttrs(MaterialIcon, { icon: 'error', size: 20 })`
  flex-shrink: 0;
  color: var(--theme-error);
`

function playersToDisplayTeams(
  layout: ReplayTeamLayout,
  computerLabel: string,
): PlayerTeamsDisplayPlayer[][] {
  return layout.teams.map(team =>
    team.map(player => ({
      race: player.race,
      isRandom: false,
      name: player.isComputer ? computerLabel : player.name,
      nameColor: 'normal' as const,
    })),
  )
}

interface ReplayListEntryProps {
  entry: ReplayLibraryEntry
  selected: boolean
  computerLabel: string
  watchTitle: string
  onSelect: (id: number) => void
  onWatch: (entry: ReplayLibraryEntry) => void
}

function ReplayListEntry({
  entry,
  selected,
  computerLabel,
  watchTitle,
  onSelect,
  onWatch,
}: ReplayListEntryProps) {
  const { t } = useTranslation()
  const map = useSbGameMap(entry.parseError ? undefined : entry.sbGameId)
  const [buttonProps, rippleRef] = useButtonState({
    onClick: () => onSelect(entry.id),
    onDoubleClick: () => onWatch(entry),
  })

  const leading = (
    <Tooltip text={longTimestamp.format(entry.gameTime)} position='right'>
      <GameDate>{narrowDuration.format(entry.gameTime)}</GameDate>
    </Tooltip>
  )

  const players = entry.parseError ? (
    <ParseErrorPlayers>
      <RowErrorIcon />
      <ParseErrorFileName>{entry.fileName}</ParseErrorFileName>
    </ParseErrorPlayers>
  ) : (
    <PlayerTeamsDisplay
      teams={playersToDisplayTeams(getReplayDisplayTeams(entry.players), computerLabel)}
    />
  )

  const thumbnail = (
    <ThumbnailContainer>
      {map ? (
        <StyledMapThumbnail
          key={map.hash}
          mapId={map.id}
          size={64}
          forceAspectRatio={1}
          hasMapPreviewAction={false}
          hasFavoriteAction={false}
        />
      ) : (
        <MapNoImageContainer>
          <PlaceholderIcon icon={entry.parseError ? 'error' : 'map'} size={36} />
        </MapNoImageContainer>
      )}
      <WatchReplayOverlay>
        <Tooltip text={watchTitle} position='top'>
          <IconButton
            styledAs='div'
            icon={<MaterialIcon icon='play_circle' />}
            onClick={event => {
              event.stopPropagation()
              onWatch(entry)
            }}
          />
        </Tooltip>
      </WatchReplayOverlay>
    </ThumbnailContainer>
  )

  return (
    <ReplayRowContainer {...buttonProps} $selected={selected}>
      <GameListEntryLayout
        leading={leading}
        players={players}
        duration={
          entry.parseError ? '—' : getGameDurationString((entry.durationFrames * 1000) / 24)
        }
        mapName={entry.parseError ? '—' : filterColorCodes(entry.mapName)}
        gameTypeLabel={entry.parseError ? '' : replayGameTypeToLabel(entry.gameType, t)}
        thumbnail={thumbnail}
      />
      <Ripple ref={rippleRef} />
    </ReplayRowContainer>
  )
}

// ---- Inspector -------------------------------------------------------------------------------

// Mirrors `DayHeader`'s own box (see `client/games/day-header.tsx`): 16px top padding + 20px
// `titleSmall` line-height + 8px bottom padding. Used to align the panel with the first replay
// row instead of the day separator above it, when the list is day-grouped.
const DAY_HEADER_HEIGHT_PX = 44

const InspectorRoot = styled.div<{ $alignWithFirstRow: boolean }>`
  ${containerStyles(ContainerLevel.Low)};

  flex-shrink: 0;
  width: 340px;
  align-self: flex-start;
  position: sticky;
  top: 24px;
  max-height: calc(100vh - 96px);
  padding: 24px;
  margin-top: ${props => (props.$alignWithFirstRow ? `${DAY_HEADER_HEIGHT_PX}px` : '0')};

  display: flex;
  flex-direction: column;
  gap: 20px;

  border-radius: 8px;
  overflow-y: auto;
`

const InspectorMapThumbnail = styled(ReduxMapThumbnail)`
  width: 100%;
  height: auto;
  aspect-ratio: 1;

  border-radius: 8px;
`

const InspectorMapPlaceholder = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 1;

  border-radius: 8px;
  contain: content;
`

const InspectorEmpty = styled.div`
  ${bodyMedium};

  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

const InspectorHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const InspectorChipsRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
`

const InspectorModeChip = styled.div`
  ${labelMedium};

  padding: 2px 10px;

  border-radius: 999px;
  background-color: rgb(from var(--theme-primary) r g b / 0.16);
  color: var(--color-blue80);
`

const SbSourceLogo = styled(Logo)`
  width: 16px;
  height: 16px;
`

const InspectorSourceBadgeSb = styled.div`
  ${labelMedium};

  display: flex;
  align-items: center;
  gap: 4px;

  padding: 2px 8px;

  border-radius: 6px;
  border: 1px solid var(--theme-outline);
  color: var(--theme-on-surface-variant);
`

const InspectorSourceBadgeBnet = styled.div`
  ${labelMedium};

  padding: 2px 8px;

  border-radius: 6px;
  border: 1px solid var(--theme-outline);
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
`

const InspectorMapName = styled.div`
  ${titleLarge};
`

const InspectorSubline = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const InspectorSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const InspectorActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const WatchButton = styled(FilledButton)`
  flex-grow: 1;
`

const InspectorErrorNote = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

interface InspectorProps {
  entry: ReplayLibraryEntry | undefined
  computerLabel: string
  /** True when the list is day-grouped, so the panel's top should align with the first row. */
  alignWithFirstRow: boolean
  onWatch: (entry: ReplayLibraryEntry) => void
  onReveal: (entry: ReplayLibraryEntry) => void
}

function Inspector({ entry, computerLabel, alignWithFirstRow, onWatch, onReveal }: InspectorProps) {
  const { t } = useTranslation()
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'bottom')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })
  const map = useSbGameMap(entry?.sbGameId)

  if (!entry) {
    return (
      <InspectorRoot $alignWithFirstRow={alignWithFirstRow}>
        <InspectorEmpty>
          {t('replays.library.inspector.empty', 'Select a replay to see its details')}
        </InspectorEmpty>
      </InspectorRoot>
    )
  }

  const mode = replayGameTypeToLabel(entry.gameType, t)
  const layout = entry.parseError ? undefined : getReplayDisplayTeams(entry.players)
  const teamLabels =
    layout && shouldShowTeamLabels(layout)
      ? layout.teams.map((_, i) =>
          t('game.teamName.number', { defaultValue: 'Team {{teamNumber}}', teamNumber: i + 1 }),
        )
      : undefined

  const chips = (
    <InspectorChipsRow>
      <InspectorModeChip>{mode}</InspectorModeChip>
      {entry.sbGameId ? (
        <InspectorSourceBadgeSb>
          <SbSourceLogo />
          {t('replays.library.sourceTagSb', 'SB')}
        </InspectorSourceBadgeSb>
      ) : (
        <InspectorSourceBadgeBnet>
          {t('replays.library.sourceTagBnet', 'B.NET')}
        </InspectorSourceBadgeBnet>
      )}
    </InspectorChipsRow>
  )

  const actions = (
    <InspectorActions>
      <WatchButton
        label={t('replays.library.watchReplay', 'Watch replay')}
        iconStart={<MaterialIcon icon='play_arrow' />}
        onClick={() => onWatch(entry)}
      />
      <IconButton
        ref={anchor}
        icon={<MaterialIcon icon='more_vert' />}
        title={t('replays.library.moreActions', 'More actions')}
        onClick={openMenu}
      />
      <Popover
        open={menuOpen}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <MenuList dense={true}>
          <MenuItem
            icon={<MaterialIcon icon='folder_open' />}
            text={t('replays.library.showInExplorer', 'Show in Explorer')}
            onClick={() => {
              closeMenu()
              onReveal(entry)
            }}
          />
        </MenuList>
      </Popover>
    </InspectorActions>
  )

  return (
    <InspectorRoot $alignWithFirstRow={alignWithFirstRow}>
      {map ? (
        <InspectorMapThumbnail
          key={map.hash}
          mapId={map.id}
          forceAspectRatio={1}
          showInfoLayer={true}
        />
      ) : (
        <InspectorMapPlaceholder>
          <MapNoImage />
        </InspectorMapPlaceholder>
      )}

      {entry.parseError ? (
        <>
          <InspectorHeader>
            {chips}
            <InspectorMapName>{entry.fileName}</InspectorMapName>
          </InspectorHeader>
          <InspectorErrorNote>
            {t('replays.library.inspector.parseError', 'This replay could not be read.')}
          </InspectorErrorNote>
        </>
      ) : (
        <>
          <InspectorHeader>
            {chips}
            {!map ? <InspectorMapName>{filterColorCodes(entry.mapName)}</InspectorMapName> : null}
            <InspectorSubline>
              {longTimestamp.format(entry.gameTime)} ·{' '}
              {getGameDurationString((entry.durationFrames * 1000) / 24)}
            </InspectorSubline>
          </InspectorHeader>
          <InspectorSection>
            <PlayerTeamsDisplay
              teams={playersToDisplayTeams(layout!, computerLabel)}
              teamLabels={teamLabels}
            />
          </InspectorSection>
        </>
      )}

      {actions}
    </InspectorRoot>
  )
}

// ---- Main component --------------------------------------------------------------------------

export function ReplayLibrary() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [entries, setEntries] = useState<ReadonlyArray<ReplayLibraryEntry>>([])
  const [hasLoaded, setHasLoaded] = useState(false)
  const [status, setStatus] = useState<ReplayLibraryStatus>()
  const [backfill, setBackfill] = useState<{ done: number; total: number }>()
  const [refreshToken, setRefreshToken] = useState(0)

  const [focusedId, setFocusedId] = useState<number>()
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null)
  const groupedRef = useRef<GroupedVirtuosoHandle>(null)
  const flatRef = useRef<VirtuosoHandle>(null)

  const [durationParam, setDurationParam] = useLocationSearchParam('duration')
  const [sortParam, setSortParam] = useLocationSearchParam('sort')
  const [mapName, setMapNameParam] = useLocationSearchParam('mapName')
  const [playerName, setPlayerNameParam] = useLocationSearchParam('playerName')
  const [formatParam, setFormatParam] = useLocationSearchParam('format')
  const [matchupParam, setMatchupParam] = useLocationSearchParam('matchup')
  const [gameTypeParam, setGameTypeParam] = useLocationSearchParam('gameType')
  const [sourceParam, setSourceParam] = useLocationSearchParam('source')

  const duration = parseDuration(durationParam)
  const sort = parseSort(sortParam)
  const format = parseFormat(formatParam)
  const matchup = parseMatchup(matchupParam)
  const gameType = parseGameType(gameTypeParam)
  const source = parseSource(sourceParam)

  const computerLabel = t('game.playerName.computer', 'Computer')
  const watchTitle = t('replays.library.watchReplay', 'Watch replay')

  const hasExtraFilters = gameType !== undefined || source !== undefined
  const hasActiveFilters =
    duration !== GameDurationFilter.All ||
    !!mapName ||
    !!playerName ||
    !!format ||
    !!matchup ||
    hasExtraFilters

  const isDurationSort =
    sort === GameSortOption.ShortestFirst || sort === GameSortOption.LongestFirst

  // Run (and re-run) the library query whenever the filters change or the index signals a change.
  useEffect(() => {
    let cancelled = false
    const filters: ReplayLibraryFilters = { sort }
    if (source !== undefined) filters.source = source
    if (mapName) filters.mapName = mapName
    if (playerName) filters.playerName = playerName
    if (gameType !== undefined) filters.gameType = gameType
    if (duration !== GameDurationFilter.All) filters.duration = duration
    if (format !== undefined) {
      filters.format = format
      if (matchup) filters.matchup = matchup
    }

    ipcRenderer
      .invoke('replayLibraryQuery', filters)
      ?.then(result => {
        if (cancelled || !result) return
        setEntries(result.entries)
        setHasLoaded(true)
      })
      .catch(swallowNonBuiltins)

    return () => {
      cancelled = true
    }
  }, [source, mapName, playerName, gameType, duration, format, matchup, sort, refreshToken])

  // Fetch the index status (and refresh it whenever the index changes).
  useEffect(() => {
    let cancelled = false
    ipcRenderer
      .invoke('replayLibraryStatus')
      ?.then(result => {
        if (!cancelled && result) {
          setStatus(result)
          setBackfill(result.backfill)
        }
      })
      .catch(swallowNonBuiltins)

    return () => {
      cancelled = true
    }
  }, [refreshToken])

  // Listen for index change + backfill events only while mounted.
  useEffect(() => {
    const handleChanged = debounce(() => setRefreshToken(token => token + 1), 300)
    const handleProgress = (_event: unknown, progress: { done: number; total: number }) => {
      setBackfill(progress)
    }
    ipcRenderer.on('replayLibraryChanged', handleChanged)
    ipcRenderer.on('replayLibraryBackfillProgress', handleProgress)

    return () => {
      handleChanged.cancel()
      // These channels are only ever listened to by this component, so removing all listeners is
      // equivalent to (and simpler than) tracking each handler reference for removal.
      ipcRenderer.removeAllListeners('replayLibraryChanged')
      ipcRenderer.removeAllListeners('replayLibraryBackfillProgress')
    }
  }, [])

  const focusedEntry = entries.find(e => e.id === focusedId) ?? entries[0]
  const focusedIndex = focusedEntry ? entries.findIndex(e => e.id === focusedEntry.id) : -1

  const watchEntry = (entry: ReplayLibraryEntry) => {
    dispatch(startReplay({ path: entry.path, name: entry.fileName }))
  }
  const revealEntry = (entry: ReplayLibraryEntry) => {
    ipcRenderer.invoke('pathsShowItemInFolder', entry.path)?.catch(swallowNonBuiltins)
  }

  const scrollToIndex = (index: number) => {
    // Only one of these lists is mounted at a time, so the other ref is null.
    groupedRef.current?.scrollIntoView({ index })
    flatRef.current?.scrollIntoView({ index })
  }
  const focusIndex = (index: number) => {
    if (index < 0 || index >= entries.length) return
    setFocusedId(entries[index].id)
    scrollToIndex(index)
  }
  const moveFocus = (delta: number) => {
    if (entries.length === 0) return
    const base = focusedIndex < 0 ? 0 : focusedIndex
    const next = Math.min(Math.max(base + delta, 0), entries.length - 1)
    focusIndex(next)
  }

  const clearAllFilters = () => {
    setDurationParam('')
    setMapNameParam('')
    setPlayerNameParam('')
    setFormatParam('')
    setMatchupParam('')
    setGameTypeParam('')
    setSourceParam('')
    // `sort` is a view option (not a filter), so it's intentionally left untouched.
  }

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
          moveFocus(-1)
          return true
        case 'ArrowDown':
          moveFocus(1)
          return true
        case 'PageUp':
          moveFocus(-10)
          return true
        case 'PageDown':
          moveFocus(10)
          return true
        case 'Home':
          focusIndex(0)
          return true
        case 'End':
          focusIndex(entries.length - 1)
          return true
        case ENTER:
        case ENTER_NUMPAD: {
          const active = document.activeElement
          // If the user is on an interactive control (e.g. a focused button), let it handle Enter.
          if (
            active instanceof HTMLElement &&
            (active.tagName === 'BUTTON' || active.tagName === 'A')
          ) {
            return false
          }
          if (focusedEntry) watchEntry(focusedEntry)
          return true
        }
      }

      return false
    },
  })

  const dayGroups = groupReplaysByDay(entries)
  const groupCounts = dayGroups.map(g => g.entries.length)
  const { todayStartMs, yesterdayStartMs } = getDayBoundaries()

  let sourceLabel = t('replays.library.filters.source', 'Source')
  if (source === 'sb') {
    sourceLabel = t('replays.library.filters.sourceSb', 'ShieldBattery')
  } else if (source === 'bnet') {
    sourceLabel = t('replays.library.filters.sourceBnet', 'Battle.net')
  }

  const renderRow = (index: number) => {
    const entry = entries[index]
    if (!entry) return null
    return (
      <ReplayListEntry
        entry={entry}
        selected={entry.id === focusedEntry?.id}
        computerLabel={computerLabel}
        watchTitle={watchTitle}
        onSelect={setFocusedId}
        onWatch={watchEntry}
      />
    )
  }

  let listContent: React.ReactNode = null
  if (!hasLoaded) {
    listContent = <LoadingDotsArea />
  } else if (entries.length === 0) {
    if (hasActiveFilters) {
      listContent = (
        <CenteredState>
          <EmptyStateTitle>{t('replays.library.noMatches', 'No replays match')}</EmptyStateTitle>
          <TextButton
            label={t('replays.library.clearFilters', 'Clear filters')}
            iconStart={<MaterialIcon icon='close' />}
            onClick={clearAllFilters}
          />
        </CenteredState>
      )
    } else {
      listContent = (
        <CenteredState>
          <EmptyStateTitle>{t('replays.library.empty', 'No replays yet')}</EmptyStateTitle>
          <div>
            {t(
              'replays.library.emptyBody',
              'Replays you watch and play will show up here automatically.',
            )}
          </div>
          {status?.watchedFolder ? <EmptyStatePath>{status.watchedFolder}</EmptyStatePath> : null}
        </CenteredState>
      )
    }
  } else if (scrollParent) {
    // NOTE: `Virtuoso` and `GroupedVirtuoso` share the same underlying component type, so
    // switching between them reconciles as a prop update and leaves stale group state behind.
    // Distinct keys force a full remount when the list mode changes.
    listContent = isDurationSort ? (
      <Virtuoso
        key='flat'
        ref={flatRef}
        customScrollParent={scrollParent}
        totalCount={entries.length}
        itemContent={renderRow}
      />
    ) : (
      <GroupedVirtuoso
        key='grouped'
        ref={groupedRef}
        customScrollParent={scrollParent}
        groupCounts={groupCounts}
        groupContent={index => {
          const group = dayGroups[index]
          return (
            <DayHeader
              label={formatDayHeaderLabel(group.dayStartMs, todayStartMs, yesterdayStartMs, t)}
              countLabel={t('replays.library.replayCount', {
                defaultValue: '{{count}} replays',
                count: group.entries.length,
              })}
            />
          )
        }}
        itemContent={renderRow}
      />
    )
  }

  let countLine: React.ReactNode = null
  if (backfill && backfill.total > 0) {
    countLine = (
      <CountLine>
        {t('replays.library.scanning', {
          defaultValue: 'Scanning replays… {{done}}/{{total}}',
          done: backfill.done,
          total: backfill.total,
        })}
      </CountLine>
    )
  } else if (hasLoaded) {
    countLine = (
      <CountLine>
        {hasActiveFilters
          ? t('replays.library.filteredCount', {
              defaultValue: '{{shown}} of {{total}} replays',
              shown: entries.length,
              total: status?.totalIndexed ?? entries.length,
            })
          : t('replays.library.replayCount', {
              defaultValue: '{{count}} replays',
              count: status?.totalIndexed ?? entries.length,
            })}
      </CountLine>
    )
  }

  return (
    <CenteredContentContainer ref={setScrollParent} $targetWidth={1280}>
      <PageColumn>
        <GameFilterBar
          showRankedCustom={false}
          duration={duration}
          setDuration={v => setDurationParam(v === GameDurationFilter.All ? '' : v)}
          sort={sort}
          setSort={v => setSortParam(v === GameSortOption.LatestFirst ? '' : v)}
          mapName={mapName}
          setMapName={setMapNameParam}
          playerName={playerName}
          setPlayerName={setPlayerNameParam}
          format={format}
          setFormat={v => setFormatParam(v ?? '')}
          matchup={matchup}
          setMatchup={v => setMatchupParam(v ?? '')}
          hasExtraFilters={hasExtraFilters}
          onClearExtraFilters={() => {
            setGameTypeParam('')
            setSourceParam('')
          }}>
          <FilterChip
            label={
              gameType !== undefined
                ? replayGameTypeToLabel(gameType, t)
                : t('replays.library.filters.mode', 'Mode')
            }
            selected={gameType !== undefined}>
            <SelectableMenuItem
              text={t('replays.library.filters.modeAny', 'Any mode')}
              selected={gameType === undefined}
              onClick={() => setGameTypeParam('')}
            />
            {REPLAY_GAME_TYPES.map(gt => (
              <SelectableMenuItem
                key={gt}
                text={replayGameTypeToLabel(gt, t)}
                selected={gameType === gt}
                onClick={() => setGameTypeParam(String(gt))}
              />
            ))}
          </FilterChip>

          <FilterChip label={sourceLabel} selected={source !== undefined}>
            <SelectableMenuItem
              text={t('replays.library.filters.sourceAny', 'Any source')}
              selected={source === undefined}
              onClick={() => setSourceParam('')}
            />
            <SelectableMenuItem
              text={t('replays.library.filters.sourceSb', 'ShieldBattery')}
              selected={source === 'sb'}
              onClick={() => setSourceParam('sb')}
            />
            <SelectableMenuItem
              text={t('replays.library.filters.sourceBnet', 'Battle.net')}
              selected={source === 'bnet'}
              onClick={() => setSourceParam('bnet')}
            />
          </FilterChip>
        </GameFilterBar>

        {countLine}

        <BodyRow>
          <ListColumn>{listContent}</ListColumn>

          <Inspector
            entry={focusedEntry}
            computerLabel={computerLabel}
            alignWithFirstRow={!isDurationSort}
            onWatch={watchEntry}
            onReveal={revealEntry}
          />
        </BodyRow>
      </PageColumn>
    </CenteredContentContainer>
  )
}
