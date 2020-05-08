exports.up = function (db, cb) {
  db.runSql(
    `
      CREATE TABLE whisper_sessions (
        user_id integer NOT NULL,
        target_user_id integer NOT NULL,
        start_date timestamp without time zone NOT NULL,
        PRIMARY KEY(user_id, target_user_id)
      );`,
    createUserIdIndex,
  )

  function createUserIdIndex(err) {
    if (err) {
      cb(err)
      return
    }

    db.addIndex(
      'whisper_sessions',
      'whisper_sessions_user_id_index',
      ['user_id'],
      false /* unique */,
      createWhisperMessages,
    )
  }

  function createWhisperMessages(err) {
    if (err) {
      cb(err)
      return
    }

    db.runSql(
      `
        CREATE TABLE whisper_messages (
          id uuid NOT NULL,
          from_id integer NOT NULL,
          to_id integer NOT NULL,
          sent timestamp without time zone NOT NULL,
          data jsonb NOT NULL,
          PRIMARY KEY(id)
        );`,
      createMessageDateIndex,
    )
  }

  function createMessageDateIndex(err) {
    if (err) {
      cb(err)
      return
    }

    db.runSql('CREATE INDEX whisper_messages_sent_index ON whisper_messages(sent DESC);', cb)
  }
}

exports.down = function (db, cb) {
  db.dropTable('whisper_sessions', dropMessages)

  function dropMessages(err) {
    if (err) {
      cb(err)
      return
    }

    db.dropTable('whisper_messages', cb)
  }
}
