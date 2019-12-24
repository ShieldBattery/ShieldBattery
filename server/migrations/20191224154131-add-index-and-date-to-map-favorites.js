exports.up = async function(db) {
  await db.runSql(`
    CREATE INDEX favorited_by_index ON favorited_maps (favorited_by);
  `)

  await db.runSql(`
    ALTER TABLE favorited_maps
    ADD COLUMN favorited_date timestamp without time zone;
  `)
}

exports.down = async function(db) {
  await db.runSql(`
    ALTER TABLE favorited_maps
    DROP COLUMN favorited_date;
  `)

  await db.runSql(`
    DROP INDEX favorited_by_index;
  `)
}

exports._meta = {
  version: 1,
}
