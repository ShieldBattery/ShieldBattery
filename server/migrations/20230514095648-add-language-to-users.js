exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE users
    ADD COLUMN language text;
  `)

  // Set existing users to english language
  await db.runSql(`
    UPDATE users
    SET language = 'en';
  `)

  // Make the column non-null
  await db.runSql(`
    ALTER TABLE users
    ALTER COLUMN language SET NOT NULL;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE users
    DROP COLUMN language;
  `)
}

exports._meta = {
  version: 1,
}
