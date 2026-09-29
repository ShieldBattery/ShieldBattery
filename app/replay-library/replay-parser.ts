import type { Player, ReplayHeader, ShieldBatteryData } from '@shieldbattery/broodrep'
import { init, parseReplay } from '@shieldbattery/broodrep'
import { createHash } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { computeMatchupString } from '../../common/games/matchups'
import { filterColorCodes } from '../../common/maps'
import { RaceChar } from '../../common/races'
import {
  NON_EXISTING_USER_ID,
  ReplayChat,
  ReplayChatMessage,
  ReplayChatPlayer,
  replayGameTypeToNumber,
  ReplayLeave,
} from '../../common/replays'
import { ReplayLibraryPlayer } from '../../common/replays-library'
import { SC_COLORS } from '../../common/settings/team-colors'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'

init()

/** Number of bytes from the start of the file hashed for a cheap content identity. */
const CONTENT_HASH_BYTES = 8 * 1024

/** Identity/metadata for a replay file on disk, independent of its parsed contents. */
export interface ReplayFileInfo {
  path: string
  /** Last-modified time as unix ms, floored to an integer. */
  fileMtime: number
  fileSize: number
  /** Hash of the first `CONTENT_HASH_BYTES` of the file. */
  contentHash: string
}

/**
 * A fully-indexed replay record, ready to be written to the database. This is the app-internal
 * shape; the renderer-facing shape is `ReplayLibraryEntry`.
 */
export interface IndexedReplay extends ReplayFileInfo {
  /** Game start time as unix ms (derived from the replay's random seed). */
  gameTime: number
  mapName: string
  gameType: number
  durationFrames: number
  sbGameId?: string
  parseError: boolean
  players: ReplayLibraryPlayer[]
  /**
   * Team size (see `getReplayTeamRaces`) when the players resolve to exactly two equal-sized teams —
   * the shape `GameFormat` filters select on. `null` for any other layout (unresolvable, uneven, or
   * more than two teams).
   */
  teamSize: number | null
  /**
   * Canonical matchup string (see `computeMatchupString`) derived from the players' team layout.
   * `null` when the layout can't be resolved.
   */
  matchup: string | null
}

/**
 * Groups a replay's players into teams (arrays of races), mirroring the server's `getTeamsFromConfig`
 * semantics so format/matchup filtering behaves consistently:
 *
 * - 2+ non-empty teams: returned as-is
 * - exactly 1 team of exactly 2 players (e.g. a melee 1v1): split into two 1-player teams
 * - anything else (e.g. a >2-player melee where teams can't be determined): `null`
 */
export function getReplayTeamRaces(
  players: ReadonlyArray<ReplayLibraryPlayer>,
): RaceChar[][] | null {
  const byTeam = new Map<number, RaceChar[]>()
  for (const p of players) {
    const races = byTeam.get(p.team)
    if (races) {
      races.push(p.race)
    } else {
      byTeam.set(p.team, [p.race])
    }
  }

  const teams = Array.from(byTeam.values()).filter(t => t.length > 0)
  if (teams.length >= 2) {
    return teams
  }
  if (teams.length === 1) {
    if (teams[0].length === 2) {
      return [[teams[0][0]], [teams[0][1]]]
    }
    return null
  }
  return null
}

/**
 * Derives the immutable team-size/matchup identity for a set of players, computed once at parse
 * time so `format`/`matchup` filters can run in SQL instead of re-deriving team layout on every
 * query. Also used by the schema migration that backfills these columns for pre-existing rows, so
 * parse-time and migrated values can never drift apart.
 */
export function deriveTeamLayout(players: ReadonlyArray<ReplayLibraryPlayer>): {
  teamSize: number | null
  matchup: string | null
} {
  const teams = getReplayTeamRaces(players)
  const teamSize =
    teams && teams.length === 2 && teams[0].length === teams[1].length ? teams[0].length : null
  const matchup = teams ? (computeMatchupString(teams) ?? null) : null
  return { teamSize, matchup }
}

