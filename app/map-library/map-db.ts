import type { Database as SqliteDatabase, Statement } from 'better-sqlite3'
// The win32-x64 subpath pins the N-API prebuild the app ships (see `replay-db.ts`).
import Database from 'better-sqlite3/win32-x64'
import path from 'node:path'
import {
  LocalMapFile,
  LocalMapInfo,
  LocalMapKind,
  LocalMapQuery,
  LocalMapQueryResult,
} from '../../common/map-library'
import { folderKey } from './map-folders'
import { buildMapSqlQuery } from './map-queries'
import { normalizeSearch, sortName } from './map-summary'

/**
 * The index is a pure cache of the map folders, so a schema change (or a change to how files are
 * read, see `map-summary.ts`) drops it and indexes every file again rather than migrating.
 */
const SCHEMA_VERSION = 1

interface DbMapFileRow {
  id: number
  path: string
  folder: string
  folder_key: string
  file_name: string
  file_mtime: number
  file_size: number
  hash: string | null
  name: string | null
  sort_name: string
  search_text: string
  search_compact: string
  width: number | null
  height: number | null
  tileset: number | null
  kind: string | null
  player_count: number | null
  is_eud: number | null
}

/** A map file as the watcher indexes it. */
export interface IndexedMapFile {
  path: string
  folder: string
  fileMtime: number
  fileSize: number
  hash?: string
  map?: LocalMapInfo
}

/** Existing index state for a path, for reconciling the folders on disk with the index. */
export interface ExistingMapFile {
  fileMtime: number
  fileSize: number
}

function fromRow(row: DbMapFileRow): LocalMapFile {
  return {
    id: row.id,
    path: row.path,
    folder: row.folder,
    fileName: row.file_name,
    fileMtime: row.file_mtime,
    fileSize: row.file_size,
    hash: row.hash ?? undefined,
    map:
      row.kind !== null
        ? {
            name: row.name ?? '',
            width: row.width ?? 0,
            height: row.height ?? 0,
            tileset: row.tileset ?? 0,
            kind: row.kind as LocalMapKind,
            playerCount: row.player_count ?? 0,
            isEud: !!row.is_eud,
          }
        : undefined,
  }
}

/** A better-sqlite3-backed index of the map files in the user's map folders. */
export class MapDb {
  private readonly db: SqliteDatabase
  private readonly upsertStmt: Statement
  private readonly deleteByPathStmt: Statement
  private readonly findByHashStmt: Statement
  private readonly existingStmt: Statement
  private readonly totalStmt: Statement
  private readonly folderCountsStmt: Statement
  private readonly deleteTxn: (paths: string[]) => void

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    try {
      this.db.pragma('journal_mode = WAL')
      this.migrate()
    } catch (err) {
      // Closed before rethrowing so the caller can delete and rebuild the file, which Windows
      // keeps locked while it's open.
      this.db.close()
      throw err
    }

