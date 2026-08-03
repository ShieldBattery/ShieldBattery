import { useTranslation } from 'react-i18next'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import styled from 'styled-components'
import { getDivisionColor } from '../../common/matchmaking'
import { longTimestamp, monthDay } from '../i18n/date-formats'
import { bodyMedium } from '../styles/typography'
import {
  RatingChartPoint,
  RatingChartSeason,
  RatingMetric,
  bandOpacity,
  buildSeasonBands,
  pointsForMetric,
  seasonAxisTicks,
  splitOnDiscontinuity,
  valueExtent,
} from './rating-chart-data'

const ChartArea = styled.div`
  width: 100%;
  height: 260px;
`

const EmptyChart = styled.div`
  ${bodyMedium};
  height: 260px;
  display: grid;
  place-items: center;
  color: var(--theme-on-surface-variant);
`

export function RatingChart({
  points,
  seasons,
  metric,
  solo,
  showSeasonBoundaries,
}: {
  points: ReadonlyArray<RatingChartPoint>
  seasons: ReadonlyArray<RatingChartSeason>
  metric: RatingMetric
  solo: boolean
  showSeasonBoundaries: boolean
}) {
  const { t } = useTranslation()

  // The rating view drops placement games entirely -- their rating is hidden -- so
  // everything below (runs, extent, axis, boundaries) works from the plotted subset.
  const plotted = pointsForMetric(points, metric)
  const runs = splitOnDiscontinuity(plotted, seasons, metric)
  const bandGroups = metric === 'points' ? buildSeasonBands(plotted, seasons, solo) : []
  const ticks = showSeasonBoundaries ? seasonAxisTicks(plotted, seasons) : undefined

  if (!plotted.length) {
    return (
      <EmptyChart>
        {points.length
          ? t(
              'users.profile.stats.ratingInPlacements',
              'Rating is hidden during placement matches.',
            )
          : t('users.profile.stats.noGamesInRange', 'No games in this range')}
      </EmptyChart>
    )
  }

  const { min, max } = valueExtent(plotted, metric)
  const lo = metric === 'points' ? 0 : Math.floor((min - 40) / 50) * 50
  const hi = Math.ceil((max + 60) / 50) * 50

  const first = plotted[0].changeDate
  const last = plotted[plotted.length - 1].changeDate
  const tickLabels = new Map(ticks?.map(tick => [tick.value, tick.label]))
  const stroke = metric === 'points' ? 'var(--theme-color-zerg)' : 'var(--theme-color-terran)'
  const boundaries = seasons
    .filter(s => plotted.some(p => p.seasonId === s.id))
    .map(s => s.startDate)
    .filter(start => start > first)

  return (
    <ChartArea>
      <ResponsiveContainer width='100%' height='100%'>
        <LineChart margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          {/* Bands first, so the grid and the series draw over them. Each season's span
              carries its own bounds, at the pool that applied then. */}
          {bandGroups.flatMap(group =>
            group.bands
              .filter(b => b.low < hi && b.high > lo)
              .map(b => (
                <ReferenceArea
                  key={`${group.seasonId}-${b.division}`}
                  x1={group.from}
                  x2={group.to}
                  y1={Math.max(lo, b.low)}
                  y2={Math.min(hi, b.high)}
                  fill={getDivisionColor(b.division)}
                  fillOpacity={bandOpacity(b.division)}
                  stroke='none'
                  ifOverflow='hidden'
                />
              )),
          )}
          <CartesianGrid stroke='var(--theme-outline-variant)' vertical={false} />
          {/* Ticks are labelled with season names where they're season rolls, and with dates
              otherwise -- which only happens in the single-season view, so the year would
              be noise. */}
          <XAxis
            dataKey='changeDate'
            type='number'
            scale='time'
            domain={[first, last]}
            ticks={ticks?.map(tick => tick.value)}
            tickFormatter={value => tickLabels.get(value) ?? monthDay.format(value)}
            stroke='var(--theme-on-surface-variant)'
            tick={{ fontSize: 12 }}
            tickLine={false}
          />
          <YAxis
            domain={[lo, hi]}
            stroke='var(--theme-on-surface-variant)'
            tick={{ fontSize: 12 }}
            tickLine={false}
            width={56}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--theme-container-high)',
              border: '1px solid var(--theme-outline-variant)',
              borderRadius: '6px',
            }}
            // Down to the minute: a busy day is dozens of games, and a date alone labels
            // every one of them identically.
            labelFormatter={value => longTimestamp.format(Number(value))}
            formatter={value => [
              Math.round(Number(value)),
              metric === 'points'
                ? t('users.profile.stats.points', 'Points')
                : t('users.profile.stats.rating', 'Rating'),
            ]}
          />
          {showSeasonBoundaries
            ? boundaries.map(start => (
                <ReferenceLine
                  key={start}
                  x={start}
                  stroke='var(--theme-outline)'
                  strokeDasharray='4 4'
                />
              ))
            : undefined}
          {runs.map((run, i) => (
            <Line
              key={i}
              data={run}
              dataKey={metric}
              // Straight segments between games: a rating is a series of discrete
              // results, and a spline invents curvature between them that reads as
              // movement the player never made.
              type='linear'
              stroke={stroke}
              strokeWidth={2}
              // A one-game run has no segment, so without a dot it would be invisible --
              // and single-game runs are common (one game in a season, or one game total).
              dot={run.length === 1 ? { r: 3, fill: stroke, strokeWidth: 0 } : false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartArea>
  )
}
