exports.up = async function (db) {
  // We haven't really ever used this data anyway, and trying to massage the old data into the new
  // format is quite involved and not really worth.
  await db.runSql(`DROP TABLE user_ips`)

  await db.runSql(`
    CREATE TABLE user_ips (
      user_id integer NOT NULL,
      ip_address inet NOT NULL,
      first_used timestamp without time zone NOT NULL,
      last_used timestamp without time zone NOT NULL,
      times_seen integer NOT NULL DEFAULT 1,

      PRIMARY KEY (user_id, ip_address)
    );
  `)

  await db.runSql(`
    CREATE INDEX user_ips_ip_address_index ON user_ips (ip_address);
  `)
}

exports.down = async function (db) {
  await db.runSql(`DROP TABLE user_ips`)

  // These are just copied (and slightly reformatted) out of the old migrations
  await db.runSql(
    `
      CREATE TABLE user_ips (
        user_id integer NOT NULL,
        ip_address inet NOT NULL,
        first_used timestamp without time zone NOT NULL,
        last_used timestamp without time zone NOT NULL
      );`,
  )

  await db.addIndex('user_ips', 'user_ips_user_id_index', ['user_id'], false /* unique */)

  await db.addIndex('user_ips', 'user_ips_ip_address_index', ['ip_address'], false /* unique */)

  await db.runSql('ALTER TABLE user_ips ADD COLUMN user_ip_counter integer NOT NULL;')
  await db.addIndex('user_ips', 'user_ips_unique_user_ip_counter_index', [
    'user_id',
    'ip_address',
    'user_ip_counter',
  ])

  await db.runSql(
    `
    WITH dupe_entries AS (
      SELECT DISTINCT user_id, ip_address, user_ip_counter, MIN(first_used) as first_first_used
      FROM user_ips
      GROUP BY user_id, ip_address, user_ip_counter HAVING COUNT(*) > 1
    ) DELETE FROM user_ips USING dupe_entries
    WHERE user_ips.user_id = dupe_entries.user_id AND
        user_ips.ip_address = dupe_entries.ip_address AND
        user_ips.user_ip_counter = dupe_entries.user_ip_counter AND
        user_ips.first_used != dupe_entries.first_first_used;
  `,
  )
  await db.removeIndex('user_ips', 'user_ips_unique_user_ip_counter_index')
  await db.addIndex(
    'user_ips',
    'user_ips_unique_user_ip_counter_index',
    ['user_id', 'ip_address', 'user_ip_counter'],
    true /* unique */,
  )
}

exports._meta = {
  version: 1,
}
