import { AssignedRaceChar } from '../../common/races'

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

/** The viewed player's record in one cell of the matrix. */
export interface MatchupCell {
  games: number
  wins: number
}

/**
 * A map in the pool, as the strip below the matrix draws it.
 *
 * The name is the identity here rather than the id: it's what the filter selects by, and two
 * uploads sharing a name are the same map as far as a player is concerned.
 */
export interface MatchupMapInfo {
  name: string
  /** 256px preview, absent for a map whose file has been removed. */
  imageUrl?: string
}

/**
 * Stands in for the band grid until the first response carries the real one.
 *
 * The server is authoritative — every payload reports its own grid — so this only has to be
 * close enough to render a slider nobody can interact with yet. Keeping it here rather than
 * reaching for the numbers at each call site means there's one place to notice if it drifts.
 */
export const DEFAULT_RATING_BANDS = { size: 100, min: 1000, max: 2400 }

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
 * Everything the matrix narrows by below the mode. Grouped rather than passed as loose arguments
 * because they always travel together, and a third and fourth positional string would be easy to
 * transpose at a call site with no type error to catch it.
 */
export interface MatchupFilters {
  /** A season id as a string, or `ALL_SEASONS`. */
  season: string
  /** A map name, or `ALL_MAPS`. */
  map: string
  /**
   * Inclusive band bounds, as lower edges. `[1000, 2400]` with the default grid means every band,
   * since both ends are clamped values that stand for "and below" / "and above".
   */
  ratingRange: readonly [number, number]
}

/**
 * Where the matrix gets its numbers.
 *
 * One mode's worth of data: the mode is the matrix's own shape (it decides how many races are
 * on an axis), so it's chosen before a source exists rather than filtered inside one. The same
 * goes for whose games these are — a source is either one player's or the whole ladder's.
 *
 * An interface rather than the query result directly, so the same component serves the profile
 * (backed by `userMatchupStats` / `globalMatchupStats`) and the dev page at `/dev/users/matchups`
 * (backed by constructed fixtures). All of them go through `createMatchupSource`, so the dev page
 * exercises the real aggregation rather than a parallel one.
 */
export interface MatchupDataSource {
  /**
   * Maps in the pool for the given filters, unsorted. `filters.map` is ignored — this is what
   * populates the map picker, so narrowing it by the current selection would leave the picker
   * offering only what's already chosen.
   */
  maps(filters: MatchupFilters): MatchupMapInfo[]
  /** The record on a map, which the map picker sorts and labels by. */
  mapStats(filters: MatchupFilters): MatchupCell
  /** The record in one cell: the viewed side's races against the opposing side's. */
  cell(filters: MatchupFilters, row: AssignedRaceChar[], col: AssignedRaceChar[]): MatchupCell
}
