exports.up = async function(db) {
  // We empty out the `maps` table because any map that doesn't have a valid owner set is pretty
  // much useless in our application. We're not deleting the actual map/image files on disk, but
  // since the map upload feature was not even available on the production servers so far, it
  // shouldn't be a problem.
  await db.runSql(`
    TRUNCATE maps;
  `)

  // Dropping columns for `filename` and `modified_time` because that information is really not that
  // useful to us. It's an information about actual files on user's disk, which we're moving away
  // from. The `uploaded_time` column is not actually being removed, just transferred to the new
  // table.
  await db.runSql(`
    ALTER TABLE maps
    DROP COLUMN filename,
    DROP COLUMN upload_time,
    DROP COLUMN modified_time;
  `)

  // Since technically two different users can upload a same map (the one with the same calculated
  // hash value), we create a table specifically to support that use case.
  // NOTE: We've created a composite primary key by putting `uploaded_by` first, because searching
  // by `x` in a (x, y) composite key is pretty fast, while searching by `y` not so much. Since
  // we'll only exclusively search by `uploaded_by` and `visibility` columns in this table, we don't
  // have to create an index for the `map_hash` column.
  await db.runSql(`
    CREATE TABLE uploaded_maps (
      map_hash bytea NOT NULL,
      uploaded_by integer NOT NULL,
      upload_date timestamp without time zone NOT NULL,
      visibility map_visibility NOT NULL DEFAULT 'PRIVATE',

      PRIMARY KEY(uploaded_by, map_hash),
      FOREIGN KEY (map_hash) REFERENCES maps (hash),
      FOREIGN KEY (uploaded_by) REFERENCES users (id)
    );
  `)

  await db.runSql(`
    CREATE INDEX visibility_index ON uploaded_maps (visibility);
  `)
}

exports.down = async function(db) {
  await db.runSql(`
    DROP INDEX visibility_index;
  `)

  await db.runSql(`
    DROP TABLE uploaded_maps;
  `)

  await db.runSql(`
    ALTER TABLE maps
    ADD COLUMN filename varchar(32) NOT NULL,
    ADD COLUMN upload_time timestamp without time zone NOT NULL,
    ADD COLUMN modified_time timestamp without time zone NOT NULL;
  `)
}

exports._meta = {
  version: 1,
}
