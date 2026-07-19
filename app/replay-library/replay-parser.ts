import type { Player, ReplayHeader, ShieldBatteryData } from '@shieldbattery/broodrep'
import { init, parseReplay } from '@shieldbattery/broodrep'
import { createHash } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'
import { computeMatchupString } from '../../common/games/matchups'
import { filterColorCodes } from '../../common/maps'
import { RaceChar } from '../../common/races'
import { NON_EXISTING_USER_ID, replayGameTypeToNumber } from '../../common/replays'
import { ReplayLibraryPlayer } from '../../common/replays-library'
import { makeSbUserId } from '../../common/users/sb-user-id'

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
  const players = headerPlayers.map<ReplayLibraryPlayer>(p => {
    const sbUserId = sbData?.userIds?.[p.slotId]
    // Empty/observer slots are recorded as NON_EXISTING_USER_ID in current replays, but old ones
    // used 0; neither is a real user id.
    const hasSbUserId =
      sbUserId !== undefined && sbUserId !== NON_EXISTING_USER_ID && sbUserId !== 0
    return {
      slot: p.slotId,
      team: p.team,
      name: p.name,
      race: p.race,
      isComputer: p.playerType === 'computer',
      sbUserId: hasSbUserId ? makeSbUserId(sbUserId) : undefined,
    }
  })
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
 * can't be parsed. This is the app's single broodrep entry point, shared by the library indexer
 * and the `replayParseMetadata` IPC handler.
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
