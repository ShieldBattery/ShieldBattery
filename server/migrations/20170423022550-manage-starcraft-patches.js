exports.up = async function (db) {
  await db.runSql(`ALTER TABLE permissions
      ADD COLUMN manage_starcraft_patches boolean NOT NULL DEFAULT false;`)
  await db.runSql(`CREATE TABLE starcraft_patches (
      hash bytea NOT NULL,
      filename citext NOT NULL,
      version_desc text NOT NULL,

      PRIMARY KEY (hash, filename)
    );
  `)
}

exports.down = async function (db) {
  await db.runSql('ALTER TABLE permissions DROP COLUMN manage_starcraft_patches;')
  await db.runSql('DROP TABLE starcraft_patches')
}

exports._meta = {
  version: 1,
}
