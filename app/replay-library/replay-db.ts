import type { Database as SqliteDatabase, Statement } from 'better-sqlite3'
import Database from 'better-sqlite3'
import path from 'node:path'
import { RaceChar } from '../../common/races'
import {
  ReplayLibraryEntry,
  ReplayLibraryFilters,
  ReplayLibraryPlayer,
} from '../../common/replays-library'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { IndexedReplay } from './replay-parser'
import { buildReplaySqlQuery, replayPassesTeamFilters } from './replay-queries'

const SCHEMA_VERSION = 1

/** Max number of bind parameters per statement; keeps `IN (...)` lists within SQLite limits. */
const MAX_IN_PARAMS = 900

interface DbReplayRow {
  id: number
  path: string
  file_mtime: number | null
  file_size: number | null
  content_hash: string | null
  game_time: number | null
  map_name: string | null
  game_type: number | null
  duration_frames: number | null
  sb_game_id: string | null
  parse_error: number
}

interface DbPlayerRow {
  replay_id: number
  slot: number | null
  team: number | null
  name: string | null
  race: string | null
  is_computer: number | null
  sb_user_id: number | null
}

/** Existing index state for a path, used when reconciling the on-disk folder with the DB. */
export interface ExistingReplayInfo {
  id: number
  fileMtime: number | null
  fileSize: number | null
}

/**
 * A better-sqlite3-backed index of local replay files. Synchronous by nature (that's how
 * better-sqlite3 works), so all methods return their results directly.
 */
export class ReplayDb {
  private readonly db: SqliteDatabase

  private readonly getIdByPathStmt: Statement
  private readonly insertReplayStmt: Statement
  private readonly insertPlayerStmt: Statement
  private readonly insertFtsStmt: Statement
  private readonly deleteReplayByIdStmt: Statement
  private readonly deleteFtsStmt: Statement

  private readonly upsertTxn: (record: IndexedReplay) => void
  private readonly deleteTxn: (paths: string[]) => void

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()

