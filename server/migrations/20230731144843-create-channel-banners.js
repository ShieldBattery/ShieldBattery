exports.up = async function (db) {
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
}

exports.down = async function (db) {
  await db.runSql(`
    DROP TABLE channel_banners;
  `)
}

exports._meta = {
  version: 1,
}
