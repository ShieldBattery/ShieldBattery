import { describe, expect, test } from 'vitest'
import { MatchmakingDivision } from '../../common/matchmaking'
import {
  RatingChartPoint,
  RatingChartSeason,
  bandOpacity,
  buildSeasonBands,
  pointsForMetric,
  seasonAxisTicks,
  splitOnDiscontinuity,
  valueExtent,
} from './rating-chart-data'

const DAY = 24 * 60 * 60 * 1000
const SEASON_LENGTH = 120 * DAY
const START = Date.UTC(2025, 0, 1)

function season(id: number, resetMmr: boolean): RatingChartSeason {
  return {
    id,
    name: `Season ${id}`,
    startDate: START + (id - 1) * SEASON_LENGTH,
    resetMmr,
  }
}

/** `count` games inside `seasonId`, evenly spaced through that season. */
function games(
  seasonId: number,
  count: number,
  ratingAt: (i: number) => number,
): RatingChartPoint[] {
  const seasonStart = START + (seasonId - 1) * SEASON_LENGTH
  return Array.from({ length: count }, (_, i) => ({
    changeDate: seasonStart + DAY + (i * (SEASON_LENGTH - 2 * DAY)) / Math.max(count, 1),
    rating: ratingAt(i),
    points: ratingAt(i) * 4,
    seasonId,
  }))
}

describe('splitOnDiscontinuity', () => {
  // Season 2 carries MMR over; season 3 resets it.
  const seasons = [season(1, true), season(2, false), season(3, true)]
  const history = [
    ...games(1, 5, i => 1500 + i),
    ...games(2, 5, i => 1600 + i),
    ...games(3, 5, i => 1500 + i),
  ]

  test('rating breaks only where a season reset it', () => {
    const runs = splitOnDiscontinuity(history, seasons, 'rating')
    // seasons 1+2 join (no reset), season 3 starts a new run
    expect(runs).toHaveLength(2)
    expect(runs[0].map(p => p.seasonId)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2])
    expect(runs[1].every(p => p.seasonId === 3)).toBe(true)
  })

  test('points break at every season boundary, reset or not', () => {
    const runs = splitOnDiscontinuity(history, seasons, 'points')
    expect(runs).toHaveLength(3)
    expect(runs.map(r => r[0].seasonId)).toEqual([1, 2, 3])
  })

  test('every point survives the split', () => {
    for (const metric of ['rating', 'points'] as const) {
      const runs = splitOnDiscontinuity(history, seasons, metric)
      expect(runs.flat()).toEqual(history)
    }
  })

  test('an empty history produces no runs', () => {
    expect(splitOnDiscontinuity([], seasons, 'rating')).toEqual([])
  })

  test('a reset in a season the player sat out still breaks the line', () => {
    // Play season 1, skip season 2 entirely (which resets), come back in season 3 (which
    // doesn't). The server voids the season 1 rating at season 2's reset whether or not it was
    // played, so joining these would draw a fall that never happened.
    const skipped = [season(1, false), season(2, true), season(3, false)]
    const history = [...games(1, 4, () => 1800), ...games(3, 4, () => 1500)]

    const runs = splitOnDiscontinuity(history, skipped, 'rating')
    expect(runs).toHaveLength(2)
    expect(runs[0].every(p => p.seasonId === 1)).toBe(true)
    expect(runs[1].every(p => p.seasonId === 3)).toBe(true)
  })

  test('a skipped season without a reset still joins', () => {
    // Same shape, but nothing in the gap resets, so the rating genuinely carried across.
    const skipped = [season(1, false), season(2, false), season(3, false)]
    const history = [...games(1, 4, () => 1800), ...games(3, 4, () => 1820)]

    expect(splitOnDiscontinuity(history, skipped, 'rating')).toHaveLength(1)
  })

  test('a single season is one run regardless of metric', () => {
    const single = games(2, 4, i => 1600 + i)
    expect(splitOnDiscontinuity(single, seasons, 'rating')).toHaveLength(1)
    expect(splitOnDiscontinuity(single, seasons, 'points')).toHaveLength(1)
  })
})

