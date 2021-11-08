exports.up = async function (db) {
  // NOTE(tec27): This assumes no games other than 1v1 have been played over matchmaking, which
  // should be a safe assumption at this point (but we can't assume the same in the reverse
  // migration).
  await db.runSql(`
    UPDATE games g
    SET config = jsonb_set(g.config, '{gameSourceExtra}', '{"type": "1v1"}', TRUE)
    WHERE g.config->>'gameSource' = 'MATCHMAKING';
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    UPDATE games g
    SET config = jsonb_set(g.config, '{gameSourceExtra}', '{"type": "1v1"}', TRUE)
    WHERE g.config->>'gameSource' = 'MATCHMAKING'
    AND g.config->'gameSourceExtra'->>'type' = '1v1';
  `)
}

exports._meta = {
  version: 1,
}
