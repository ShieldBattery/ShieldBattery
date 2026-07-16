// Minimal type declarations for the subset of better-sqlite3's API that we use. The package ships
// without types, and we intentionally avoid pulling in @types/better-sqlite3 as a dependency.
// TODO(replay-library): Replace with the official types if they're ever added as a dependency.
declare module 'better-sqlite3' {
  interface RunResult {
    changes: number
    lastInsertRowid: number | bigint
  }

  export interface Statement {
    run(...params: any[]): RunResult
    get(...params: any[]): any
    all(...params: any[]): any[]
    iterate(...params: any[]): IterableIterator<any>
  }

  export interface Database {
    prepare(sql: string): Statement
    exec(sql: string): Database
    pragma(source: string, options?: { simple?: boolean }): any
    transaction<F extends (...args: any[]) => any>(fn: F): F
    close(): Database
    readonly open: boolean
    readonly name: string
  }

  export interface Options {
    readonly?: boolean
    fileMustExist?: boolean
    timeout?: number
    verbose?: (...args: any[]) => void
  }

  interface DatabaseConstructor {
    new (filename: string, options?: Options): Database
    (filename: string, options?: Options): Database
  }

  const Database: DatabaseConstructor
  export default Database
}
