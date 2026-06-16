import { useAtomValue } from 'jotai'
import { AnimatePresence, m } from 'motion/react'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css, keyframes } from 'styled-components'
import { ladderPlayerToMatchmakingDivision } from '../../common/ladder/ladder'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingDivision,
  MatchmakingPreferences,
  MatchmakingType,
  defaultPreferences,
  getTotalBonusPoolForSeason,
  hasVetoes,
  matchmakingDivisionToLabel,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { AssignedRaceChar, RaceChar } from '../../common/races'
import { urlPath } from '../../common/urls'
import { useTrackPageView } from '../analytics/analytics'
import { useSelfUser } from '../auth/auth-utils'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { getInstantaneousSelfRank } from '../ladder/action-creators'
import { RaceIcon } from '../lobbies/race-icon'
import { FilledButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { push } from '../navigation/routing'
import { useNow } from '../react/date-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { healthChecked } from '../starcraft/health-checked'
import { bodySmall, labelMedium, labelSmall, sofiaSans, titleSmall } from '../styles/typography'
import { cancelFindMatch, findMatch, getCurrentMapPool } from './action-creators'
import { Contents1v1 } from './find-1v1'
import { Contents1v1Fastest } from './find-1v1-fastest'
import { Contents2v2 } from './find-2v2'
import { FindMatchFormRef } from './find-match-forms'
import { currentSearchInfoAtom, isMatchmakingAtom } from './matchmaking-atoms'
import { DivisionIcon } from './rank-icon'

// ─── Static mode definitions ─────────────────────────────────────────────────

export interface RealModeData {
  type: MatchmakingType
  group: string
  team: boolean
}

const REAL_MODES: RealModeData[] = [
  { type: MatchmakingType.Match1v1, group: '1v1', team: false },
  { type: MatchmakingType.Match1v1Fastest, group: '1v1', team: false },
  { type: MatchmakingType.Match2v2, group: '2v2', team: true },
]

const MODE_GROUPS: { id: '1v1' | '2v2'; label: string; hint: string }[] = [
  { id: '1v1', label: '1v1', hint: 'Solo ranked · race locked before queue' },
  { id: '2v2', label: '2v2', hint: 'Team play · race drafted in-game' },
]

// ─── Animations ───────────────────────────────────────────────────────────────

const searchPulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
`

// ─── Page layout ──────────────────────────────────────────────────────────────

export const PageRoot = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 100%;
  background: var(--theme-surface);
  padding: 28px 40px 0;
  gap: 20px;
  position: relative;

  @media (max-width: 1024px) {
    padding: 24px 20px 0;
  }
`

export const PanelRoot = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 20px;
`

export const PageHead = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
`

export const PageTitle = styled.h1`
  ${sofiaSans};
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--theme-on-surface);
  margin: 0;
`

export const PageSubtitle = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  margin-top: 4px;
`

export const SeasonLabel = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  white-space: nowrap;
  margin-top: 4px;
`

// ─── Lobby banner ─────────────────────────────────────────────────────────────

export const LobbyBanner = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: color-mix(in srgb, var(--theme-on-surface) 6%, var(--theme-container-low));
  border: 1px solid color-mix(in srgb, var(--theme-on-surface) 12%, transparent);
  border-radius: 8px;
  color: var(--theme-on-surface-variant);
  font-size: 14px;
`

export const LobbyBannerText = styled.span`
  flex: 1;
`

export const LobbyBannerButton = styled(TextButton)`
  flex-shrink: 0;
`

// ─── Mode groups ──────────────────────────────────────────────────────────────

export const GroupsContainer = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 28px;
`

export const ModeGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

export const GroupHead = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
`

export const GroupLabel = styled.span`
  font: 600 11px / 1 var(--font-body, sans-serif);
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--theme-on-surface-variant);
  white-space: nowrap;
`

export const GroupDivider = styled.span`
  flex: 1;
  height: 1px;
  background: color-mix(in srgb, var(--theme-on-surface) 8%, transparent);
`

export const GroupHint = styled.span`
  font: 400 11px / 1 var(--font-body, sans-serif);
  color: var(--theme-on-surface-variant);
  opacity: 0.6;
  white-space: nowrap;
