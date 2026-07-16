import { debounce } from 'lodash-es'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GroupedVirtuoso, GroupedVirtuosoHandle } from 'react-virtuoso'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import {
  ALL_GAME_FORMATS,
  createEmptyMatchup,
  decodeMatchup,
  EncodedMatchupString,
  encodeMatchup,
  GameDurationFilter,
  GameFormat,
  getDurationLabel,
} from '../../common/games/game-filters'
import { getGameDurationString } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import { filterColorCodes } from '../../common/maps'
import { RaceChar } from '../../common/races'
import { replayGameTypeToLabel } from '../../common/replays'
import {
  ReplayLibraryEntry,
  ReplayLibraryFilters,
  ReplayLibraryStatus,
} from '../../common/replays-library'
import { MatchupFilter } from '../games/matchup-filter'
import { PlayerTeamsDisplay, PlayerTeamsDisplayPlayer } from '../games/player-teams-display'
import { longTimestamp, narrowDuration, shortTimestamp } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { FilledButton, IconButton, OutlinedButton, TextButton } from '../material/button'
import { FilterChip } from '../material/filter-chip'
import { SelectableMenuItem } from '../material/menu/selectable-item'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { TextField } from '../material/text-field'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { getRaceColor } from '../styles/colors'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  headlineSmall,
  labelLarge,
  labelMedium,
  labelSmall,
  singleLine,
  titleLarge,
  titleMedium,
  titleSmall,
} from '../styles/typography'
import { startReplay } from './action-creators'
import {
  formatFileSize,
  getDayBoundaries,
  getReplayDisplayTeams,
  getReplayMatchupBadge,
  groupReplaysByDay,
  ReplayMatchupBadge,
  ReplayTeamLayout,
  shouldShowTeamLabels,
} from './replay-library-helpers'

const ipcRenderer = new TypedIpcRenderer()

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const DURATION_OPTIONS = [
  GameDurationFilter.All,
  GameDurationFilter.Under10,
  GameDurationFilter.From10To20,
  GameDurationFilter.From20To30,
  GameDurationFilter.Over30,
] as const

// Raw numeric game types offered in the Mode filter, mirroring `SupportedReplayGameType` in
// common/replays.ts (which isn't exported). Labeled via `replayGameTypeToLabel`.
const REPLAY_GAME_TYPES = [2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 15] as const

