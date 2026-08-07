import { ALL_MATCHMAKING_TYPES, MatchmakingType, TEAM_SIZES } from '../../../common/matchmaking'
import { raceCombos } from '../matchup-data'
import { MatchupModeData } from '../matchup-source'
import { FIXTURE_SEASONS, rng } from './fixtures'

/**
 * Constructed matchup buckets for the Matchups dev page.
 *
 * Produces the same shape `userMatchupStats` and `globalMatchupStats` return, so the page under
 * test is the page that ships.
 */

/**
 * Maps the matchup fixtures are spread across, standing in for a real season's pool.
 *
 * No `mapFile`, so the strip renders its no-image placeholder for every card. That's the honest
 * fixture: there are no real map images to point at without a server, and a placeholder that
 * keeps the card's size is exactly what a removed map file produces in the app.
 */
export const MATCHUP_MAPS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'map-fs', name: 'Fighting Spirit' },
  { id: 'map-cb', name: 'Circuit Breaker' },
  { id: 'map-po', name: 'Polypoid' },
]

/**
 * How much of a mode's matrix is left unplayed. A 1v1 player fills all nine cells sooner or
 * later, while a 3v3 player's 10x10 is mostly blanks -- the matrix is honest about that, so the
 * fixtures have to be too or the team layouts look denser here than they ever do in the app.
 */
const SPARSITY_BY_TEAM_SIZE: Readonly<Record<number, number>> = { 1: 0, 2: 0.25, 3: 0.55 }

/**
 * The band grid the fixtures spread across, matching the server's constants. Six of the fifteen
 * bands rather than all of them: an account plays inside a narrow rating window, so a fixture that
 * filled every band would make the range filter look like it does nothing.
 */
export const FIXTURE_RATING_BANDS = { size: 100, min: 1000, max: 2400 }
const FIXTURE_BANDS = [1400, 1500, 1600, 1700, 1800, 1900]

/**
 * Matchup buckets for one mode, shaped exactly as `userMatchupStats` returns them.
 *
 * Sides are built from `raceCombos`, the same function that lays out the axes, so a fixture
 * covers exactly the cells the matrix can draw and a team mode needs no separate generator.
 *
 * Deliberately uneven: some cells are heavily played, some sit under the thin-sample
 * threshold so their dimming is visible, and some are missing entirely so the empty cell
 * renders. A uniform matrix would hide all three.
 */
export function makeMatchupBuckets(seed: number, teamSize: number): MatchupModeData['buckets'] {
  const combos = raceCombos(teamSize)
  const sparsity = SPARSITY_BY_TEAM_SIZE[teamSize] ?? 0
  const buckets: Array<MatchupModeData['buckets'][number]> = []
  const r = rng(seed)

  for (const season of FIXTURE_SEASONS) {
    for (const map of MATCHUP_MAPS) {
      for (const races of combos) {
        for (const opponentRaces of combos) {
          // Solo has no sparsity, so one cell of one map is left unplayed by hand to keep a
          // blank in the 1v1 matrix.
          const blank =
            season.id === 1 &&
            map.id === 'map-po' &&
            races.join('') === 't'.repeat(teamSize) &&
            opponentRaces.join('') === 'p'.repeat(teamSize)
          if (blank || r() < sparsity) continue

          const games = 1 + Math.floor(r() * 14)
          buckets.push({
            seasonId: season.id,
            mapId: map.id,
            races,
            opponentRaces,
            ratingBand: FIXTURE_BANDS[Math.floor(r() * FIXTURE_BANDS.length)],
            games,
            // Win rates between 30% and 75%, so the cell tinting spans both directions.
            wins: Math.round(games * (0.3 + r() * 0.45)),
          })
        }
      }
    }
  }
  return buckets
}

/**
 * A matchup payload for one mode, seeded off the mode itself so switching modes on the dev page
 * shows different data and the same mode always shows the same data.
 *
 * Both scopes have the same shape -- `globalMatchupStats` returns the same buckets and maps as the
 * per-user query -- so the scope only changes the seed. Global games are scaled up, since every
 * game there is counted once per participant across the whole ladder.
 */
export function makeMatchupMode(
  type: MatchmakingType,
  scope: 'mine' | 'global' = 'mine',
): MatchupModeData {
  const seed = ALL_MATCHMAKING_TYPES.indexOf(type) * 977 + 31 + (scope === 'global' ? 5000 : 0)
  const buckets = makeMatchupBuckets(seed, TEAM_SIZES[type])
  if (scope === 'mine') {
    return { buckets, maps: MATCHUP_MAPS }
  }
  return {
    buckets: buckets.map(b => ({ ...b, games: b.games * 37, wins: b.wins * 37 })),
    maps: MATCHUP_MAPS,
  }
}