`

export const ModeList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

// ─── Type Row ─────────────────────────────────────────────────────────────────

const TypeRowRoot = styled.div<{
  $selected: boolean
  $faded: boolean
  $searching: boolean
  $disabled: boolean
}>`
  display: grid;
  grid-template-columns: 44px minmax(200px, 1fr) 292px minmax(240px, 280px) 52px;
  align-items: center;
  gap: 14px;
  padding: 14px 20px;
  background: ${props =>
    props.$selected
      ? 'color-mix(in srgb, var(--theme-primary) 8%, var(--theme-container-low))'
      : 'var(--theme-container-low)'};
  border-radius: 8px;
  box-shadow: var(--shadow-1dp);
  border: 1px solid
    ${props =>
      props.$selected
        ? 'color-mix(in srgb, var(--theme-primary) 60%, transparent)'
        : 'transparent'};
  cursor: ${props => (props.$searching || props.$disabled ? 'default' : 'pointer')};
  user-select: none;
  transition:
    background 200ms ease,
    border-color 200ms ease,
    opacity 300ms ease;
  opacity: ${props => {
    if (props.$faded) {
      return 0.3
    }
    if (props.$disabled) {
      return 0.7
    }
    return 1
  }};
  pointer-events: ${props => (props.$faded ? 'none' : 'auto')};

  &:hover {
    background: ${props => {
      if (props.$disabled || props.$searching) {
        return props.$selected
          ? 'color-mix(in srgb, var(--theme-primary) 8%, var(--theme-container-low))'
          : 'var(--theme-container-low)'
      } else {
        return props.$selected
          ? 'color-mix(in srgb, var(--theme-primary) 12%, var(--theme-container))'
          : 'var(--theme-container)'
      }
    }};
  }

  @media (max-width: 1280px) {
    grid-template-columns: 44px 1fr auto 52px;
    grid-template-rows: auto auto;
    grid-template-areas:
      'check title summary gear'
      'check stats summary gear';
    column-gap: 16px;
    row-gap: 4px;
    padding: 12px 18px;
    align-items: start;
  }
`

const RowCheckBox = styled(CheckBox)<{ $pulsing: boolean }>`
  padding: 0;
  align-self: center;

  ${props =>
    props.$pulsing &&
    css`
      animation: ${searchPulse} 1.8s ease-in-out infinite;
    `}

  @media (max-width: 1280px) {
    grid-area: check;
    align-self: center;
  }
`

const DisabledCheckPlaceholder = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  color: var(--theme-on-surface-variant);
  opacity: 0.6;
  align-self: center;

  @media (max-width: 1280px) {
    grid-area: check;
    align-self: center;
  }
`

const RowTitle = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;

  @media (max-width: 1280px) {
    grid-area: title;
    align-self: end;
    padding-bottom: 2px;
  }
`

const RowTitleMain = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const RowModeName = styled.h3`
  ${sofiaSans};
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--theme-on-surface);
  white-space: nowrap;

  @media (max-width: 1024px) {
    font-size: 18px;
  }
`

const GroupBadge = styled.span`
  ${labelSmall};
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  background: color-mix(in srgb, var(--theme-on-surface) 10%, transparent);
  color: var(--theme-on-surface-variant);
`

const RowDesc = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);

  @media (max-width: 1280px) {
    display: none;
  }
`

// Stats column — inner grid: Rank | MMR | Bonus Pool
const StatsBlock = styled.div`
  display: grid;
  grid-template-columns: 110px 70px 80px;
  align-items: center;
  padding: 0 16px;
  border-left: 1px solid color-mix(in srgb, var(--theme-on-surface) 8%, transparent);
  border-right: 1px solid color-mix(in srgb, var(--theme-on-surface) 8%, transparent);

  @media (max-width: 1280px) {
    grid-area: stats;
    justify-self: start;
    align-self: start;
    padding: 0;
    border: none;
    display: flex;
    flex-direction: row;
    gap: 14px;
    align-items: center;
  }
`

const StatCell = styled.div<{ $unranked?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  opacity: ${props => (props.$unranked ? 0.7 : 1)};

  @media (max-width: 1280px) {
    flex-direction: row;
    align-items: center;
    gap: 6px;

    & + &::before {
      content: '';
      display: block;
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--color-grey-blue60);
      margin-right: 8px;
      flex-shrink: 0;
      align-self: center;
    }
  }
`

const StatLabel = styled.span`
  font: 600 9px / 1 var(--font-body, sans-serif);
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--color-grey-blue60);

  @media (max-width: 1280px) {
    display: none;
  }
`

const StatValue = styled.span`
  ${titleSmall};
  display: flex;
  align-items: center;
  min-height: 28px;
  color: var(--theme-on-surface);
  font-feature-settings: 'tnum';
`

const StatUnrankedValue = styled.span`
  ${bodySmall};
  display: flex;
  align-items: center;
  min-height: 28px;
  color: var(--theme-on-surface-variant);
`

const StatRankRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
`

const SmallDivisionIcon = styled(DivisionIcon)`
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.4));

  @media (max-width: 1280px) {
    width: 22px;
    height: 22px;
  }
`

const StatRankLabel = styled.span`
  font: 500 12px / 1.1 var(--font-body, sans-serif);
  color: var(--color-grey-blue95);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const BonusValue = styled.span<{ $zero: boolean }>`
  ${labelMedium};
  display: flex;
  align-items: center;
  gap: 3px;
  color: ${props => (props.$zero ? 'var(--color-grey-blue60)' : 'var(--color-amber70)')};
  font-feature-settings: 'tnum';
  min-height: 28px;
`

// ─── Unavailable info (replaces stats+summary for disabled types) ─────────────

const UnavailableBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  grid-column: 3 / 6;
  padding: 0 16px;

  @media (max-width: 1280px) {
    grid-column: auto;
    grid-area: stats / stats / gear / summary;
    padding: 0;
  }
`

