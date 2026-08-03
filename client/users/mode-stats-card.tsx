import * as m from 'motion/react-m'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MATCHMAKING_MODES, MatchmakingType, isSoloType } from '../../common/matchmaking'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { LoadingDotsArea } from '../progress/dots'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { bodySmall, labelMedium, singleLine, titleLarge, titleMedium } from '../styles/typography'
import { RatingChart } from './rating-chart'
import { RatingChartPoint, RatingChartSeason, RatingMetric } from './rating-chart-data'

const ALL_SEASONS = 'all'

/**
 * What the card has to show. Kept as one value rather than separate `fetching`/`error`
 * flags so the states can't contradict each other, and so a caller with data already in
 * hand (the dev page) just passes `ready`.
 */
export type ModeStatsCardState = 'loading' | 'error' | 'ready'

const ModeCard = styled.div`
  background: var(--theme-container-low);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  overflow: hidden;
`

const ModeHeader = styled.button`
  ${buttonReset};
  width: 100%;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 16px;

  color: inherit;
  text-align: left;

  &:hover {
    background: var(--theme-container);
  }
`

const ModeTitle = styled.div`
  ${titleMedium};
  ${singleLine};
`

const ModeSub = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Grow = styled.div`
  flex-grow: 1;
  min-width: 0;
`

const MetricColumn = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
`

const MetricValue = styled.div`
  ${titleLarge};
  font-variant-numeric: tabular-nums;
`

const Unrated = styled.span`
  color: var(--theme-on-surface-variant);
`

const Delta = styled.div<{ $positive: boolean }>`
  ${labelMedium};
  font-variant-numeric: tabular-nums;
  color: ${props => (props.$positive ? 'var(--theme-positive)' : 'var(--theme-negative)')};
`

const Caret = styledWithAttrs(MaterialIcon, { icon: 'expand_more' })<{ $open: boolean }>`
  color: var(--theme-on-surface-variant);
  transform: ${props => (props.$open ? 'rotate(180deg)' : 'none')};
  transition: transform 150ms ease;
`

/**
 * The animated element carries no vertical padding of its own: padding sits outside the
 * height box, so an element animating to `height: 0` would still occupy its padding and
 * leave a visible stub behind. The inner element holds the spacing instead.
 *
 * `visibility: hidden` once fully collapsed, so the controls inside don't stay in the tab
 * order while clipped out of view. It's applied only after the animation settles, since
 * hiding during the collapse would make the content vanish instead of slide.
 */
const CardBody = styled(m.div)<{ $hidden: boolean }>`
  overflow: hidden;
  border-top: 1px solid var(--theme-outline-variant);
  visibility: ${props => (props.$hidden ? 'hidden' : 'visible')};
`

const CardBodyContent = styled.div`
  padding: 4px 16px 16px;
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin: 12px 0;
`

const ChipRow = styled.div`
  display: flex;
  gap: 6px;
`

const Chip = styled.button<{ $active: boolean }>`
  ${buttonReset};
  ${labelMedium};
  padding: 5px 12px;
  border-radius: 999px;

  background: ${props => (props.$active ? 'var(--theme-container-highest)' : 'transparent')};
  border: 1px solid
    ${props => (props.$active ? 'var(--theme-primary)' : 'var(--theme-outline-variant)')};
  color: ${props =>
    props.$active ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)'};
`

const SeasonFilter = styled.div`
  width: 208px;
  max-width: 100%;
`

const Downsampled = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  margin-top: 8px;
`

const LoadError = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

/**
 * One collapsible mode on the Stats tab: the headline figures, and the rating chart with
 * its metric and season filters.
 *
 * Takes its history as props rather than fetching it, so the dev page can render the same
 * card against constructed data. Metric and season are the card's own UI state and stay
 * here — a caller has no reason to own them.
 */
