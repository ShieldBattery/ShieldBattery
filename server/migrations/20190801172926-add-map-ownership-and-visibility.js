exports.up = async function(db) {
  // We empty out the `maps` table because any map that doesn't have a valid owner set is pretty
  // much useless in our application. We're not deleting the actual map/image files on disk, but
  // since the map upload feature was not even turned on on the production servers so far, it
  // shouldn't be a problem.
  await db.runSql(`
    TRUNCATE maps;
  `)

  await db.runSql(`
    ALTER TABLE maps
    ADD COLUMN uploaded_by integer NOT NULL,
    ADD COLUMN visibility map_visibility NOT NULL DEFAULT 'PRIVATE';
  `)

  await db.runSql(`
    ALTER TABLE maps
    ADD CONSTRAINT fk_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users (id);
  `)

  await db.runSql(`
    CREATE INDEX uploaded_by_index ON maps (uploaded_by);
    CREATE INDEX visibility_index ON maps (visibility);
  `)
}

exports.down = async function(db) {
  await db.runSql(`
    DROP INDEX uploaded_by_index;
    DROP INDEX visibility_index;
  `)

  await db.runSql(`
    ALTER TABLE maps
    DROP CONSTRAINT fk_uploaded_by;
  `)

  await db.runSql(`
    ALTER TABLE maps
    DROP COLUMN uploaded_by,
    DROP COLUMN visibility;
  `)
}

exports._meta = {
  version: 1,
}
