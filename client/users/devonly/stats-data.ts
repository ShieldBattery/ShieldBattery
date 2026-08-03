import {
  MatchmakingType,
  NUM_PLACEMENT_MATCHES,
  POINTS_FOR_RATING_TARGET_FACTOR,
} from '../../../common/matchmaking'
import { AssignedRaceChar } from '../../../common/races'
import { MatchupModeData } from '../matchup-source'
import { RatingChartPoint, RatingChartSeason } from '../rating-chart-data'

/**
 * Constructed data for the user stats dev page.
 *
 * Produces the same types the GraphQL queries return, so the page under test is the page
 * that ships. Anything that isn't data construction belongs in the shared modules next door.
 */

/** A season plus the extra bits the generator needs to lay games out inside it. */
interface FixtureSeason extends RatingChartSeason {
  /** Roughly what fraction of a mode's games were played in this season. */
  share: number
  endDate: number
}

const FIXTURE_SEASONS: ReadonlyArray<FixtureSeason> = [
  {
    id: 1,
    name: 'Season 1',
    resetMmr: true,
    share: 0.38,
    startDate: Date.UTC(2025, 7, 1),
    endDate: Date.UTC(2025, 11, 1),
  },
  {
    id: 2,
    name: 'Season 2',
    resetMmr: false,
    share: 0.38,
    startDate: Date.UTC(2025, 11, 1),
    endDate: Date.UTC(2026, 3, 1),
  },
  {
    id: 3,
    name: 'Season 3',
    resetMmr: true,
    share: 0.24,
    startDate: Date.UTC(2026, 3, 1),
    endDate: Date.UTC(2026, 7, 1),
  },
]

export const SEASONS: ReadonlyArray<RatingChartSeason> = FIXTURE_SEASONS

const CURRENT_SEASON = FIXTURE_SEASONS[FIXTURE_SEASONS.length - 1]

/** Deterministic PRNG so the dev page looks the same on every reload. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * Generates exactly `totalGames` points, split across the seasons by their share, so a
 * mode's chart plots as many games as its header claims. Games are dated across each
 * season's real span, since that's what the chart's axis and per-season bands read.
 */
function buildHistory(seed: number, targets: number[], totalGames: number): RatingChartPoint[] {
  const r = rng(seed)
  const out: RatingChartPoint[] = []
  let rating = 1500
  let played = 0
  // Games since the last MMR reset: the counter the server judges placements by. Ratings for
  // games inside placements come through as null, exactly as the real queries deliver them.
  let lifetimeGames = 0

  for (const [i, season] of FIXTURE_SEASONS.entries()) {
    if (season.resetMmr) {
      rating = 1500
      lifetimeGames = 0
    }
    // Points are seasonal: they restart at 0 every season, even when MMR carries over.
    let points = 0
    // The last season takes the remainder so the total lands exactly on totalGames.
    const n =
      i === FIXTURE_SEASONS.length - 1 ? totalGames - played : Math.round(totalGames * season.share)
    const goal = targets[i]
    // Leave a margin at each end so a season's first game isn't exactly on the boundary.
    const span = (season.endDate - season.startDate) * 0.94
    const step = span / Math.max(n, 1)

    for (let g = 0; g < n; g++) {
      rating += (goal - rating) / Math.max(n - g, 1) + (r() - 0.5) * 34

      const target = rating * POINTS_FOR_RATING_TARGET_FACTOR
      // Unconverged players get catch-up points on top of the normal gain.
      const approach = points >= target * 0.92 ? 0.02 : 0.055
      points += (target - points) * approach + (r() - 0.5) * 46
      points += 2.4 // bonus pool accrues whether or not it's earned in game
      if (points < 0) points = 0

      lifetimeGames++
      out.push({
        changeDate: season.startDate + span * 0.03 + g * step,
        rating: lifetimeGames >= NUM_PLACEMENT_MATCHES ? rating : null,
        points,
        seasonId: season.id,
      })
      played++
    }
  }
  return out
}

/** A mode's card contents, matching what the profile passes the real card. */
export interface DevMode {
  type: MatchmakingType
  wins: number
  losses: number
  /** Absent while the player is still in placement matches, like the real header. */
  rating?: number
  seasonDelta?: number
  history: RatingChartPoint[]
}

