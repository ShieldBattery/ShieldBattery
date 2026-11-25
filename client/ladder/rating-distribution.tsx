import { TFunction } from 'i18next'
import { Immutable } from 'immer'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import styled from 'styled-components'
import { LadderPlayer, ladderPlayerToMatchmakingDivision } from '../../common/ladder/ladder'
import {
  getDivisionColor,
  getDivisionContext,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  MatchmakingSeasonJson,
} from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import {
  bodyMedium,
  bodySmall,
  labelLarge,
  labelMedium,
  titleLarge,
  titleMedium,
} from '../styles/typography'
import {
  buildRatingDistribution,
  fractionAtOrAbove,
  hasVisibleRating,
  RatingBucket,
} from './rating-distribution-data'

const ratingFormat = numberFormat({ maximumFractionDigits: 0 })
const countFormat = numberFormat()
const percentFormat = numberFormat({ style: 'percent', maximumFractionDigits: 1 })

/** One representative division per tier, in ladder order, for the color legend. */
const LEGEND_TIERS: ReadonlyArray<MatchmakingDivision> = [
  MatchmakingDivision.Bronze1,
  MatchmakingDivision.Silver1,
  MatchmakingDivision.Gold1,
  MatchmakingDivision.Platinum1,
  MatchmakingDivision.Diamond1,
  MatchmakingDivision.Champion,
]

const Root = styled.div`
  position: absolute;
  inset: 0;
  overflow-y: auto;
  /* Narrows to the ladder header's 16px inset at phone widths. */
  padding: 8px clamp(16px, 4cqi, 24px) 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Stats = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
`

const StatTile = styled.div<{ $highlight?: boolean }>`
  min-width: 160px;
  padding: 12px 16px;
  border-radius: 8px;
  background-color: ${props =>
    props.$highlight ? 'var(--theme-primary-container)' : 'var(--theme-container-low)'};
  color: ${props =>
    props.$highlight ? 'var(--theme-on-primary-container)' : 'var(--theme-on-surface)'};
`

const StatLabel = styled.div`
  ${labelMedium};
  opacity: 0.8;
`

const StatValue = styled.div`
  ${titleLarge};
  display: flex;
  align-items: baseline;
  gap: 8px;
`

const StatDetail = styled.span`
  ${labelLarge};
`

const ChartCard = styled.div`
  padding: 16px 16px 12px;
  border-radius: 8px;
  background-color: var(--theme-container-low);
`

const ChartTitle = styled.div`
  ${titleMedium};
  padding-inline: 8px;
`

const ChartDescription = styled.div`
  ${bodySmall};
  padding-inline: 8px;
  color: var(--theme-on-surface-variant);
`

const ChartArea = styled.div`
  width: 100%;
  height: 340px;
  margin-top: 16px;
`

const Legend = styled.ul`
  margin: 8px 0 0;
  padding: 0 8px;
  list-style: none;

  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
`

const LegendItem = styled.li`
  ${labelMedium};
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--theme-on-surface-variant);
`

const Swatch = styled.span<{ $color: string }>`
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background-color: ${props => props.$color};
`

const TooltipRoot = styled.div`
  ${bodyMedium};
  padding: 8px 12px;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 6px;
  background-color: var(--theme-container-high);
  color: var(--theme-on-surface);
`

const TooltipTitle = styled.div`
  ${labelLarge};
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
`

const TooltipMuted = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const EmptyState = styled.div`
  ${bodyMedium};
  height: 240px;
  display: grid;
  place-items: center;
  color: var(--theme-on-surface-variant);
`

export interface RatingDistributionProps {
  players: Immutable<LadderPlayer[]>
  season?: Readonly<MatchmakingSeasonJson>
  /** The time the rankings were retrieved, which sets the bonus pool divisions are placed with. */
  curTime: number
  selfUserId?: SbUserId
  topNode?: React.ReactNode
  bottomNode?: React.ReactNode
}

/**
 * A histogram of how many players are at each rating on a ladder, with bars colored by the
 * division most of their players are in, and a marker for where the viewer stands.
 */
