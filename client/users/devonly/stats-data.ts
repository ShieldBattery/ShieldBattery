import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingDivision,
  MatchmakingType,
  POINTS_FOR_RATING_TARGET_FACTOR,
  TEAM_SIZES,
  getDivisionColor,
  getDivisionsForPointsChange,
  getTotalBonusPool,
} from '../../../common/matchmaking'
import { AssignedRaceChar } from '../../../common/races'
import { SbUserId, makeSbUserId } from '../../../common/users/sb-user-id'

/**
 * Mock data for the user stats dev page. Shaped like what the real queries would
 * return so the components can be swapped onto live data without changing props.
 */

export interface RatingPoint {
  /** Index of the game within the player's history for this mode. */
  game: number
  rating: number
  points: number
  season: number
}

export interface SeasonInfo {
  id: number
  name: string
  /** Whether MMR was reset at the start of this season. */
  resetMmr: boolean
  /** Roughly what fraction of a mode's games were played in this season. */
  share: number
  startDate: Date
  endDate: Date
}

export interface ModeStats {
  type: MatchmakingType
  games: number
  rating: number
  seasonDelta: number
  history: RatingPoint[]
}

export interface RivalEntry {
  userId: SbUserId
  name: string
  games: number
  wins: number
}

export const SEASONS: ReadonlyArray<SeasonInfo> = [
  {
    id: 1,
    name: 'Season 1',
    resetMmr: true,
    share: 0.38,
    startDate: new Date('2025-08-01T00:00:00Z'),
    endDate: new Date('2025-12-01T00:00:00Z'),
  },
  {
    id: 2,
    name: 'Season 2',
    resetMmr: false,
    share: 0.38,
    startDate: new Date('2025-12-01T00:00:00Z'),
    endDate: new Date('2026-04-01T00:00:00Z'),
  },
  {
    id: 3,
    name: 'Season 3',
    resetMmr: true,
    share: 0.24,
    startDate: new Date('2026-04-01T00:00:00Z'),
    endDate: new Date('2026-08-01T00:00:00Z'),
  },
]

export const CURRENT_SEASON = SEASONS[SEASONS.length - 1]

/**
 * The bonus pool as it stands now, via the real accrual function. Division bounds are
 * `low + bonusPool * factor`, so this is what positions the bands.
 */
export function currentBonusPool(): number {
  return bonusPoolFor(CURRENT_SEASON)
}

/**
 * The pool as it stood for a given season: at its end if it's over, at now if it's
 * still running. Drawing a past season's points against today's bounds would judge
 * them by thresholds that never applied.
 */
export function bonusPoolFor(season: SeasonInfo): number {
  const at = new Date(Math.min(Date.now(), Number(season.endDate)))
  return getTotalBonusPool(at, season.startDate, season.endDate)
}

/**
 * Fill weight climbs across the three sub-divisions of a tier. The tier colour is
 * shared across its sub-divisions, so this step is what separates them.
 */
function bandOpacity(division: MatchmakingDivision): number {
  if (division === MatchmakingDivision.Champion) return 0.24
  if (division.endsWith('2')) return 0.16
  if (division.endsWith('3')) return 0.21
  return 0.11
}

export interface DivisionBand {
  division: MatchmakingDivision
  low: number
  high: number
  color: string
  opacity: number
}

/**
 * Every division with its points bounds at the given bonus pool. Bounds come from
 * `getDivisionsForPointsChange` rather than a local copy of the table, so the bands
 * can't drift away from what the matchmaker actually does.
 */
export function divisionBands(solo: boolean, bonusPool: number): DivisionBand[] {
  return getDivisionsForPointsChange(solo, 0, Number.MAX_SAFE_INTEGER, bonusPool).map(
    ([division, low, high]) => ({
      division,
      low,
      high,
      color: getDivisionColor(division),
      opacity: bandOpacity(division),
    }),
  )
}

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
 * mode's chart plots as many games as its header claims.
 */
