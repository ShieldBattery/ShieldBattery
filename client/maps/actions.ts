import {
  GetBatchMapInfoResponse,
  GetFavoritedMapsQueryParams,
  GetFavoritesResponse,
  GetMapsQueryParams,
  GetMapsResponse,
  MapInfoJson,
  SbMapId,
  UpdateMapResponse,
  UpdateMapServerRequest,
  UploadMapResponse,
} from '../../common/maps'
import { BaseFetchFailure } from '../network/fetch-errors'

export type MapsActions =
  | UploadLocalMap
  | GetMaps
  | GetFavorites
  | GetBatchMapInfoSuccess
  | GetBatchMapInfoFailure
  | AddToFavorites
  | RemoveFromFavorites
  | UpdateMapSuccess
  | LoadMapInfo

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

/**
 * The server has returned the list of maps with a particular visibility and other filters applied.
 */
export interface GetMaps {
  type: '@maps/getMaps'
  payload: GetMapsResponse
  meta: GetMapsQueryParams
}

/**
 * The server has returned the list of favorited maps for the current user.
 */
export interface GetFavorites {
  type: '@maps/getFavoritedMaps'
  payload: GetFavoritesResponse
  meta: GetFavoritedMapsQueryParams
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

/**
 * Loads a map's info directly. Useful if map info is received from a source that doesn't dispatch
 * through redux.
 */
export interface LoadMapInfo {
  type: '@maps/loadMapInfo'
  payload: MapInfoJson
}