const dayGroupDateFormat = new Intl.DateTimeFormat(navigator.language, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

// ---- Layout ----------------------------------------------------------------------------------

const Root = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;

  background-color: var(--theme-surface);
  overflow: hidden;
`

const Header = styled.div`
  flex-shrink: 0;
  padding: 16px 24px 8px;

  display: flex;
  align-items: center;
  gap: 16px;
`

const PageTitle = styled.div`
  ${headlineSmall};
  min-width: 0;
`

const Toolbar = styled.div`
  flex-shrink: 0;
  padding: 8px 24px 16px;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
`

const SearchField = styled(TextField)`
  width: 320px;
  flex-shrink: 0;
`

const Body = styled.div`
  flex-grow: 1;
  min-height: 0;

  display: flex;
  flex-direction: row;
`

const ListColumn = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
`

const ListScroll = styled.div`
  position: relative;
  flex-grow: 1;
  min-height: 0;

  padding: 0 8px 24px 24px;

  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
`

const StatusBar = styled.div`
  ${bodySmall};
  flex-shrink: 0;
  height: 36px;
  padding: 0 24px;

  display: flex;
  align-items: center;
  gap: 16px;

  border-top: 1px solid var(--theme-outline-variant);
  color: var(--theme-on-surface-variant);
`

const StatusHints = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
`

const StatusHint = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`

const StatusSpacer = styled.div`
  flex-grow: 1;
`

const StatusIndexed = styled.div`
  ${singleLine};
  flex-shrink: 0;
`

const Kbd = styled.kbd`
  ${labelSmall};

  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;

  border: 1px solid var(--theme-outline);
  border-radius: 4px;
  background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  color: var(--theme-on-surface-variant);
  font-family: inherit;
`

// ---- Empty / loading states ------------------------------------------------------------------

const CenteredState = styled.div`
  ${bodyLarge};

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;

  height: 100%;
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

// ---- Day group header ------------------------------------------------------------------------

const DayHeaderRoot = styled.div`
  ${titleSmall};

  display: flex;
  align-items: baseline;
  gap: 8px;

  padding: 16px 8px 8px;

  background-color: var(--theme-surface);
  color: var(--theme-on-surface);
`

const DayHeaderCount = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const DayHeaderRule = styled.div`
  flex-grow: 1;
  height: 1px;
  align-self: center;

  background-color: var(--theme-outline-variant);
`

// ---- Matchup badge ---------------------------------------------------------------------------

const MatchupBadgeRoot = styled.div`
  ${titleSmall};

  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1px;
`

const RaceLetter = styled.span<{ $race: RaceChar }>`
  color: ${props => getRaceColor(props.$race)};
`

const MatchupVs = styled.span`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
`

const MatchupText = styled.span`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

function MatchupBadge({ badge }: { badge: ReplayMatchupBadge }) {
  if (badge.kind === 'text') {
    return <MatchupText>{badge.text}</MatchupText>
  }

  return (
    <MatchupBadgeRoot>
      {badge.races.map((race, i) => (
        <Fragment key={i}>
          {i > 0 ? <MatchupVs>v</MatchupVs> : null}
          <RaceLetter $race={race}>{race.toUpperCase()}</RaceLetter>
        </Fragment>
      ))}
    </MatchupBadgeRoot>
  )
}

// ---- Row -------------------------------------------------------------------------------------

const RowRoot = styled.div<{ $focused: boolean }>`
  position: relative;
  width: 100%;
  min-height: 48px;
  padding: 6px 8px;

  display: grid;
  grid-template-columns: 12px 64px 56px minmax(0, 1fr) minmax(80px, 200px) 56px 36px;
  align-items: center;
  gap: 12px;

  border-radius: 6px;
  cursor: pointer;

  background-color: ${props =>
    props.$focused ? 'rgb(from var(--theme-on-surface) r g b / 0.1)' : 'transparent'};

  &:hover {
    background-color: ${props =>
      props.$focused
        ? 'rgb(from var(--theme-on-surface) r g b / 0.12)'
        : 'rgb(from var(--theme-on-surface) r g b / 0.06)'};
  }
`

const RowDot = styled.div`
  width: 12px;
`

const RowTime = styled.div`
  ${bodyMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const RowMatchup = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`

const RowPlayers = styled(PlayerTeamsDisplay)`
  min-width: 0;
`

const RowMap = styled.div`
  ${bodyMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const RowDuration = styled.div`
  ${bodyMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
  text-align: right;
  font-variant-numeric: tabular-nums;
`

const RowPlayButton = styled(IconButton)`
  width: 36px;
  min-height: 36px;
  opacity: 0;

  color: var(--theme-on-surface);

  ${RowRoot}:hover & {
    opacity: 1;
  }

  &:focus-visible {
    opacity: 1;
  }
`

const RowErrorFileName = styled.div`
  ${bodyMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const RowErrorIcon = styled(MaterialIcon).attrs({ icon: 'error', size: 20 })`
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

interface ReplayRowProps {
  entry: ReplayLibraryEntry
  focused: boolean
  computerLabel: string
  onFocus: (id: number) => void
  onWatch: (entry: ReplayLibraryEntry) => void
  watchTitle: string
}

function ReplayRow({
  entry,
  focused,
  computerLabel,
  onFocus,
  onWatch,
  watchTitle,
}: ReplayRowProps) {
  const layout = getReplayDisplayTeams(entry.players)

  return (
    <RowRoot
      $focused={focused}
      onClick={() => onFocus(entry.id)}
      onDoubleClick={() => onWatch(entry)}>
      <RowDot />
      <RowTime>{shortTimestamp.format(entry.gameTime)}</RowTime>
      <RowMatchup>
        {entry.parseError ? (
          <RowErrorIcon />
        ) : (
          <MatchupBadge badge={getReplayMatchupBadge(layout)} />
        )}
      </RowMatchup>
      {entry.parseError ? (
        <RowErrorFileName>{entry.fileName}</RowErrorFileName>
      ) : (
        <RowPlayers teams={playersToDisplayTeams(layout, computerLabel)} />
      )}
      <RowMap>{entry.parseError ? '' : filterColorCodes(entry.mapName)}</RowMap>
      <RowDuration>
        {entry.parseError ? '' : getGameDurationString((entry.durationFrames * 1000) / 24)}
      </RowDuration>
      <RowPlayButton
        icon={<MaterialIcon icon='play_arrow' />}
        title={watchTitle}
        onClick={event => {
          event.stopPropagation()
          onWatch(entry)
        }}
      />
    </RowRoot>
  )
}

// ---- Hero card -------------------------------------------------------------------------------

const HeroCardRoot = styled.div`
  margin: 16px 0 8px;
  padding: 20px 24px;

  display: flex;
  align-items: center;
  gap: 24px;

  border: 1px solid rgb(from var(--theme-amber) r g b / 0.5);
  border-radius: 12px;
  background: linear-gradient(
    120deg,
    rgb(from var(--theme-amber) r g b / 0.12),
    var(--theme-container-low) 65%
  );
`

const HeroInfo = styled.div`
  min-width: 0;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const HeroEyebrow = styled.div`
  ${labelMedium};

  display: flex;
  align-items: center;
  gap: 6px;

  color: var(--theme-amber);
  letter-spacing: 0.8px;
  text-transform: uppercase;
`

const HeroPlayers = styled(PlayerTeamsDisplay)`
  min-width: 0;
`

const HeroErrorName = styled.div`
  ${titleMedium};
  ${singleLine};
`

const HeroMeta = styled.div`
  ${bodyMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const HeroActions = styled.div`
  flex-shrink: 0;

  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
`

const WatchButtonLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`

interface HeroCardProps {
  entry: ReplayLibraryEntry
  computerLabel: string
  onWatch: (entry: ReplayLibraryEntry) => void
}

function HeroCard({ entry, computerLabel, onWatch }: HeroCardProps) {
  const { t } = useTranslation()
  const layout = getReplayDisplayTeams(entry.players)
  const mode = replayGameTypeToLabel(entry.gameType, t)
  const meta = entry.parseError
    ? mode
    : [
        filterColorCodes(entry.mapName),
        mode,
        getGameDurationString((entry.durationFrames * 1000) / 24),
      ]
        .filter(Boolean)
        .join(' · ')

  return (
    <HeroCardRoot>
      <HeroInfo>
        <HeroEyebrow>
          <MaterialIcon icon='star' size={16} />
          {t('replays.library.latestReplay', 'Latest replay')} ·{' '}
          {narrowDuration.format(entry.gameTime)}
        </HeroEyebrow>
        {entry.parseError ? (
          <HeroErrorName>{entry.fileName}</HeroErrorName>
        ) : (
          <HeroPlayers teams={playersToDisplayTeams(layout, computerLabel)} />
        )}
        <HeroMeta>{meta}</HeroMeta>
      </HeroInfo>
      <HeroActions>
        <FilledButton
          label={
            <WatchButtonLabel>
              {t('replays.library.watchReplay', 'Watch replay')}
              <Kbd>⏎</Kbd>
            </WatchButtonLabel>
          }
          iconStart={<MaterialIcon icon='play_arrow' />}
          onClick={() => onWatch(entry)}
        />
      </HeroActions>
    </HeroCardRoot>
  )
}

// ---- Inspector -------------------------------------------------------------------------------

const InspectorRoot = styled.div`
  flex-shrink: 0;
  width: 360px;
  height: 100%;
  padding: 24px;

  display: flex;
  flex-direction: column;
  gap: 20px;

  border-left: 1px solid var(--theme-outline-variant);
  background-color: var(--theme-container-lowest);
  overflow-y: auto;
`

const InspectorEmpty = styled.div`
  ${bodyMedium};

  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

const InspectorHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const InspectorModeChip = styled.div`
  ${labelMedium};

  align-self: flex-start;
  padding: 2px 10px;

  border-radius: 999px;
  background-color: rgb(from var(--theme-primary) r g b / 0.16);
  color: var(--color-blue80);
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
  flex-direction: column;
  gap: 8px;
`

const FullWidthFilledButton = styled(FilledButton)`
  width: 100%;
`

const FullWidthOutlinedButton = styled(OutlinedButton)`
  width: 100%;
`

const InspectorSpacer = styled.div`
  flex-grow: 1;
`

const InspectorFooter = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const InspectorErrorNote = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

interface InspectorProps {
  entry: ReplayLibraryEntry | undefined
  computerLabel: string
  onWatch: (entry: ReplayLibraryEntry) => void
  onReveal: (entry: ReplayLibraryEntry) => void
}

function Inspector({ entry, computerLabel, onWatch, onReveal }: InspectorProps) {
  const { t } = useTranslation()

  if (!entry) {
    return (
      <InspectorRoot>
        <InspectorEmpty>
          {t('replays.library.inspector.empty', 'Select a replay to see its details')}
        </InspectorEmpty>
      </InspectorRoot>
    )
  }

  const mode = replayGameTypeToLabel(entry.gameType, t)
  const duration = getGameDurationString((entry.durationFrames * 1000) / 24)
  const layout = getReplayDisplayTeams(entry.players)
  const teamLabels = shouldShowTeamLabels(layout)
    ? layout.teams.map((_, i) =>
        t('game.teamName.number', { defaultValue: 'Team {{teamNumber}}', teamNumber: i + 1 }),
      )
    : undefined

  return (
    <InspectorRoot>
      {entry.parseError ? (
        <>
          <InspectorHeader>
            <InspectorModeChip>{mode}</InspectorModeChip>
            <InspectorMapName>{entry.fileName}</InspectorMapName>
          </InspectorHeader>
          <InspectorErrorNote>
            {t('replays.library.inspector.parseError', 'This replay could not be read.')}
          </InspectorErrorNote>
        </>
      ) : (
        <>
          <InspectorHeader>
            <InspectorModeChip>{mode}</InspectorModeChip>
            <InspectorMapName>{filterColorCodes(entry.mapName)}</InspectorMapName>
            <InspectorSubline>
              {longTimestamp.format(entry.gameTime)} · {duration}
            </InspectorSubline>
          </InspectorHeader>
          <InspectorSection>
            <PlayerTeamsDisplay
              teams={playersToDisplayTeams(layout, computerLabel)}
              teamLabels={teamLabels}
            />
          </InspectorSection>
        </>
      )}

      <InspectorActions>
        <FullWidthFilledButton
          label={t('replays.library.watchReplay', 'Watch replay')}
          iconStart={<MaterialIcon icon='play_arrow' />}
          onClick={() => onWatch(entry)}
        />
        <FullWidthOutlinedButton
          label={t('replays.library.showInExplorer', 'Show in Explorer')}
          iconStart={<MaterialIcon icon='folder_open' />}
          onClick={() => onReveal(entry)}
        />
      </InspectorActions>

      <InspectorSpacer />

      <InspectorFooter>
        {entry.fileName} · {formatFileSize(entry.fileSize)}
      </InspectorFooter>
    </InspectorRoot>
  )
}

// ---- Matchup filter chip ---------------------------------------------------------------------

const MatchupPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  width: 320px;

  border-radius: 8px;
  background-color: var(--theme-container-high);
`

const MatchupPanelSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const MatchupPanelLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const FormatChips = styled.div`
  display: flex;
  gap: 8px;
`

interface MatchupFilterChipProps {
  format?: GameFormat
  matchup?: EncodedMatchupString
  onFormatChange: (format?: GameFormat) => void
  onMatchupChange: (matchup?: EncodedMatchupString) => void
}

function MatchupFilterChip({
  format,
  matchup,
  onFormatChange,
  onMatchupChange,
}: MatchupFilterChipProps) {
  const { t } = useTranslation()
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition<HTMLButtonElement>(
    'left',
    'bottom',
  )
  const [open, openPopover, closePopover] = usePopoverController({ refreshAnchorPos })

  return (
    <>
      <FilterChip
        ref={anchorRef}
        label={format ?? t('replays.library.filters.matchup', 'Matchup')}
        icon={<MaterialIcon icon='swords' size={18} />}
        selected={!!format || open}
        onClick={e => (open ? closePopover() : openPopover(e))}
      />
      <Popover
        open={open}
        onDismiss={closePopover}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='left'
        originY='top'>
        <MatchupPanel>
          <MatchupPanelSection>
            <MatchupPanelLabel>{t('replays.library.filters.format', 'Format')}</MatchupPanelLabel>
            <FormatChips>
              {ALL_GAME_FORMATS.map(f => (
                <FilterChip
                  key={f}
                  label={f}
                  selected={format === f}
                  onClick={() => {
                    if (format === f) {
                      onFormatChange(undefined)
                      onMatchupChange(undefined)
                    } else {
                      onFormatChange(f)
                      onMatchupChange(undefined)
                    }
                  }}
                />
              ))}
            </FormatChips>
          </MatchupPanelSection>
          {format ? (
            <MatchupPanelSection>
              <MatchupPanelLabel>
                {t('replays.library.filters.matchup', 'Matchup')}
              </MatchupPanelLabel>
              <MatchupFilter
                matchup={decodeMatchup(format, matchup) ?? createEmptyMatchup(format)}
                onMatchupChange={m => {
                  const hasRace = [...m.team1, ...m.team2].some(r => r !== undefined)
                  onMatchupChange(hasRace ? encodeMatchup(m) : undefined)
                }}
              />
            </MatchupPanelSection>
          ) : null}
        </MatchupPanel>
      </Popover>
    </>
  )
}

// ---- Main component --------------------------------------------------------------------------

const SlashHint = styled.div`
  ${labelMedium};

  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;

  border: 1px solid var(--theme-outline);
  border-radius: 4px;
  color: var(--theme-on-surface-variant);
`

function formatDayLabel(
  dayStartMs: number,
  todayStartMs: number,
  yesterdayStartMs: number,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (dayStartMs === todayStartMs) {
    return t('replays.library.today', 'Today')
  }
  if (dayStartMs === yesterdayStartMs) {
    return t('replays.library.yesterday', 'Yesterday')
  }
  return dayGroupDateFormat.format(dayStartMs)
}

export function ReplayLibrary() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [entries, setEntries] = useState<ReadonlyArray<ReplayLibraryEntry>>([])
  const [hasLoaded, setHasLoaded] = useState(false)
  const [maps, setMaps] = useState<ReadonlyArray<string>>([])
  const [status, setStatus] = useState<ReplayLibraryStatus>()
  const [backfill, setBackfill] = useState<{ done: number; total: number }>()
  const [refreshToken, setRefreshToken] = useState(0)

  const [source, setSource] = useState<'sb' | 'bnet'>()
  const [mapName, setMapName] = useState<string>()
  const [gameType, setGameType] = useState<number>()
  const [duration, setDuration] = useState(GameDurationFilter.All)
  const [format, setFormat] = useState<GameFormat>()
  const [matchup, setMatchup] = useState<EncodedMatchupString>()
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)

  const [focusedId, setFocusedId] = useState<number>()

  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null)
  const virtuosoRef = useRef<GroupedVirtuosoHandle>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchDebounceRef = useRef(debounce((value: string) => setSearchQuery(value), 150))

  const computerLabel = t('game.playerName.computer', 'Computer')
  const watchTitle = t('replays.library.watchReplay', 'Watch replay')

  const hasActiveFilters =
    source !== undefined ||
    mapName !== undefined ||
    gameType !== undefined ||
    duration !== GameDurationFilter.All ||
    format !== undefined ||
    !!matchup ||
    searchQuery !== ''

  // Run (and re-run) the library query whenever the filters change or the index signals a change.
  useEffect(() => {
    let cancelled = false
    const filters: ReplayLibraryFilters = {}
    if (source !== undefined) filters.source = source
    if (mapName !== undefined) filters.mapName = mapName
    if (gameType !== undefined) filters.gameType = gameType
    if (duration !== GameDurationFilter.All) filters.duration = duration
    if (format !== undefined) {
      filters.format = format
      if (matchup) filters.matchup = matchup
    }
    if (searchQuery) filters.searchQuery = searchQuery

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
  }, [source, mapName, gameType, duration, format, matchup, searchQuery, refreshToken])

  // Fetch the map list + index status (and refresh them whenever the index changes).
  useEffect(() => {
    let cancelled = false
    ipcRenderer
      .invoke('replayLibraryGetMaps')
      ?.then(result => {
        if (!cancelled && result) setMaps(result)
      })
      .catch(swallowNonBuiltins)
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

  // Cancel any pending debounced search on unmount.
  useEffect(() => {
    const searchDebounce = searchDebounceRef.current
    return () => searchDebounce.cancel()
  }, [])

  const focusedEntry = entries.find(e => e.id === focusedId) ?? entries[0]
  const focusedIndex = focusedEntry ? entries.findIndex(e => e.id === focusedEntry.id) : -1

  const watchEntry = (entry: ReplayLibraryEntry) => {
    dispatch(startReplay({ path: entry.path, name: entry.fileName }))
  }
  const revealEntry = (entry: ReplayLibraryEntry) => {
    ipcRenderer.invoke('pathsShowItemInFolder', entry.path)?.catch(swallowNonBuiltins)
  }

  const focusIndex = (index: number) => {
    if (index < 0 || index >= entries.length) return
    setFocusedId(entries[index].id)
    virtuosoRef.current?.scrollIntoView({ index })
  }
  const moveFocus = (delta: number) => {
    if (entries.length === 0) return
    const base = focusedIndex < 0 ? 0 : focusedIndex
    const next = Math.min(Math.max(base + delta, 0), entries.length - 1)
    focusIndex(next)
  }

  const onSearchChange = (value: string) => {
    setSearchInput(value)
    searchDebounceRef.current(value)
  }
  const clearSearch = () => {
    searchDebounceRef.current.cancel()
    setSearchInput('')
    setSearchQuery('')
  }
  const clearAllFilters = () => {
    setSource(undefined)
    setMapName(undefined)
    setGameType(undefined)
    setDuration(GameDurationFilter.All)
    setFormat(undefined)
    setMatchup(undefined)
    clearSearch()
  }

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      const isEnter = event.code === ENTER || event.code === ENTER_NUMPAD

      // Shift+Enter watches the newest replay from anywhere on the page (even while searching).
      if (isEnter && event.shiftKey) {
        if (entries[0]) watchEntry(entries[0])
        return true
      }

      // `/` focuses the search field from anywhere on the page.
      if (event.code === 'Slash' && !searchFocused) {
        searchInputRef.current?.focus()
        return true
      }

      if (searchFocused) {
        if (event.code === 'Escape') {
          if (searchInput) {
            clearSearch()
          } else {
            searchInputRef.current?.blur()
          }
          return true
        }
        // Let all other keys type normally.
        return false
      }

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
        case 'Escape':
          if (hasActiveFilters) {
            clearAllFilters()
            return true
          }
          return false
        case 'KeyE':
          if (focusedEntry) revealEntry(focusedEntry)
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

  const heroEntry = entries[0]
  const dayGroups = groupReplaysByDay(entries)
  const groupCounts = dayGroups.map(g => g.entries.length)
  const { todayStartMs, yesterdayStartMs } = getDayBoundaries()

  let sourceLabel = t('replays.library.filters.source', 'Source')
  if (source === 'sb') {
    sourceLabel = t('replays.library.filters.sourceSb', 'ShieldBattery')
  } else if (source === 'bnet') {
    sourceLabel = t('replays.library.filters.sourceBnet', 'Battle.net')
  }

  let listContent
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
  } else {
    listContent = (
      <ListScroll ref={setScrollParent}>
        {heroEntry ? (
          <HeroCard entry={heroEntry} computerLabel={computerLabel} onWatch={watchEntry} />
        ) : null}
        {scrollParent ? (
          <GroupedVirtuoso
            ref={virtuosoRef}
            customScrollParent={scrollParent}
            groupCounts={groupCounts}
            groupContent={index => {
              const group = dayGroups[index]
              return (
                <DayHeaderRoot>
                  <span>{formatDayLabel(group.dayStartMs, todayStartMs, yesterdayStartMs, t)}</span>
                  <DayHeaderCount>
                    {t('replays.library.replayCount', {
                      defaultValue: '{{count}} replays',
                      count: group.entries.length,
                    })}
                  </DayHeaderCount>
                  <DayHeaderRule />
                </DayHeaderRoot>
              )
            }}
            itemContent={index => {
              const entry = entries[index]
              if (!entry) return null
              return (
                <ReplayRow
                  entry={entry}
                  focused={entry.id === focusedEntry?.id}
                  computerLabel={computerLabel}
                  watchTitle={watchTitle}
                  onFocus={setFocusedId}
                  onWatch={watchEntry}
                />
              )
            }}
          />
        ) : null}
      </ListScroll>
    )
  }

  const indexedCount = status?.totalIndexed ?? entries.length

  return (
    <Root>
      <Header>
        <PageTitle>{t('replays.library.title', 'Library')}</PageTitle>
        <StatusSpacer />
        {status?.watchedFolder ? (
          <IconButton
            icon={<MaterialIcon icon='folder_open' />}
            title={t('replays.library.openFolder', 'Open replays folder')}
            onClick={() => {
              ipcRenderer
                .invoke('pathsShowItemInFolder', status.watchedFolder)
                ?.catch(swallowNonBuiltins)
            }}
          />
        ) : null}
      </Header>

      <Toolbar>
        <SearchField
          ref={searchInputRef}
          value={searchInput}
          label={t('common.actions.search', 'Search')}
          dense={true}
          allowErrors={false}
          leadingIcons={[<MaterialIcon icon='search' key='search' />]}
          trailingIcons={
            !searchInput && !searchFocused ? [<SlashHint key='slash'>/</SlashHint>] : []
          }
          onChange={event => onSearchChange(event.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
        />

        <FilterChip label={sourceLabel} selected={source !== undefined}>
          <SelectableMenuItem
            text={t('replays.library.filters.sourceAny', 'Any source')}
            selected={source === undefined}
            onClick={() => setSource(undefined)}
          />
          <SelectableMenuItem
            text={t('replays.library.filters.sourceSb', 'ShieldBattery')}
            selected={source === 'sb'}
            onClick={() => setSource('sb')}
          />
          <SelectableMenuItem
            text={t('replays.library.filters.sourceBnet', 'Battle.net')}
            selected={source === 'bnet'}
            onClick={() => setSource('bnet')}
          />
        </FilterChip>

        <MatchupFilterChip
          format={format}
          matchup={matchup}
          onFormatChange={setFormat}
          onMatchupChange={setMatchup}
        />

        <FilterChip
          label={mapName ?? t('replays.library.filters.map', 'Map')}
          selected={mapName !== undefined}>
          <SelectableMenuItem
            text={t('replays.library.filters.mapAny', 'Any map')}
            selected={mapName === undefined}
            onClick={() => setMapName(undefined)}
          />
          {maps.map(m => (
            <SelectableMenuItem
              key={m}
              text={filterColorCodes(m)}
              selected={mapName === m}
              onClick={() => setMapName(m)}
            />
          ))}
        </FilterChip>

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
            onClick={() => setGameType(undefined)}
          />
          {REPLAY_GAME_TYPES.map(gt => (
            <SelectableMenuItem
              key={gt}
              text={replayGameTypeToLabel(gt, t)}
              selected={gameType === gt}
              onClick={() => setGameType(gt)}
            />
          ))}
        </FilterChip>

        <FilterChip
          label={getDurationLabel(duration, t)}
          icon={<MaterialIcon icon='timer' filled={false} size={18} />}
          selected={duration !== GameDurationFilter.All}>
          {DURATION_OPTIONS.map(d => (
            <SelectableMenuItem
              key={d}
              text={getDurationLabel(d, t)}
              selected={duration === d}
              onClick={() => setDuration(d)}
            />
          ))}
        </FilterChip>

        {hasActiveFilters ? (
          <TextButton
            label={t('common.actions.clear', 'Clear')}
            iconStart={<MaterialIcon icon='close' />}
            onClick={clearAllFilters}
          />
        ) : null}
      </Toolbar>

      <Body>
        <ListColumn>{listContent}</ListColumn>
        <Inspector
          entry={focusedEntry}
          computerLabel={computerLabel}
          onWatch={watchEntry}
          onReveal={revealEntry}
        />
      </Body>

      <StatusBar>
        <StatusHints>
          <StatusHint>
            <Kbd>↑↓</Kbd> {t('replays.library.hints.navigate', 'Navigate')}
          </StatusHint>
          <StatusHint>
            <Kbd>⏎</Kbd> {t('replays.library.hints.watch', 'Watch')}
          </StatusHint>
          <StatusHint>
            <Kbd>⇧⏎</Kbd> {t('replays.library.hints.watchLatest', 'Watch latest')}
          </StatusHint>
          <StatusHint>
            <Kbd>/</Kbd> {t('replays.library.hints.search', 'Search')}
          </StatusHint>
          <StatusHint>
            <Kbd>E</Kbd> {t('replays.library.hints.explorer', 'Explorer')}
          </StatusHint>
        </StatusHints>
        <StatusSpacer />
        <StatusIndexed>
          {backfill && backfill.total > 0
            ? t('replays.library.indexing', {
                defaultValue: 'Indexing… {{done}}/{{total}}',
                done: backfill.done,
                total: backfill.total,
              })
            : t('replays.library.indexed', {
                defaultValue: '{{count}} replays indexed',
                count: indexedCount,
              })}
        </StatusIndexed>
      </StatusBar>
    </Root>
  )
}
