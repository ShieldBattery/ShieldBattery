import { MATCHMAKING_MODES, MatchmakingType } from '../../../common/matchmaking'
import { MatchupRecordData } from '../matchup-rows'

/**
 * Constructed matchup records for the user stats dev page, in the shape the GraphQL queries
 * return. A single season is roughly a third of the all-season totals.
 */

type Records = ReadonlyArray<MatchupRecordData>

function record(races: string, opponentRaces: string, wins: number, losses: number) {
  return { races, opponentRaces, wins, losses }
}

/** Every pair of sides once, then mirrored, the way the ladder counts both sides of each game. */
function bothSides(records: Records): Records {
  return records.flatMap(r =>
    r.races === r.opponentRaces ? [r] : [r, record(r.opponentRaces, r.races, r.losses, r.wins)],
  )
}

const PLAYER: Record<number, Records> = {
  // A Protoss main with some off-racing, including a matchup with very few games.
  1: [
    record('p', 'z', 142, 109),
    record('p', 't', 98, 101),
    record('p', 'p', 61, 47),
    record('z', 't', 3, 1),
  ],
  // Long tail of team compositions, more than fit before "Show all".
  2: [
    record('pz', 'pt', 41, 30),
    record('pz', 'zz', 28, 31),
    record('pz', 'tz', 22, 15),
    record('pt', 'pz', 18, 19),
    record('pz', 'pz', 14, 12),
    record('pz', 'tt', 9, 4),
    record('pp', 'zz', 2, 1),
  ],
  3: [record('ptz', 'ptz', 21, 18), record('ptz', 'ppz', 16, 11), record('ppz', 'tzz', 9, 12)],
}

const LADDER: Record<number, Records> = {
  1: bothSides([
    record('p', 'z', 10_412, 9_877),
    record('p', 't', 8_841, 9_203),
    record('t', 'z', 9_960, 9_610),
    record('p', 'p', 4_022, 4_022),
    record('t', 't', 3_310, 3_310),
    record('z', 'z', 5_190, 5_190),
  ]),
  2: bothSides([
    record('pt', 'pz', 1_204, 1_150),
    record('pz', 'zz', 990, 1_020),
    record('pz', 'tz', 880, 801),
    record('pt', 'zz', 640, 700),
    record('pz', 'pz', 610, 610),
    record('pz', 'tt', 402, 377),
    record('pp', 'zz', 11, 7),
  ]),
  3: bothSides([
    record('ptz', 'ptz', 310, 310),
    record('ppz', 'ptz', 140, 166),
    record('ppz', 'tzz', 51, 60),
  ]),
}

function forSeason(records: Records, seasonId: number | undefined): Records {
  if (seasonId === undefined) {
    return records
  }
  return records
    .map(r => record(r.races, r.opponentRaces, Math.round(r.wins / 3), Math.round(r.losses / 3)))
    .filter(r => r.wins + r.losses > 0)
}

export function devPlayerMatchups(type: MatchmakingType, seasonId: number | undefined): Records {
  return forSeason(PLAYER[MATCHMAKING_MODES[type].teamSize] ?? [], seasonId)
}

export function devLadderMatchups(type: MatchmakingType, seasonId: number | undefined): Records {
  return forSeason(LADDER[MATCHMAKING_MODES[type].teamSize] ?? [], seasonId)
}
