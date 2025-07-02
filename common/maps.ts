import { TFunction } from 'i18next'
import { Immutable } from 'immer'
import { Tagged } from 'type-fest'
import { assertUnreachable } from './assert-unreachable'
import { GameType } from './games/game-type'
import { Jsonify } from './json'
import { RaceChar } from './races'
import { MapVisibility } from './typeshare'
import { SbUser } from './users/sb-user'
import { SbUserId } from './users/sb-user-id'

export const MAX_MAP_FILE_SIZE_BYTES = 100 * 1024 * 1024 // 100MB

export const MAP_LIST_LIMIT = 40

export type SbMapId = Tagged<string, 'SbMapId'>

/**
 * Converts a map ID string into a properly typed version. Alternative methods of retrieving an
 * SbMapId should be preferred, such as using a value retrieved from the database, or getting one
 * via the common Joi validator.
 */
export function makeSbMapId(id: string): SbMapId {
  return id as SbMapId
}

export enum Tileset {
  // NOTE(tec27): These are ordered to match their int values ingame
  Badlands = 0,
  Platform,
  Installation,
  Ashworld,
  Jungle,
  Desert,
  Ice,
  Twilight,
}

export const ALL_TILESETS: ReadonlyArray<Tileset> = [
  Tileset.Badlands,
  Tileset.Platform,
  Tileset.Installation,
  Tileset.Ashworld,
  Tileset.Jungle,
  Tileset.Desert,
  Tileset.Ice,
  Tileset.Twilight,
]

export function tilesetToName(tileset: Tileset, t: TFunction) {
  switch (tileset) {
    case Tileset.Badlands:
      return t('maps.tileset.badlands', 'Badlands')
    case Tileset.Platform:
      return t('maps.tileset.spacePlatform', 'Space platform')
    case Tileset.Installation:
      return t('maps.tileset.installation', 'Installation')
    case Tileset.Ashworld:
      return t('maps.tileset.ashworld', 'Ashworld')
    case Tileset.Jungle:
      return t('maps.tileset.jungleWorld', 'Jungle world')
    case Tileset.Desert:
      return t('maps.tileset.desert', 'Desert')
    case Tileset.Ice:
      return t('maps.tileset.ice', 'Ice')
    case Tileset.Twilight:
      return t('maps.tileset.twilight', 'Twilight')
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

export function mapSortTypeToLabel(sortType: MapSortType, t: TFunction) {
  switch (sortType) {
    case MapSortType.Name:
      return t('maps.server.sortMaps.option.name', 'Name')
    case MapSortType.NumberOfPlayers:
      return t('maps.server.sortMaps.option.numberOfPlayers', 'Number of players')
    case MapSortType.Date:
      return t('maps.server.sortMaps.option.dateUploaded', 'Date uploaded')
    default:
      return sortType satisfies never
  }
}

export { MapVisibility }
export const ALL_MAP_VISIBILITIES: Readonly<MapVisibility[]> = Object.values(MapVisibility)

export type NumPlayers = 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface MapFilters {
  numPlayers: NumPlayers[]
  tileset: Tileset[]
}

export type MapExtension = 'scx' | 'scm'
export const ALL_MAP_EXTENSIONS: Readonly<MapExtension[]> = ['scx', 'scm']

export type MapForcePlayerRace = 'any' | RaceChar

export interface MapForcePlayer {
  id: number
  race: MapForcePlayerRace
  // TODO(tec27): Make an enum for these types
  typeId: number
  computer: boolean
}

export interface MapForce {
  name: string
  teamId: number
  players: MapForcePlayer[]
}

export interface MapData {
  format: MapExtension
  tileset: Tileset
  originalName: string
  originalDescription: string
  slots: number
  umsSlots: number
  umsForces: MapForce[]
  width: number
  height: number
  isEud: boolean
  parserVersion: number
}

export interface MapInfo {
  id: SbMapId
  hash: string
  name: string
  description: string
  uploadedBy: SbUserId
  uploadDate: Date
  visibility: MapVisibility
  mapData: MapData
  mapUrl?: string
  image256Url?: string
  image512Url?: string
  image1024Url?: string
  image2048Url?: string
  imageVersion: number
}

export type MapInfoJson = Jsonify<MapInfo>

export function toMapInfoJson(mapInfo: MapInfo): MapInfoJson {
  return {
    ...mapInfo,
    uploadDate: Number(mapInfo.uploadDate),
  }
}

/** Returns the number of teams for a map/game type. */
export function numTeams(
  gameType: GameType,
  gameSubType: number,
  umsForces: Immutable<MapForce[]>,
): number {
  switch (gameType) {
    case GameType.Melee:
    case GameType.FreeForAll:
    case GameType.OneVsOne:
      return 1
    case GameType.TopVsBottom:
      return 2
    case GameType.TeamMelee:
    case GameType.TeamFreeForAll:
      return gameSubType
    case GameType.UseMapSettings:
      return umsForces.length
    default:
      return assertUnreachable(gameType)
  }
}

/**
 * Returns a list of labels for each of the teams for a map/game type. List will be empty if there
 * aren't any teams.
 */
export function getTeamNames(
  {
    gameType,
    gameSubType,
    umsForces,
  }: {
    gameType: GameType
    gameSubType: number
    umsForces: Immutable<MapForce[]>
  },
  t?: TFunction,
): string[] {
  switch (gameType) {
    case GameType.Melee:
    case GameType.FreeForAll:
    case GameType.OneVsOne:
      return []
    case GameType.TopVsBottom:
      return [
        t ? t('game.teamName.top', 'Top') : 'Top',
        t ? t('game.teamName.bottom', 'Bottom') : 'Bottom',
      ]
    case GameType.TeamMelee:
    case GameType.TeamFreeForAll: {
      const teamNames = []
      const amount = numTeams(gameType, gameSubType, umsForces)
      for (let i = 1; i <= amount; i++) {
        teamNames.push(
          t
            ? t('game.teamName.number', {
                defaultValue: 'Team {{teamNumber}}',
                teamNumber: i,
              })
            : `Team ${i}`,
        )
      }
      return teamNames
    }
    case GameType.UseMapSettings:
      return umsForces.map(f => f.name)
    default:
      return assertUnreachable(gameType)
  }
}

/**
 * Filters out unprintable characters used for color codes in BW (we don't utilize these in our
 * client, and they just show up as tofu).
 */
export function filterColorCodes(str: string): string {
  return Array.from(str)
    .filter(c => {
      const code = c.charCodeAt(0)
      return (
        code > 0x1f ||
        /** newline */
        code === 0x0a ||
        /** carriage return */
        code === 0x0d
      )
    })
    .join('')
}

export interface UploadMapResponse {
  map: MapInfoJson
  users: SbUser[]
}

export interface GetMapsResponse {
  maps: MapInfoJson[]
  hasMoreMaps: boolean
  users: SbUser[]
}

export interface GetFavoritesResponse {
  favoritedMaps: MapInfoJson[]
  users: SbUser[]
}

export interface GetBatchMapInfoResponse {
  maps: MapInfoJson[]
  favoritedMaps: SbMapId[]
  users: SbUser[]
}

export interface UpdateMapServerRequest {
  name?: string
  description?: string
}

export interface UpdateMapResponse {
  map: MapInfoJson
  users: SbUser[]
}
