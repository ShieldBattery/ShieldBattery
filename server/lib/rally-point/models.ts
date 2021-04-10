import sql from 'sql-template-strings'
import { RallyPointServer } from '../../../common/rally-point'
import db from '../db/index'

/**
 * Retrieves the complete list of rally-point servers, ordered by ID.
 */
export async function retrieveRallyPointServers(): Promise<RallyPointServer[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<RallyPointServer>(sql`
      SELECT id, enabled, description, hostname, port
      FROM rally_point_servers
      ORDER BY id;
    `)
    return result.rows
  } finally {
    done()
  }
}

export async function addRallyPointServer(
  server: Omit<RallyPointServer, 'id'>,
): Promise<RallyPointServer> {
  const { client, done } = await db()
  try {
    const result = await client.query<RallyPointServer>(sql`
      INSERT INTO rally_point_servers (enabled, description, hostname, port)
      VALUES (${server.enabled}, ${server.description}, ${server.hostname}, ${server.port})
      RETURNING id, enabled, description, hostname, port;
    `)

    return result.rows[0]
  } finally {
    done()
  }
}

/**
 * Updates an existing rally-point server.
 * @returns The updated server, or undefined if no matching server was found
 */
export async function updateRallyPointServer(
  server: RallyPointServer,
): Promise<RallyPointServer | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<RallyPointServer>(sql`
      UPDATE rally_point_servers
      SET
        enabled = ${server.enabled},
        description = ${server.description},
        hostname = ${server.hostname},
        port = ${server.port}
      WHERE
        id = ${server.id}
      RETURNING id, enabled, description, hostname, port;
    `)

    return result.rowCount > 0 ? result.rows[0] : undefined
  } finally {
    done()
  }
}