describe('buildSeasonBands', () => {
  const seasons = [season(1, true), season(2, false), season(3, true)]
  const history = [
    ...games(1, 4, () => 1500),
    ...games(2, 4, () => 1600),
    ...games(3, 4, () => 1700),
  ]
  const now = START + 3 * SEASON_LENGTH

  test('produces one group per season present in the data', () => {
    const groups = buildSeasonBands(history, seasons, true, now)
    expect(groups.map(g => g.seasonId)).toEqual([1, 2, 3])
  })

  test('skips seasons the player did not play', () => {
    const onlyLast = games(3, 4, () => 1700)
    const groups = buildSeasonBands(onlyLast, seasons, true, now)
    expect(groups.map(g => g.seasonId)).toEqual([3])
  })

  test('spans tile without gaps, so bands meet at the boundary', () => {
    const groups = buildSeasonBands(history, seasons, true, now)
    for (let i = 0; i < groups.length - 1; i++) {
      expect(groups[i].to).toBe(groups[i + 1].from)
    }
  })

  test('a season still in progress has lower bounds than a completed one', () => {
    // The reason bands are per-season at all: bounds are `low + bonusPool * factor`, and a
    // season ten days old has accrued almost none of its pool. Drawing it against a
    // completed season's bounds would place the player a division or two too low.
    const tenDaysIn = START + 2 * SEASON_LENGTH + 10 * DAY
    const groups = buildSeasonBands(history, seasons, true, tenDaysIn)
    const goldOf = (g: (typeof groups)[number]) =>
      g.bands.find(b => b.division === MatchmakingDivision.Gold1)!.low

    expect(goldOf(groups[2])).toBeLessThan(goldOf(groups[0]))
  })

  test('completed seasons of equal length share bounds', () => {
    const groups = buildSeasonBands(history, seasons, true, now)
    const goldOf = (g: (typeof groups)[number]) =>
      g.bands.find(b => b.division === MatchmakingDivision.Gold1)!.low
    expect(goldOf(groups[0])).toBe(goldOf(groups[1]))
  })

  test('the newest season accrues without an end-of-season freeze', () => {
    // getTotalBonusPool only deducts the freeze period when it knows the season's end. The
    // newest season has no following season to bound it, so it keeps accruing — which is
    // right while it's live, and means its bounds sit slightly above an equally-long
    // completed season once it's over.
    const groups = buildSeasonBands(history, seasons, true, now)
    const goldOf = (g: (typeof groups)[number]) =>
      g.bands.find(b => b.division === MatchmakingDivision.Gold1)!.low
    expect(goldOf(groups[2])).toBeGreaterThan(goldOf(groups[0]))
  })

  test('solo and team ladders have different bounds', () => {
    const solo = buildSeasonBands(history, seasons, true, now)
    const team = buildSeasonBands(history, seasons, false, now)
    const lowOf = (groups: typeof solo) =>
      groups[0].bands.find(b => b.division === MatchmakingDivision.Gold1)!.low
    expect(lowOf(solo)).not.toBe(lowOf(team))
  })

  test('covers the whole ladder, Bronze through Champion', () => {
    const groups = buildSeasonBands(history, seasons, true, now)
    const divisions = groups[0].bands.map(b => b.division)
    expect(divisions[0]).toBe(MatchmakingDivision.Bronze1)
    expect(divisions[divisions.length - 1]).toBe(MatchmakingDivision.Champion)
    // Unrated isn't a band on a chart of played games
    expect(divisions).not.toContain(MatchmakingDivision.Unrated)
  })

  test('scales to a long-lived account without collapsing seasons together', () => {
    // 17 seasons is roughly five years of ladder, which is what a veteran profile hits.
    const many = Array.from({ length: 17 }, (_, i) => season(i + 1, i % 3 === 0))
    const longHistory = many.flatMap(s => games(s.id, 40, () => 1500 + s.id * 10))
    const groups = buildSeasonBands(longHistory, many, true, START + 17 * SEASON_LENGTH)

    expect(groups).toHaveLength(17)
    expect(new Set(groups.map(g => g.seasonId)).size).toBe(17)
    for (let i = 0; i < groups.length - 1; i++) {
      expect(groups[i].to).toBe(groups[i + 1].from)
      expect(groups[i].from).toBeLessThan(groups[i].to)
    }
  })
})

