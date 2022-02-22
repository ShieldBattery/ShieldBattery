exports.up = async function (db) {
  await db.runSql(`
    DROP TABLE invites;
  `)

  await db.runSql(`
    ALTER TABLE permissions
    DROP COLUMN accept_invites;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    CREATE TABLE invites (
      email varchar(100),
      token varchar(50),
      teamliquid_name varchar(20),
      os varchar(50),
      browser varchar(50),
      graphics varchar(50),
      can_host boolean,

      PRIMARY KEY (email)
    );
  `)

  await db.runSql(`
    ALTER TABLE permissions
    ADD COLUMN accept_invites boolean NOT NULL DEFAULT false;
  `)
}

exports._meta = {
  version: 1,
}
