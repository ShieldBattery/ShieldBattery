exports.up = async function(db) {
  await db.runSql(`
    ALTER TABLE users
    ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
  `)

  await db.runSql(`
    CREATE TABLE email_verifications (
      user_id integer NOT NULL,
      email varchar(100) NOT NULL,
      verification_code varchar(50) NOT NULL,
      request_time timestamp without time zone NOT NULL,
      request_ip inet NOT NULL,

      PRIMARY KEY (user_id, verification_code)
    );
  `)
}

exports.down = async function(db) {
  await db.runSql('ALTER TABLE users DROP COLUMN email_verified;')
  await db.runSql('DROP TABLE email_verifications;')
}

exports._meta = {
  version: 1,
}
