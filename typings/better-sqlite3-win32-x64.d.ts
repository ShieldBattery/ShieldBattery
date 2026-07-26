// better-sqlite3's platform-specific entrypoints export the same Database class as the default
// entrypoint; @types/better-sqlite3 only declares the latter.
declare module 'better-sqlite3/win32-x64' {
  import Database = require('better-sqlite3')
  export = Database
}
