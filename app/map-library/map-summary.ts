import { summarizeMapJson } from '@shieldbattery/broodmap'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { LocalMapInfo, LocalMapKind } from '../../common/map-library'
import { MAX_MAP_FILE_SIZE_BYTES } from '../../common/maps'

/**
 * Reading a local map file's facts, and ShieldBattery's rules for them (whether it's a melee or UMS
 * map, how many players it seats). The rules must match the server's (`server-rs/src/maps/parse.rs`
 * and the `kind`/`player_count` columns of `maps`), so a local file filters and reads the same as
 * the uploaded copy of it would.
 */

/** What broodmap's `summarizeMapJson` returns (see its README). */
export interface BroodmapMapSummary {
  name: string | null
  description: string | null
  width: number
  height: number
  tileset: number
  stringEncoding: string
  players: Array<{ controller: number; race: number; force: number }>
  forces: Array<{ name: string | null }>
  usesEud: boolean
  triggerActionKinds: string[] | null
  triggerCount: number | null
  placedUnits: number
  playerUnits: number
  startLocations: number
}

/** More preplaced player-owned units than this make a map UMS. */
const MAX_MELEE_PLAYER_UNITS = 8
/** The `OWNR` controller value of a human slot; the other active values (1-7) are computers. */
const HUMAN_CONTROLLER = 6
const FORCE_COUNT = 4

/**
 * Trigger actions that fit a melee map: the default melee triggers plus what tournament melee maps
 * commonly add. Any other action makes a map UMS. EUD death counts are caught by the EUD check.
 */
const MELEE_COMPATIBLE_ACTIONS: ReadonlySet<string> = new Set([
  'NoAction',
  'Victory',
  'Defeat',
  'PreserveTrigger',
  'Wait',
  'PlaySound',
  'DisplayTextMessage',
  'SetMissionObjectives',
  'RunAiScript',
  'SetAlliance',
  'ModifyResources',
  'Comment',
  'RemoveUnit',
  'RemoveUnitAtLocation',
  'SetDeaths',
])

const MIB = 1024 * 1024
/**
 * The resource limits the server reads uploaded maps with (`parse_limits` in server-rs): broodmap's
 * defaults, with room for the largest CHK seen in a real map.
 */
const SUMMARY_OPTIONS = JSON.stringify({
  maxMapBytes: MAX_MAP_FILE_SIZE_BYTES,
  maxMpqFileBytes: 256 * MIB,
  maxChkBytes: 256 * MIB,
  maxMergedChunkBytes: 256 * MIB,
})

/**
 * Hashes a map file the way the server identifies map files: the hex-encoded SHA-256 of its
 * lowercase extension followed by its contents.
 */
export function hashMapBytes(filePath: string, bytes: Uint8Array): string {
  return createHash('sha256')
    .update(path.win32.extname(filePath).slice(1).toLowerCase())
    .update(bytes)
    .digest('hex')
}

/** Reads a map file's facts. Throws if `bytes` isn't a readable map. */
export function readMapSummary(bytes: Uint8Array): BroodmapMapSummary {
  return JSON.parse(summarizeMapJson(bytes, SUMMARY_OPTIONS)) as BroodmapMapSummary
}

/** Drops control characters (StarCraft's color codes) other than line breaks. */
export function filterColorCodes(text: string): string {
  return Array.from(text)
    .filter(c => c.codePointAt(0)! > 0x1f || c === '\n' || c === '\r')
    .join('')
}

/**
 * Whether a map has content beyond what melee games use (`ums_content` on the server): EUD triggers,
 * trigger actions melee maps don't use, or more preplaced player units than a melee start has. Such
 * maps are rendered with their units as placed.
 */
export function hasUmsContent(summary: BroodmapMapSummary): boolean {
  return (
    summary.usesEud ||
    (summary.triggerActionKinds ?? []).some(kind => !MELEE_COMPATIBLE_ACTIONS.has(kind)) ||
    summary.playerUnits > MAX_MELEE_PLAYER_UNITS
  )
}

/** Applies ShieldBattery's rules to a map's facts. */
export function toLocalMapInfo(summary: BroodmapMapSummary): LocalMapInfo {
  let playersMelee = 0
  let playersUms = 0
  for (const slot of summary.players) {
    if (slot.controller < 1 || slot.controller > 7) {
      continue
    }
    playersMelee += 1
    if (slot.controller === HUMAN_CONTROLLER && slot.force < FORCE_COUNT) {
      playersUms += 1
    }
  }

  const isUms = playersMelee < 2 || summary.usesEud || hasUmsContent(summary)

  let playerCount: number
  if (isUms) {
    playerCount = playersUms > 0 ? playersUms : playersMelee
  } else {
    playerCount = playersMelee > 0 ? playersMelee : playersUms
  }

  return {
    name: filterColorCodes(summary.name ?? ''),
    width: summary.width,
    height: summary.height,
    tileset: summary.tileset,
    kind: isUms ? LocalMapKind.Ums : LocalMapKind.Melee,
    playerCount,
    isEud: summary.usesEud,
  }
}

const ALNUM = /[\p{Alphabetic}\p{Nd}]/u

/**
 * Normalizes text for searching the way the server does (`normalize_search`): lowercased, every
 * run of characters that aren't letters or digits collapsed into one space, and trimmed.
 */
export function normalizeSearch(text: string): string {
  let out = ''
  let pendingSpace = false
  for (const c of text.toLowerCase()) {
    if (ALNUM.test(c)) {
      if (pendingSpace && out) {
        out += ' '
      }
      pendingSpace = false
      out += c
    } else {
      pendingSpace = true
    }
  }
  return out
}

/** Leading parenthesized prefixes (`(4)`), bracketed tags (`[EUD]`) and punctuation. */
const SORT_NAME_PREFIX = /^(?:\([^)]*\)|\[[^\]]*\]|[^\p{Alphabetic}\p{Nd}])+/u

/**
 * The name to sort by, matching the server's `sort_name`: without leading prefixes, tags and
 * punctuation, so `(4)Lights Out` sorts under L. Falls back to the full name if nothing is left.
 */
export function sortName(name: string): string {
  return name.replace(SORT_NAME_PREFIX, '') || name
}
