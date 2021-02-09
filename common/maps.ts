import { assertUnreachable } from './assert-unreachable'

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

export const SORT_BY_NAME = 0
export const SORT_BY_NUM_OF_PLAYERS = 1
export const SORT_BY_DATE = 2

export interface MapInfo {
  id: string
  hash: string
  name: string
  description: string
  uploadedBy: {
    id: number
    name: string
  }
  uploadDate: string
  visibility: string // TODO(tec27): this is an enum, need to determine values
  mapData: {
    format: string // TODO(tec27): can probably treat this as a string enum
    tileset: Tileset
    originalName: string
    originalDescription: string
    slots: number
    umsSlots: number
    // TODO(tec27): type the umsForces/players properly
    umsForces: Array<{ teamId: number; name: string; players: unknown[] }>
    width: number
    height: number
  }
  isFavorited: boolean
  mapUrl: string
  image256Url: string
  image512Url: string
  image1024Url: string
  image2048Url: string
}