const UnavailableLabel = styled.span`
  font: 600 11px / 1 var(--font-body, sans-serif);
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--theme-on-surface-variant);
`

const UnavailableDetail = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const UnavailableCountdown = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  font-feature-settings: 'tnum';
`

// Summary column
const SummaryBlock = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  row-gap: 4px;
  column-gap: 10px;
  color: var(--theme-on-surface-variant);
  font-size: 13px;
  justify-self: start;

  pointer-events: none;

  @media (max-width: 1280px) {
    grid-area: summary;
    justify-self: end;
    align-self: center;
  }
`

const SummaryRaceRow = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
`

const StyledRaceIcon = styled(RaceIcon)`
  width: 22px;
  height: 22px;
  flex-shrink: 0;
`

const ChipRaceIcon = styled(RaceIcon)`
  width: 14px;
  height: 14px;
  flex-shrink: 0;
`

const MirrorArrow = styled.span`
  ${bodySmall};
  opacity: 0.6;
  color: var(--theme-on-surface-variant);
`

const SummaryMapRow = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
`

const MapCountLabel = styled.span`
  ${labelSmall};
  text-transform: uppercase;
  letter-spacing: 0.4px;
`

const MapCountNum = styled.strong`
  font-family: var(--font-display, sans-serif);
  font-weight: 600;
  color: var(--color-grey99);
  font-feature-settings: 'tnum';
`

const PoolBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 5px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--theme-amber) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-amber) 40%, transparent);
  font: 600 10px / 1.1 var(--font-body, sans-serif);
  letter-spacing: 0.3px;
  text-transform: uppercase;
  color: var(--theme-amber);
  white-space: nowrap;
`

const PoolBadgeDot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--theme-amber);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-amber) 25%, transparent);
  flex-shrink: 0;
`

// Gear button column
const GearWrap = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;

  @media (max-width: 1280px) {
    grid-area: gear;
    align-self: center;
  }
`

const GearButton = styled.button`
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  border: 1px solid var(--theme-outline);
  background: transparent;
  color: var(--theme-on-surface-variant);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease;

  &:hover:not(:disabled) {
    color: var(--theme-amber);
    border-color: color-mix(in srgb, var(--theme-amber) 50%, transparent);
    background: color-mix(in srgb, var(--theme-amber) 8%, transparent);
  }

  &:disabled {
    opacity: 0.38;
    cursor: default;
  }

  @media (max-width: 1024px) {
    width: 36px;
    height: 36px;
  }
