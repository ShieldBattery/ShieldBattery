exports.up = function(db, cb) {
  db.runSql(
    `
      CREATE TABLE joined_channels (
        user_id integer NOT NULL,
        channel_name citext NOT NULL,
        join_date timestamp without time zone NOT NULL,
        PRIMARY KEY(user_id, channel_name)
      );`,
    addJoinedConstraints,
  )

  function addJoinedConstraints(err) {
    if (err) {
      cb(err)
      return
    }

    const sql = `ALTER TABLE joined_channels ADD CONSTRAINT
        channel_name_length_check CHECK (length(channel_name) <= 64);`
    db.runSql(sql, createJoinedChannelIndex)
  }

  function createJoinedChannelIndex(err) {
    if (err) {
      cb(err)
      return
    }

    // Composite key (x, y) is plenty fast for searching by x, but not as optimal for searching by
    // just y. Given that we'll want to enumerate all the users in a channel a lot, we add an index
    // on that to ensure it will be a faster lookup
    // See: http://dba.stackexchange.com/questions/6115/working-of-indexes-in-postgresql
    db.addIndex(
      'joined_channels',
      'joined_channels_name_index',
      ['channel_name'],
      false /* unique */,
      createChannelMessages,
    )
  }

  function createChannelMessages(err) {
    if (err) {
      cb(err)
      return
    }

    db.runSql(
      `
        CREATE TABLE channel_messages (
          id uuid NOT NULL,
          user_id integer NOT NULL,
          channel_name citext NOT NULL,
          sent timestamp without time zone NOT NULL,
          data jsonb NOT NULL,
          PRIMARY KEY(id)
        );`,
      createChannelNameIndex,
    )
  }

  function createChannelNameIndex(err) {
    if (err) {
      cb(err)
      return
    }

    db.addIndex(
      'channel_messages',
      'channel_messages_channel_index',
      ['channel_name'],
      false /* unique */,
      createMessageDateIndex,
    )
  }

  function createMessageDateIndex(err) {
    if (err) {
      cb(err)
      return
    }

    db.runSql(
      'CREATE INDEX channel_messages_sent_index ON channel_messages(sent DESC);',
      addInitialChannel,
    )
  }

  function addInitialChannel(err) {
    if (err) {
      cb(err)
      return
    }

    db.runSql(
      `INSERT INTO joined_channels
        SELECT id as user_id,
        'ShieldBattery'::citext as channel_name,
        CURRENT_TIMESTAMP AT TIME ZONE 'UTC' as join_date FROM users;`,
      cb,
    )
  }
}

exports.down = function(db, cb) {
  db.dropTable('joined_channels', dropMessages)

  function dropMessages(err) {
    if (err) {
      cb(err)
      return
    }

    db.dropTable('channel_messages', cb)
  }
}
