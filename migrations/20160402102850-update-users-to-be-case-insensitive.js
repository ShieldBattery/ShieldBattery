exports.up = function(db, callback) {
  const sql =
    'DELETE FROM users WHERE id IN (SELECT id FROM users ' +
    'WHERE LOWER(name) IN (SELECT LOWER(name) FROM users GROUP BY LOWER(name) HAVING COUNT(*) > 1))'

  db.runSql(sql, maybeInstallCitextExtension)

  function maybeInstallCitextExtension(err) {
    if (err) {
      callback(err)
      return
    }

    const sql = 'CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public'
    db.runSql(sql, updateUsernames)
  }

  function updateUsernames(err) {
    if (err) {
      callback(err)
      return
    }

    const sql = 'ALTER TABLE users ALTER COLUMN name TYPE citext; ' +
      'ALTER TABLE users ALTER COLUMN name SET NOT NULL; ' +
      'ALTER TABLE users ADD CONSTRAINT name_length_check CHECK (length(name) <= 32)'
    db.runSql(sql, callback)
  }
}

exports.down = function(db, callback) {
  const sql = 'ALTER TABLE users ALTER COLUMN name TYPE varchar(32); ' +
    'ALTER TABLE users ALTER COLUMN name SET NOT NULL'
  db.runSql(sql, callback)
}
