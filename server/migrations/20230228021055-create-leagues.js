exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE leagues (
      id uuid NOT NULL DEFAULT sb_uuid(),
      name text NOT NULL,
      description text NOT NULL,
      signups_after timestamp without time zone NOT NULL,
      start_at timestamp without time zone NOT NULL,
      end_at timestamp without time zone NOT NULL,
      image_path text,
      rules_and_info text,
      link text,

      PRIMARY KEY (id),
      CHECK (signups_after <= start_at),
      CHECK (start_at <= end_at)
    );
  `)

  // NOTE(tec27): My assumption here is that any query for start_at or signups_after will also
  // include an end_at filter, so indexes on those other columns would never be particularly useful
  await db.runSql(`
      CREATE INDEX ON leagues(end_at DESC);
  `)
}

exports.down = async function (db) {
  await db.runSql(`DROP TABLE leagues;`)
}

exports._meta = {
  version: 1,
}