`

// ─── Stats block sub-component ────────────────────────────────────────────────

export interface RowStats {
  division: MatchmakingDivision
  mmr: number | null
  bonus: number
}

interface ModeStatsProps {
  stats: RowStats
  t: ReturnType<typeof useTranslation>['t']
}

export function ModeStats({ stats, t }: ModeStatsProps) {
  const unranked = stats.mmr === null
  return (
    <StatsBlock>
      <StatCell>
        <StatLabel>{t('matchmaking.findMatch.rank', 'Rank')}</StatLabel>
        <StatRankRow>
          <SmallDivisionIcon division={stats.division} size={28} />
          <StatRankLabel>{matchmakingDivisionToLabel(stats.division, t)}</StatRankLabel>
        </StatRankRow>
      </StatCell>

      <StatCell $unranked={unranked}>
        <StatLabel>{t('matchmaking.findMatch.rating', 'Rating')}</StatLabel>
        {unranked ? (
          <StatUnrankedValue>{t('matchmaking.findMatch.unratedText', 'Unrated')}</StatUnrankedValue>
        ) : (
          <StatValue>{stats.mmr!.toLocaleString()}</StatValue>
        )}
      </StatCell>

      <StatCell>
        <StatLabel>{t('matchmaking.findMatch.bonusPool', 'Bonus pool')}</StatLabel>
        <BonusValue $zero={stats.bonus === 0}>
          <MaterialIcon icon='bolt' size={13} />+{stats.bonus}
        </BonusValue>
      </StatCell>
    </StatsBlock>
  )
}

// ─── Unavailable info sub-component ──────────────────────────────────────────

/**
 * Formats the time remaining until `nextStartDate` as a `1d 02h 03m 04s` countdown string, relative
 * to `now`. Returns an empty string once the date has passed (or if there is no date). Derived
 * purely from its inputs so the caller can drive ticking with `useNow()` rather than its own timer.
 */
function formatCountdown(nextStartDate: Date | undefined, now: number): string {
  if (!nextStartDate) {
    return ''
  }
  const diff = Number(nextStartDate) - now
  if (diff <= 0) {
    return ''
  }
  const d = Math.floor(diff / (24 * 3600000))
  const h = Math.floor((diff % (24 * 3600000)) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  parts.push(`${String(h).padStart(2, '0')}h`)
  parts.push(`${String(m).padStart(2, '0')}m`)
  parts.push(`${String(s).padStart(2, '0')}s`)
  return parts.join(' ')
}

const dateRangeFormat = new Intl.DateTimeFormat(navigator.language, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

interface UnavailableInfoProps {
  nextStartDate?: Date
  nextEndDate?: Date
}

function UnavailableInfo({ nextStartDate, nextEndDate }: UnavailableInfoProps) {
  const { t } = useTranslation()
  const now = useNow()

  const hasSchedule = nextStartDate !== undefined && Number(nextStartDate) > now
  const countdown = hasSchedule ? formatCountdown(nextStartDate, now) : ''

  return (
    <UnavailableBlock>
      <UnavailableLabel>{t('matchmaking.findMatch.unavailable', 'Unavailable')}</UnavailableLabel>
      {hasSchedule ? (
        <>
          <UnavailableDetail>
            {dateRangeFormat.format(nextStartDate)}
            {nextEndDate && nextEndDate > nextStartDate!
              ? ` – ${dateRangeFormat.format(nextEndDate)}`
              : ''}
          </UnavailableDetail>
          {countdown ? <UnavailableCountdown>{countdown}</UnavailableCountdown> : null}
        </>
      ) : (
        <UnavailableDetail>
          {t('matchmaking.findMatch.noScheduledWindow', 'No scheduled window yet')}
        </UnavailableDetail>
      )}
    </UnavailableBlock>
  )
}

// ─── Summary block sub-component ─────────────────────────────────────────────

export interface RowSummaryState {
  race: RaceChar
  useAlternateRace: boolean
  alternateRace: AssignedRaceChar
  mapSelectionCount: number
  mapPoolVetoLimit: number
  isVetoMode: boolean
  poolChanged: boolean
}

interface ModeSummaryProps {
  mode: RealModeData
  summaryState: RowSummaryState
}

export function ModeSummary({ mode, summaryState }: ModeSummaryProps) {
  const { t } = useTranslation()
  return (
    <SummaryBlock>
      {!mode.team ? (
        <SummaryRaceRow>
          <StyledRaceIcon race={summaryState.race} applyRaceColor={true} />
          {summaryState.useAlternateRace && summaryState.race !== 'r' ? (
            <>
              <MirrorArrow>→</MirrorArrow>
              <StyledRaceIcon race={summaryState.alternateRace} applyRaceColor={true} />
            </>
          ) : null}
        </SummaryRaceRow>
      ) : null}

      {summaryState.mapPoolVetoLimit > 0 ? (
        <SummaryMapRow>
          <MaterialIcon icon='map' size={16} />
          {summaryState.isVetoMode ? (
            <MapCountLabel>
              <MapCountNum>{summaryState.mapSelectionCount}</MapCountNum>
              {t('matchmaking.findMatch.vetoedCount', ' / {{limit}} vetoed', {
                limit: summaryState.mapPoolVetoLimit,
              })}
            </MapCountLabel>
          ) : (
            <MapCountLabel>
              <MapCountNum>{summaryState.mapSelectionCount}</MapCountNum>
              {t('matchmaking.findMatch.pickedCount', ' / {{limit}} picked', {
                limit: summaryState.mapPoolVetoLimit,
              })}
            </MapCountLabel>
          )}
        </SummaryMapRow>
      ) : null}

      {summaryState.poolChanged ? (
        <PoolBadge>
          <PoolBadgeDot />
          {t('matchmaking.findMatch.poolUpdated', 'Pool updated')}
        </PoolBadge>
      ) : null}
    </SummaryBlock>
  )
}

// ─── Type Row component ───────────────────────────────────────────────────────

interface TypeRowProps {
  mode: RealModeData
  label: string
  desc: string
  selected: boolean
  isSearching: boolean
  isEnabled: boolean
  nextStartDate?: Date
  nextEndDate?: Date
  stats: RowStats
  summaryState: RowSummaryState
  t: ReturnType<typeof useTranslation>['t']
  onToggle: () => void
  onOpenSettings: () => void
}

export function TypeRow({
  mode,
  label,
  desc,
  selected,
  isSearching,
  isEnabled,
  nextStartDate,
  nextEndDate,
  stats,
  summaryState,
  t,
  onToggle,
  onOpenSettings,
}: TypeRowProps) {
  const faded = isSearching && !selected
  const pulsing = isSearching && selected
  const isDisabled = !isEnabled

  return (
    <TypeRowRoot
      $selected={selected && !isDisabled}
      $faded={faded}
      $searching={isSearching}
      $disabled={isDisabled}
      onClick={isDisabled || isSearching ? undefined : onToggle}>
      {isDisabled ? (
        <DisabledCheckPlaceholder>
          <MaterialIcon icon='block' size={24} />
        </DisabledCheckPlaceholder>
      ) : (
        <RowCheckBox checked={selected} onChange={() => {}} $pulsing={pulsing} />
      )}

      <RowTitle>
        <RowTitleMain>
          <RowModeName>{label}</RowModeName>
          <GroupBadge>{mode.group}</GroupBadge>
        </RowTitleMain>
        <RowDesc>{desc}</RowDesc>
      </RowTitle>

      {isDisabled ? (
        <UnavailableInfo nextStartDate={nextStartDate} nextEndDate={nextEndDate} />
      ) : (
        <>
          <ModeStats stats={stats} t={t} />
          <ModeSummary mode={mode} summaryState={summaryState} />
          <GearWrap onClick={e => e.stopPropagation()}>
            <GearButton
              title={t('matchmaking.findMatch.settingsTitle', 'Settings — {{label}}', { label })}
              disabled={isSearching}
              onClick={e => {
                e.stopPropagation()
                if (!isSearching) onOpenSettings()
              }}>
              <MaterialIcon icon='tune' size={20} />
            </GearButton>
          </GearWrap>
        </>
      )}
    </TypeRowRoot>
  )
}

// ─── Settings Drawer ──────────────────────────────────────────────────────────

const DrawerScrim = styled(m.div)`
  position: fixed;
  inset: var(--sb-system-bar-height, 0) 0 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 100;
