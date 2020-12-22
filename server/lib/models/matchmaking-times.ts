import db from '../db'
import sql from 'sql-template-strings'
import { MatchmakingType } from '../../../common/matchmaking'

export interface MatchmakingTime {
  id: string
  type: MatchmakingType
  startDate: Date
  enabled: boolean
}

function convertFromDb(props: {
  /* eslint-disable camelcase */
  id: string
  matchmaking_type: MatchmakingType
  start_date: Date
  enabled: boolean
  /* eslint-enable camelcase */
}): MatchmakingTime {
  return {
    id: props.id,
    type: props.matchmaking_type,
    startDate: props.start_date,
    enabled: props.enabled,
  }
}

export async function getCurrentMatchmakingTime(
  matchmakingType: MatchmakingType,
): Promise<MatchmakingTime | null> {
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
    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : null
  } finally {
    done()
  }
}

enum TimesPeriod {
  Future,
  Past,
}

async function getTotalTimes(
  matchmakingType: MatchmakingType,
  date = new Date(),
  period = TimesPeriod.Future,
): Promise<number> {
  const query = sql`
    SELECT COUNT(*)
    FROM matchmaking_times
    WHERE matchmaking_type = ${matchmakingType} AND start_date
  `
    .append(period === TimesPeriod.Future ? '>' : '<')
    .append(sql`${date};`)

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return parseInt(result.rows[0].count, 10)
  } finally {
    done()
  }
}

/**
 * Get future N (where N defaults to 10) matchmaking times after date X (where X defaults to current
 * date) for a particular matchmaking type. Also has the paging support.
 */
export async function getFutureMatchmakingTimes(
  matchmakingType: MatchmakingType,
  date = new Date(),
  limit = 10,
  page = 0,
): Promise<{
  futureTimes: MatchmakingTime[]
  totalFutureTimes: number
}> {
  // To make sure the results are ordered in expected order, we first use the ascending order in the
  // sub-query to get the given page of times, then reverse the order of results in the outer query,
  // so that the newest time is on top.
  const query = sql`
    WITH times AS (
      SELECT *
      FROM matchmaking_times
      WHERE matchmaking_type = ${matchmakingType} AND start_date > ${date}
      ORDER BY start_date ASC
      LIMIT ${limit}
      OFFSET ${page * limit}
    )
    SELECT *
    FROM times
    ORDER BY start_date DESC;
  `

  const { client, done } = await db()
  try {
    const [total, result] = await Promise.all([
      getTotalTimes(matchmakingType, date, TimesPeriod.Future),
      client.query(query),
    ])
    return {
      futureTimes: result.rows.map(r => convertFromDb(r)),
      totalFutureTimes: total,
    }
  } finally {
    done()
  }
}

/**
 * Get past N (where N defaults to 10) matchmaking times before date X (where X defaults to current
 * date) for a particular matchmaking type. Also has the paging support.
 */
export async function getPastMatchmakingTimes(
  matchmakingType: MatchmakingType,
  date = new Date(),
  limit = 10,
  page = 0,
): Promise<{
  pastTimes: MatchmakingTime[]
  totalPastTimes: number
}> {
  const query = sql`
    SELECT *
    FROM matchmaking_times
    WHERE matchmaking_type = ${matchmakingType} AND start_date < ${date}
    ORDER BY start_date DESC
    LIMIT ${limit}
    OFFSET ${page * limit};
  `

  const { client, done } = await db()
  try {
    const [total, result] = await Promise.all([
      getTotalTimes(matchmakingType, date, TimesPeriod.Past),
      client.query(query),
    ])
    return {
      pastTimes: result.rows.map(r => convertFromDb(r)),
      totalPastTimes: total,
    }
  } finally {
    done()
  }
}

/**
 * Get matchmaking schedule. The schedule represents future N (where N defaults to 2) matchmaking
 * times, starting with a first S (where S defaults to enabled) status, after date X (where X
 * defaults to current date) for a particular matchmaking type. Additionally, all subsequent
 * matchmaking times with the same enabled status as the one before them are filtered out.
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
