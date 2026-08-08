import { RatingChartSeason } from '../rating-chart-data'

/**
 * The season grid and PRNG both dev fixture sets are built on.
 *
 * Shared rather than owned by either: the rating histories and the matchup buckets have to agree
 * about which seasons exist, or the same account would appear to have played in different ones
 * depending on which tab you opened.
 */

/** A season plus the extra bits the generator needs to lay games out inside it. */
interface FixtureSeason extends RatingChartSeason {
  /** Roughly what fraction of a mode's games were played in this season. */
  share: number
  endDate: number
}

export const FIXTURE_SEASONS: ReadonlyArray<FixtureSeason> = [
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

export const CURRENT_SEASON = FIXTURE_SEASONS[FIXTURE_SEASONS.length - 1]

/** Deterministic PRNG so the dev pages look the same on every reload. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
