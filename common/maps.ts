import { TFunction } from 'i18next'
import { Immutable } from 'immer'
import { ReadonlyDeep, Tagged } from 'type-fest'
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

/**
 * Lowercase, file/URL-safe identifiers for the tilesets that have dedicated preview art (e.g. the
 * team-color settings' minimap previews, `client/settings/game/team-color-preview.tsx`, and the
 * generator that renders them, `tools/gen-minimap-previews.ts`). Installation is excluded: it only
 * appears in the campaign and rare UMS maps, so no preview art is maintained for it.
 */
export type TilesetId = 'jungle' | 'badlands' | 'desert' | 'ice' | 'space' | 'twilight' | 'ashworld'

/** Every preview {@link TilesetId}, in the order they should be offered/cycled in the UI. */
export const ALL_TILESET_IDS: ReadonlyArray<TilesetId> = [
  'jungle',
  'badlands',
  'desert',
  'ice',
  'space',
  'twilight',
  'ashworld',
]

/**
 * Maps the numeric {@link Tileset} enum (matches BW's own in-game tileset ints, see the NOTE on
 * {@link Tileset}) to its {@link TilesetId}, or `undefined` for tilesets with no preview art
 * (Installation).
 */
export const TILESET_IDS: Readonly<Record<Tileset, TilesetId | undefined>> = {
  [Tileset.Badlands]: 'badlands',
  [Tileset.Platform]: 'space',
  [Tileset.Installation]: undefined,
  [Tileset.Ashworld]: 'ashworld',
  [Tileset.Jungle]: 'jungle',
  [Tileset.Desert]: 'desert',
  [Tileset.Ice]: 'ice',
  [Tileset.Twilight]: 'twilight',
}

/**
 * Flat fallback colors for each preview tileset, sampled from their terrain. Used before a real
 * minimap render exists yet, or if one fails to load -- see `TeamColorPreview` and
 * `tools/gen-minimap-previews.ts`, which both need the exact same values (the preview's CSS
 * fallback and the script's placeholder PNGs should be indistinguishable from each other).
 */
export const TILESET_PLACEHOLDER_COLORS: Readonly<Record<TilesetId, string>> = {
  jungle: '#081208',
  badlands: '#1b1310',
  desert: '#1a1206',
  ice: '#0c1218',
  space: '#05070d',
  twilight: '#0d0a14',
  ashworld: '#120a08',
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

export enum MapServiceErrorCode {
  /**
   * The map has no usable player slots: no start locations (which melee games seat players by)
   * and no active player slots in its force data (which UMS games use).
   */
  NoPlayerSlots = 'noPlayerSlots',
  /** The file couldn't be parsed as a map (corrupt, truncated, or not a map file at all). */
  InvalidMapFile = 'invalidMapFile',
}

export type NumPlayers = 2 | 3 | 4 | 5 | 6 | 7 | 8

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

/**
 * A start location placed for a player slot. `x` and `y` are in map pixels, and `slot` is the player
 * slot (0-7) the start location belongs to.
 */
export interface MapStartLocation {
  slot: number
  x: number
  y: number
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
  /** The map's start locations. Empty until the map file has been analyzed. */
  startLocations: MapStartLocation[]
  /**
   * Whether the map has UMS content: trigger actions that melee games don't use, more than 8
   * preplaced player-owned units, or EUDs. Undefined until the map file has been analyzed.
   */
  umsContent?: boolean
  parserVersion: number
}

export interface MapInfo {
  id: SbMapId
  hash: string
  name: string
  description: string
  /** The user who listed the map, if it's listed (`visibility` is not `Unlisted`). */
  publishedBy?: SbUserId
  publishedAt?: Date
  /** Where the map is listed. Unlisted maps are only reachable by id or from users' own maps. */
  visibility: MapVisibility
  mapData: MapData
  mapUrl?: string
  image256Url?: string
  image512Url?: string
  image1024Url?: string
  image2048Url?: string
  /** A 1024px JPEG of the map, for consumers that can't decode the other images' format. */
  jpegImageUrl?: string
  imageVersion: number
  /**
   * Whether the map's images have its start locations drawn in. Images without them are meant to
   * have start locations drawn on top.
   */
  imageSpawnsBaked: boolean
}

export type MapInfoJson = Jsonify<MapInfo>

export function toMapInfoJson(mapInfo: MapInfo): MapInfoJson {
  return {
    ...mapInfo,
    publishedAt: mapInfo.publishedAt ? Number(mapInfo.publishedAt) : undefined,
  }
}

/**
 * The subset of map info needed to render a map's image. Structurally satisfied by `MapInfoJson`,
 * and by narrower wire types that deliberately omit the rest (e.g. the unauthenticated lobby
 * summary's map).
 */
export interface MapImageInfo {
  name: string
  image256Url?: string
  image512Url?: string
  image1024Url?: string
  image2048Url?: string
  mapData: { width: number; height: number }
}

/**
 * Returns a `srcset` for a map's images. Images are rendered at a whole number of pixels per tile
 * (at most 32) that fits each size along the map's longest side, so they can be narrower than
 * their nominal size.
 */
export function mapImageSrcSet(map: ReadonlyDeep<MapImageInfo>): string {
  const { width, height } = map.mapData
  const longestSide = Math.max(width, height, 1)
  const sizes = [
    [256, map.image256Url],
    [512, map.image512Url],
    [1024, map.image1024Url],
    [2048, map.image2048Url],
  ] as const
  // Small maps reach the pixels-per-tile cap below the largest sizes, and a srcset can't repeat a
  // width
  const candidates = new Map<number, string>()
  for (const [size, url] of sizes) {
    const pixelsPerTile = Math.min(Math.max(Math.floor(size / longestSide), 1), 32)
    const imageWidth = width * pixelsPerTile
    if (url && !candidates.has(imageWidth)) {
      candidates.set(imageWidth, url)
    }
  }
  return Array.from(candidates, ([imageWidth, url]) => `${url} ${imageWidth}w`).join(', ')
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

export interface GetMapsQueryParams {
  visibility?: MapVisibility
  sort?: MapSortType
  numPlayers?: NumPlayers[]
  tilesets?: Tileset[]
  q?: string
  offset?: number
}

export type GetFavoritedMapsQueryParams = Omit<GetMapsQueryParams, 'visibility' | 'offset'>

export interface GetMapsResponse {
  maps: MapInfoJson[]
  hasMoreMaps: boolean
  /** The returned maps that are in the requesting user's own maps. */
  libraryMapIds: SbMapId[]
  users: SbUser[]
}

export interface GetFavoritesResponse {
  favoritedMaps: MapInfoJson[]
  /** The returned maps that are in the requesting user's own maps. */
  libraryMapIds: SbMapId[]
  users: SbUser[]
}

export interface GetBatchMapInfoResponse {
  maps: MapInfoJson[]
  favoritedMapIds: SbMapId[]
  /** The returned maps that are in the requesting user's own maps. */
  libraryMapIds: SbMapId[]
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
