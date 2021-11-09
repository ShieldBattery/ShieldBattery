exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE users ADD COLUMN accepted_privacy_version INTEGER NOT NULL DEFAULT 0;
  `)
  await db.runSql(`
    ALTER TABLE users ADD COLUMN accepted_terms_version INTEGER NOT NULL DEFAULT 0;
  `)
  await db.runSql(`
    ALTER TABLE users ADD COLUMN accepted_use_policy_version INTEGER NOT NULL DEFAULT 0;
  `)
}

exports.down = async function (db) {
  await db.runSql('ALTER TABLE users DROP COLUMN accepted_use_policy_version;')
  await db.runSql('ALTER TABLE users DROP COLUMN accepted_terms_version;')
  await db.runSql('ALTER TABLE users DROP COLUMN accepted_privacy_version;')
}

exports._meta = {
  version: 1,
}
