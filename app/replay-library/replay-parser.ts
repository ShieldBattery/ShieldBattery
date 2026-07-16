import ReplayParser, { ReplayHeader } from 'jssuh'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { filterColorCodes } from '../../common/maps'
import {
  NON_EXISTING_USER_ID,
  ReplayShieldBatteryData,
  replayRaceToChar,
} from '../../common/replays'
import { ReplayLibraryPlayer } from '../../common/replays-library'
import { parseShieldbatteryReplayData } from '../replays/parse-shieldbattery-replay'

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
}

/**
 * Maps a parsed replay header (plus optional ShieldBattery section) into an `IndexedReplay`. Pure:
 * no file access, no side effects.
 */
export function mapReplayHeaderToRecord(
  fileInfo: ReplayFileInfo,
  header: ReplayHeader,
  sbData: ReplayShieldBatteryData | undefined,
): IndexedReplay {
  const players = header.players.map<ReplayLibraryPlayer>(p => {
    const sbUserId = sbData?.userIds?.[p.id]
    return {
      slot: p.id,
      team: p.team,
      name: p.name,
      race: replayRaceToChar(p.race),
      isComputer: p.isComputer,
      sbUserId: sbUserId !== undefined && sbUserId !== NON_EXISTING_USER_ID ? sbUserId : undefined,
    }
  })

  return {
    ...fileInfo,
    // The replay's random seed is the unix-seconds timestamp of when the game started.
    gameTime: header.seed * 1000,
    mapName: filterColorCodes(header.mapName),
    gameType: header.gameType,
    durationFrames: header.durationFrames,
    sbGameId: sbData?.gameId,
    parseError: false,
    players,
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

interface ParsedReplay {
  header: ReplayHeader
  sbData?: ReplayShieldBatteryData
}

/**
 * Reads and parses a replay's header + ShieldBattery section, using the same approach as the
 * `replayParseMetadata` IPC handler. Rejects if the header can't be read.
 */
function readReplayHeader(filePath: string): Promise<ParsedReplay> {
  return new Promise((resolve, reject) => {
    const parser = new ReplayParser()
    let header: ReplayHeader | undefined
    parser.on('replayHeader', h => {
      header = h
    })

    let sbData: ReplayShieldBatteryData | undefined
    parser.rawScrSection('Sbat', buffer => {
      try {
        sbData = parseShieldbatteryReplayData(buffer)
      } catch {
        // A missing/corrupt SB section just means we treat this as a non-SB replay.
      }
    })

    parser.on('end', () => {
      if (header) {
        resolve({ header, sbData })
      } else {
        reject(new Error(`Replay header was never parsed for ${filePath}`))
      }
    })

    pipeline(createReadStream(filePath), parser).catch(reject)
    parser.resume()
  })
}

/** Parses a replay file into an `IndexedReplay`. Rejects if the header can't be parsed. */
export async function parseReplayFile(fileInfo: ReplayFileInfo): Promise<IndexedReplay> {
  const { header, sbData } = await readReplayHeader(fileInfo.path)
  return mapReplayHeaderToRecord(fileInfo, header, sbData)
}
