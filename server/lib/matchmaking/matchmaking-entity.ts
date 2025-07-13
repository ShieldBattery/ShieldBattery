import { Immutable } from 'immer'
import { ReadonlyDeep, Simplify } from 'type-fest'
import { PreferenceData } from '../../../common/matchmaking'
import { RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ClientIdentifierString } from '../users/client-ids'
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
  id: SbUserId
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
  /** The user's client identifiers (used for smurf detection and matchmaking bans). */
  identifiers: ReadonlyDeep<ClientIdentifierString[]>
}

export type MatchmakingPlayer = Simplify<MatchmakingPlayerData & MatchmakingQueueData>

export type MatchmakingEntity = MatchmakingPlayer

export function isNewPlayer(entity: MatchmakingEntity) {
  return entity.numGamesPlayed >= NEW_PLAYER_GAME_COUNT
}

export function matchmakingRatingToPlayerData({
  mmr,
  race,
  mapSelections,
  preferenceData,
  identifiers,
}: {
  mmr: MatchmakingRating
  race: RaceChar
  mapSelections: ReadonlyArray<string>
  preferenceData: PreferenceData
  identifiers: ReadonlyArray<ClientIdentifierString>
}): MatchmakingPlayerData {
  return {
    id: mmr.userId,
    race,
    mapSelections,
    preferenceData,
    numGamesPlayed: mmr.numGamesPlayed,
    rating: mmr.rating,
    identifiers,
  }
}

export function* getPlayersFromEntity(entity: Immutable<MatchmakingEntity>) {
  yield entity
}

export function getNumPlayersInEntity(entity: MatchmakingEntity): number {
  return 1
}

export function getMatchmakingEntityId(entity: Immutable<MatchmakingEntity>): SbUserId {
  return entity.id
}
