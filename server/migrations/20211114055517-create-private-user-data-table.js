exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE users_private AS
      SELECT id as user_id, password FROM users;
  `)
  await db.runSql(`
    ALTER TABLE users_private ADD PRIMARY KEY (user_id);
  `)
  await db.runSql(`
    ALTER TABLE users_private
    ADD CONSTRAINT users_private_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES users (id);
  `)

  await db.runSql(`
    ALTER TABLE users DROP COLUMN password;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE users ADD COLUMN password varchar(60) NULL;
  `)
  await db.runSql(`
    UPDATE users
    SET password = p.password
    FROM users_private p
    WHERE users.id = p.user_id;
  `)
  await db.runSql(`
    ALTER TABLE users
    ALTER COLUMN password SET NOT NULL;
  `)
  await db.runSql(`
    DROP TABLE users_private;
  `)
}

exports._meta = {
  version: 1,
}
