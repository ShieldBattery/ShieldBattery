/**
 * The fewest games the ladder needs in a matchup before its winrate is shown beside a player's.
 * Below this, the ladder's rate says more about who happened to play than about the matchup.
 */
export const MIN_LADDER_GAMES_FOR_WINRATE = 20

/**
 * A record in one matchup, as served: `races` against `opponentRaces`, each one team's races
 * sorted (e.g. `p`, `pt`).
 */
export interface MatchupRecordData {
  races: string
  opponentRaces: string
  wins: number
  losses: number
}

/** Whose records a matchups list shows. */
export type MatchupScope = 'player' | 'ladder'

export interface MatchupRow {
  races: string
  opponentRaces: string
  games: number
  /** Undefined for the record of a whole ladder's mirror games, which is always even. */
  wins?: number
  losses?: number
  /** Undefined when there's no winrate to show (a ladder mirror). */
  winRate?: number
  /** The whole ladder's winrate from the same side, when it's shown beside a player's. */
  ladderWinRate?: number
}

export function isMirror(record: Pick<MatchupRecordData, 'races' | 'opponentRaces'>): boolean {
  return record.races === record.opponentRaces
}

function ladderRates(ladder: ReadonlyArray<MatchupRecordData>): Map<string, number> {
  const rates = new Map<string, number>()
  for (const r of ladder) {
    const games = r.wins + r.losses
    if (!isMirror(r) && games >= MIN_LADDER_GAMES_FOR_WINRATE) {
      rates.set(`${r.races}-${r.opponentRaces}`, r.wins / games)
    }
  }
  return rates
}

/**
 * A player's matchups, most played first, each beside the ladder's winrate from the same side
 * (where the ladder has enough games for one). A player's mirror record is their own, so it's shown
 * like any other.
 */
export function playerMatchupRows(
  player: ReadonlyArray<MatchupRecordData>,
  ladder: ReadonlyArray<MatchupRecordData>,
): MatchupRow[] {
  const rates = ladderRates(ladder)
  return player
    .map(r => {
      const games = r.wins + r.losses
      return {
        races: r.races,
        opponentRaces: r.opponentRaces,
        games,
        wins: r.wins,
        losses: r.losses,
        winRate: games > 0 ? r.wins / games : undefined,
        ladderWinRate: rates.get(`${r.races}-${r.opponentRaces}`),
      }
    })
    .sort(byGames)
}

/**
 * The ladder's matchups, most played first. The ladder counts every game from both sides, so each
 * pair of sides is listed once, from the side that sorts first (`p` against `z`, not also `z`
 * against `p`). A mirror's record is even by construction, so it only carries its game count:
 * each mirror game added one win and one loss to its row.
 */
export function ladderMatchupRows(ladder: ReadonlyArray<MatchupRecordData>): MatchupRow[] {
  return ladder
    .filter(r => r.races <= r.opponentRaces)
    .map(r => {
      if (isMirror(r)) {
        return { races: r.races, opponentRaces: r.opponentRaces, games: r.wins }
      }
      const games = r.wins + r.losses
      return {
        races: r.races,
        opponentRaces: r.opponentRaces,
        games,
        wins: r.wins,
        losses: r.losses,
        winRate: games >= MIN_LADDER_GAMES_FOR_WINRATE ? r.wins / games : undefined,
      }
    })
    .sort(byGames)
}

function byGames(a: MatchupRow, b: MatchupRow): number {
  return (
    b.games - a.games ||
    a.races.localeCompare(b.races) ||
    a.opponentRaces.localeCompare(b.opponentRaces)
  )
}