/** The ShieldBattery user recorded in `slotId` of a replay's ShieldBattery section, if any. */
function getSbUserIdForSlot(
  sbData: ShieldBatteryData | undefined,
  slotId: number,
): SbUserId | undefined {
  const sbUserId = sbData?.userIds?.[slotId]
  // Empty/observer slots are recorded as NON_EXISTING_USER_ID in current replays, but old ones
  // used 0; neither is a real user id.
  return sbUserId !== undefined && sbUserId !== NON_EXISTING_USER_ID && sbUserId !== 0
    ? makeSbUserId(sbUserId)
    : undefined
}

/**
 * Maps a parsed replay header (plus its players and optional ShieldBattery section) into an
 * `IndexedReplay`. Pure: no file access, no side effects.
 */
export function mapReplayHeaderToRecord(
  fileInfo: ReplayFileInfo,
  header: ReplayHeader,
  headerPlayers: ReadonlyArray<Player>,
  sbData: ShieldBatteryData | undefined,
): IndexedReplay {
  const players = headerPlayers.map<ReplayLibraryPlayer>(p => ({
    slot: p.slotId,
    team: p.team,
    name: p.name,
    race: p.race,
    isComputer: p.playerType === 'computer',
    sbUserId: getSbUserIdForSlot(sbData, p.slotId),
  }))
  const { teamSize, matchup } = deriveTeamLayout(players)

  return {
    ...fileInfo,
    // The replay's start time is the unix-seconds timestamp of when the game started.
    gameTime: header.startTime * 1000,
    mapName: filterColorCodes(header.mapName),
    gameType: replayGameTypeToNumber[header.gameType],
    durationFrames: header.frames,
    sbGameId: sbData?.gameId,
    parseError: false,
    players,
    teamSize,
    matchup,
  }
}

/**
 * Builds a record for a replay we couldn't parse, so it still shows up in the index (flagged) rather
 * than silently disappearing. Pure.
 */
export function makeParseErrorRecord(fileInfo: ReplayFileInfo): IndexedReplay {
  return {
    ...fileInfo,
    gameTime: 0,
    mapName: '',
    gameType: 0,
    durationFrames: 0,
    sbGameId: undefined,
    parseError: true,
    teamSize: null,
    matchup: null,
    players: [],
  }
}

/** Computes the content hash for a replay file (hash of its first `CONTENT_HASH_BYTES`). */
export async function computeContentHash(filePath: string): Promise<string> {
  const fd = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(CONTENT_HASH_BYTES)
    const { bytesRead } = await fd.read(buffer, 0, CONTENT_HASH_BYTES, 0)
    return createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex')
  } finally {
    await fd.close()
  }
}

/**
 * Reads and parses a replay's header, players, and ShieldBattery section. Rejects if the file
 * can't be parsed. Shared by the library indexer and the `replayParseMetadata` IPC handler.
 */
export async function parseReplayMetadata(filePath: string): Promise<{
  headerData: ReplayHeader
  players: Player[]
  shieldBatteryData?: ShieldBatteryData
}> {
  const buffer = await readFile(filePath)
  try {
    const replay = parseReplay(buffer)
    try {
      return {
        headerData: replay.header,
        players: replay.players(),
        shieldBatteryData: replay.getShieldBatterySection(),
      }
    } finally {
      replay.free()
    }
  } catch (err) {
    // broodrep's WASM bindings throw plain strings for parse errors
    throw err instanceof Error ? err : new Error(String(err))
  }
}

/** Parses a replay file into an `IndexedReplay`. Rejects if the file can't be parsed. */
export async function parseReplayFile(fileInfo: ReplayFileInfo): Promise<IndexedReplay> {
  const { headerData, players, shieldBatteryData } = await parseReplayMetadata(fileInfo.path)
  return mapReplayHeaderToRecord(fileInfo, headerData, players, shieldBatteryData)
}

/**
 * BW's leave reason for a player who was dropped (stopped responding); any other reason is a
 * deliberate exit. The replay's leave command stores the low byte of the in-game reason
 * (`0x4000_0006`).
 */
const DROPPED_LEAVE_REASON = 6

/**
 * Reads a replay's recorded chat and leaves, along with the players (and their colors) needed to
 * attribute them. Rejects if the file can't be parsed.
 */
