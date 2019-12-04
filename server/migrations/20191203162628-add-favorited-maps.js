exports.up = async function(db) {
  await db.runSql(`
    CREATE TABLE favorited_maps (
      map_id uuid NOT NULL,
      favorited_by integer NOT NULL,

      PRIMARY KEY (map_id, favorited_by),
      FOREIGN KEY (map_id) REFERENCES uploaded_maps (id),
      FOREIGN KEY (favorited_by) REFERENCES users (id)
    );
  `)
}

exports.down = async function(db) {
  await db.runSql(`
    DROP TABLE favorited_maps;
  `)
}

exports._meta = {
  version: 1,
}