    this.upsertStmt = this.db.prepare(`
      INSERT INTO map_files (
        path, folder, folder_key, file_name, file_mtime, file_size, hash, name, sort_name,
        search_text, search_compact, width, height, tileset, kind, player_count, is_eud
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (path) DO UPDATE SET
        folder = excluded.folder, folder_key = excluded.folder_key,
        file_name = excluded.file_name, file_mtime = excluded.file_mtime,
        file_size = excluded.file_size, hash = excluded.hash, name = excluded.name,
        sort_name = excluded.sort_name, search_text = excluded.search_text,
        search_compact = excluded.search_compact, width = excluded.width,
        height = excluded.height, tileset = excluded.tileset, kind = excluded.kind,
        player_count = excluded.player_count, is_eud = excluded.is_eud
    `)
    this.deleteByPathStmt = this.db.prepare('DELETE FROM map_files WHERE path = ?')
    this.findByHashStmt = this.db.prepare(
      'SELECT * FROM map_files WHERE hash = ? AND kind IS NOT NULL LIMIT 1',
    )
    this.existingStmt = this.db.prepare('SELECT path, file_mtime, file_size FROM map_files')
    this.totalStmt = this.db.prepare('SELECT COUNT(*) AS total FROM map_files')
    this.folderCountsStmt = this.db.prepare(
      'SELECT folder, COUNT(*) AS count FROM map_files GROUP BY folder',
    )
    this.deleteTxn = this.db.transaction((paths: string[]) => {
      for (const p of paths) {
        this.deleteByPathStmt.run(p)
      }
    })
  }

  private migrate(): void {
    const version = Number(this.db.pragma('user_version', { simple: true }))
    if (version === SCHEMA_VERSION) {
      return
    }
    this.db.exec(`
      DROP TABLE IF EXISTS map_files;
      CREATE TABLE map_files (
        id INTEGER PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        folder TEXT NOT NULL,
        -- The folder lowercased in JS (SQLite's own case folding only covers ASCII)
        folder_key TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_mtime INTEGER NOT NULL,
        file_size INTEGER NOT NULL,
        -- The server's identity for the file; NULL if it couldn't be read
        hash TEXT,
        -- The map's facts; all NULL if the file couldn't be read as a map
        name TEXT,
        sort_name TEXT NOT NULL,
        search_text TEXT NOT NULL,
        search_compact TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        tileset INTEGER,
        kind TEXT,
        player_count INTEGER,
        is_eud INTEGER
      );
      CREATE INDEX idx_map_files_hash ON map_files (hash);
      CREATE INDEX idx_map_files_folder_key ON map_files (folder_key);
      CREATE INDEX idx_map_files_mtime ON map_files (file_mtime DESC);
    `)
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }

  /** The indexed files' modification times and sizes, by path. */
  getExisting(): Map<string, ExistingMapFile> {
    const rows = this.existingStmt.all() as Array<
      Pick<DbMapFileRow, 'path' | 'file_mtime' | 'file_size'>
    >
    return new Map(
      rows.map(row => [row.path, { fileMtime: row.file_mtime, fileSize: row.file_size }]),
    )
  }

  /** The facts of an indexed file with this hash, so a copy of it doesn't need reading again. */
  findMapInfoByHash(hash: string): LocalMapInfo | undefined {
    const row = this.findByHashStmt.get(hash) as DbMapFileRow | undefined
    return row ? fromRow(row).map : undefined
  }

  /** The path of an indexed, readable file with this hash. */
  findPathByHash(hash: string): string | undefined {
    const row = this.findByHashStmt.get(hash) as DbMapFileRow | undefined
    return row?.path
  }

  upsertFile(file: IndexedMapFile): void {
    const fileName = path.win32.basename(file.path)
    const baseName = fileName.slice(0, fileName.length - path.win32.extname(fileName).length)
    const searchText = normalizeSearch(`${file.map?.name ?? ''} ${baseName}`)
    this.upsertStmt.run(
      file.path,
      file.folder,
      folderKey(file.folder),
      fileName,
      file.fileMtime,
      file.fileSize,
      file.hash ?? null,
      file.map?.name ?? null,
      sortName(file.map?.name || baseName),
      searchText,
      searchText.replaceAll(' ', ''),
      file.map?.width ?? null,
      file.map?.height ?? null,
      file.map?.tileset ?? null,
      file.map?.kind ?? null,
      file.map?.playerCount ?? null,
      file.map ? Number(file.map.isEud) : null,
    )
  }

  deleteByPaths(paths: ReadonlyArray<string>): void {
    this.deleteTxn([...paths])
  }

  query(query: LocalMapQuery): LocalMapQueryResult {
    const built = buildMapSqlQuery(query)
    const rows = this.db.prepare(built.sql).all(...built.pageParams) as DbMapFileRow[]
    const { total } = this.db.prepare(built.countSql).get(...built.params) as { total: number }
    return { files: rows.map(fromRow), total }
  }

  /** How many files sit directly in each folder. */
  getFolderCounts(): Array<{ folder: string; count: number }> {
    return this.folderCountsStmt.all() as Array<{ folder: string; count: number }>
  }

  getTotalIndexed(): number {
    return (this.totalStmt.get() as { total: number }).total
  }
}
