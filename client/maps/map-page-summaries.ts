import { GameType } from '../../common/games/game-type'
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

/**
 * The fewest lobby games a map needs before the game type it's usually played as is called out.
 * Below this, a split says more about who happened to host than about how the map is played.
 */
export const MIN_LOBBY_GAMES_FOR_USUAL_GAME_TYPE = 10

export interface UsualGameType {
  gameType: GameType
  /** The share of the map's lobby games played with `gameType`, from 0 to 1. */
  share: number
}

/**
 * Returns the game type a map's lobby games are usually played with, when that's worth pointing
 * out: some games use another type, or the usual one isn't the default for the map's kind (e.g. a
 * melee map mostly played as Top vs Bottom). Undefined when every game uses the default type or
 * there are too few games to say.
 */
export function usualGameType(
  counts: ReadonlyArray<{ gameType: GameType; games: number }>,
  defaultGameType: GameType,
  minGames = MIN_LOBBY_GAMES_FOR_USUAL_GAME_TYPE,
): UsualGameType | undefined {
  let total = 0
  let top: { gameType: GameType; games: number } | undefined
  for (const count of counts) {
    total += count.games
    if (!top || count.games > top.games) {
      top = count
    }
  }

  if (!top || total < minGames) {
    return undefined
  }
  const share = top.games / total
  return share < 1 || top.gameType !== defaultGameType
    ? { gameType: top.gameType, share }
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
