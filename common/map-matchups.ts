/**
 * The fewest decided games a matchup (or race composition) needs on a map before its winrate is
 * shown. Below this, a winrate says more about who happened to play than about the map.
 */
export const MIN_DECIDED_GAMES_FOR_WINRATE = 20

/**
 * Decided matchmaking games on a map for one matchup. `matchup` is a canonical matchup string
 * (each team's races sorted, then the teams sorted, e.g. `p-z` or `pt-tz`); `leftWins` and
 * `rightWins` count wins for the team before and after the `-`. Mirror matchups (`p-p`) have no
 * sides, so both are 0 for them.
 */
export interface MapMatchupCounts {
  matchup: string
  games: number
  leftWins: number
  rightWins: number
}

/** A matchup's winrate from each side, or undefined when it has too few games for one. */
export function matchupWinRates(
  counts: MapMatchupCounts,
  minGames = MIN_DECIDED_GAMES_FOR_WINRATE,
): { left: number; right: number } | undefined {
  const decided = counts.leftWins + counts.rightWins
  if (isMirrorMatchup(counts.matchup) || decided < minGames) {
    return undefined
  }
  return { left: counts.leftWins / decided, right: counts.rightWins / decided }
}

export function isMirrorMatchup(matchup: string): boolean {
  const [left, right] = matchup.split('-')
  return left === right
}

export interface CompositionWinRate {
  /** One team's sorted races, e.g. `pt`. */
  composition: string
  games: number
  wins: number
  /** Undefined when the composition has too few games for a winrate. */
  winRate: number | undefined
}

/**
 * Totals each race composition's record over every matchup it played on a map, as both sides of
 * each game. Mirror matchups are left out: both sides of a mirror game are the same composition,
 * so counting them would only pull every composition toward 50%.
 *
 * Sorted by winrate (best first, compositions without one last), then by games.
 */
export function compositionWinRates(
  rows: ReadonlyArray<MapMatchupCounts>,
  minGames = MIN_DECIDED_GAMES_FOR_WINRATE,
): CompositionWinRate[] {
  const totals = new Map<string, { games: number; wins: number }>()
  const add = (composition: string, games: number, wins: number) => {
    const total = totals.get(composition) ?? { games: 0, wins: 0 }
    total.games += games
    total.wins += wins
    totals.set(composition, total)
  }

  for (const row of rows) {
    if (isMirrorMatchup(row.matchup)) {
      continue
    }
    const [left, right] = row.matchup.split('-')
    const decided = row.leftWins + row.rightWins
    add(left, decided, row.leftWins)
    add(right, decided, row.rightWins)
  }

  return Array.from(totals, ([composition, { games, wins }]) => ({
    composition,
    games,
    wins,
    winRate: games >= minGames ? wins / games : undefined,
  })).sort(
    (a, b) =>
      (b.winRate ?? -1) - (a.winRate ?? -1) ||
      b.games - a.games ||
      a.composition.localeCompare(b.composition),
  )
}
