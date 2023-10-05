exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE permissions
    ADD COLUMN manage_news boolean NOT NULL DEFAULT false;
  `)

  await db.runSql(`
    CREATE TABLE news_posts (
      id uuid PRIMARY KEY DEFAULT sb_uuid(),
      author_id integer REFERENCES users(id) ON DELETE SET NULL,
      cover_image_path text,
      title text NOT NULL,
      summary text NOT NULL,
      content text NOT NULL,
      published_at timestamp without time zone,
      updated_at timestamp without time zone NOT NULL DEFAULT now()
    );
  `)

  await db.runSql(`
    CREATE INDEX ON news_posts(published_at DESC);
  `)

  await db.runSql(`
    CREATE TABLE news_post_edits (
      id uuid PRIMARY KEY DEFAULT sb_uuid(),
      post_id uuid NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
      editor_id integer REFERENCES users(id) ON DELETE SET NULL,
      author_id integer REFERENCES users(id) ON DELETE SET NULL,
      cover_image_path text,
      title text NOT NULL,
      summary text NOT NULL,
      content text NOT NULL,
      published_at timestamp without time zone,
      edited_at timestamp without time zone NOT NULL DEFAULT now()
    );
  `)

  await db.runSql(`
    CREATE INDEX ON news_post_edits(post_id);
  `)
}

exports.down = async function (db) {
  await db.runSql(`DROP TABLE news_post_edits;`)
  await db.runSql(`DROP TABLE news_posts;`)

  await db.runSql(`
    ALTER TABLE permissions
    DROP COLUMN manage_news;
  `)
}

exports._meta = {
  version: 1,
}
