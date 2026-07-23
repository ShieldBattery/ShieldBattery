import { TFunction } from 'i18next'
import { Variants } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  ALL_GAME_FORMATS,
  createEmptyMatchup,
  decodeMatchup,
  EncodedMatchupString,
  encodeMatchup,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
  getDurationLabel,
  getSortLabel,
} from '../../common/games/game-filters'
import {
  FEATURED_REPLAY_GAME_TYPES,
  replayGameTypeToLabel,
  SupportedReplayGameType,
} from '../../common/replays'
import { monthDay } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { TextButton } from '../material/button'
import { DateTextField } from '../material/date-text-field'
import { FilterChip } from '../material/filter-chip'
import { SelectableMenuItem } from '../material/menu/selectable-item'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { TextField } from '../material/text-field'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { FlexSpacer } from '../styles/flex-spacer'
import { labelLarge, labelMedium } from '../styles/typography'
import { resolveDateRangeMs } from './day-header'
import { MatchupFilter } from './matchup-filter'

const FilterBarContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  width: 100%;
  min-height: 56px;
`

const FiltersLabel = styled.div`
  ${labelLarge};
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--theme-on-surface-variant);
`

const popoverVariants: Variants = {
  entering: { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0 },
  exiting: { opacity: 0, y: -8 },
}

const DURATION_OPTIONS = [
  GameDurationFilter.All,
  GameDurationFilter.Under10,
  GameDurationFilter.From10To20,
  GameDurationFilter.From20To30,
  GameDurationFilter.Over30,
] as const

const SORT_OPTIONS = [
  GameSortOption.LatestFirst,
  GameSortOption.OldestFirst,
  GameSortOption.ShortestFirst,
  GameSortOption.LongestFirst,
] as const

/** Formats a `Date` as a local (not UTC) `yyyy-mm-dd` string, suitable for `<input type='date'>`. */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** A quick-range option offered in the Date filter's popover. */
enum DatePreset {
  PastWeek = 'pastWeek',
  PastMonth = 'pastMonth',
  Past3Months = 'past3Months',
  PastYear = 'pastYear',
}

const DATE_PRESETS: ReadonlyArray<{
  preset: DatePreset
  fromDate: (today: Date) => Date
}> = [
  {
    preset: DatePreset.PastWeek,
    fromDate: today => new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7),
  },
  {
    preset: DatePreset.PastMonth,
    fromDate: today => new Date(today.getFullYear(), today.getMonth() - 1, today.getDate()),
  },
  {
    preset: DatePreset.Past3Months,
    fromDate: today => new Date(today.getFullYear(), today.getMonth() - 3, today.getDate()),
  },
  {
    preset: DatePreset.PastYear,
    fromDate: today => new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()),
  },
]

function getDatePresetLabel(preset: DatePreset, t: TFunction): string {
  switch (preset) {
    case DatePreset.PastWeek:
      return t('game.filters.datePastWeek', 'Past week')
    case DatePreset.PastMonth:
      return t('game.filters.datePastMonth', 'Past month')
    case DatePreset.Past3Months:
      return t('game.filters.datePast3Months', 'Past 3 months')
    case DatePreset.PastYear:
      return t('game.filters.datePastYear', 'Past year')
    default:
      return preset satisfies never
  }
}

/**
 * Formats the Date filter chip's label: the generic label when unset, or a compact rendering of
 * the active bound(s) otherwise (an open start or end reads as "From X"/"Until X", a full range as
 * "X – Y").
 */
function getDateFilterChipLabel(startDate: string, endDate: string, t: TFunction): string {
  const { startMs, endMs } = resolveDateRangeMs(startDate, endDate)

  if (startMs !== undefined && endMs !== undefined) {
    return t('game.filters.dateRangeBetween', {
      defaultValue: '{{start}} – {{end}}',
      start: monthDay.format(startMs),
      end: monthDay.format(endMs),
    })
  } else if (startMs !== undefined) {
    return t('game.filters.dateRangeFrom', {
      defaultValue: 'From {{date}}',
      date: monthDay.format(startMs),
    })
  } else if (endMs !== undefined) {
    return t('game.filters.dateRangeUntil', {
      defaultValue: 'Until {{date}}',
      date: monthDay.format(endMs),
    })
  }

  return t('game.filters.date', 'Date')
}

export interface GameFilterBarProps {
  /** When false, hides Ranked and Custom filter chips (e.g. for Games page which only shows matchmaking). */
  showRankedCustom?: boolean
  ranked?: boolean
  setRanked?: (v: boolean) => void
  custom?: boolean
  setCustom?: (v: boolean) => void
  duration: GameDurationFilter
  setDuration: (v: GameDurationFilter) => void
  sort: GameSortOption
  setSort: (v: GameSortOption) => void
  mapName: string
  setMapName: (v: string) => void
  playerName: string
  setPlayerName: (v: string) => void
  format?: GameFormat
  setFormat: (v?: GameFormat) => void
  matchup?: EncodedMatchupString
  setMatchup: (v?: EncodedMatchupString) => void
  /** When true, shows the game mode (game type) filter chip. */
  showGameType?: boolean
  gameType?: SupportedReplayGameType | 'others'
  setGameType?: (v: SupportedReplayGameType | 'others' | undefined) => void
  /**
   * When `setSpoilerFree` is provided, shows a spoiler-free toggle that hides the game length and,
   * where shown, the match result.
   */
  spoilerFree?: boolean
  setSpoilerFree?: (v: boolean) => void
  /**
   * The active date range bounds, as `yyyy-mm-dd` strings (empty = unset). The Date filter chip is
   * only shown when `setStartDate` is provided.
   */
  startDate?: string
  setStartDate?: (value: string) => void
  endDate?: string
  setEndDate?: (value: string) => void
  className?: string
}

/**
 * A filter bar for game history with immediate-apply filters (chips, dropdowns)
 * and an advanced filters panel with draft state.
 */
export function GameFilterBar({
  showRankedCustom = true,
  ranked = false,
  setRanked,
  custom = false,
  setCustom,
  duration,
  setDuration,
  sort,
  setSort,
  mapName,
  setMapName,
  playerName,
  setPlayerName,
  format,
  setFormat,
  matchup,
  setMatchup,
  showGameType = false,
  gameType,
  setGameType,
  spoilerFree = false,
  setSpoilerFree,
  startDate = '',
  setStartDate,
  endDate = '',
  setEndDate,
  className,
}: GameFilterBarProps) {
  const { t } = useTranslation()
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('left', 'bottom')
  const [opened, openPopover, closePopover] = usePopoverController({ refreshAnchorPos })
  const [dateAnchorRef, dateAnchorX, dateAnchorY, refreshDateAnchorPos] = useRefAnchorPosition(
    'left',
    'bottom',
  )
  const [dateOpened, openDatePopover, closeDatePopover] = usePopoverController({
    refreshAnchorPos: refreshDateAnchorPos,
  })

  const hasAdvancedFilters = !!mapName || !!playerName || !!format || !!matchup
  const hasDateRange = !!startDate || !!endDate
  const hasActiveFilters =
    (showRankedCustom && (ranked || custom)) ||
    duration !== GameDurationFilter.All ||
    hasAdvancedFilters ||
    (showGameType && gameType !== undefined) ||
    hasDateRange

  let gameTypeLabel = t('game.filters.mode', 'Mode')
  if (gameType === 'others') {
    gameTypeLabel = t('game.filters.modeOthers', 'Others')
  } else if (gameType !== undefined) {
    gameTypeLabel = replayGameTypeToLabel(gameType, t)
  }

  return (
    <FilterBarContainer className={className}>
      <FiltersLabel>
        <MaterialIcon icon='filter_list' size={20} />
        {t('game.filters.label', 'Filters')}
      </FiltersLabel>

      {showRankedCustom && (
        <>
          <FilterChip
            label={t('game.filters.ranked', 'Ranked')}
            selected={ranked}
            onClick={() => setRanked?.(!ranked)}
          />
          <FilterChip
            label={t('game.filters.custom', 'Custom')}
            selected={custom}
            onClick={() => setCustom?.(!custom)}
          />
        </>
      )}

      {showGameType && (
        <FilterChip label={gameTypeLabel} selected={gameType !== undefined}>
          <SelectableMenuItem
            text={t('game.filters.modeAny', 'Any mode')}
            selected={gameType === undefined}
            onClick={() => setGameType?.(undefined)}
          />
          {FEATURED_REPLAY_GAME_TYPES.map(gt => (
            <SelectableMenuItem
              key={gt}
              text={replayGameTypeToLabel(gt, t)}
              selected={gameType === gt}
              onClick={() => setGameType?.(gt)}
            />
          ))}
          <SelectableMenuItem
            text={t('game.filters.modeOthers', 'Others')}
            selected={gameType === 'others'}
            onClick={() => setGameType?.('others')}
          />
        </FilterChip>
      )}

      <FilterChip
        label={getDurationLabel(duration, t)}
        icon={<MaterialIcon icon='timer' filled={false} size={18} />}>
        {DURATION_OPTIONS.map(d => (
          <SelectableMenuItem
            key={d}
            text={getDurationLabel(d, t)}
            selected={duration === d}
            onClick={() => setDuration(d)}
          />
        ))}
      </FilterChip>

      <FilterChip
        ref={anchorRef}
        label={t('game.filters.advanced', 'Advanced')}
        icon={<MaterialIcon icon='instant_mix' size={18} />}
        selected={!!hasAdvancedFilters || opened}
        onClick={e => (opened ? closePopover() : openPopover(e))}
      />

      {setStartDate && (
        <FilterChip
          ref={dateAnchorRef}
          label={getDateFilterChipLabel(startDate, endDate, t)}
          icon={<MaterialIcon icon='calendar_month' size={18} />}
          selected={hasDateRange || dateOpened}
          onClick={e => (dateOpened ? closeDatePopover() : openDatePopover(e))}
        />
      )}

      {hasActiveFilters && (
        <TextButton
          label={t('common.actions.clear', 'Clear')}
          iconStart={<MaterialIcon icon='close' />}
          onClick={() => {
            setRanked?.(false)
            setCustom?.(false)
            setDuration(GameDurationFilter.All)
            setMapName('')
            setPlayerName('')
            setFormat(undefined)
            setMatchup(undefined)
            setGameType?.(undefined)
            setStartDate?.('')
            setEndDate?.('')
          }}
        />
      )}

      <FlexSpacer />

      {setSpoilerFree && (
        <FilterChip
          label={t('game.filters.spoilerFree', 'Spoiler-free')}
          icon={<MaterialIcon icon='visibility_off' size={18} />}
          selected={spoilerFree}
          onClick={() => setSpoilerFree(!spoilerFree)}
        />
      )}

      <FilterChip label={getSortLabel(sort, t)} icon={<MaterialIcon icon='sort' size={18} />}>
        {SORT_OPTIONS.map(s => (
          <SelectableMenuItem
            key={s}
            text={getSortLabel(s, t)}
            selected={sort === s}
            onClick={() => setSort(s)}
          />
        ))}
      </FilterChip>

      <Popover
        open={opened}
        onDismiss={closePopover}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='left'
        originY='top'
        motionVariants={popoverVariants}
        motionInitial='entering'
        motionAnimate='visible'
        motionExit='exiting'>
        <AdvancedFiltersPanel
          mapName={mapName}
          playerName={playerName}
          format={format}
          matchup={matchup}
          onApply={advancedValues => {
            setMapName(advancedValues.mapName)
            setPlayerName(advancedValues.playerName)
            setFormat(advancedValues.format)
            setMatchup(advancedValues.matchup)
            closePopover()
          }}
          onClose={closePopover}
        />
      </Popover>

      {setStartDate && (
        <Popover
          open={dateOpened}
          onDismiss={closeDatePopover}
          anchorX={dateAnchorX ?? 0}
          anchorY={dateAnchorY ?? 0}
          originX='left'
          originY='top'
          motionVariants={popoverVariants}
          motionInitial='entering'
          motionAnimate='visible'
          motionExit='exiting'>
          <DateFiltersPanel
            startDate={startDate}
            endDate={endDate}
            onApply={dateValues => {
              setStartDate(dateValues.startDate)
              setEndDate?.(dateValues.endDate)
              closeDatePopover()
            }}
          />
        </Popover>
      )}
    </FilterBarContainer>
  )
}

/** Shared popover panel shell for the filter bar's draft-state panels (Advanced, Date). */
const FilterPanelContainer = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  display: flex;
  flex-direction: column;

  border-radius: 8px;
  width: 364px;
`

const PanelContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
`

const PanelSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const FormatButtonsContainer = styled.div`
  display: flex;
  gap: 8px;
`

const PanelActions = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: 8px 4px 4px;
`

interface AdvancedFiltersPanelProps {
  mapName: string
  playerName: string
  format?: GameFormat
  matchup?: EncodedMatchupString
  onApply: (values: {
    mapName: string
    playerName: string
    format?: GameFormat
    matchup?: EncodedMatchupString
  }) => void
  onClose: () => void
}

function AdvancedFiltersPanel({
  mapName,
  playerName,
  format,
  matchup,
  onApply,
  onClose,
}: AdvancedFiltersPanelProps) {
  const { t } = useTranslation()

  const [draftMapName, setDraftMapName] = useState(mapName)
  const [draftPlayerName, setDraftPlayerName] = useState(playerName)
  const [draftFormat, setDraftFormat] = useState(format)
  const [draftMatchup, setDraftMatchup] = useState(matchup)

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        onApply({
          mapName: draftMapName,
          playerName: draftPlayerName,
          format: draftFormat,
          matchup: draftMatchup,
        })
        return true
      }

      return false
    },
  })

  return (
    <FilterPanelContainer>
      <PanelContent>
        <PanelSection>
          <SectionLabel>{t('common.actions.search', 'Search')}</SectionLabel>
          <TextField
            label={t('game.filters.mapName', 'Map name')}
            value={draftMapName}
            onChange={e => setDraftMapName(e.target.value)}
            dense={true}
            allowErrors={false}
          />
          <TextField
            label={t('game.filters.playerName', 'Player name')}
            value={draftPlayerName}
            onChange={e => setDraftPlayerName(e.target.value)}
            dense={true}
            allowErrors={false}
          />
        </PanelSection>

        <PanelSection>
          <SectionLabel>{t('game.filters.format', 'Format')}</SectionLabel>
          <FormatButtonsContainer>
            {ALL_GAME_FORMATS.map(f => (
              <FilterChip
                key={f}
                label={f}
                selected={draftFormat === f}
                onClick={() => {
                  if (draftFormat === f) {
                    setDraftFormat(undefined)
                    setDraftMatchup(undefined)
                  } else {
                    setDraftFormat(f)
                    // Leave the matchup unset until an actual race is chosen, so we don't carry a
                    // no-op all-wildcard matchup (e.g. `____-____`) around in the URL.
                    setDraftMatchup(undefined)
                  }
                }}
              />
            ))}
          </FormatButtonsContainer>
        </PanelSection>

        {draftFormat && (
          <PanelSection>
            <SectionLabel>{t('game.filters.matchup', 'Matchup')}</SectionLabel>
            <MatchupFilter
              matchup={decodeMatchup(draftFormat, draftMatchup) ?? createEmptyMatchup(draftFormat)}
              onMatchupChange={m => {
                const hasNonUndefinedRace = [...m.team1, ...m.team2].some(r => r !== undefined)
                setDraftMatchup(hasNonUndefinedRace ? encodeMatchup(m) : undefined)
              }}
            />
          </PanelSection>
        )}
      </PanelContent>

      <PanelActions>
        <TextButton
          label={t('common.actions.reset', 'Reset')}
          onClick={() => {
            setDraftMapName('')
            setDraftPlayerName('')
            setDraftFormat(undefined)
            setDraftMatchup(undefined)
          }}
        />
        <TextButton
          label={t('common.actions.apply', 'Apply')}
          onClick={() =>
            onApply({
              mapName: draftMapName,
              playerName: draftPlayerName,
              format: draftFormat,
              matchup: draftMatchup,
            })
          }
        />
      </PanelActions>
    </FilterPanelContainer>
  )
}

const PresetButtonsContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

interface DateFiltersPanelProps {
  startDate: string
  endDate: string
  onApply: (values: { startDate: string; endDate: string }) => void
}

function DateFiltersPanel({ startDate, endDate, onApply }: DateFiltersPanelProps) {
  const { t } = useTranslation()

  const [draftStartDate, setDraftStartDate] = useState(startDate)
  const [draftEndDate, setDraftEndDate] = useState(endDate)

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        onApply({ startDate: draftStartDate, endDate: draftEndDate })
        return true
      }

      return false
    },
  })

  const today = new Date()

  return (
    <FilterPanelContainer>
      <PanelContent>
        <PanelSection>
          <SectionLabel>{t('game.filters.datePresets', 'Quick ranges')}</SectionLabel>
          <PresetButtonsContainer>
            {DATE_PRESETS.map(({ preset, fromDate }) => {
              const presetStartDate = toLocalDateString(fromDate(today))
              const presetEndDate = toLocalDateString(today)
              return (
                <FilterChip
                  key={preset}
                  label={getDatePresetLabel(preset, t)}
                  selected={draftStartDate === presetStartDate && draftEndDate === presetEndDate}
                  onClick={() => {
                    setDraftStartDate(presetStartDate)
                    setDraftEndDate(presetEndDate)
                  }}
                />
              )
            })}
          </PresetButtonsContainer>
        </PanelSection>

        <PanelSection>
          <DateTextField
            label={t('game.filters.dateFrom', 'From')}
            value={draftStartDate}
            onChange={e => setDraftStartDate(e.target.value)}
            dense={true}
            allowErrors={false}
          />
          <DateTextField
            label={t('game.filters.dateTo', 'To')}
            value={draftEndDate}
            onChange={e => setDraftEndDate(e.target.value)}
            dense={true}
            allowErrors={false}
          />
        </PanelSection>
      </PanelContent>

      <PanelActions>
        <TextButton
          label={t('common.actions.reset', 'Reset')}
          onClick={() => {
            setDraftStartDate('')
            setDraftEndDate('')
          }}
        />
        <TextButton
          label={t('common.actions.apply', 'Apply')}
          onClick={() => onApply({ startDate: draftStartDate, endDate: draftEndDate })}
        />
      </PanelActions>
    </FilterPanelContainer>
  )
}
