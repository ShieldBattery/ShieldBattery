import { Jsonify } from '../json'
import { MapInfoJson, SbMapId } from '../maps'
import { MatchmakingType } from '../matchmaking'

export const MATCHMAKING_MAP_POOLS_LIMIT = 5

export interface MatchmakingMapPool {
  id: number
  matchmakingType: MatchmakingType
  maps: SbMapId[]
  maxVetoCount: number
  startDate: Date
}

export type MatchmakingMapPoolJson = Jsonify<MatchmakingMapPool>

export function toMatchmakingMapPoolJson(pool: MatchmakingMapPool): MatchmakingMapPoolJson {
  return {
    id: pool.id,
    matchmakingType: pool.matchmakingType,
    maps: pool.maps,
    maxVetoCount: pool.maxVetoCount,
    startDate: Number(pool.startDate),
  }
}

export function fromMatchmakingMapPoolJson(pool: MatchmakingMapPoolJson): MatchmakingMapPool {
  return {
    id: pool.id,
    matchmakingType: pool.matchmakingType,
    maps: pool.maps,
    maxVetoCount: pool.maxVetoCount,
    startDate: new Date(pool.startDate),
  }
}

export interface GetMatchmakingMapPoolResponse {
  pool: MatchmakingMapPoolJson
  mapInfos: MapInfoJson[]
}

export interface GetMatchmakingMapPoolsHistoryResponse {
  pools: MatchmakingMapPoolJson[]
  mapInfos: MapInfoJson[]
  hasMorePools: boolean
}

export interface CreateMatchmakingMapPoolRequest {
  maps: ReadonlyArray<SbMapId>
  maxVetoCount: number
  startDate: number
}

export interface CreateMatchmakingMapPoolResponse {
  pool: MatchmakingMapPoolJson
  mapInfos: MapInfoJson[]
}
