import { Immutable } from 'immer'
import { Simplify } from 'type-fest'
import { PreferenceData } from '../../../common/matchmaking'
import { RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user'
import { NEW_PLAYER_GAME_COUNT } from './constants'
import { MatchmakingRating } from './models'

export interface MatchmakingInterval {
  low: number
  high: number
}

export interface MatchmakingQueueData {
  /**
   * The current search interval for matchmaking, i.e. the lowest and highest rating that would be
   * considered a valid match.
   */
  interval: MatchmakingInterval
  /**
   * The number of search iterations this user has gone through (should be initialized to 0, will
   * be updated by the matchmaker).
   */
  searchIterations: number

  /**
   * The values the search interval was started with. This should be `undefined` initially, the
   * matchmaker will initialize the correct values.
   */
  startingInterval?: MatchmakingInterval
  /**
   * The maximum values the search interval will be increased to. This should be `undefined`
   * initially, the matchmaker will initialize the correct values.
   */
  maxInterval?: MatchmakingInterval
}

export interface MatchmakingPlayerData {
  /** The user's ID number (from the `users` table). */
  id: SbUserId
  /** The user's name. */
  name: string
  /** The race the user wants to play. */
  race: RaceChar
  /**
   * A list of maps that this player has selected when queueing for a match. Its meaning depends on
   * the matchmaking type and the system it's using. E.g. 1v1/2v2 might use this list as maps the
   * user has vetoed, while in 3v3 it might be used as as a list of maps that the user wants to
   * queue on.
   */
  mapSelections: ReadonlyArray<string>
  /**
   * The `data` field from `MatchmakingPreferences` that this user queued with, so that it can be
   * used to configure their race, etc. in the game setup process.
   */
  preferenceData: Readonly<PreferenceData>
  /** How many games this user has played (in the current MMR section). */
  numGamesPlayed: number
  /** The user's current MMR. */
  rating: number
}

export type MatchmakingPlayer = Simplify<MatchmakingPlayerData & MatchmakingQueueData>

export interface MatchmakingParty extends MatchmakingQueueData {
  players: MatchmakingPlayerData[]
  leaderId: SbUserId
  partyId: string
}

export type MatchmakingEntity = MatchmakingPlayer | MatchmakingParty

export function isNewPlayer(entity: MatchmakingEntity) {
  if (isMatchmakingParty(entity)) {
    for (const player of getPlayersFromEntity(entity)) {
      if (player.numGamesPlayed >= NEW_PLAYER_GAME_COUNT) {
        return false
      }
    }
    // Only count them as a new player if the whole party is new
    return true
  } else {
    return entity.numGamesPlayed >= NEW_PLAYER_GAME_COUNT
  }
}

export function matchmakingRatingToPlayerData({
  mmr,
  username,
  race,
  mapSelections,
  preferenceData,
}: {
  mmr: MatchmakingRating
  username: string
  race: RaceChar
  mapSelections: ReadonlyArray<string>
  preferenceData: PreferenceData
}): MatchmakingPlayerData {
  return {
    id: mmr.userId,
    name: username,
    race,
    mapSelections,
    preferenceData,
    numGamesPlayed: mmr.numGamesPlayed,
    rating: mmr.rating,
  }
}

export function isMatchmakingParty(entity: MatchmakingEntity): entity is MatchmakingParty {
  return 'players' in entity
}

export function* getPlayersFromEntity(entity: Immutable<MatchmakingEntity>) {
  if ('players' in entity) {
    yield* entity.players
  } else {
    yield entity
  }
}

export function getNumPlayersInEntity(entity: MatchmakingEntity): number {
  return isMatchmakingParty(entity) ? entity.players.length : 1
}

export function getMatchmakingEntityId(entity: Immutable<MatchmakingEntity>): SbUserId {
  return 'players' in entity ? entity.leaderId : entity.id
}
