/**
 * Types for the app's index of the map files in the user's StarCraft map folders (the "On this PC"
 * maps), shared between the app's indexing worker and the renderer.
 */

/** The map folders the app indexes, by the key their files' folders start with. */
export enum LocalMapRoot {
  /** The `Maps` folder of the StarCraft install. */
  Install = 'install',
  /** `Documents\StarCraft\maps`, where maps downloaded from battle.net lobbies also land. */
  Documents = 'documents',
}

export const ALL_LOCAL_MAP_ROOTS: ReadonlyArray<LocalMapRoot> = Object.values(LocalMapRoot)

/** The path the app serves local map files' images under, followed by the file's hash. */
export const LOCAL_MAP_IMAGE_PATH_PREFIX = '/local-map-image/'

/**
 * The URL of the image of the local map file with this hash, rendered by the app from the
 * StarCraft install. Only the app serves these; the request fails if the image can't be made.
 */
export function localMapImageUrl(hash: string): string {
  return `shieldbattery://app${LOCAL_MAP_IMAGE_PATH_PREFIX}${hash}`
}

/** Whether a map is meant for melee games or has its own Use Map Settings rules. */
export enum LocalMapKind {
  Melee = 'melee',
  Ums = 'ums',
}

/** A map file in one of the indexed folders. */
export interface LocalMapFile {
  id: number
  /** The file's absolute path. */
  path: string
  /**
   * The file's folder: its root's key, then the folders below that root, `/`-separated (e.g.
   * `documents/Download/UMS`).
   */
  folder: string
  fileName: string
  /** Last modified time, in milliseconds since the epoch. */
  fileMtime: number
  fileSize: number
  /**
   * The hex-encoded SHA-256 of the file's lowercase extension followed by its contents, which is
   * how the server identifies map files (`MapFile.id` is the same hash, base64-encoded). Unset if
   * the file couldn't be read.
   */
  hash?: string
  /** What the file says about itself. Unset if it couldn't be read as a map. */
  map?: LocalMapInfo
}

/** The facts read from a map file. */
export interface LocalMapInfo {
  /** The map's own name, with color codes removed. Empty if the map doesn't set one. */
  name: string
  /** Width in tiles. */
  width: number
  /** Height in tiles. */
  height: number
  tileset: number
  kind: LocalMapKind
  /** The player slots for the map's kind. */
  playerCount: number
  isEud: boolean
}

/** Size classes by the larger of a map's width and height, matching the server's `MapSizeClass`. */
export enum LocalMapSize {
  /** Up to 64. */
  Tiny = 'tiny',
  /** 65 to 96. */
  Small = 'small',
  /** 97 to 128. */
  Medium = 'medium',
  /** 129 to 192. */
  Large = 'large',
  /** Larger than 192. */
  Huge = 'huge',
}

export enum LocalMapSort {
  Name = 'name',
  Players = 'players',
  /** Most recently modified file first (for most files, when it was added to the folder). */
  Newest = 'newest',
}

export interface LocalMapQuery {
  /** Text to find in map names and file names. Case and punctuation are ignored. */
  search?: string
  /** Only maps of this kind. */
  kind?: LocalMapKind
  /** Exact player counts to include. */
  players?: number[]
  sizes?: LocalMapSize[]
  tilesets?: number[]
  /** `true` for only EUD maps, `false` to leave them out. */
  eud?: boolean
  /** Only maps in this folder, and with `recursive`, in the folders beneath it. */
  folder?: { path: string; recursive: boolean }
  sort: LocalMapSort
  offset: number
  limit: number
}

export interface LocalMapQueryResult {
  files: LocalMapFile[]
  /** How many files match the query across every page. */
  total: number
}

/** A folder holding map files, directly or at any depth below it. */
export interface LocalMapFolder {
  /** The folder's path, in the same form as `LocalMapFile.folder`. */
  path: string
  /** The folder's own name (its last path segment). */
  name: string
  /** How many map files are in this folder and the ones beneath it. */
  fileCount: number
}

export type LocalMapIndexProgress =
  | { phase: 'scanning' }
  | { phase: 'indexing'; done: number; total: number }

export interface LocalMapLibraryStatus {
  /** Number of map files in the index. */
  totalIndexed: number
  /** Present while files are being scanned or indexed. */
  progress?: LocalMapIndexProgress
  /** The folders being indexed, by root. */
  roots: Array<{ root: LocalMapRoot; path: string }>
}
