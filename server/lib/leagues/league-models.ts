import sql from 'sql-template-strings'
import { Merge, OptionalKeysOf, RequiredKeysOf } from 'type-fest'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { appendToMultimap } from '../../../common/data-structures/maps'
import { League, LeagueId } from '../../../common/leagues'
import { MatchmakingResult, MatchmakingType } from '../../../common/matchmaking'
import { RaceStats } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user'
import db, { DbClient } from '../db'
import { Dbify } from '../db/types'
import { getUrl } from '../file-upload'

type DbLeague = Dbify<League>

function convertLeagueFromDb(props: DbLeague): League {
  return {
    id: props.id,
    name: props.name,
    matchmakingType: props.matchmaking_type,
    description: props.description,
    signupsAfter: props.signups_after,
    startAt: props.start_at,
    endAt: props.end_at,
    imagePath: props.image_path ? getUrl(props.image_path) : undefined,
    badgePath: props.badge_path ? getUrl(props.badge_path) : undefined,
    rulesAndInfo: props.rules_and_info,
    link: props.link,
  }
}

export async function createLeague(
  {
    name,
    matchmakingType,
    description,
    signupsAfter,
    startAt,
    endAt,
    imagePath,
    badgePath,
    rulesAndInfo,
    link,
  }: Omit<League, 'id'>,
  withClient?: DbClient,
): Promise<League> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbLeague>(sql`
      INSERT INTO leagues (
        name, matchmaking_type, description, signups_after, start_at, end_at,
        image_path, badge_path, rules_and_info, link
      ) VALUES (
        ${name}, ${matchmakingType}, ${description}, ${signupsAfter}, ${startAt}, ${endAt},
        ${imagePath}, ${badgePath}, ${rulesAndInfo}, ${link}
      ) RETURNING *
    `)
    return convertLeagueFromDb(result.rows[0])
  } finally {
    done()
  }
}

// TODO(tec27): Move this somewhere common
export type Patch<T extends object> = Merge<
  { [K in RequiredKeysOf<T>]?: T[K] },
  { [K in OptionalKeysOf<T>]?: T[K] | null }
>

export async function updateLeague(
  id: LeagueId,
  updates: Patch<Omit<League, 'id'>>,
  withClient?: DbClient,
): Promise<League> {
  const { client, done } = await db(withClient)
  try {
    const query = sql`
      UPDATE leagues
      SET
    `

    let first = true
    for (const [_key, value] of Object.entries(updates)) {
      if (value === undefined) {
        continue
      }

      const key = _key as keyof typeof updates
      if (!first) {
        query.append(sql`, `)
      } else {
        first = false
      }

      switch (key) {
        case 'name':
          query.append(sql`name = ${value}`)
          break
        case 'matchmakingType':
          query.append(sql`matchmaking_type = ${value}`)
          break
        case 'description':
          query.append(sql`description = ${value}`)
          break
        case 'signupsAfter':
          query.append(sql`signups_after = ${value}`)
          break
        case 'startAt':
          query.append(sql`start_at = ${value}`)
          break
        case 'endAt':
          query.append(sql`end_at = ${value}`)
          break
        case 'imagePath':
          query.append(sql`image_path = ${value}`)
          break
        case 'badgePath':
          query.append(sql`badge_path = ${value}`)
        case 'rulesAndInfo':
          query.append(sql`rules_and_info = ${value}`)
          break
        case 'link':
          query.append(sql`link = ${value}`)
          break

        default:
          assertUnreachable(key)
      }
    }

    if (first) {
      throw new Error('No columns updated')
    }

    query.append(sql`
      WHERE id = ${id}
      RETURNING *
    `)

    const result = await client.query<DbLeague>(query)
    return convertLeagueFromDb(result.rows[0])
  } finally {
    done()
  }
}

