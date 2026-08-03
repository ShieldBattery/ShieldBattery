import { MatchmakingType, TEAM_SIZES } from '../../common/matchmaking'
import { AssignedRaceChar } from '../../common/races'
import { ALL_MODES } from './stats-filters'

/**
 * Shape and combinatorics for the matchup matrix, kept apart from the component so the
 * axes can be derived and tested without rendering.
 */

/**
 * Deliberately TPZ rather than the alphabetical order of `ALL_ASSIGNED_RACE_CHARS`: this
 * is display order for the matrix axes, and TPZ is how races are conventionally listed
 * for Brood War.
 */
export const MATRIX_RACES: ReadonlyArray<AssignedRaceChar> = ['t', 'p', 'z']

/** A matchup filter is either one matchmaking mode or every mode combined. */
export type ModeFilter = MatchmakingType | typeof ALL_MODES

/** The viewed player's record in one cell of the matrix. */
export interface MatchupCell {
  games: number
  wins: number
}

/**
 * Across all modes there is no single team size, so the combined view falls back to the
 * 1v1 shape: your race against each opposing race, counting opponents individually.
 */
export function teamSizeFor(mode: ModeFilter): number {
  return mode === ALL_MODES ? 1 : TEAM_SIZES[mode]
}

/**
 * Race compositions of a given size, unordered: a team is identified by the races on it,
 * not by who played which, so TP and PT are the same composition. That collapse is what
 * keeps a 3v3 matrix at 10x10 rather than 27x27.
 */
export function raceCombos(size: number): AssignedRaceChar[][] {
  const out: AssignedRaceChar[][] = []
  const walk = (start: number, acc: AssignedRaceChar[]) => {
    if (acc.length === size) {
      out.push(acc.slice())
      return
    }
    for (let i = start; i < MATRIX_RACES.length; i++) {
      acc.push(MATRIX_RACES[i])
      walk(i, acc)
      acc.pop()
    }
  }
  walk(0, [])
  return out
}

/**
 * Where the matrix gets its numbers.
 *
 * An interface rather than the query result directly, so the same component serves the profile
 * (backed by `userMatchupStats`) and the dev page at `/dev/users/stats` (backed by constructed
 * fixtures). Both go through `createMatchupSource`, so the dev page exercises the real
 * aggregation rather than a parallel one.
 */
export interface MatchupDataSource {
  /** Maps in the pool for this mode and season, unsorted. */
  maps(mode: ModeFilter, season: string): string[]
  /** The player's overall record on a map, which the map picker sorts and labels by. */
  mapStats(mode: ModeFilter, season: string, map: string): MatchupCell
  /** The player's record in one cell: their team's races against the opposing team's. */
  cell(
    mode: ModeFilter,
    season: string,
    map: string,
    row: AssignedRaceChar[],
    col: AssignedRaceChar[],
  ): MatchupCell
}
