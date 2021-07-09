import { assertUnreachable } from './assert-unreachable'
import { Jsonify } from './json'
import { RaceChar } from './races'

export enum Tileset {
  // NOTE(tec27): These are ordered to match their int values ingame
  Badlands,
  Platform,
  Installation,
  Ashworld,
  Jungle,
  Desert,
  Ice,
  Twilight,
}

export const ALL_TILESETS: Readonly<number[]> = [0, 1, 2, 3, 4, 5, 6, 7]

export function tilesetToName(tileset: Tileset) {
  switch (tileset) {
    case Tileset.Badlands:
      return 'Badlands'
    case Tileset.Platform:
      return 'Space platform'
    case Tileset.Installation:
      return 'Installation'
    case Tileset.Ashworld:
      return 'Ashworld'
    case Tileset.Jungle:
      return 'Jungle world'
    case Tileset.Desert:
      return 'Desert'
    case Tileset.Ice:
      return 'Ice'
    case Tileset.Twilight:
      return 'Twilight'
    default:
      return assertUnreachable(tileset)
  }
}

export enum MapSortType {
  Name = 0,
  NumberOfPlayers = 1,
  Date = 2,
}
export const ALL_MAP_SORT_TYPES: Readonly<MapSortType[]> = [
  MapSortType.Name,
  MapSortType.NumberOfPlayers,
  MapSortType.Date,
]

export enum MapVisibility {
  Private = 'PRIVATE',
  Public = 'PUBLIC',
  Official = 'OFFICIAL',
}
export const ALL_MAP_VISIBILITIES: Readonly<MapVisibility[]> = Object.values(MapVisibility)

export interface MapFilters {
  numPlayers: Array<2 | 3 | 4 | 5 | 6 | 7 | 8>
  tileset: Tileset[]
}

export type MapExtension = 'scx' | 'scm'
export const ALL_MAP_EXTENSIONS: Readonly<MapExtension[]> = ['scx', 'scm']

export interface MapForcesPlayer {
  id: number
  race: 'any' | RaceChar
  // TODO(tec27): Make an enum for these types
  typeId: number
  computer: boolean
}

export interface MapForces {
  name: string
  teamId: number
  players: MapForcesPlayer[]
}

export interface MapInfo {
  id: string
  hash: string
  name: string
  description: string
  // TODO(tec27): Just pass back the user ID in here, let our typical user pattern handle converting
  // that to a name and such
  uploadedBy: {
    id: number
    name: string
  }
  uploadDate: Date
  visibility: MapVisibility
  mapData: {
    format: MapExtension
    tileset: Tileset
    originalName: string
    originalDescription: string
    slots: number
    umsSlots: number
    umsForces: MapForces[]
    width: number
    height: number
  }
  isFavorited: boolean
  mapUrl?: string
  image256Url?: string
  image512Url?: string
  image1024Url?: string
  image2048Url?: string
}

export type MapInfoJson = Jsonify<MapInfo>

export function toMapInfoJson(mapInfo: MapInfo): MapInfoJson {
  return {
    ...mapInfo,
    uploadDate: Number(mapInfo.uploadDate),
  }
}