export function RatingDistribution({
  players,
  season,
  curTime,
  selfUserId,
  topNode,
  bottomNode,
}: RatingDistributionProps) {
  const { t } = useTranslation()
  const ratingFormatter = useFormat(ratingFormat)
  const countFormatter = useFormat(countFormat)
  const percentFormatter = useFormat(percentFormat)

  const divisionContext = season ? getDivisionContext(new Date(curTime), season) : { bonusPool: 0 }
  const distribution = buildRatingDistribution(players, p =>
    ladderPlayerToMatchmakingDivision(p, divisionContext),
  )
  const { buckets, ratedCount, median, sortedRatings, bucketWidth } = distribution

  const selfPlayer =
    selfUserId !== undefined ? players.find(p => p.userId === selfUserId) : undefined
  const selfRated = selfPlayer && hasVisibleRating(selfPlayer) ? selfPlayer : undefined
  const selfBucket = selfRated
    ? buckets.find(b => selfRated.rating >= b.start && selfRated.rating < b.end)
    : undefined

  const renderTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: ReadonlyArray<{ payload?: RatingBucket }>
  }) => {
    const bucket = active ? payload?.[0]?.payload : undefined
    if (!bucket) {
      return null
    }

    return (
      <TooltipRoot>
        <TooltipTitle>
          {bucket.count > 0 ? <Swatch $color={getDivisionColor(bucket.division)} /> : null}
          {t('ladder.distribution.tooltipRange', {
            defaultValue: 'Rating {{start}}–{{end}}',
            start: ratingFormatter.format(bucket.start),
            end: ratingFormatter.format(bucket.end),
          })}
        </TooltipTitle>
        <div>
          {t('ladder.distribution.tooltipPlayers', {
            defaultValue: '{{count}} players ({{percent}})',
            defaultValue_one: '{{count}} player ({{percent}})',
            count: bucket.count,
            percent: percentFormatter.format(bucket.count / ratedCount),
          })}
        </div>
        <div>
          {t('ladder.distribution.topPercent', {
            defaultValue: 'Top {{percent}}',
            percent: percentFormatter.format(bucket.atOrAbove / ratedCount),
          })}
        </div>
        {bucket.count > 0 ? (
          <TooltipMuted>
            {t('ladder.distribution.tooltipDivision', {
              defaultValue: 'Mostly {{division}}',
              division: matchmakingDivisionToLabel(bucket.division, t),
            })}
          </TooltipMuted>
        ) : null}
      </TooltipRoot>
    )
  }

  return (
    <Root>
      {topNode}
      <Stats>
        <StatTile>
          <StatLabel>{t('ladder.distribution.ratedPlayers', 'Rated players')}</StatLabel>
          <StatValue>{countFormatter.format(ratedCount)}</StatValue>
        </StatTile>
        {median !== undefined ? (
          <StatTile>
            <StatLabel>{t('ladder.distribution.medianRating', 'Median rating')}</StatLabel>
            <StatValue>{ratingFormatter.format(median)}</StatValue>
          </StatTile>
        ) : null}
        {selfRated ? (
          <StatTile $highlight={true}>
            <StatLabel>{t('ladder.distribution.yourRating', 'Your rating')}</StatLabel>
            <StatValue>
              {ratingFormatter.format(selfRated.rating)}
              <StatDetail>
                {t('ladder.distribution.topPercent', {
                  defaultValue: 'Top {{percent}}',
                  percent: percentFormatter.format(
                    fractionAtOrAbove(sortedRatings, selfRated.rating),
                  ),
                })}
              </StatDetail>
            </StatValue>
          </StatTile>
        ) : null}
      </Stats>

      <ChartCard>
        <ChartTitle>{t('ladder.distribution.title', 'Rating distribution')}</ChartTitle>
        <ChartDescription>
          {t('ladder.distribution.description', {
            defaultValue:
              'Players who finished their placement matches, in steps of {{width}} rating. ' +
              'Each bar is colored by the division most of its players are in.',
            width: bucketWidth,
          })}
        </ChartDescription>
        {buckets.length ? (
          <ChartArea>
            <ResponsiveContainer width='100%' height='100%'>
              <BarChart data={buckets} margin={{ top: 20, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid stroke='var(--theme-outline-variant)' vertical={false} />
                <XAxis
                  dataKey='start'
                  tickFormatter={value => ratingFormatter.format(Number(value))}
                  stroke='var(--theme-on-surface-variant)'
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  minTickGap={16}
                />
                <YAxis
                  allowDecimals={false}
                  tickFormatter={value => countFormatter.format(Number(value))}
                  stroke='var(--theme-on-surface-variant)'
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  width={48}
                />
                <Tooltip
                  content={renderTooltip}
                  cursor={{ fill: 'var(--theme-on-surface)', fillOpacity: 0.08 }}
                  isAnimationActive={false}
                />
                <Bar dataKey='count' radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {buckets.map(bucket => (
                    <Cell
                      key={bucket.start}
                      fill={getDivisionColor(bucket.division)}
                      stroke={bucket === selfBucket ? 'var(--theme-on-surface)' : 'none'}
                      strokeWidth={bucket === selfBucket ? 2 : 0}
                    />
                  ))}
                </Bar>
                {selfBucket ? (
                  <ReferenceLine
                    x={selfBucket.start}
                    stroke='var(--theme-on-surface)'
                    strokeDasharray='4 4'
                    label={{
                      value: t('ladder.distribution.you', 'You'),
                      position: 'top',
                      fill: 'var(--theme-on-surface)',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  />
                ) : null}
              </BarChart>
            </ResponsiveContainer>
          </ChartArea>
        ) : (
          <EmptyState>
            {t('ladder.distribution.empty', 'No players have finished their placements yet.')}
          </EmptyState>
        )}
        {buckets.length ? (
          <Legend>
            {LEGEND_TIERS.map(division => (
              <LegendItem key={division}>
                <Swatch $color={getDivisionColor(division)} />
                {divisionTierLabel(division, t)}
              </LegendItem>
            ))}
          </Legend>
        ) : null}
      </ChartCard>
      {bottomNode}
    </Root>
  )
}

function divisionTierLabel(division: MatchmakingDivision, t: TFunction): string {
  switch (division) {
    case MatchmakingDivision.Bronze1:
      return t('ladder.divisionGroup.bronze', 'Bronze')
    case MatchmakingDivision.Silver1:
      return t('ladder.divisionGroup.silver', 'Silver')
    case MatchmakingDivision.Gold1:
      return t('ladder.divisionGroup.gold', 'Gold')
    case MatchmakingDivision.Platinum1:
      return t('ladder.divisionGroup.platinum', 'Platinum')
    case MatchmakingDivision.Diamond1:
      return t('ladder.divisionGroup.diamond', 'Diamond')
    default:
      return t('ladder.divisionGroup.champion', 'Champion')
  }
}