    this.getIdByPathStmt = this.db.prepare('SELECT id FROM replays WHERE path = ?')
    this.insertReplayStmt = this.db.prepare(`
      INSERT INTO replays (
        path, file_mtime, file_size, content_hash, game_time, map_name, game_type,
        duration_frames, sb_game_id, parse_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.insertPlayerStmt = this.db.prepare(`
      INSERT INTO replay_players (replay_id, slot, team, name, race, is_computer, sb_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    this.insertFtsStmt = this.db.prepare('INSERT INTO replay_fts (rowid, content) VALUES (?, ?)')
    this.deleteReplayByIdStmt = this.db.prepare('DELETE FROM replays WHERE id = ?')
    this.deleteFtsStmt = this.db.prepare('DELETE FROM replay_fts WHERE rowid = ?')

    this.upsertTxn = this.db.transaction((record: IndexedReplay) => {
      const existing = this.getIdByPathStmt.get(record.path) as { id: number } | undefined
      if (existing) {
        // Cascade removes players; FTS is content-less so we clear it explicitly.
        this.deleteFtsStmt.run(existing.id)
        this.deleteReplayByIdStmt.run(existing.id)
      }

      const info = this.insertReplayStmt.run(
        record.path,
        record.fileMtime,
        record.fileSize,
        record.contentHash,
        record.gameTime,
        record.mapName,
        record.gameType,
        record.durationFrames,
        record.sbGameId ?? null,
        record.parseError ? 1 : 0,
      )
      const id = Number(info.lastInsertRowid)

      for (const p of record.players) {
        this.insertPlayerStmt.run(
          id,
          p.slot,
          p.team,
          p.name,
          p.race,
          p.isComputer ? 1 : 0,
          p.sbUserId ?? null,
        )
      }

      this.insertFtsStmt.run(id, buildFtsContent(record))
    })

    this.deleteTxn = this.db.transaction((paths: string[]) => {
      for (const p of paths) {
        const row = this.getIdByPathStmt.get(p) as { id: number } | undefined
        if (row) {
          this.deleteFtsStmt.run(row.id)
          this.deleteReplayByIdStmt.run(row.id)
        }
      }
    })
  }

  private migrate(): void {
    const version = Number(this.db.pragma('user_version', { simple: true }))
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE replays (
          id INTEGER PRIMARY KEY,
          path TEXT UNIQUE NOT NULL,
          file_mtime INTEGER,
          file_size INTEGER,
          content_hash TEXT,
          game_time INTEGER,
          map_name TEXT,
          game_type INTEGER,
          duration_frames INTEGER,
          sb_game_id TEXT,
          parse_error INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_replays_game_time ON replays (game_time DESC);

        CREATE TABLE replay_players (
          replay_id INTEGER NOT NULL REFERENCES replays (id) ON DELETE CASCADE,
          slot INTEGER,
          team INTEGER,
          name TEXT,
          race TEXT,
          is_computer INTEGER,
          sb_user_id INTEGER
        );
        CREATE INDEX idx_replay_players_replay_id ON replay_players (replay_id);

        CREATE VIRTUAL TABLE replay_fts USING fts5(content);
      `)
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
    }
  }

  /** Returns the current index state keyed by file path, for reconciliation. */
  getExistingReplays(): Map<string, ExistingReplayInfo> {
    const rows = this.db
      .prepare('SELECT id, path, file_mtime, file_size FROM replays')
      .all() as Array<Pick<DbReplayRow, 'id' | 'path' | 'file_mtime' | 'file_size'>>
    const result = new Map<string, ExistingReplayInfo>()
    for (const row of rows) {
      result.set(row.path, { id: row.id, fileMtime: row.file_mtime, fileSize: row.file_size })
    }
    return result
  }

  /** Inserts or replaces the index entry for a single replay (keyed by path). */
  upsertReplay(record: IndexedReplay): void {
    this.upsertTxn(record)
  }

  /** Removes the index entries for the given file paths. */
  deleteByPaths(paths: string[]): void {
    if (paths.length > 0) {
      this.deleteTxn(paths)
    }
  }

  /** Number of replays currently in the index (including parse-error rows). */
  getTotalIndexed(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM replays').get() as { count: number }
    return row.count
  }

  /** Distinct, non-empty map names of successfully-parsed replays, for a filter chip. */
  getDistinctMapNames(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT map_name FROM replays
         WHERE parse_error = 0 AND map_name IS NOT NULL AND map_name <> ''
         ORDER BY map_name COLLATE NOCASE`,
      )
      .all() as Array<{ map_name: string }>
    return rows.map(r => r.map_name)
  }

  /**
   * Runs a filtered query, returning all matching entries newest-first. The row-level filters run in
   * SQL; format/matchup filters run in JS over the loaded players.
   */
  query(filters: ReplayLibraryFilters): { entries: ReplayLibraryEntry[]; total: number } {
    const { sql, params } = buildReplaySqlQuery(filters)
    const rows = this.db.prepare(sql).all(...params) as DbReplayRow[]

    const playersByReplay = this.getPlayersForReplayIds(rows.map(r => r.id))
    let entries = rows.map(r => rowToEntry(r, playersByReplay.get(r.id) ?? []))

    if (filters.format) {
      entries = entries.filter(e => replayPassesTeamFilters(e.players, filters))
    }

    return { entries, total: entries.length }
  }

  close(): void {
    if (this.db.open) {
      this.db.close()
    }
  }

  private getPlayersForReplayIds(ids: number[]): Map<number, DbPlayerRow[]> {
    const result = new Map<number, DbPlayerRow[]>()
    if (ids.length === 0) {
      return result
    }

    for (let i = 0; i < ids.length; i += MAX_IN_PARAMS) {
      const chunk = ids.slice(i, i + MAX_IN_PARAMS)
      const placeholders = chunk.map(() => '?').join(', ')
      const rows = this.db
        .prepare(
          `SELECT replay_id, slot, team, name, race, is_computer, sb_user_id
           FROM replay_players
           WHERE replay_id IN (${placeholders})
           ORDER BY replay_id, slot`,
        )
        .all(...chunk) as DbPlayerRow[]
      for (const row of rows) {
        const list = result.get(row.replay_id)
        if (list) {
          list.push(row)
        } else {
          result.set(row.replay_id, [row])
        }
      }
    }

    return result
  }
}

function buildFtsContent(record: IndexedReplay): string {
  return [record.mapName, ...record.players.map(p => p.name)].filter(s => s.length > 0).join(' ')
}

function rowToEntry(row: DbReplayRow, playerRows: DbPlayerRow[]): ReplayLibraryEntry {
  const players = playerRows.map<ReplayLibraryPlayer>(p => ({
    slot: p.slot ?? 0,
    team: p.team ?? 0,
    name: p.name ?? '',
    race: (p.race ?? 'r') as RaceChar,
    isComputer: p.is_computer !== 0,
    sbUserId: p.sb_user_id != null ? makeSbUserId(p.sb_user_id) : undefined,
  }))

  return {
    id: row.id,
    path: row.path,
    fileName: path.basename(row.path),
    fileSize: row.file_size ?? 0,
    gameTime: row.game_time ?? 0,
    mapName: row.map_name ?? '',
    gameType: row.game_type ?? 0,
    durationFrames: row.duration_frames ?? 0,
    sbGameId: row.sb_game_id ?? undefined,
    parseError: row.parse_error !== 0,
    players,
  }
}