export function ModeStatsCard({
  matchmakingType,
  wins,
  losses,
  rating,
  seasonDelta,
  open,
  onToggle,
  state,
  seasons,
  points: allPoints,
  totalGames,
  downsampled,
  footer,
}: {
  matchmakingType: MatchmakingType
  wins: number
  losses: number
  /** The headline rating. Absent while the player is still in placement matches. */
  rating?: number
  seasonDelta?: number
  open: boolean
  onToggle: () => void
  state: ModeStatsCardState
  seasons: ReadonlyArray<RatingChartSeason>
  points: ReadonlyArray<RatingChartPoint>
  totalGames?: number
  downsampled?: boolean
  /**
   * Rendered below the chart once the card has data. A slot rather than the card fetching it
   * itself, so the dev page can keep driving this component from props alone.
   */
  footer?: React.ReactNode
}) {
  const { t } = useTranslation()
  const [metric, setMetric] = useState<RatingMetric>('rating')
  const [season, setSeason] = useState<string>(ALL_SEASONS)
  // Tracks when a collapse has finished, so the body can leave the tab order.
  const [settledClosed, setSettledClosed] = useState(!open)

  // Only offer seasons this mode was actually played in.
  const playedSeasons = seasons.filter(s => allPoints.some(p => p.seasonId === s.id)).reverse()
  const points =
    season === ALL_SEASONS ? allPoints : allPoints.filter(p => p.seasonId === Number(season))

  return (
    <ModeCard>
      <ModeHeader onClick={onToggle} aria-expanded={open}>
        <Grow>
          <ModeTitle>{MATCHMAKING_MODES[matchmakingType].label(t)}</ModeTitle>
          {/* The record rather than a game count: it carries the same size information
              without needing a plural form, which the parser can't generate correctly. */}
          <ModeSub>
            {wins}&ndash;{losses}
          </ModeSub>
        </Grow>
        <MetricColumn>
          <MetricValue>
            {rating !== undefined ? Math.round(rating) : <Unrated>&mdash;</Unrated>}
          </MetricValue>
          {seasonDelta !== undefined ? (
            <Delta $positive={seasonDelta >= 0}>
              {seasonDelta >= 0 ? '▲' : '▼'}{' '}
              {/* "vs. last season", not "this season": the number is measured against the
                  last rating held before this season began and deliberately spans an MMR
                  reset, so labelling it "this season" would show most of the ladder a large
                  drop in a reset season when they're actually up. */}
              {t('users.profile.stats.seasonDelta', {
                defaultValue: '{{amount}} vs. last season',
                amount: Math.abs(Math.round(seasonDelta)),
              })}
            </Delta>
          ) : undefined}
        </MetricColumn>
        <Caret $open={open} />
      </ModeHeader>

      {/*
        The body stays mounted and animates between two variants rather than being added and
        removed through AnimatePresence. Collapsing to `height: 0` needs the element measured
        while it's still in the tree, and keeping it mounted also keeps its scroll position and
        the chart's own state across a collapse.
      */}
      <CardBody
        $hidden={settledClosed}
        variants={{
          collapsed: { height: 0, opacity: 0 },
          expanded: { height: 'auto', opacity: 1 },
        }}
        initial={false}
        animate={open ? 'expanded' : 'collapsed'}
        onAnimationStart={() => setSettledClosed(false)}
        onAnimationComplete={() => setSettledClosed(!open)}
        // No bounce: overshooting a height animation makes the cards below jump.
        transition={{ type: 'spring', duration: 0.3, bounce: 0 }}>
        <CardBodyContent>
          {state === 'loading' ? <LoadingDotsArea /> : undefined}
          {state === 'error' ? (
            <LoadError>
              {t('users.profile.stats.loadError', 'There was a problem loading this history.')}
            </LoadError>
          ) : undefined}
          {state === 'ready' ? (
            <>
              <Controls>
                <ChipRow>
                  <Chip $active={metric === 'rating'} onClick={() => setMetric('rating')}>
                    {t('users.profile.stats.rating', 'Rating')}
                  </Chip>
                  <Chip $active={metric === 'points'} onClick={() => setMetric('points')}>
                    {t('users.profile.stats.points', 'Points')}
                  </Chip>
                </ChipRow>
                <SeasonFilter>
                  <Select
                    value={season}
                    label={t('users.profile.stats.season', 'Season')}
                    allowErrors={false}
                    dense={true}
                    onChange={(value: string) => setSeason(value)}>
                    <SelectOption
                      value={ALL_SEASONS}
                      text={t('users.profile.stats.allTime', 'All time')}
                    />
                    {playedSeasons.map(s => (
                      <SelectOption key={s.id} value={String(s.id)} text={s.name} />
                    ))}
                  </Select>
                </SeasonFilter>
              </Controls>
              <RatingChart
                points={points}
                seasons={seasons}
                metric={metric}
                solo={isSoloType(matchmakingType)}
                showSeasonBoundaries={season === ALL_SEASONS}
              />
              {downsampled ? (
                <Downsampled>
                  {/* count is always well past the downsampling threshold here, so the
                      singular form this generates is unreachable. */}
                  {t('users.profile.stats.downsampled', {
                    defaultValue:
                      'Showing a reduced view of {{count}} games to keep the chart readable.',
                    count: totalGames,
                  })}
                </Downsampled>
              ) : undefined}
              {footer}
            </>
          ) : undefined}
        </CardBodyContent>
      </CardBody>
    </ModeCard>
  )
}