describe('bandOpacity', () => {
  test('climbs across a tier so same-coloured sub-divisions stay distinguishable', () => {
    expect(bandOpacity(MatchmakingDivision.Bronze1)).toBeLessThan(
      bandOpacity(MatchmakingDivision.Bronze2),
    )
    expect(bandOpacity(MatchmakingDivision.Bronze2)).toBeLessThan(
      bandOpacity(MatchmakingDivision.Bronze3),
    )
  })

  test('is consistent across tiers, so the step reads the same everywhere', () => {
    expect(bandOpacity(MatchmakingDivision.Silver1)).toBe(bandOpacity(MatchmakingDivision.Gold1))
    expect(bandOpacity(MatchmakingDivision.Diamond3)).toBe(bandOpacity(MatchmakingDivision.Gold3))
  })
})

describe('pointsForMetric', () => {
  // The first games of a reset are placements: the server sends them without a rating.
  const history = games(1, 6, i => 1500 + i).map((p, i) => ({
    ...p,
    rating: i < 4 ? null : p.rating,
  }))

  test('the rating view drops placement games', () => {
    const visible = pointsForMetric(history, 'rating')
    expect(visible).toHaveLength(2)
    expect(visible.every(p => p.rating !== null)).toBe(true)
  })

  test('the points view keeps every game', () => {
    expect(pointsForMetric(history, 'points')).toHaveLength(6)
  })
})

describe('valueExtent', () => {
  const points = games(1, 3, i => 1500 + i * 100)

  test('reads the metric being plotted', () => {
    expect(valueExtent(points, 'rating')).toEqual({ min: 1500, max: 1700 })
    expect(valueExtent(points, 'points')).toEqual({ min: 6000, max: 6800 })
  })

  test('a hidden rating cannot drag the extent', () => {
    // Placement games carry no rating; even if one reaches this unfiltered, it must not
    // register as a bound.
    const withHidden: RatingChartPoint[] = [
      { changeDate: 0, rating: null, points: 6000, seasonId: 1 },
      { changeDate: 1, rating: 1600, points: 6400, seasonId: 1 },
    ]
    expect(valueExtent(withHidden, 'rating')).toEqual({ min: 1600, max: 1600 })
  })

  test('handles a history far past the argument-spread limit', () => {
    // Math.min(...values) throws RangeError somewhere north of ~100k arguments; a veteran's
    // history is well within reach of that, so the implementation must not spread.
    const huge: RatingChartPoint[] = Array.from({ length: 200_000 }, (_, i) => ({
      changeDate: i,
      rating: 1500 + (i % 500),
      points: 6000,
      seasonId: 1,
    }))
    expect(() => valueExtent(huge, 'rating')).not.toThrow()
    expect(valueExtent(huge, 'rating')).toEqual({ min: 1500, max: 1999 })
  })
})

describe('seasonAxisTicks', () => {
  const seasons = [season(1, true), season(2, false), season(3, true)]
  const history = [
    ...games(1, 4, () => 1500),
    ...games(2, 4, () => 1600),
    ...games(3, 4, () => 1700),
  ]

  test('one tick per season played, labelled by season', () => {
    const ticks = seasonAxisTicks(history, seasons)
    expect(ticks.map(t => t.label)).toEqual(['Season 1', 'Season 2', 'Season 3'])
  })

  test('the first tick is clamped to the first game, not the season start', () => {
    // Season 1 began before this player's first game; a tick at the season start would sit
    // off the left edge of the axis.
    const ticks = seasonAxisTicks(history, seasons)
    expect(ticks[0].value).toBe(history[0].changeDate)
  })

  test('ignores seasons with no games', () => {
    const onlyMiddle = games(2, 4, () => 1600)
    expect(seasonAxisTicks(onlyMiddle, seasons).map(t => t.label)).toEqual(['Season 2'])
  })

  test('an empty history has no ticks', () => {
    expect(seasonAxisTicks([], seasons)).toEqual([])
  })
})