export async function deleteLeague(id: LeagueId, withClient?: DbClient): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      DELETE FROM leagues
      WHERE id = ${id}
    `)
  } finally {
    done()
  }
}

/** Returns a league with the matching ID if it exists and should be visible to normal users. */
export async function getLeague(
  id: LeagueId,
  now: Date,
  withClient?: DbClient,
): Promise<League | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query(sql`
      SELECT * FROM leagues
      WHERE id = ${id}
      AND signups_after <= ${now}
    `)

    return result.rows.length ? convertLeagueFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

export async function getLeaguesById(
  ids: ReadonlyArray<LeagueId>,
  withClient?: DbClient,
): Promise<League[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbLeague>(sql`
      SELECT * FROM leagues
      WHERE id = ANY(${ids})
    `)

    return result.rows.map(convertLeagueFromDb)
  } finally {
    done()
  }
}

// TODO(tec27): Paginate these queries
/**
 * Returns the leagues that have ended.
 */
export async function getPastLeagues(date: Date, withClient?: DbClient): Promise<League[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbLeague>(sql`
      SELECT *
      FROM leagues
      WHERE end_at <= ${date}
      ORDER BY end_at DESC
    `)
    return result.rows.map(convertLeagueFromDb)
  } finally {
    done()
  }
}

/**
 * Returns the leagues that are currently running.
 */
export async function getCurrentLeagues(date: Date, withClient?: DbClient): Promise<League[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbLeague>(sql`
      SELECT *
      FROM leagues
      WHERE start_at <= ${date} AND end_at > ${date}
      ORDER BY start_at DESC
    `)
    return result.rows.map(convertLeagueFromDb)
  } finally {
    done()
  }
}

/**
 * Returns the leagues that are accepting signups but not currently running.
 */
export async function getFutureLeagues(date: Date, withClient?: DbClient): Promise<League[]> {
  const { client, done } = await db(withClient)
  try {
    // TODO(tec27): Should this sort ascending instead? It's a bit confusing with the other 2
    // queries here but might do a better job of highlighting the "latest" leagues to sign up for
    const result = await client.query<DbLeague>(sql`
      SELECT *
      FROM leagues
      WHERE end_at > ${date} AND start_at > ${date} AND signups_after <= ${date}
      ORDER BY start_at DESC
    `)
    return result.rows.map(convertLeagueFromDb)
  } finally {
    done()
  }
}

export async function adminGetAllLeagues(withClient?: DbClient): Promise<League[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbLeague>(sql`
      SELECT *
      FROM leagues
      ORDER BY start_at DESC
    `)
    return result.rows.map(convertLeagueFromDb)
  } finally {
    done()
  }
}

export async function adminGetLeague(
  id: LeagueId,
  withClient?: DbClient,
): Promise<League | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbLeague>(sql`
      SELECT *
      FROM leagues
      WHERE id = ${id}
    `)

    return result.rows.length ? convertLeagueFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

export interface LeagueUser extends RaceStats {
  leagueId: LeagueId
  userId: SbUserId
  lastPlayedDate?: Date
  points: number
  pointsConverged: boolean
  wins: number
  losses: number
}

type DbLeagueUser = Dbify<LeagueUser>

function convertLeagueUserFromDb(dbUser: DbLeagueUser): LeagueUser {
  return {
    leagueId: dbUser.league_id,
    userId: dbUser.user_id,
    lastPlayedDate: dbUser.last_played_date,
    points: dbUser.points,
    pointsConverged: dbUser.points_converged,
    wins: dbUser.wins,
    losses: dbUser.losses,
    pWins: dbUser.p_wins,
    pLosses: dbUser.p_losses,
    tWins: dbUser.t_wins,
    tLosses: dbUser.t_losses,
    zWins: dbUser.z_wins,
    zLosses: dbUser.z_losses,
    rWins: dbUser.r_wins,
    rLosses: dbUser.r_losses,
    rPWins: dbUser.r_p_wins,
    rPLosses: dbUser.r_p_losses,
    rTWins: dbUser.r_t_wins,
    rTLosses: dbUser.r_t_losses,
    rZWins: dbUser.r_z_wins,
    rZLosses: dbUser.r_z_losses,
  }
}

export async function getLeagueUser(
  leagueId: LeagueId,
  userId: SbUserId,
  withClient?: DbClient,
): Promise<LeagueUser | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbLeagueUser>(sql`
      SELECT * FROM league_users
      WHERE league_id = ${leagueId} AND user_id = ${userId}
    `)

    return result.rows.length ? convertLeagueUserFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

export async function getManyLeagueUsers(
  leagueId: LeagueId,
  userIds: ReadonlyArray<SbUserId>,
  withClient?: DbClient,
): Promise<LeagueUser[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbLeagueUser>(sql`
      SELECT * FROM league_users
      WHERE league_id = ${leagueId} AND user_id = ANY(${userIds})
    `)

    return result.rows.map(convertLeagueUserFromDb)
  } finally {
    done()
  }
}

export async function getAllLeaguesForUser(
  userId: SbUserId,
  withClient?: DbClient,
): Promise<LeagueUser[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbLeagueUser>(sql`
      SELECT * FROM league_users
      WHERE user_id = ${userId}
    `)

    return result.rows.map(convertLeagueUserFromDb)
  } finally {
    done()
  }
}

export async function joinLeagueForUser(
  leagueId: LeagueId,
  userId: SbUserId,
  withClient?: DbClient,
): Promise<LeagueUser> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query(sql`
      INSERT INTO league_users (league_id, user_id)
      VALUES (${leagueId}, ${userId})
      RETURNING *
    `)

    return convertLeagueUserFromDb(result.rows[0])
  } finally {
    done()
  }
}

export async function updateLeagueUser(leagueUser: LeagueUser, client: DbClient) {
  await client.query(sql`
    UPDATE league_users
    SET
      last_played_date = ${leagueUser.lastPlayedDate},
      points = ${leagueUser.points},
      points_converged = ${leagueUser.pointsConverged},
      wins = ${leagueUser.wins},
      losses = ${leagueUser.losses},
      p_wins = ${leagueUser.pWins},
      p_losses = ${leagueUser.pLosses},
      t_wins = ${leagueUser.tWins},
      t_losses = ${leagueUser.tLosses},
      z_wins = ${leagueUser.zWins},
      z_losses = ${leagueUser.zLosses},
      r_wins = ${leagueUser.rWins},
      r_losses = ${leagueUser.rLosses},
      r_p_wins = ${leagueUser.rPWins},
      r_p_losses = ${leagueUser.rPLosses},
      r_t_wins = ${leagueUser.rTWins},
      r_t_losses = ${leagueUser.rTLosses},
      r_z_wins = ${leagueUser.rZWins},
      r_z_losses = ${leagueUser.rZLosses}
    WHERE league_id = ${leagueUser.leagueId} AND user_id = ${leagueUser.userId}
  `)
}

/**
 * Returns a Map of `userId` -> `LeagueUser`s for all specified users where the leagues are of
 * `matchmakingType` and running as of `atDate`.
 */
export async function getActiveLeaguesForUsers(
  userIds: ReadonlyArray<SbUserId>,
  matchmakingType: MatchmakingType,
  atDate: Date,
  withClient?: DbClient,
): Promise<Map<SbUserId, LeagueUser[]>> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query(sql`
      SELECT lu.*
      FROM league_users lu
      JOIN leagues l ON l.id = lu.league_id
      WHERE lu.user_id = ANY(${userIds})
        AND l.end_at > ${atDate}
        AND l.start_at <= ${atDate}
        AND l.matchmaking_type = ${matchmakingType}
    `)

    const leaguesByUser: Map<SbUserId, LeagueUser[]> = new Map()
    for (const row of result.rows) {
      const leagueUser = convertLeagueUserFromDb(row)
      appendToMultimap(leaguesByUser, leagueUser.userId, leagueUser)
    }

    return leaguesByUser
  } finally {
    done()
  }
}

export interface LeagueUserChange {
  userId: SbUserId
  leagueId: LeagueId
  gameId: string
  changeDate: Date

  outcome: MatchmakingResult
  points: number
  pointsChange: number
  pointsConverged: boolean
}

type DbLeagueUserChange = Dbify<LeagueUserChange>

function convertLeagueUserChangeFromDb(dbChange: DbLeagueUserChange): LeagueUserChange {
  return {
    userId: dbChange.user_id,
    leagueId: dbChange.league_id,
    gameId: dbChange.game_id,
    changeDate: dbChange.change_date,
    outcome: dbChange.outcome,
    points: dbChange.points,
    pointsChange: dbChange.points_change,
    pointsConverged: dbChange.points_converged,
  }
}

export async function insertLeagueUserChange(
  change: LeagueUserChange,
  client: DbClient,
): Promise<void> {
  await client.query(sql`
    INSERT INTO league_user_changes
      (user_id, league_id, game_id, change_date, outcome, points, points_change, points_converged)
    VALUES
      (${change.userId}, ${change.leagueId}, ${change.gameId}, ${change.changeDate},
       ${change.outcome}, ${change.points}, ${change.pointsChange}, ${change.pointsConverged})
  `)
}

export async function getLeagueUserChangesForGame(
  gameId: string,
  withClient?: DbClient,
): Promise<LeagueUserChange[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbLeagueUserChange>(sql`
      SELECT * FROM league_user_changes
      WHERE game_id = ${gameId}
    `)

    return result.rows.map(convertLeagueUserChangeFromDb)
  } finally {
    done()
  }
}