function buildHistory(seed: number, targets: number[], totalGames: number): RatingPoint[] {
  const r = rng(seed)
  const out: RatingPoint[] = []
  let rating = 1500
  let game = 0

  for (const [i, season] of SEASONS.entries()) {
    if (season.resetMmr) rating = 1500
    // Points are seasonal: they restart at 0 every season, even when MMR carries over.
    let points = 0
    // The last season takes the remainder so the total lands exactly on totalGames.
    const n = i === SEASONS.length - 1 ? totalGames - game : Math.round(totalGames * season.share)
    const goal = targets[i]

    for (let g = 0; g < n; g++) {
      rating += (goal - rating) / Math.max(n - g, 1) + (r() - 0.5) * 34

      const target = rating * POINTS_FOR_RATING_TARGET_FACTOR
      // Unconverged players get catch-up points on top of the normal gain.
      const approach = points >= target * 0.92 ? 0.02 : 0.055
      points += (target - points) * approach + (r() - 0.5) * 46
      points += 2.4 // bonus pool accrues whether or not it's earned in game
      if (points < 0) points = 0

      out.push({ game, rating, points, season: season.id })
      game++
    }
  }
  return out
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
): ModeStats {
  const history = buildHistory(seed, targets, totalGames)
  const last = history[history.length - 1]
  const firstOfSeason = history.findIndex(p => p.season === CURRENT_SEASON.id)
  // A reset season starts from scratch, and so does a history that has no earlier
  // game to carry a rating over from (findIndex gives -1 for a season never played,
  // 0 for one the history starts in).
  const seasonStartRating =
    CURRENT_SEASON.resetMmr || firstOfSeason <= 0 ? 1500 : history[firstOfSeason - 1].rating

  return {
    type,
    games: history.length,
    rating: Math.round(last.rating),
    seasonDelta: Math.round(last.rating - seasonStartRating),
    history,
  }
}

/** Game indices where a new season begins, for drawing boundary markers. */
export function seasonBoundaries(history: ReadonlyArray<RatingPoint>): number[] {
  const out: number[] = []
  for (let i = 1; i < history.length; i++) {
    if (history[i].season !== history[i - 1].season) out.push(history[i].game)
  }
  return out
}

export const MODES: ReadonlyArray<ModeStats> = [
  makeMode(MatchmakingType.Match1v1, 20260730, [1771, 1804, 1918], 613),
  makeMode(MatchmakingType.Match2v2, 991, [1610, 1703, 1642], 96),
  makeMode(MatchmakingType.Match2v2Fastest, 4242, [1588, 1690, 1774], 214),
  makeMode(MatchmakingType.Match3v3Hunters, 8181, [1502, 1571, 1596], 132),
]

/** Modes ordered so the player's most-played appears first. */
export const MODES_BY_PLAYTIME: ReadonlyArray<ModeStats> = MODES.slice().sort(
  (a, b) => b.games - a.games,
)

/**
 * Splits a history into runs that should be drawn as separate lines. Rating only
 * breaks where a season reset it; points restart every season, so they always break
 * at a boundary. Connecting across either draws a jump that never happened.
 */
export function splitOnDiscontinuity(
  history: ReadonlyArray<RatingPoint>,
  everyBoundary: boolean,
): RatingPoint[][] {
  const resetSeasons = new Set(SEASONS.filter(s => s.resetMmr).map(s => s.id))
  const runs: RatingPoint[][] = []
  let current: RatingPoint[] = []
  for (const point of history) {
    const previous = current[current.length - 1]
    const crossedSeason = previous !== undefined && previous.season !== point.season
    if (crossedSeason && (everyBoundary || resetSeasons.has(point.season))) {
      runs.push(current)
      current = []
    }
    current.push(point)
  }
  if (current.length) runs.push(current)
  return runs
}

// --- Rivals ---------------------------------------------------------------

export const BEST_ALLIES: ReadonlyArray<RivalEntry> = [
  { userId: makeSbUserId(4821), name: 'Nydus_Nomad', games: 61, wins: 44 },
  { userId: makeSbUserId(1190), name: 'PylonPusher', games: 28, wins: 19 },
  { userId: makeSbUserId(7734), name: 'SiegeCreep', games: 17, wins: 11 },
  { userId: makeSbUserId(2255), name: 'MacroMantis', games: 12, wins: 7 },
]

