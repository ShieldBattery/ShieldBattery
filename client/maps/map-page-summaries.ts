import { ALL_MATCHMAKING_TYPES, MatchmakingType } from '../../common/matchmaking'

/** How a UMS map's forces split its human players, plus how many computer slots it has. */
export interface ForceLayout {
  /** The number of human players in each force that has any, in force order. */
  teams: number[]
  computers: number
}

/**
 * Returns how a UMS map's forces split its players, or undefined when that says nothing the player
 * count doesn't already: a single force of humans with no computers.
 */
export function umsForceLayout(
  forces: ReadonlyArray<{ players: ReadonlyArray<{ isComputer: boolean }> }>,
): ForceLayout | undefined {
  const teams: number[] = []
  let computers = 0
  for (const force of forces) {
    let humans = 0
    for (const player of force.players) {
      if (player.isComputer) {
        computers += 1
      } else {
        humans += 1
      }
    }
    if (humans > 0) {
      teams.push(humans)
    }
  }

  return teams.length > 1 || (teams.length === 1 && computers > 0)
    ? { teams, computers }
    : undefined
}

/** The matchmaking types a map has matchup results in, with the seasons each type has them for. */
export interface MatchupTypeSeasons {
  type: MatchmakingType
  /** Newest first. */
  seasonIds: number[]
}

/**
 * Groups a map's matchup seasons by matchmaking type, in the canonical matchmaking type order, each
 * with its seasons newest first.
 */
export function groupMatchupSeasons(
  seasons: ReadonlyArray<{ seasonId: number; matchmakingType: MatchmakingType }>,
): MatchupTypeSeasons[] {
  const byType = new Map<MatchmakingType, Set<number>>()
  for (const { seasonId, matchmakingType } of seasons) {
    let seasonIds = byType.get(matchmakingType)
    if (!seasonIds) {
      seasonIds = new Set()
      byType.set(matchmakingType, seasonIds)
    }
    seasonIds.add(seasonId)
  }

  return ALL_MATCHMAKING_TYPES.filter(type => byType.has(type)).map(type => ({
    type,
    seasonIds: Array.from(byType.get(type)!).sort((a, b) => b - a),
  }))
}

/**
 * Returns each week's total games scaled against the busiest week (0 to 1), for drawing the weeks
 * as bars. All zeros when no week has any games.
 */
export function weeklyBarHeights(weeks: ReadonlyArray<number>): number[] {
  const max = Math.max(0, ...weeks)
  return weeks.map(games => (max > 0 ? games / max : 0))
}
