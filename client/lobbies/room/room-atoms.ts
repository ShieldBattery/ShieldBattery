import { atom } from 'jotai'
import { SbMapId } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'

/** The lobby members who have marked themselves ready for the next game. */
export const readyUsersAtom = atom<ReadonlySet<SbUserId>>(new Set<SbUserId>())

/** One lobby member's seat on a finished game's roster. */
export interface LobbySeriesPlayer {
  readonly userId: SbUserId
  readonly race: RaceChar
}

/** One team's roster on a finished game, as it stood for that game. */
export interface LobbySeriesTeam {
  /** The team's display name at the time, e.g. `Top`. */
  readonly name?: string
  readonly players: ReadonlyArray<LobbySeriesPlayer>
}

/** A game the lobby has finished playing. */
export interface LobbySeriesGame {
  readonly gameId: string
  /** The map it was played on, which the lobby may well have moved off of since. */
  readonly mapId: SbMapId
  /** Index into this game's own `teams` of the team that won. */
  readonly winningTeamIndex: number
  readonly durationMs: number
  /**
   * Every team's roster and the race each of its players played that game. Both are kept
   * alongside the result because seats, races, and team makeup all move between games, so the
   * lobby's current layout can't describe a game that's already over.
   */
  readonly teams: ReadonlyArray<LobbySeriesTeam>
}

/** The lobby's finished games this session, oldest first. */
export const lobbySeriesAtom = atom<ReadonlyArray<LobbySeriesGame>>([])

/** Returns how many of a series' games each user won. */
export function getWinsByUser(games: ReadonlyArray<LobbySeriesGame>): Map<SbUserId, number> {
  const wins = new Map<SbUserId, number>()
  for (const game of games) {
    const winners = game.teams[game.winningTeamIndex]?.players ?? []
    for (const { userId } of winners) {
      wins.set(userId, (wins.get(userId) ?? 0) + 1)
    }
  }

  return wins
}
