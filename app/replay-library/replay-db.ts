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
import { deriveTeamLayout, IndexedReplay } from './replay-parser'
import { buildReplaySqlQuery } from './replay-queries'

const SCHEMA_VERSION = 5

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
  team_size: number | null
  matchup: string | null
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
        duration_frames, sb_game_id, parse_error, team_size, matchup
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        record.teamSize,
        record.matchup,
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

  // Atomic (SQLite DDL is transactional) so a crash mid-migration rolls back to the previous
  // version instead of leaving a half-applied schema whose re-run fails (e.g. a repeated
  // `ALTER TABLE ... ADD COLUMN` throwing `duplicate column name`); `user_version` participates in
  // the same transaction, so it only advances once every step below has succeeded.
  private migrate(): void {
    this.db.transaction(() => {
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

      if (version < 3) {
        // Every ORDER BY now sorts by parse_error first (to pin unreadable replays last), so the
        // old game_time-only index can no longer serve the common newest-first ordering.
        this.db.exec(`
          DROP INDEX IF EXISTS idx_replays_game_time;
          CREATE INDEX idx_replays_parse_error_game_time ON replays (parse_error, game_time DESC);
        `)
      }

      if (version < 4) {
        // Derived team-layout columns so format/matchup filters run in SQL; values are recomputed
        // from replay_players for pre-v4 rows.
        this.db.exec(`
          ALTER TABLE replays ADD COLUMN team_size INTEGER;
          ALTER TABLE replays ADD COLUMN matchup TEXT;
        `)
        this.backfillTeamLayout()
      }

      if (version < 5) {
        // The replay parser changed; every row's file_mtime is cleared so none of them match their
        // file's actual mtime on disk, forcing the next reconcile to reparse every replay
        // (including parse_error rows) with the new parser.
        this.db.exec('UPDATE replays SET file_mtime = NULL')
      }

      if (version < SCHEMA_VERSION) {
        this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
      }
    })()
  }

  /**
   * Populates `team_size`/`matchup` for rows that predate their addition, deriving them from each
   * replay's players via the same `deriveTeamLayout` the parser uses. Replays with no players are
   * left untouched (the columns default to `NULL`).
   *
   * Called from within `migrate()`'s own transaction; the `db.transaction` used below nests inside
   * it, which better-sqlite3 automatically turns into a savepoint rather than a separate
   * transaction, so this doesn't need to change.
   */
  private backfillTeamLayout(): void {
    const playerRows = this.db
      .prepare('SELECT replay_id, team, race FROM replay_players ORDER BY replay_id')
      .all() as Array<Pick<DbPlayerRow, 'replay_id' | 'team' | 'race'>>

    const playersByReplay = new Map<number, ReplayLibraryPlayer[]>()
    for (const row of playerRows) {
      const player: ReplayLibraryPlayer = {
        slot: 0,
        team: row.team ?? 0,
        name: '',
        race: (row.race ?? 'r') as RaceChar,
        isComputer: false,
      }
      const players = playersByReplay.get(row.replay_id)
      if (players) {
        players.push(player)
      } else {
        playersByReplay.set(row.replay_id, [player])
      }
    }

    const updateTeamLayoutStmt = this.db.prepare(
      'UPDATE replays SET team_size = ?, matchup = ? WHERE id = ?',
    )
    const backfillTxn = this.db.transaction(() => {
      for (const [replayId, players] of playersByReplay) {
        const { teamSize, matchup } = deriveTeamLayout(players)
        updateTeamLayoutStmt.run(teamSize, matchup, replayId)
      }
    })
    backfillTxn()
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
   * All filters (including format/matchup) run in SQL; paging is pushed into SQL (`LIMIT`/`OFFSET`)
   * so a large library doesn't get fully materialized per query, and players are only loaded for
   * the rows in the requested page.
   */
  query(filters: ReplayLibraryFilters): { entries: ReplayLibraryEntry[]; total: number } {
    const { sql, countSql, params } = buildReplaySqlQuery(filters)
    const offset = filters.offset ?? 0

    const total = (this.db.prepare(countSql).get(...params) as { count: number }).count
    const pageRows = this.db
      .prepare(`${sql} LIMIT ? OFFSET ?`)
      .all(...params, filters.limit ?? -1, offset) as DbReplayRow[]
    const playersByReplay = this.getPlayersForReplayIds(pageRows.map(r => r.id))
    const entries = pageRows.map(r => rowToEntry(r, playersByReplay.get(r.id) ?? []))

    return { entries, total }
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