`

const DrawerPanel = styled(m.aside)`
  position: fixed;
  top: var(--sb-system-bar-height, 0);
  left: 0;
  bottom: 0;
  width: 661px;
  max-width: 92vw;
  background: var(--theme-container);
  border-right: 1px solid color-mix(in srgb, var(--theme-on-surface) 10%, transparent);
  box-shadow: 12px 0 48px rgba(0, 0, 0, 0.5);
  z-index: 101;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const DrawerHead = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--theme-on-surface) 10%, transparent);
  background: var(--theme-container-high);
  flex-shrink: 0;
`

const DrawerGroupBadge = styled(GroupBadge)`
  font-size: 11px;
`

const DrawerTitle = styled.div`
  ${sofiaSans};
  font-size: 22px;
  font-weight: 700;
  color: var(--theme-on-surface);
  flex: 1;
`

const DrawerCloseBtn = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--theme-on-surface-variant);
  cursor: pointer;
  transition: background 150ms ease;
  flex-shrink: 0;

  &:hover {
    background: color-mix(in srgb, var(--theme-on-surface) 10%, transparent);
    color: var(--theme-on-surface);
  }
`

const DrawerBody = styled.div`
  flex: 1;
  overflow-y: auto;
  scrollbar-gutter: stable both-edges;
  padding: 16px 8px 24px;
`

const DrawerFoot = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 14px 24px;
  border-top: 1px solid color-mix(in srgb, var(--theme-on-surface) 10%, transparent);
  background: var(--theme-container-low);
  flex-shrink: 0;
`

interface SettingsDrawerProps {
  drawerType: MatchmakingType | null
  labelForType: (type: MatchmakingType) => string
  formRefs: Record<MatchmakingType, React.RefObject<FindMatchFormRef | null>>
  onClose: () => void
}

export function SettingsDrawer({
  drawerType,
  labelForType,
  formRefs,
  onClose,
}: SettingsDrawerProps) {
  const { t } = useTranslation()
  const groupForType = (type: MatchmakingType): '1v1' | '2v2' => {
    return type === MatchmakingType.Match2v2 ? '2v2' : '1v1'
  }

  return (
    <AnimatePresence>
      {drawerType !== null ? (
        <>
          <DrawerScrim
            key='scrim'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <DrawerPanel
            key='panel'
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}>
            <DrawerHead>
              <DrawerGroupBadge>{groupForType(drawerType)}</DrawerGroupBadge>
              <DrawerTitle>{labelForType(drawerType)}</DrawerTitle>
              <DrawerCloseBtn onClick={onClose} title={t('common.actions.close', 'Close')}>
                <MaterialIcon icon='close' size={22} />
              </DrawerCloseBtn>
            </DrawerHead>

            <DrawerBody>
              {(() => {
                switch (drawerType) {
                  case MatchmakingType.Match1v1:
                    return (
                      <Contents1v1
                        formRef={formRefs[MatchmakingType.Match1v1]}
                        onSubmit={() => {}}
                        disabled={false}
                      />
                    )
                  case MatchmakingType.Match1v1Fastest:
                    return (
                      <Contents1v1Fastest
                        formRef={formRefs[MatchmakingType.Match1v1Fastest]}
                        onSubmit={() => {}}
                        disabled={false}
                      />
                    )
                  case MatchmakingType.Match2v2:
                    return (
                      <Contents2v2
                        formRef={formRefs[MatchmakingType.Match2v2]}
                        onSubmit={() => {}}
                        disabled={false}
                      />
                    )
                  default:
                    return drawerType satisfies never
                }
              })()}
            </DrawerBody>

            <DrawerFoot>
              <TextButton label={t('common.actions.done', 'Done')} onClick={onClose} />
            </DrawerFoot>
          </DrawerPanel>
        </>
      ) : null}
    </AnimatePresence>
  )
}

// ─── Queue bar ────────────────────────────────────────────────────────────────

const QueueBarRoot = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 24px;
  align-items: center;
  padding: 16px 20px 16px 24px;
  background: var(--theme-container-high);
  border: 1px solid color-mix(in srgb, var(--theme-on-surface) 16%, transparent);
  border-radius: 10px;
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.5),
    0 0 0 1px color-mix(in srgb, var(--theme-on-surface) 8%, transparent);
  backdrop-filter: blur(6px);
  position: sticky;
  bottom: 24px;
  z-index: 10;
`

