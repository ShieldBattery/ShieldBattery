import {
  MatchmakingDivision,
  getAllDivisionsWithBounds,
  getTotalBonusPool,
} from '../../common/matchmaking'

/**
 * Shaping logic for the profile rating chart, kept apart from the component so it can be
 * tested without rendering.
 */

/** What the chart plots. Divisions are defined on points, so bands only apply to that. */
export type RatingMetric = 'rating' | 'points'

export interface RatingChartSeason {
  id: number
  name: string
  startDate: number
  resetMmr: boolean
}

export interface RatingChartPoint {
  changeDate: number
  /**
   * `null` for games played during placement matches: the server never sends a provisional
   * rating. Points are public throughout, so those are always present.
   */
  rating: number | null
  points: number
  seasonId: number
}

/**
 * The points that carry a value for the given metric. The rating view drops placement games
 * (their rating is hidden), while the points view plots every game.
 */
export function pointsForMetric(
  points: ReadonlyArray<RatingChartPoint>,
  metric: RatingMetric,
): ReadonlyArray<RatingChartPoint> {
  return metric === 'rating' ? points.filter(p => p.rating !== null) : points
}

export interface SeasonBands {
  seasonId: number
  from: number
  to: number
  bands: Array<{ division: MatchmakingDivision; low: number; high: number }>
}

/**
 * Splits a history into runs drawn as separate lines. Points restart at zero every season, so
 * they always break at a boundary; rating only breaks where a season reset it. Joining across
 * either would draw a fall the player never took.
 */
export function splitOnDiscontinuity(
  points: ReadonlyArray<RatingChartPoint>,
  seasons: ReadonlyArray<RatingChartSeason>,
  metric: RatingMetric,
): RatingChartPoint[][] {
  const indexById = new Map(seasons.map((s, i) => [s.id, i]))

  /**
   * Whether a reset fell between two games. Every season in the gap counts, not just the one
   * being arrived in: a reset voids every rating older than itself, so a season the player sat
   * out still breaks the line. The server does the same when it walks back for a previous
   * rating (`getMatchmakingRating` stops at the first reset season it passes, played or not).
   */
  const crossedReset = (from: RatingChartPoint, to: RatingChartPoint) => {
    const fromIndex = indexById.get(from.seasonId)
    const toIndex = indexById.get(to.seasonId)
    // An unknown season shouldn't happen, since seasonId is derived from this same list. If it
    // does, break the line: a spurious gap misleads less than a fall the player never took.
    if (fromIndex === undefined || toIndex === undefined) return true
    return seasons.slice(fromIndex + 1, toIndex + 1).some(s => s.resetMmr)
  }

  const runs: RatingChartPoint[][] = []
  let current: RatingChartPoint[] = []

  for (const point of points) {
    const previous = current[current.length - 1]
    const crossedSeason = previous !== undefined && previous.seasonId !== point.seasonId
    if (crossedSeason && (metric === 'points' || crossedReset(previous, point))) {
      runs.push(current)
      current = []
    }
    current.push(point)
  }
  if (current.length) runs.push(current)
  return runs
}

/**
 * One band set per season on screen, each at the bonus pool that applied during it.
 *
 * Division bounds are `low + bonusPool * factor` and the pool accrues across a season, so a
 * single band set spanning an all-time view would judge every past season by today's pool —
 * badly wrong early in a new season, when the pool is near zero and completed seasons'
 * inflated point totals tower over bounds that haven't moved yet.
 */
export function buildSeasonBands(
  points: ReadonlyArray<RatingChartPoint>,
  seasons: ReadonlyArray<RatingChartSeason>,
  solo: boolean,
  now = Date.now(),
): SeasonBands[] {
  const groups: SeasonBands[] = []

  for (const [i, season] of seasons.entries()) {
    const inSeason = points.filter(p => p.seasonId === season.id)
    if (!inSeason.length) continue

    const nextStart = seasons[i + 1]?.startDate
    const at = Math.min(now, nextStart ?? now)
    const pool = getTotalBonusPool(
      new Date(at),
      new Date(season.startDate),
      nextStart !== undefined ? new Date(nextStart) : undefined,
    )

    groups.push({
      seasonId: season.id,
      from: inSeason[0].changeDate,
      to: inSeason[inSeason.length - 1].changeDate,
      bands: getAllDivisionsWithBounds(solo, pool).map(([division, low, high]) => ({
        division,
        low,
        high,
      })),
    })
  }

  // Butt each span against the next so the bands tile rather than leaving gaps.
  for (let i = 0; i < groups.length - 1; i++) {
    groups[i].to = groups[i + 1].from
  }
  return groups
}

/** Fill weight climbs across a tier's three sub-divisions, which share a colour. */
export function bandOpacity(division: MatchmakingDivision): number {
  if (division === MatchmakingDivision.Champion) return 0.24
  if (division.endsWith('2')) return 0.16
  if (division.endsWith('3')) return 0.21
  return 0.11
}

/**
 * Lowest and highest value in view for the given metric.
 *
 * A loop rather than `Math.min(...values)`: a spread passes one argument per game, which a
 * long history can push past the engine's call-argument limit.
 */
export function valueExtent(
  points: ReadonlyArray<RatingChartPoint>,
  metric: RatingMetric,
): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const point of points) {
    const value = metric === 'points' ? point.points : point.rating
    if (value === null) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}

/**
 * Ticks for an all-time x-axis: one per season roll, labelled by season name. Evenly spaced
 * dates land wherever the tick algorithm likes and crowd each other; season rolls are the
 * landmarks that mean something.
 */
export function seasonAxisTicks(
  points: ReadonlyArray<RatingChartPoint>,
  seasons: ReadonlyArray<RatingChartSeason>,
): Array<{ value: number; label: string }> {
  if (!points.length) return []
  const first = points[0].changeDate
  const last = points[points.length - 1].changeDate
  return seasons
    .filter(s => points.some(p => p.seasonId === s.id))
    .map(s => ({ value: Math.max(s.startDate, first), label: s.name }))
    .filter(tick => tick.value <= last)
}