export const RIVALS: ReadonlyArray<RivalEntry> = [
  { userId: makeSbUserId(9012), name: 'DarkSwarmDan', games: 74, wins: 39 },
  { userId: makeSbUserId(3376), name: 'ReaverRush', games: 52, wins: 30 },
  { userId: makeSbUserId(6640), name: 'TankLineTom', games: 41, wins: 17 },
  { userId: makeSbUserId(8123), name: 'LurkerLane', games: 33, wins: 18 },
]

export const TOUGHEST_OPPONENTS: ReadonlyArray<RivalEntry> = [
  { userId: makeSbUserId(5567), name: 'CarrierHasArrived', games: 22, wins: 4 },
  { userId: makeSbUserId(4402), name: 'GhostNukeGuy', games: 15, wins: 4 },
  { userId: makeSbUserId(6640), name: 'TankLineTom', games: 41, wins: 17 },
  { userId: makeSbUserId(7781), name: 'DefilerDiva', games: 11, wins: 5 },
]

// --- Matchups -------------------------------------------------------------

/**
 * Deliberately TPZ rather than the alphabetical order of `ALL_ASSIGNED_RACE_CHARS`:
 * this is display order for the matrix axes, and TPZ is how races are conventionally
 * listed for Brood War.
 */
export const MATRIX_RACES: ReadonlyArray<AssignedRaceChar> = ['t', 'p', 'z']

export interface MapInfo {
  name: string
  modes: MatchmakingType[]
  seasons: number[]
}

export const MAP_POOL: ReadonlyArray<MapInfo> = [
  {
    name: 'Fighting Spirit',
    modes: [MatchmakingType.Match1v1, MatchmakingType.Match2v2],
    seasons: [1, 2, 3],
  },
  { name: 'Polypoid', modes: [MatchmakingType.Match1v1], seasons: [1, 2, 3] },
  { name: 'Eclipse', modes: [MatchmakingType.Match1v1], seasons: [1, 2] },
  { name: 'Vermeer', modes: [MatchmakingType.Match1v1], seasons: [3] },
  { name: 'Retro', modes: [MatchmakingType.Match1v1], seasons: [2, 3] },
  { name: 'Circuit Breaker', modes: [MatchmakingType.Match1v1], seasons: [1] },
  { name: 'Rush Hour', modes: [MatchmakingType.Match2v2], seasons: [2, 3] },
  { name: 'Neo Sylphid', modes: [MatchmakingType.Match2v2], seasons: [1, 2] },
  {
    name: 'Fastest Map Possible',
    modes: [MatchmakingType.Match2v2Fastest],
    seasons: [1, 2, 3],
  },
  { name: 'Ultra Fastest', modes: [MatchmakingType.Match2v2Fastest], seasons: [3] },
  { name: 'Hunters', modes: [MatchmakingType.Match3v3Hunters], seasons: [1, 2, 3] },
  { name: 'Deep Hunters', modes: [MatchmakingType.Match3v3Hunters], seasons: [2, 3] },
]

export const ALL_MODES = 'all'
export const ALL_SEASONS = 'all'
export const ALL_MAPS = 'Overall'

/** A matchup filter is either one matchmaking mode or every mode combined. */
export type ModeFilter = MatchmakingType | typeof ALL_MODES

/**
 * Across all modes there is no single team size, so the combined view falls back to
 * the 1v1 shape: your race against each opposing race, counting opponents individually.
 */
export function teamSizeFor(mode: ModeFilter): number {
  return mode === ALL_MODES ? 1 : TEAM_SIZES[mode]
}

export function mapsFor(mode: ModeFilter, season: string): string[] {
  return MAP_POOL.filter(
    m =>
      (mode === ALL_MODES || m.modes.includes(mode)) &&
      (season === ALL_SEASONS || m.seasons.includes(Number(season))),
  ).map(m => m.name)
}

