exports.up = async function (db) {
  // Alter all news_posts timestamp columns to have timezone info
  await db.runSql(`
    ALTER TABLE news_posts
    ALTER COLUMN published_at TYPE timestamptz USING published_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
  `)

  // Alter all news_post_edits timestamp columns to have timezone info
  await db.runSql(`
    ALTER TABLE news_post_edits
    ALTER COLUMN published_at TYPE timestamptz USING published_at AT TIME ZONE 'UTC',
    ALTER COLUMN edited_at TYPE timestamptz USING edited_at AT TIME ZONE 'UTC';
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE news_posts
    ALTER COLUMN published_at TYPE timestamp without time zone USING
      published_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE timestamp without time zone USING updated_at AT TIME ZONE 'UTC';
  `)

  await db.runSql(`
    ALTER TABLE news_post_edits
    ALTER COLUMN published_at TYPE timestamp without time zone USING
      published_at AT TIME ZONE 'UTC',
    ALTER COLUMN edited_at TYPE timestamp without time zone USING edited_at AT TIME ZONE 'UTC';
  `)
}

exports._meta = {
  version: 1,
}