const QueueSummary = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`

const QueueSummaryHead = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  ${labelMedium};
  font-weight: 600;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--theme-on-surface-variant);
`

const QueueEmptyHint = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--theme-on-surface-variant);
  font-size: 13px;
`

const QueueChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const QueueChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px 0 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--theme-primary) 20%, transparent);
  color: var(--color-blue90);
  font: 500 11px / 1 var(--font-body, sans-serif);
  letter-spacing: 0.4px;
`

const SearchingTimer = styled.div`
  ${sofiaSans};
  font-size: 42px;
  font-weight: 700;
  color: var(--theme-amber);
  letter-spacing: 1px;
  font-feature-settings: 'tnum';
  line-height: 1;
`

const QueueActions = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
`

export interface QueueChipData {
  type: string
  label: string
  race: RaceChar
}

interface QueueBarProps {
  selectedChips: QueueChipData[]
  isSearching: boolean
  elapsedSecs: number
  disabled: boolean
  onFindMatch: () => void
  onCancel: () => void
}

export function QueueBar({
  selectedChips,
  isSearching,
  elapsedSecs,
  disabled,
  onFindMatch,
  onCancel,
}: QueueBarProps) {
  const { t } = useTranslation()
  const mm = String(Math.floor(elapsedSecs / 60)).padStart(2, '0')
  const ss = String(elapsedSecs % 60).padStart(2, '0')

  let summaryContent: React.ReactNode
  if (isSearching) {
    summaryContent = (
      <>
        <QueueSummaryHead>
          {t(
            'matchmaking.findMatch.searchingMessage',
            'Searching for a match — widening MMR range · first match wins the queue',
          )}
        </QueueSummaryHead>
        <SearchingTimer>
          {mm}:{ss}
        </SearchingTimer>
      </>
    )
  } else if (disabled) {
    summaryContent = (
      <QueueEmptyHint>
        <MaterialIcon icon='info' size={18} />
        {t(
          'matchmaking.findMatch.selectAtLeastOne',
          'Select at least one matchmaking type to start a queue.',
        )}
      </QueueEmptyHint>
    )
  } else {
    summaryContent = (
      <>
        <QueueSummaryHead>
          {t('matchmaking.findMatch.readyToQueue', 'Ready to queue')}
        </QueueSummaryHead>
        <QueueChips>
          {selectedChips.map(({ type, label, race }) => (
            <QueueChip key={type}>
              <ChipRaceIcon race={race} />
              {label}
            </QueueChip>
          ))}
        </QueueChips>
      </>
    )
  }

  return (
    <QueueBarRoot>
      <QueueSummary>{summaryContent}</QueueSummary>

      <QueueActions>
        {isSearching ? (
          <TextButton
            label={t('matchmaking.findMatch.cancelSearch', 'Cancel search')}
            onClick={onCancel}
          />
        ) : (
          <FilledButton
            label={t('matchmaking.findMatch.title', 'Find match')}
            disabled={disabled}
            onClick={disabled ? undefined : onFindMatch}
          />
        )}
      </QueueActions>
    </QueueBarRoot>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export const PageSpacer = styled.div`
  height: 24px;
  flex-shrink: 0;
