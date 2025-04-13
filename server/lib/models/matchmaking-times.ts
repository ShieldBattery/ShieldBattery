import { MatchmakingType } from '../../../common/matchmaking'
import { MatchmakingTime } from '../../../common/matchmaking/matchmaking-times'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

type DbMatchmakingTime = Dbify<MatchmakingTime>

function convertFromDb(props: DbMatchmakingTime): MatchmakingTime {
  return {
    id: props.id,
    matchmakingType: props.matchmaking_type,
    startDate: props.start_date,
    enabled: props.enabled,
  }
}

export async function getCurrentMatchmakingTime(
  matchmakingType: MatchmakingType,
): Promise<MatchmakingTime | undefined> {
  const query = sql`
    SELECT *
    FROM matchmaking_times
    WHERE matchmaking_type = ${matchmakingType} AND start_date <= ${new Date()}
    ORDER BY start_date DESC
    LIMIT 1;
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/**
 * Returns a list of matchmaking times *after* a particular date.
 */
export async function getFutureMatchmakingTimes(
  {
    matchmakingType,
    date,
    limit,
    offset,
  }: {
    matchmakingType: MatchmakingType
    date: Date
    limit: number
    offset: number
  },
  withClient?: DbClient,
): Promise<MatchmakingTime[]> {
  const query = sql`
    SELECT *
    FROM matchmaking_times
    WHERE matchmaking_type = ${matchmakingType} AND start_date > ${date}
    ORDER BY start_date ASC
    LIMIT ${limit}
    OFFSET ${offset};
  `

  const { client, done } = await db(withClient)
  try {
    const result = await client.query(query)
    return result.rows.map(r => convertFromDb(r))
  } finally {
    done()
  }
}

/**
 * Returns a list of matchmaking times *before* a particular date.
 */
export async function getPastMatchmakingTimes(
  {
    matchmakingType,
    date,
    limit,
    offset,
  }: {
    matchmakingType: MatchmakingType
    date: Date
    limit: number
    offset: number
  },
  withClient?: DbClient,
): Promise<MatchmakingTime[]> {
  const query = sql`
    SELECT *
    FROM matchmaking_times
    WHERE matchmaking_type = ${matchmakingType} AND start_date < ${date}
    ORDER BY start_date DESC
    LIMIT ${limit}
    OFFSET ${offset};
  `

  const { client, done } = await db(withClient)
  try {
    const result = await client.query(query)
    return result.rows.map(r => convertFromDb(r))
  } finally {
    done()
  }
}

/**
 * Retrieve the schedule of currently applicable matchmaking status changes. The schedule represents
 * future N (where N defaults to 2) matchmaking times, starting with a first S (where S defaults to
 * enabled) status, after date X (where X defaults to current date) for a particular matchmaking
 * type. Additionally, all subsequent matchmaking times with the same enabled status as the one
 * before them are filtered out.
 */
export async function getMatchmakingSchedule(
  matchmakingType: MatchmakingType,
  date = new Date(),
  firstStatus = true,
  depth = 2,
): Promise<Array<MatchmakingTime>> {
  const query = sql`
    WITH RECURSIVE schedule AS (
      (SELECT *, 0 AS depth
      FROM matchmaking_times AS mt
      WHERE mt.matchmaking_type = ${matchmakingType} AND mt.enabled = ${firstStatus}
        AND mt.start_date > ${date}
      ORDER BY mt.start_date
      LIMIT 1)

      UNION ALL

      (SELECT mt.*, s.depth + 1 AS depth
      FROM matchmaking_times AS mt, schedule s
      WHERE mt.matchmaking_type = s.matchmaking_type AND mt.enabled != s.enabled
        AND mt.start_date > s.start_date
      ORDER BY mt.start_date
      LIMIT 1)
    )
    SELECT *
    FROM schedule
    WHERE depth <= ${depth}
    ORDER BY start_date;
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return result.rows.map(r => convertFromDb(r))
  } finally {
    done()
  }
}

export async function addMatchmakingTime(
  matchmakingType: MatchmakingType,
  startDate: Date,
  enabled: boolean,
): Promise<MatchmakingTime> {
  const query = sql`
    INSERT INTO matchmaking_times (matchmaking_type, start_date, enabled)
    VALUES (${matchmakingType}, ${startDate}, ${enabled})
    RETURNING *;
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return convertFromDb(result.rows[0])
  } finally {
    done()
  }
}

export async function getMatchmakingTimeById(id: string): Promise<MatchmakingTime | null> {
  const query = sql`
    SELECT *
    FROM matchmaking_times
    WHERE id = ${id};
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : null
  } finally {
    done()
  }
}

export async function removeMatchmakingTime(id: string): Promise<void> {
  const query = sql`
    DELETE FROM matchmaking_times
    WHERE id = ${id};
  `

  const { client, done } = await db()
  try {
    await client.query(query)
  } finally {
    done()
  }
}
