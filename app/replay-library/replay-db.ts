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

const SCHEMA_VERSION = 2

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
  contentHash: string | null
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
  private readonly deleteReplayByIdStmt: Statement
  private readonly updateReplayFileStmt: Statement

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
    this.deleteReplayByIdStmt = this.db.prepare('DELETE FROM replays WHERE id = ?')
    this.updateReplayFileStmt = this.db.prepare(
      'UPDATE replays SET path = ?, file_mtime = ? WHERE id = ?',
    )

    this.upsertTxn = this.db.transaction((record: IndexedReplay) => {
      const existing = this.getIdByPathStmt.get(record.path) as { id: number } | undefined
      if (existing) {
        // Cascade removes players.
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
    })

    this.deleteTxn = this.db.transaction((paths: string[]) => {
      for (const p of paths) {
        const row = this.getIdByPathStmt.get(p) as { id: number } | undefined
        if (row) {
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
      `)
    }
    if (version < 2) {
      // The FTS free-text index was replaced by LIKE-based substring filtering.
      this.db.exec('DROP TABLE IF EXISTS replay_fts')
    }

    if (version < SCHEMA_VERSION) {
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
    }
  }

  /** Returns the current index state keyed by file path, for reconciliation. */
  getExistingReplays(): Map<string, ExistingReplayInfo> {
    const rows = this.db
      .prepare('SELECT id, path, file_mtime, file_size, content_hash FROM replays')
      .all() as Array<
      Pick<DbReplayRow, 'id' | 'path' | 'file_mtime' | 'file_size' | 'content_hash'>
    >
    const result = new Map<string, ExistingReplayInfo>()
    for (const row of rows) {
      result.set(row.path, {
        id: row.id,
        fileMtime: row.file_mtime,
        fileSize: row.file_size,
        contentHash: row.content_hash,
      })
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

  /** Points an existing index entry at a new path (a moved/renamed file), keeping its parsed data. */
  updateReplayFile(id: number, newPath: string, fileMtime: number): void {
    this.updateReplayFileStmt.run(newPath, fileMtime, id)
  }

  /** Number of replays currently in the index (including parse-error rows). */
  getTotalIndexed(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM replays').get() as { count: number }
    return row.count
  }

  /**
   * Runs a filtered query, returning the page of matching entries selected by `filters.offset`/
   * `filters.limit` (offset defaults to 0, an omitted limit returns everything), ordered per
   * `filters.sort` (defaulting to newest-first). `total` is the count of matches across all pages.
   * The row-level filters run in SQL; format/matchup filters run in JS over the loaded players.
   *
   * When a format filter is set, players have to be loaded for every matching row up front (the
   * team layout can only be checked in JS), so the page is sliced after filtering. Otherwise,
   * players are only loaded for the rows in the requested page, since row order/count is already
   * final at that point.
   */
  query(filters: ReplayLibraryFilters): { entries: ReplayLibraryEntry[]; total: number } {
    const { sql, params } = buildReplaySqlQuery(filters)
    const rows = this.db.prepare(sql).all(...params) as DbReplayRow[]

    const offset = filters.offset ?? 0

    if (filters.format) {
      const playersByReplay = this.getPlayersForReplayIds(rows.map(r => r.id))
      const allEntries = rows
        .map(r => rowToEntry(r, playersByReplay.get(r.id) ?? []))
        .filter(e => replayPassesTeamFilters(e.players, filters))

      const page =
        filters.limit !== undefined
          ? allEntries.slice(offset, offset + filters.limit)
          : allEntries.slice(offset)

      return { entries: page, total: allEntries.length }
    }

    const pageRows =
      filters.limit !== undefined ? rows.slice(offset, offset + filters.limit) : rows.slice(offset)
    const playersByReplay = this.getPlayersForReplayIds(pageRows.map(r => r.id))
    const entries = pageRows.map(r => rowToEntry(r, playersByReplay.get(r.id) ?? []))

    return { entries, total: rows.length }
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
