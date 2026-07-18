import type { Database as SqliteDatabase, Statement } from 'better-sqlite3'
import Database from 'better-sqlite3'
import path from 'node:path'
import { RaceChar } from '../../common/races'
import {
  ReplayLibraryEntry,
  ReplayLibraryFilters,
  ReplayLibraryPlayer,
  ReplayPlaylist,
} from '../../common/replays-library'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { reorderPlaylistEntries } from './playlist-order'
import { deriveTeamLayout, IndexedReplay } from './replay-parser'
import { buildReplaySqlQuery } from './replay-queries'

// better-sqlite3 locates its native addon through a dynamic `bindings()` require that webpack can't
// statically analyze, so in the bundled production build the `.node` would be silently dropped from
// the package (and the DB would fail to open). Requiring it explicitly routes it through
// `native-addon-loader` — which copies it into `dist/native/` (shipped by prod.yml/staging.yml) —
// and we hand the resulting addon to better-sqlite3 via `nativeBinding` (it accepts a pre-loaded
// addon object in place of a path). In dev, Node loads the `.node` directly, so this works there
// too. `build/Release/` is where the Electron-ABI build lands (this install has no prebuilds dir).
const betterSqlite3Addon = require('better-sqlite3/build/Release/better_sqlite3.node')

const SCHEMA_VERSION = 7

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
  starred_at: number | null
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
  private readonly setStarredStmt: Statement
  private readonly getStarredCountStmt: Statement
  private readonly findReplayIdByGameIdStmt: Statement
  private readonly listPlaylistsStmt: Statement
  private readonly insertPlaylistStmt: Statement
  private readonly getMaxPlaylistPositionStmt: Statement
  private readonly renamePlaylistStmt: Statement
  private readonly deletePlaylistStmt: Statement
  private readonly getMaxEntryPositionStmt: Statement
  private readonly insertPlaylistEntryStmt: Statement
  private readonly getPlaylistEntryIdsStmt: Statement
  private readonly deletePlaylistEntryStmt: Statement
  private readonly updateEntryPositionStmt: Statement
  private readonly getPlaylistsForReplayStmt: Statement

  private readonly upsertTxn: (record: IndexedReplay) => void
  private readonly deleteTxn: (paths: string[]) => void
  private readonly addToPlaylistTxn: (playlistId: number, replayIds: number[]) => void
  private readonly removeFromPlaylistTxn: (playlistId: number, replayIds: number[]) => void
  private readonly movePlaylistEntryTxn: (
    playlistId: number,
    replayId: number,
    toIndex: number,
  ) => void

  constructor(dbPath: string) {
    // `nativeBinding` is typed as a string path by @types/better-sqlite3, but the runtime also
    // accepts a pre-loaded addon object (WiseLibs/better-sqlite3#972), which is what we pass.
    this.db = new Database(dbPath, { nativeBinding: betterSqlite3Addon })
    try {
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('foreign_keys = ON')
      this.migrate()
    } catch (err) {
      // If the file can't be opened or migrated (corruption, a schema from an incompatible build,
      // etc.), close the handle before rethrowing so the caller can delete and rebuild the index —
      // Windows keeps the file locked while it's open. The index is a pure, rebuildable cache of the
      // replay folder, so recreating it from scratch loses nothing.
      this.db.close()
      throw err
    }

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
    this.setStarredStmt = this.db.prepare('UPDATE replays SET starred_at = ? WHERE id = ?')
    this.getStarredCountStmt = this.db.prepare(
      'SELECT COUNT(*) AS count FROM replays WHERE starred_at IS NOT NULL',
    )
    this.findReplayIdByGameIdStmt = this.db.prepare(
      'SELECT id FROM replays WHERE sb_game_id = ? ORDER BY parse_error ASC, id ASC LIMIT 1',
    )

    this.listPlaylistsStmt = this.db.prepare(`
      SELECT p.id, p.name, COUNT(pe.replay_id) AS count
      FROM playlists p
      LEFT JOIN playlist_entries pe ON pe.playlist_id = p.id
      GROUP BY p.id
      ORDER BY p.position
    `)
    this.insertPlaylistStmt = this.db.prepare(
      'INSERT INTO playlists (name, position, created_at) VALUES (?, ?, ?)',
    )
    this.getMaxPlaylistPositionStmt = this.db.prepare(
      'SELECT MAX(position) AS maxPosition FROM playlists',
    )
    this.renamePlaylistStmt = this.db.prepare('UPDATE playlists SET name = ? WHERE id = ?')
    this.deletePlaylistStmt = this.db.prepare('DELETE FROM playlists WHERE id = ?')
    this.getMaxEntryPositionStmt = this.db.prepare(
      'SELECT MAX(position) AS maxPosition FROM playlist_entries WHERE playlist_id = ?',
    )
    this.insertPlaylistEntryStmt = this.db.prepare(
      'INSERT INTO playlist_entries (playlist_id, replay_id, position, added_at) VALUES (?, ?, ?, ?)',
    )
    this.getPlaylistEntryIdsStmt = this.db.prepare(
      'SELECT replay_id FROM playlist_entries WHERE playlist_id = ? ORDER BY position',
    )
    this.deletePlaylistEntryStmt = this.db.prepare(
      'DELETE FROM playlist_entries WHERE playlist_id = ? AND replay_id = ?',
    )
    this.updateEntryPositionStmt = this.db.prepare(
      'UPDATE playlist_entries SET position = ? WHERE playlist_id = ? AND replay_id = ?',
    )
    this.getPlaylistsForReplayStmt = this.db.prepare(`
      SELECT p.id, p.name
      FROM playlists p
      INNER JOIN playlist_entries pe ON pe.playlist_id = p.id
      WHERE pe.replay_id = ?
      ORDER BY p.position
    `)

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

    this.addToPlaylistTxn = this.db.transaction((playlistId: number, replayIds: number[]) => {
      const existingIds = new Set(
        (this.getPlaylistEntryIdsStmt.all(playlistId) as Array<{ replay_id: number }>).map(
          row => row.replay_id,
        ),
      )
      const newIds = [...new Set(replayIds)].filter(id => !existingIds.has(id))
      if (newIds.length === 0) {
        return
      }

      const maxPositionRow = this.getMaxEntryPositionStmt.get(playlistId) as {
        maxPosition: number | null
      }
      let position = maxPositionRow.maxPosition != null ? maxPositionRow.maxPosition + 1 : 0
      const now = Date.now()
      for (const replayId of newIds) {
        this.insertPlaylistEntryStmt.run(playlistId, replayId, position, now)
        position++
      }
    })

    this.removeFromPlaylistTxn = this.db.transaction((playlistId: number, replayIds: number[]) => {
      for (const replayId of replayIds) {
        this.deletePlaylistEntryStmt.run(playlistId, replayId)
      }

      const remainingIds = (
        this.getPlaylistEntryIdsStmt.all(playlistId) as Array<{ replay_id: number }>
      ).map(row => row.replay_id)
      remainingIds.forEach((replayId, index) => {
        this.updateEntryPositionStmt.run(index, playlistId, replayId)
      })
    })

    this.movePlaylistEntryTxn = this.db.transaction(
      (playlistId: number, replayId: number, toIndex: number) => {
        const ids = (
          this.getPlaylistEntryIdsStmt.all(playlistId) as Array<{ replay_id: number }>
        ).map(row => row.replay_id)
        if (!ids.includes(replayId)) {
          return
        }

        const reordered = reorderPlaylistEntries(ids, replayId, toIndex)
        reordered.forEach((id, index) => {
          this.updateEntryPositionStmt.run(index, playlistId, id)
        })
      },
    )
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

      if (version < 6) {
        // Starring and local playlists.
        this.db.exec(`
          ALTER TABLE replays ADD COLUMN starred_at INTEGER;

          CREATE TABLE playlists (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            position INTEGER NOT NULL,
            created_at INTEGER NOT NULL
          );

          CREATE TABLE playlist_entries (
            playlist_id INTEGER NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
            replay_id INTEGER NOT NULL REFERENCES replays (id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            added_at INTEGER NOT NULL,
            PRIMARY KEY (playlist_id, replay_id)
          );
          CREATE INDEX idx_playlist_entries_playlist ON playlist_entries (playlist_id, position);
        `)
      }

      if (version < 7) {
        // Old replays use 0 (not just NON_EXISTING_USER_ID) for empty/observer slots in the
        // ShieldBattery section; rows indexed before the parser learned that need the same
        // treatment so consumers never see a bogus user id.
        this.db.exec('UPDATE replay_players SET sb_user_id = NULL WHERE sb_user_id = 0')
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

  /** Number of replays currently starred. */
  getStarredCount(): number {
    const row = this.getStarredCountStmt.get() as { count: number }
    return row.count
  }

  /** Stars or unstars a replay. */
  setStarred(replayId: number, starred: boolean): void {
    this.setStarredStmt.run(starred ? Date.now() : null, replayId)
  }

  /** The id of the indexed replay produced by a ShieldBattery game, if one has been indexed. */
  findReplayIdByGameId(gameId: string): number | undefined {
    const row = this.findReplayIdByGameIdStmt.get(gameId) as { id: number } | undefined
    return row?.id
  }

  /** Lists the local playlists, ordered per their manual arrangement. */
  listPlaylists(): ReplayPlaylist[] {
    return this.listPlaylistsStmt.all() as ReplayPlaylist[]
  }

  /** Creates a new, empty playlist, appended after the existing ones. Returns its new id. */
  createPlaylist(name: string): number {
    const maxPositionRow = this.getMaxPlaylistPositionStmt.get() as { maxPosition: number | null }
    const position = maxPositionRow.maxPosition != null ? maxPositionRow.maxPosition + 1 : 0
    const info = this.insertPlaylistStmt.run(name, position, Date.now())
    return Number(info.lastInsertRowid)
  }

  renamePlaylist(id: number, name: string): void {
    this.renamePlaylistStmt.run(name, id)
  }

  /** Deletes a playlist; its entries cascade. */
  deletePlaylist(id: number): void {
    this.deletePlaylistStmt.run(id)
  }

  /** Appends replays to a playlist's manual order. Replays already in the playlist are left alone. */
  addToPlaylist(playlistId: number, replayIds: number[]): void {
    this.addToPlaylistTxn(playlistId, replayIds)
  }

  /** Removes replays from a playlist, closing the gap in the remaining manual order. */
  removeFromPlaylist(playlistId: number, replayIds: number[]): void {
    this.removeFromPlaylistTxn(playlistId, replayIds)
  }

  /** Moves a replay to `toIndex` (clamped) within a playlist's manual order. No-op if not present. */
  movePlaylistEntry(playlistId: number, replayId: number, toIndex: number): void {
    this.movePlaylistEntryTxn(playlistId, replayId, toIndex)
  }

  /** Lists the playlists containing a replay, ordered per their manual arrangement. */
  getPlaylistsForReplay(replayId: number): Array<{ id: number; name: string }> {
    return this.getPlaylistsForReplayStmt.all(replayId) as Array<{ id: number; name: string }>
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
    starredAt: row.starred_at ?? undefined,
  }
}
