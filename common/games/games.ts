import type { TFunction } from 'i18next'
import { Immutable } from 'immer'
import { assertUnreachable } from '../assert-unreachable'
import { Jsonify } from '../json'
import { ClientLeagueUserChangeJson, LeagueJson } from '../leagues/leagues'
import { MapInfoJson, SbMapId } from '../maps'
import {
  MatchmakingSeasonJson,
  PublicMatchmakingRatingChangeJson,
  matchmakingTypeToLabel,
} from '../matchmaking'
import { SbUser } from '../users/sb-user'
import { SbUserId } from '../users/sb-user-id'
import { GameConfig, GameSource } from './configuration'
import {
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
} from './game-filters'
import { MatchupString } from './matchups'
import { NetcodeV2RelayEvent } from './netcode-v2'
import { GameClientPlayerResult, ReconciledPlayerResult } from './results'

export const GET_GAMES_LIMIT = 40

/**
 * The maximum `offset` accepted by the paginated games list endpoints. Offset-based pagination has
 * to produce and sort every row up to the offset, so we cap it to keep a hand-crafted request from
 * forcing an unbounded amount of work (especially on the public games list). At `GET_GAMES_LIMIT`
 * per page this is still hundreds of pages deep, far past where anyone realistically scrolls.
 */
export const MAX_GAMES_OFFSET = 10000

export interface GameRecord {
  id: string
  startTime: Date
  mapId: SbMapId
  config: GameConfig
  disputable: boolean
  disputeRequested: boolean
  disputeReviewed: boolean
  gameLength: number | null
  results: [SbUserId, ReconciledPlayerResult][] | null
  selectedMatchup: MatchupString | null
  assignedMatchup: MatchupString | null
}

export type GameRecordJson = Jsonify<GameRecord>

export interface GameDebugInfo {
  reportedResults: Array<{
    userId: SbUserId
    reportedAt?: Date
    reportedResults?: {
      time: number
      playerResults: Array<[SbUserId, GameClientPlayerResult]>
    }
  }>
  /** All replays uploaded for this game. */
  replays?: GameReplayDebugInfo[]
  /** The netcode-v2 (rally-point2) coordinator session and relay-serving history, if any. */
  netcodeV2: {
    /** The coordinator session id persisted for this game, or `null` if it never had one. */
    session: number | null
    relays: NetcodeV2RelayEvent[]
  }
}

export interface GameReplayDebugInfo {
  /** The replay file ID. */
  id: string
  /** The user who uploaded this replay (from games_users, not replay_files.uploaded_by). */
  uploadedByUserId: SbUserId
  /** Signed URL for downloading this replay. */
  url: string
  /** SHA-256 hash of the replay file (hex-encoded), used for cache verification. */
  hash: string
  /** Duration in frames from replay header. */
  frames: number | null
}

export type GameDebugInfoJson = Jsonify<GameDebugInfo>

export function toGameDebugInfoJson(debugInfo: GameDebugInfo): GameDebugInfoJson {
  return {
    reportedResults: debugInfo.reportedResults.map(result => ({
      userId: result.userId,
      reportedAt: result.reportedAt ? Number(result.reportedAt) : undefined,
      reportedResults: result.reportedResults,
    })),
    replays: debugInfo.replays,
    netcodeV2: debugInfo.netcodeV2,
  }
}

export function toGameRecordJson(game: GameRecord): GameRecordJson {
  return {
    id: game.id,
    startTime: Number(game.startTime),
    mapId: game.mapId,
    config: game.config,
    disputable: game.disputable,
    disputeRequested: game.disputeRequested,
    disputeReviewed: game.disputeReviewed,
    gameLength: game.gameLength,
    results: game.results,
    selectedMatchup: game.selectedMatchup,
    assignedMatchup: game.assignedMatchup,
  }
}

export function getGameTypeLabel(game: Immutable<GameRecordJson>, t: TFunction): string {
  // TODO(tec27): show mode (UMS, Top v Bottom, etc.?)
  if (game.config.gameSource === GameSource.Lobby) {
    return t('game.gameSource.custom', 'Custom game')
  } else if (game.config.gameSource === GameSource.Matchmaking) {
    return t('game.gameSource.ranked', {
      defaultValue: `Ranked {{matchmakingType}}`,
      matchmakingType: matchmakingTypeToLabel(game.config.gameSourceExtra.type, t),
    })
  }

  return assertUnreachable(game.config)
}

/** Info about a replay file available for download/watching. */
export interface GameReplayInfo {
  /** The ID of the game this replay belongs to. */
  gameId: string
  /** Unique replay file ID, used as the cache key. */
  id: string
  /** Signed URL for downloading the replay. */
  url: string
  /** SHA-256 hash of the replay file (hex-encoded), used for cache verification. */
  hash: string
  /** The replay's generated base filename (from `generateReplayFilename`), without extension. */
  filename: string
}

export interface GetGameResponse {
  game: GameRecordJson
  /** Can be undefined if the map could not be found (e.g. if it has been deleted). */
  map: MapInfoJson | undefined
  users: SbUser[]
  mmrChanges: PublicMatchmakingRatingChangeJson[]
  /** Replay info for the best replay (if available and user has access). */
  replay?: GameReplayInfo
  debugInfo?: GameDebugInfoJson
}

export interface GetGamesQueryParams {
  duration?: GameDurationFilter
  mapName?: string
  playerName?: string
  format?: GameFormat
  matchup?: EncodedMatchupString
  sort?: GameSortOption
  offset?: number
}

export interface GetGamesResponse {
  games: GameRecordJson[]
  maps: MapInfoJson[]
  users: SbUser[]
  hasMoreGames: boolean
  replays: GameReplayInfo[]
}

/** Events that can be sent when subscribed to changes to a particular game record. */
export type GameSubscriptionEvent = GameRecordUpdate

export interface GameRecordUpdate {
  type: 'update'
  game: GameRecordJson
  mmrChanges: PublicMatchmakingRatingChangeJson[]
}

export interface MatchmakingResultsEvent {
  userId: SbUserId
  game: GameRecordJson
  mmrChange: PublicMatchmakingRatingChangeJson
  leagueChanges: ClientLeagueUserChangeJson[]
  leagues: LeagueJson[]
  season: MatchmakingSeasonJson
}

/**
 * Request to nullify the matchmaking/league points for a game (an admin action taken after an
 * actioned game report). Refunds points lost by everyone who played *except* the punished
 * player(s), for the current season only.
 */
export interface NullifyGamePointsRequest {
  /** The players to exclude from the refund (i.e. the punished player(s)). */
  punishedUserIds: SbUserId[]
}

export interface NullifyGamePointsResponse {
  /**
   * The players whose points were restored (matchmaking and/or league). Per-player amounts aren't
   * included since matchmaking and league points are separate currencies; the authoritative
   * breakdown lives in the `game_points_refunds` audit row.
   */
  refundedUsers: SbUserId[]
}

export function getGameDurationString(durationMs: number): string {
  const timeSec = Math.floor(durationMs / 1000)
  const hours = Math.floor(timeSec / 3600)
  const minutes = Math.floor(timeSec / 60) % 60
  const seconds = timeSec % 60

  return [hours, minutes, seconds]
    .map(v => ('' + v).padStart(2, '0'))
    .filter((v, i) => v !== '00' || i > 0)
    .join(':')
}
