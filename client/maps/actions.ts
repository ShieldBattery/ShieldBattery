import {
  GetBatchMapInfoResponse,
  GetMapsResponse,
  MapSortType,
  MapVisibility,
  NumPlayers,
  SbMapId,
  Tileset,
  UpdateMapResponse,
  UpdateMapServerRequest,
  UploadMapResponse,
} from '../../common/maps'
import { BaseFetchFailure } from '../network/fetch-errors'

export type MapsActions =
  | UploadLocalMap
  | GetMaps
  | GetBatchMapInfoSuccess
  | GetBatchMapInfoFailure
  | AddToFavorites
  | RemoveFromFavorites
  | UpdateMapSuccess
/**
 * The server has returned the map that was uploaded.
 */
export interface UploadLocalMap {
  type: '@maps/uploadLocalMap'
  payload: UploadMapResponse
  meta: {
    path: string
  }
}

export interface GetMapsListParams {
  visibility: MapVisibility
  sort: MapSortType
  numPlayers: NumPlayers[]
  tileset: Tileset[]
  searchQuery: string
  offset: number
}

/**
 * The server has returned the list of maps with a particular visibility and other filters applied.
 */
export interface GetMaps {
  type: '@maps/getMaps'
  payload: GetMapsResponse
  meta: GetMapsListParams
}

/**
 * The server returned a response to our request for map info about one or more maps.
 */
export interface GetBatchMapInfoSuccess {
  type: '@maps/getBatchMapInfo'
  payload: GetBatchMapInfoResponse
  error?: false
}

export type GetBatchMapInfoFailure = BaseFetchFailure<'@maps/getBatchMapInfo'>

export interface AddToFavorites {
  type: '@maps/addToFavorites'
  payload: SbMapId
}

export interface RemoveFromFavorites {
  type: '@maps/removeFromFavorites'
  payload: SbMapId
}

/**
 * The server has updated the map.
 */
export interface UpdateMapSuccess {
  type: '@maps/updateMap'
  payload: UpdateMapResponse
  meta: UpdateMapServerRequest
}
