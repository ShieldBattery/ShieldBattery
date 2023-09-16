exports.up = async function (db) {
  await db.runSql(`
    DROP TABLE channel_banners;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    CREATE TABLE channel_banners (
      id uuid NOT NULL DEFAULT sb_uuid(),
      name text NOT NULL,
      limited boolean NOT NULL,
      available_in integer[] NOT NULL,
      image_path text NOT NULL,
      uploaded_at timestamp without time zone NOT NULL,
      updated_at timestamp without time zone NOT NULL,

      PRIMARY KEY (id)
    );
  `)

  // The first index here is mostly used for sorting in the admin panel, and the second index is
  // mostly used for the regular users.
  await db.runSql(`
    CREATE INDEX ON channel_banners(uploaded_at DESC);
    CREATE INDEX ON channel_banners(name DESC);
  `)
}

exports._meta = {
  version: 1,
}
