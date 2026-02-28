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
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { TextButton } from '../material/button'
import { FilterChip } from '../material/filter-chip'
import { SelectableMenuItem } from '../material/menu/selectable-item'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { TextField } from '../material/text-field'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { FlexSpacer } from '../styles/flex-spacer'
import { labelLarge, labelMedium } from '../styles/typography'
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
  className,
}: GameFilterBarProps) {
  const { t } = useTranslation()
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('left', 'bottom')
  const [opened, openPopover, closePopover] = usePopoverController({ refreshAnchorPos })

  const hasAdvancedFilters = !!mapName || !!playerName || !!format || !!matchup
  const hasActiveFilters =
    (showRankedCustom && (ranked || custom)) ||
    duration !== GameDurationFilter.All ||
    hasAdvancedFilters

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
          }}
        />
      )}

      <FlexSpacer />

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
    </FilterBarContainer>
  )
}

const AdvancedPanelContainer = styled.div`
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
    <AdvancedPanelContainer>
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
                    setDraftMatchup(encodeMatchup(createEmptyMatchup(f)))
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
    </AdvancedPanelContainer>
  )
}