`

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

export function FindMatch() {
  const { t } = useTranslation()
  useTrackPageView(urlPath`/matchmaking/find`)
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()!

  // ─── Searching state (from Jotai atoms) ─────────────────────────────────────
  const isSearching = useAtomValue(isMatchmakingAtom)
  const searchInfo = useAtomValue(currentSearchInfoAtom)

  // ─── Redux state ────────────────────────────────────────────────────────────
  const season = useAppSelector(s => s.selfRank.currentSeason)
  const selfRankByType = useAppSelector(s => s.selfRank.byType)
  const matchmakingStatus = useAppSelector(s => s.matchmakingStatus.byType)
  const matchmakingPreferences = useAppSelector(s => s.matchmakingPreferences.byType)
  const mapPools = useAppSelector(s => s.mapPools.byType)
  const inLobby = useAppSelector(s => s.lobby.inLobby)
  const lobbyName = useAppSelector(s => s.lobby.info.name)

  // ─── Local state ────────────────────────────────────────────────────────────
  const [selectedTypes, setSelectedTypes] = useState<Set<MatchmakingType>>(new Set())
  const [drawerType, setDrawerType] = useState<MatchmakingType | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [elapsedSecs, setElapsedSecs] = useState(0)

  const formRef1v1 = useRef<FindMatchFormRef>(null)
  const formRef1v1Fastest = useRef<FindMatchFormRef>(null)
  const formRef2v2 = useRef<FindMatchFormRef>(null)
  const formRefs: Record<MatchmakingType, React.RefObject<FindMatchFormRef | null>> = {
    [MatchmakingType.Match1v1]: formRef1v1,
    [MatchmakingType.Match1v1Fastest]: formRef1v1Fastest,
    [MatchmakingType.Match2v2]: formRef2v2,
  }

  // ─── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    for (const type of ALL_MATCHMAKING_TYPES) {
      dispatch(getCurrentMapPool(type))
    }
  }, [dispatch])

  useEffect(() => {
    const abortController = new AbortController()
    dispatch(
      getInstantaneousSelfRank({
        signal: abortController.signal,
        onSuccess: () => {},
        onError: () => {},
      }),
    )
    return () => {
      abortController.abort()
    }
  }, [dispatch, selfUser.id])

  useEffect(() => {
    if (!isSearching || !searchInfo) {
      setElapsedSecs(0)
      return undefined
    }
    const update = () => {
      setElapsedSecs(Math.floor((performance.now() - searchInfo.startTime) / 1000))
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [isSearching, searchInfo])

  // ─── Derived data ────────────────────────────────────────────────────────────

  const bonusPoolSize = season ? getTotalBonusPoolForSeason(new Date(), season) : 0

  const isTypeEnabled = (type: MatchmakingType): boolean =>
    matchmakingStatus.get(type)?.enabled ?? false

  // While searching, the effective selected types come from Jotai (server-authoritative). When not
  // searching, we filter out any types that are currently disabled: their rows can't be deselected
  // (the checkbox is replaced by a "blocked" placeholder) and the server rejects the entire request
  // if any selected type is disabled, so leaving them in would make every queue attempt error out.
  const effectiveSelectedTypes: ReadonlySet<MatchmakingType> = isSearching
    ? new Set(searchInfo?.searchedTypes.keys() ?? [])
    : new Set(Array.from(selectedTypes).filter(isTypeEnabled))

  const getStatsForType = (type: MatchmakingType): RowStats => {
    const player = selfRankByType.get(type)
    if (!player || !season) {
      return { division: MatchmakingDivision.Unrated, mmr: null, bonus: 0 }
    }
    const division = ladderPlayerToMatchmakingDivision(player, bonusPoolSize)
    const isUnranked = player.wins + player.losses === 0
    const bonus = Math.max(0, Math.floor(bonusPoolSize - player.bonusUsed))
    return {
      division,
      mmr: isUnranked ? null : Math.round(player.rating),
      bonus,
    }
  }

  const getSummaryStateForType = (type: MatchmakingType): RowSummaryState => {
    const prefs = matchmakingPreferences.get(type)?.preferences
    const mapPool = mapPools.get(type)
    const poolChanged = matchmakingPreferences.get(type)?.mapPoolOutdated ?? false

    let race: RaceChar = 'r'
    let useAlternateRace = false
    let alternateRace: AssignedRaceChar = 'z'
    let mapSelectionCount = 0

    if (prefs && 'race' in prefs) {
      race = (prefs as MatchmakingPreferences).race ?? 'r'
      mapSelectionCount = (prefs as MatchmakingPreferences).mapSelections?.length ?? 0
      if (
        (type === MatchmakingType.Match1v1 || type === MatchmakingType.Match1v1Fastest) &&
        race !== 'r'
      ) {
        const data1v1 = (
          prefs as MatchmakingPreferences & {
            data: { useAlternateRace?: boolean; alternateRace?: AssignedRaceChar }
          }
        ).data
        useAlternateRace = data1v1?.useAlternateRace ?? false
        alternateRace = data1v1?.alternateRace ?? 'z'
      }
    }

    return {
      race,
      useAlternateRace,
      alternateRace,
      mapSelectionCount,
      mapPoolVetoLimit: mapPool?.maxVetoCount ?? 0,
      isVetoMode: hasVetoes(type),
      poolChanged,
    }
  }

  const getRaceForType = (type: MatchmakingType): RaceChar => {
    const prefs = matchmakingPreferences.get(type)?.preferences
    if (prefs && 'race' in prefs) return (prefs as MatchmakingPreferences).race ?? 'r'
    return 'r'
  }

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleToggle = (type: MatchmakingType) => {
    if (isSearching) return
    setSelectedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const handleOpenSettings = (type: MatchmakingType) => {
    if (isSearching) return
    setDrawerType(type)
  }

  const handleFindMatch = healthChecked(() => {
    if (inLobby || isSubmitting || effectiveSelectedTypes.size === 0) return

    const allPrefs: MatchmakingPreferences[] = []
    for (const type of effectiveSelectedTypes) {
      const prefs = matchmakingPreferences.get(type)?.preferences
      if (prefs && 'matchmakingType' in prefs) {
        allPrefs.push(prefs as MatchmakingPreferences)
      } else {
        // The user has never saved preferences for this type, so the server sends `{}`. Fall back
        // to defaults (random race, current map pool) so they can still queue — otherwise the Find
        // match button would silently do nothing for a fresh account.
        allPrefs.push(
          defaultPreferences(
            type,
            selfUser.id,
            mapPools.get(type)?.id ?? 1,
          ) as MatchmakingPreferences,
        )
      }
    }
    if (allPrefs.length === 0) return

    setIsSubmitting(true)
    dispatch(
      findMatch(allPrefs, {
        onSuccess: () => {
          setIsSubmitting(false)
        },
        onError: () => {
          setIsSubmitting(false)
        },
      }),
    )
  })

  const handleCancel = () => {
    dispatch(
      cancelFindMatch({
        onSuccess: () => {},
        onError: () => {},
      }),
    )
  }

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === ENTER || event.code === ENTER_NUMPAD) {
        if (!isSearching && effectiveSelectedTypes.size > 0 && !inLobby) {
          handleFindMatch()
          return true
        }
      }
      return false
    },
  })

  // ─── Render ─────────────────────────────────────────────────────────────────

  const labelForType = (type: MatchmakingType) => matchmakingTypeToLabel(type, t)

  const descForType = (type: MatchmakingType): string => {
    switch (type) {
      case MatchmakingType.Match1v1:
        return t('matchmaking.findMatch.desc.1v1', 'Solo · standard maps')
      case MatchmakingType.Match1v1Fastest:
        return t('matchmaking.findMatch.desc.1v1fastest', 'Solo · Fastest Map')
      case MatchmakingType.Match2v2:
        return t('matchmaking.findMatch.desc.2v2', 'Team · standard maps')
      default:
        return type satisfies never
    }
  }

  const selectedChips: QueueChipData[] = isSearching
    ? Array.from(searchInfo?.searchedTypes.entries() ?? []).map(([type, race]) => ({
        type,
        label: labelForType(type),
        race,
      }))
    : Array.from(effectiveSelectedTypes).map(type => ({
        type,
        label: labelForType(type),
        race: getRaceForType(type),
      }))

  const findMatchDisabled = effectiveSelectedTypes.size === 0 || inLobby || isSubmitting

  return (
    <PageRoot>
      <PanelRoot>
        <PageHead>
          <div>
            <PageTitle>{t('matchmaking.findMatch.title', 'Find match')}</PageTitle>
            <PageSubtitle>
              {t(
                'matchmaking.findMatch.subtitle',
                'Choose one or more matchmaking types — we\u2019ll queue for them all at once.',
              )}
            </PageSubtitle>
          </div>
          {season ? <SeasonLabel>{season.name}</SeasonLabel> : null}
        </PageHead>

        {inLobby ? (
          <LobbyBanner>
            <MaterialIcon icon='info' size={20} />
            <LobbyBannerText>
              {t(
                'matchmaking.findMatch.inLobbyBanner',
                'You\u2019re in a lobby \u2014 matchmaking is unavailable while in a game lobby.',
              )}
            </LobbyBannerText>
            <LobbyBannerButton
              label={t('matchmaking.findMatch.goToLobby', 'Go to lobby')}
              onClick={() => push(urlPath`/lobbies/${lobbyName}`)}
            />
          </LobbyBanner>
        ) : null}

        <GroupsContainer>
          {MODE_GROUPS.map(group => {
            const modes = REAL_MODES.filter(m => m.group === group.id)
            return (
              <ModeGroup key={group.id}>
                <GroupHead>
                  <GroupLabel>{group.label}</GroupLabel>
                  <GroupDivider />
                  <GroupHint>{group.hint}</GroupHint>
                </GroupHead>
                <ModeList>
                  {modes.map(mode => {
                    const status = matchmakingStatus.get(mode.type)
                    const isEnabled = status?.enabled ?? false
                    return (
                      <TypeRow
                        key={mode.type}
                        mode={mode}
                        label={labelForType(mode.type)}
                        desc={descForType(mode.type)}
                        selected={effectiveSelectedTypes.has(mode.type)}
                        isSearching={isSearching}
                        isEnabled={isEnabled}
                        nextStartDate={status?.nextStartDate}
                        nextEndDate={status?.nextEndDate}
                        stats={getStatsForType(mode.type)}
                        summaryState={getSummaryStateForType(mode.type)}
                        t={t}
                        onToggle={() => handleToggle(mode.type)}
                        onOpenSettings={() => handleOpenSettings(mode.type)}
                      />
                    )
                  })}
                </ModeList>
              </ModeGroup>
            )
          })}
        </GroupsContainer>

        <QueueBar
          selectedChips={selectedChips}
          isSearching={isSearching}
          elapsedSecs={elapsedSecs}
          disabled={findMatchDisabled}
          onFindMatch={handleFindMatch}
          onCancel={handleCancel}
        />
      </PanelRoot>

      <PageSpacer />

      <SettingsDrawer
        drawerType={drawerType}
        labelForType={labelForType}
        formRefs={formRefs}
        onClose={() => setDrawerType(null)}
      />
    </PageRoot>
  )
}
