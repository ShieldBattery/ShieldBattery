exports.up = async function (db) {
  await db.runSql(`
      ALTER TABLE permissions
      ADD COLUMN manage_bug_reports boolean NOT NULL DEFAULT false;
    `)

  // Create a table to contain the bug reports
  await db.runSql(`
    CREATE TABLE bug_reports (
      id uuid PRIMARY KEY DEFAULT sb_uuid(),
      submitter_id integer REFERENCES users(id) ON DELETE SET NULL,
      details text NOT NULL,
      logs_deleted boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now(),
      resolved_at timestamp,
      resolver_id integer REFERENCES users(id) ON DELETE SET NULL
    );
  `)

  await db.runSql(`
      CREATE INDEX ON bug_reports(id) WHERE resolved_at IS NULL;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
      ALTER TABLE permissions
      DROP COLUMN manage_bug_reports;
    `)

  await db.runSql(`DROP TABLE bug_reports;`)
}

exports._meta = {
  version: 1,
}