/**
 * Race compositions of a given size, unordered: a team is identified by the races
 * on it, not by who played which, so TP and PT are the same composition.
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

export interface MatchupCell {
  games: number
  wins: number
}

const MODE_TOTALS: Record<ModeFilter, number> = {
  [ALL_MODES]: MODES.reduce((sum, m) => sum + m.games, 0),
  ...(Object.fromEntries(ALL_MATCHMAKING_TYPES.map(type => [type, 0])) as Record<
    MatchmakingType,
    number
  >),
  ...(Object.fromEntries(MODES.map(m => [m.type, m.games])) as Record<MatchmakingType, number>),
}

// This player mains Terran; ally races are near-random and opponents follow ladder
// population. Modelling that matters: a uniform spread makes a team matrix look far
// better covered than it really is.
const SELF_WEIGHT: Record<AssignedRaceChar, number> = { t: 0.62, p: 0.26, z: 0.12 }
const ALLY_WEIGHT: Record<AssignedRaceChar, number> = { t: 0.34, p: 0.33, z: 0.33 }
const OPP_WEIGHT: Record<AssignedRaceChar, number> = { t: 0.36, p: 0.34, z: 0.3 }

function arrangements(parts: AssignedRaceChar[]): number {
  const counts = new Map<AssignedRaceChar, number>()
  for (const p of parts) counts.set(p, (counts.get(p) ?? 0) + 1)
  let result = 1
  for (let f = 2; f <= parts.length; f++) result *= f
  for (const c of counts.values()) {
    for (let g = 2; g <= c; g++) result /= g
  }
  return result
}

function multisetWeight(
  parts: AssignedRaceChar[],
  weights: Record<AssignedRaceChar, number>,
): number {
  if (!parts.length) return 1
  let w = 1
  for (const p of parts) w *= weights[p]
  return w * arrangements(parts)
}

/** A comp doesn't record which member was you, so sum over the possibilities. */
function rowWeight(parts: AssignedRaceChar[]): number {
  const seen = new Set<AssignedRaceChar>()
  let total = 0
  for (const race of parts) {
    if (seen.has(race)) continue
    seen.add(race)
    const rest = parts.slice()
    rest.splice(rest.indexOf(race), 1)
    total += SELF_WEIGHT[race] * multisetWeight(rest, ALLY_WEIGHT)
  }
  return total
}

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** Game counts are a counting process, so draw them as one. */
function poisson(lambda: number, r: () => number): number {
  if (lambda <= 0) return 0
  if (lambda < 30) {
    const l = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k++
      p *= r()
    } while (p > l)
    return k - 1
  }
  const u1 = Math.max(r(), 1e-9)
  const u2 = r()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.max(0, Math.round(lambda + z * Math.sqrt(lambda)))
}

export function matchupCell(
  mode: ModeFilter,
  season: string,
  map: string,
  row: AssignedRaceChar[],
  col: AssignedRaceChar[],
): MatchupCell {
  const key = `${mode}|${season}|${map}|${row.join('')}>${col.join('')}`
  const r = rng(hashStr(key))
  r()
  r()

  let scale = 0.18
  if (map === ALL_MAPS) {
    scale = season === ALL_SEASONS ? 1 : 0.4
  }
  const weight = rowWeight(row) * multisetWeight(col, OPP_WEIGHT)
  const games = poisson((MODE_TOTALS[mode] ?? 300) * scale * weight, r)
  if (games < 1) return { games: 0, wins: 0 }

  const sameComp = row.join('') === col.join('')
  const winRate = sameComp ? 0.46 + r() * 0.1 : 0.42 + r() * 0.28
  return { games, wins: Math.round(games * winRate) }
}

/** A map's win rate is the sum of its own matrix, so a label can't disagree with the grid. */
export function mapStats(mode: ModeFilter, season: string, map: string): MatchupCell {
  const combos = raceCombos(teamSizeFor(mode))
  let games = 0
  let wins = 0
  for (const row of combos) {
    for (const col of combos) {
      const cell = matchupCell(mode, season, map, row, col)
      games += cell.games
      wins += cell.wins
    }
  }
  return { games, wins }
}
