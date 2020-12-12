import db from '../db'
import sql from 'sql-template-strings'
import { MatchmakingType } from '../../../common/matchmaking'

export interface MatchmakingTime {
  id: string
  type: MatchmakingType
  startDate: number
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
    startDate: +props.start_date,
    enabled: props.enabled,
  }
}

/**
 * Retrieves a history of matchmaking times for a particular matchmaking type. History size can be
 * provided which will be used to retrieve (at most) that amount of history on both sides of the
 * date nearest to the current.
 */
export async function getMatchmakingTimesHistory(
  matchmakingType: MatchmakingType,
  historySize = 10,
): Promise<Array<MatchmakingTime | null>> {
  const query = sql`
    WITH mt AS (
      SELECT id, matchmaking_type, start_date, enabled, row_number() OVER (ORDER BY start_date DESC)
      FROM matchmaking_times
    ), current AS (
      SELECT row_number
      FROM mt
      WHERE matchmaking_type = ${matchmakingType} AND start_date < NOW()
      ORDER BY start_date DESC
      LIMIT 1
    )
    SELECT mt.*
    FROM mt, current
    WHERE matchmaking_type = ${matchmakingType}
      AND ABS(mt.row_number - current.row_number) <= ${historySize}
    ORDER BY mt.row_number;
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return result.rows.map(convertFromDb)
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

export async function getCurrentMatchmakingState(
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
