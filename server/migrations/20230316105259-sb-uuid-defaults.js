exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE channel_messages
    ALTER COLUMN id SET DEFAULT sb_uuid();
  `)
  await db.runSql(`
    ALTER TABLE games
    ALTER COLUMN id SET DEFAULT sb_uuid();
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_completions
    ALTER COLUMN id SET DEFAULT sb_uuid();
  `)
  await db.runSql(`
    ALTER TABLE notifications
    ALTER COLUMN id SET DEFAULT sb_uuid();
  `)
  await db.runSql(`
    ALTER TABLE whisper_messages
    ALTER COLUMN id SET DEFAULT sb_uuid();
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE channel_messages
    ALTER COLUMN id SET DEFAULT uuid_generate_v4();
  `)
  await db.runSql(`
    ALTER TABLE games
    ALTER COLUMN id SET DEFAULT uuid_generate_v4();
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_completions
    ALTER COLUMN id SET DEFAULT uuid_generate_v4();
  `)
  await db.runSql(`
    ALTER TABLE notifications
    ALTER COLUMN id SET DEFAULT uuid_generate_v4();
  `)
  await db.runSql(`
    ALTER TABLE whisper_messages
    ALTER COLUMN id SET DEFAULT uuid_generate_v4();
  `)
}

exports._meta = {
  version: 1,
}