export async function parseReplayChat(filePath: string): Promise<ReplayChat> {
  const buffer = await readFile(filePath)
  try {
    const replay = parseReplay(buffer)
    try {
      const sbData = replay.getShieldBatterySection()
      const colorsSection = replay.getRawSection('customColors')
      const colors = colorsSection ? decodeReplayColors(colorsSection) : []
      const replayPlayers = [...replay.players(), ...replay.observers()]
      const players = replayPlayers.map<ReplayChatPlayer>(p => ({
        slotId: p.slotId,
        name: p.name,
        isObserver: p.isObserver,
        userId: getSbUserIdForSlot(sbData, p.slotId),
        // Without a recorded color a slot keeps BW's default, which is its slot's standard color.
        color: colors[p.slotId] ?? (p.isObserver ? undefined : SC_COLORS[p.slotId]?.hex),
      }))
      const messages: ReplayChatMessage[] = []
      const leaves: ReplayLeave[] = []
      for (const { frame, playerId, command } of replay.queryCommands({
        includeKinds: ['chat', 'leaveGame'],
      }) ?? []) {
        if (command.type === 'chat') {
          messages.push({ frame, senderSlot: command.senderSlot, text: command.message })
        } else if (command.type === 'leaveGame') {
          // Unlike chat, which names its sender, a leave is attributed to the leaving player's
          // network id.
          const leaver = replayPlayers.find(p => p.networkId === playerId)
          if (leaver) {
            leaves.push({
              frame,
              slotId: leaver.slotId,
              dropped: command.reason === DROPPED_LEAVE_REASON,
            })
          }
        }
      }
      return { frames: replay.header.frames, players, messages, leaves }
    } finally {
      replay.free()
    }
  } catch (err) {
    // broodrep's WASM bindings throw plain strings for parse errors
    throw err instanceof Error ? err : new Error(String(err))
  }
}

/** The most bytes a single chunk of a BW replay section decompresses to. */
const MAX_SECTION_CHUNK_SIZE = 8192

/**
 * Decodes the per-slot player colors (as `#rrggbb` strings, indexed by slot id) from a replay's
 * `customColors` section. Slots with no recorded color are left empty.
 *
 * broodrep returns this section as stored, which is BW's chunked section format: a checksum, a
 * chunk count, then length-prefixed chunks that are zlib-compressed when that made them smaller.
 * The decompressed data is an RGBA quad of 0-1 floats per slot. A malformed section decodes to no
 * colors rather than failing the whole parse.
 */
export function decodeReplayColors(section: Uint8Array): Array<string | undefined> {
  const data = decompressSection(section)
  if (!data) {
    return []
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const colors: Array<string | undefined> = []
  for (let offset = 0; offset + 16 <= data.byteLength; offset += 16) {
    const alpha = view.getFloat32(offset + 12, true)
    if (!(alpha > 0)) {
      colors.push(undefined)
      continue
    }
    let hex = '#'
    for (let i = 0; i < 3; i++) {
      const channel = view.getFloat32(offset + i * 4, true)
      const byte = Number.isFinite(channel)
        ? Math.round(Math.min(Math.max(channel, 0), 1) * 255)
        : 0
      hex += byte.toString(16).padStart(2, '0')
    }
    colors.push(hex)
  }
  return colors
}

function decompressSection(section: Uint8Array): Uint8Array | undefined {
  const view = new DataView(section.buffer, section.byteOffset, section.byteLength)
  if (section.byteLength < 8) {
    return undefined
  }
  // The first u32 is a checksum, which isn't verified here.
  const chunkCount = view.getUint32(4, true)
  const chunks: Uint8Array[] = []
  let offset = 8
  for (let i = 0; i < chunkCount; i++) {
    if (offset + 4 > section.byteLength) {
      return undefined
    }
    const length = view.getUint32(offset, true)
    offset += 4
    if (offset + length > section.byteLength) {
      return undefined
    }
    const chunk = section.subarray(offset, offset + length)
    offset += length
    if (isZlibHeader(chunk)) {
      try {
        chunks.push(inflateSync(chunk, { maxOutputLength: MAX_SECTION_CHUNK_SIZE }))
        continue
      } catch {
        // A stored chunk can happen to start with bytes that look like a zlib header; the
        // checksum inflate verifies rules out treating one as compressed, so use it as-is.
      }
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function isZlibHeader(chunk: Uint8Array): boolean {
  return chunk.length >= 2 && (chunk[0] & 0x0f) === 8 && ((chunk[0] << 8) | chunk[1]) % 31 === 0
}
