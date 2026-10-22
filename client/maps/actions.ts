import { GetGamesResponse } from '../../common/games/games'
import {
  GetBatchMapInfoResponse,
  GetMapsQueryParams,
  GetMapsResponse,
  MapInfoJson,
  SbMapId,
  UpdateMapResponse,
  UpdateMapServerRequest,
} from '../../common/maps'
import { SbUser } from '../../common/users/sb-user'
import { BaseFetchFailure } from '../network/fetch-errors'

export type MapsActions =
  | UploadMap
  | GetMaps
  | GetBatchMapInfoSuccess
  | GetBatchMapInfoFailure
  | AddToFavorites
  | RemoveFromFavorites
  | RemoveFromMyMaps
  | DelistMap
  | UpdateMapSuccess
  | LoadMapInfos
  | GetMapGames

/** A map that was just uploaded, along with the info needed to display it. */
export interface UploadedMap {
  map: MapInfoJson
  /** Contains the map's ID if it's in the current user's own maps. */
  libraryMapIds: SbMapId[]
  users: SbUser[]
}

/**
 * A map file was uploaded to the current user's own maps.
 */
export interface UploadMap {
  type: '@maps/uploadMap'
  payload: UploadedMap
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

/** The map has been removed from the current user's own maps. */
export interface RemoveFromMyMaps {
  type: '@maps/removeFromMyMaps'
  payload: SbMapId
}

/** The map has been taken out of the map listings. */
export interface DelistMap {
  type: '@maps/delistMap'
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
 * Loads multiple map infos directly. Useful if map infos are received from a source that doesn't
 * dispatch through redux.
 */
export interface LoadMapInfos {
  type: '@maps/loadMapInfos'
  payload: MapInfoJson[]
}

/** The server has returned a page of the games played on a map. */
export interface GetMapGames {
  type: '@maps/getMapGames'
  payload: GetGamesResponse
  error?: false
}
