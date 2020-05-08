exports.up = function (db, callback) {
  const sql =
    'DELETE FROM users WHERE id IN (SELECT id FROM users as u1 ' +
    'WHERE 1 = (SELECT 1 FROM users as u2 WHERE LOWER(u1.name) = LOWER(u2.name) ' +
    'AND u1.id > u2.id GROUP BY LOWER(u1.name)))'

  db.runSql(sql, updateUsernames)

  function updateUsernames(err) {
    if (err) {
      callback(err)
      return
    }

    const sql =
      'ALTER TABLE users ALTER COLUMN name TYPE citext; ' +
      'ALTER TABLE users ADD CONSTRAINT name_length_check CHECK (length(name) <= 32)'
    db.runSql(sql, callback)
  }
}

exports.down = function (db, callback) {
  const sql =
    'ALTER TABLE users ALTER COLUMN name TYPE varchar(32); ' +
    'ALTER TABLE users DROP CONSTRAINT name_length_check'
  db.runSql(sql, callback)
}