/**
 * Builds a mode from its generated history, so the headline figures can't disagree with
 * the chart underneath them.
 */
function makeMode(
  type: MatchmakingType,
  seed: number,
  targets: number[],
  totalGames: number,
  winRate: number,
): DevMode {
  const history = buildHistory(seed, targets, totalGames)
  const last = history[history.length - 1]
  const firstOfSeason = history.findIndex(p => p.seasonId === CURRENT_SEASON.id)
  // The delta mirrors the server's: current rating against the last rating held before this
  // season began, deliberately spanning any MMR reset. It exists only when the mode was
  // played both this season and before it, and only when neither endpoint's rating is hidden
  // inside placements.
  const lastBefore = firstOfSeason > 0 ? history[firstOfSeason - 1] : undefined
  const current = last.seasonId === CURRENT_SEASON.id ? last.rating : null
  const seasonDelta =
    current !== null && lastBefore != null && lastBefore.rating !== null
      ? Math.round(current - lastBefore.rating)
      : undefined
  const wins = Math.round(history.length * winRate)

  return {
    type,
    wins,
    losses: history.length - wins,
    rating: last.rating !== null ? Math.round(last.rating) : undefined,
    seasonDelta,
    history,
  }
}

/** Ordered so the player's most-played mode appears first, as the real page does. */
export const MODES_BY_PLAYTIME: ReadonlyArray<DevMode> = [
  makeMode(MatchmakingType.Match1v1, 20260730, [1771, 1804, 1918], 613, 0.54),
  makeMode(MatchmakingType.Match2v2Fastest, 4242, [1588, 1690, 1774], 214, 0.57),
  makeMode(MatchmakingType.Match3v3Hunters, 8181, [1502, 1571, 1596], 132, 0.45),
  makeMode(MatchmakingType.Match2v2, 991, [1610, 1703, 1642], 96, 0.49),
  // Still in placements: every rating is hidden, so the card shows a dash and the rating
  // chart shows its placement message while the points view still plots the games. Five
  // games leaves exactly one in the last season, which also exercises the chart's
  // single-game-run dot.
  makeMode(MatchmakingType.Match1v1Fastest, 777, [1540, 1560, 1580], 5, 0.4),
]

/** Maps the matchup fixtures are spread across, standing in for a real season's pool. */
export const MATCHUP_MAPS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'map-fs', name: 'Fighting Spirit' },
  { id: 'map-cb', name: 'Circuit Breaker' },
  { id: 'map-po', name: 'Polypoid' },
]

/**
 * Matchup buckets for one solo mode, shaped exactly as `userMatchupStats` returns them.
 *
 * Deliberately uneven: some cells are heavily played, some sit under the thin-sample
 * threshold so their dimming is visible, and at least one is missing entirely so the empty
 * cell renders. A uniform matrix would hide all three.
 */
export function makeMatchupBuckets(seed: number): MatchupModeData['buckets'] {
  const races: AssignedRaceChar[] = ['t', 'p', 'z']
  const buckets: Array<MatchupModeData['buckets'][number]> = []
  let n = seed

  const next = (max: number) => {
    // Same mulberry-ish stepping the rest of this file uses: deterministic, so the dev page
    // looks identical between reloads.
    n = (n * 1103515245 + 12345) & 0x7fffffff
    return n % max
  }

  for (const season of FIXTURE_SEASONS) {
    for (const map of MATCHUP_MAPS) {
      for (const race of races) {
        for (const opponent of races) {
          // Leave one cell of one map unplayed so the matrix has a blank in it.
          if (season.id === 1 && map.id === 'map-po' && race === 't' && opponent === 'p') continue
          const games = 1 + next(14)
          buckets.push({
            seasonId: season.id,
            mapId: map.id,
            races: [race],
            opponentRaces: [opponent],
            games,
            wins: Math.round(games * (0.3 + next(45) / 100)),
          })
        }
      }
    }
  }
  return buckets
}

/** A complete `userMatchupStats` payload for one mode. */
export function makeMatchupMode(type: MatchmakingType, seed: number): MatchupModeData {
  const buckets = makeMatchupBuckets(seed)
  return {
    matchmakingType: type,
    totalGames: buckets.reduce((sum, b) => sum + b.games, 0),
    buckets,
    maps: MATCHUP_MAPS,
  }
}
