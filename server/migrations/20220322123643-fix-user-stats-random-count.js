exports.up = async function (db) {
  // Previous migration which initialized "random -> assigned race" stats was incorrectly counting
  // all games for each race, instead of just the games where the user selected random.
  for (const race of ['p', 't', 'z']) {
    await db.runSql(`
      UPDATE user_stats AS s
      SET r_${race}_wins = r.wins
      FROM (
        SELECT user_id, COUNT(*) as wins
        FROM games_users gu JOIN games g
          ON gu.game_id = g.id
        WHERE
          g.config->>'gameType' != 'ums' AND
          gu.selected_race = 'r' AND
          gu.assigned_race = '${race}' AND
          gu.result = 'win'
        GROUP BY user_id
      ) r
      WHERE s.user_id = r.user_id
    `)

    await db.runSql(`
      UPDATE user_stats AS s
      SET r_${race}_losses = r.losses
      FROM (
        SELECT user_id, COUNT(*) as losses
        FROM games_users gu JOIN games g
          ON gu.game_id = g.id
        WHERE
          g.config->>'gameType' != 'ums' AND
          gu.selected_race = 'r' AND
          gu.assigned_race = '${race}' AND
          gu.result = 'loss'
        GROUP BY user_id
      ) r
      WHERE s.user_id = r.user_id
    `)
  }
}

exports.down = async function (db) {
  // There's really no point in reverting the user stats to an incorrect count, so we just do
  // nothing here.
}

exports._meta = {
  version: 1,
}
