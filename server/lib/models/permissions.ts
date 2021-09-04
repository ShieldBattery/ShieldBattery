import sql from 'sql-template-strings'
import { SbPermissions } from '../../../common/users/permissions'
import db, { DbClient } from '../db'
import { Dbify } from '../db/types'

type DbPermissions = Dbify<SbPermissions>

function convertFromDb(props: DbPermissions): SbPermissions {
  return {
    editPermissions: props.edit_permissions,
    debug: props.debug,
    acceptInvites: props.accept_invites,
    editAllChannels: props.edit_all_channels,
    banUsers: props.ban_users,
    manageMaps: props.manage_maps,
    manageMapPools: props.manage_map_pools,
    manageMatchmakingTimes: props.manage_matchmaking_times,
    manageRallyPointServers: props.manage_rally_point_servers,
    massDeleteMaps: props.mass_delete_maps,
  }
}

export async function createPermissions(
  dbClient: DbClient,
  userId: number,
): Promise<SbPermissions> {
  const query = sql`
    INSERT INTO permissions (user_id) VALUES (${userId}) RETURNING *;
  `

  const result = await dbClient.query(query)
  if (result.rowCount < 1) throw new Error('No rows returned')
  return convertFromDb(result.rows[0])
}

export async function getPermissions(userId: number) {
  const query = sql`
    SELECT user_id, edit_permissions, debug, accept_invites, edit_all_channels, ban_users,
        manage_maps, manage_map_pools, mass_delete_maps, manage_matchmaking_times,
        manage_rally_point_servers
    FROM permissions
    WHERE user_id = ${userId};
  `

  const { client, done } = await db()
  try {
    const result = await client.query<DbPermissions>(query)
    return convertFromDb(result.rows[0])
  } finally {
    done()
  }
}

export async function updatePermissions(userId: number, perms: SbPermissions) {
  const query = sql`
    UPDATE permissions
    SET
      edit_permissions = ${!!perms.editPermissions},
      debug = ${!!perms.debug},
      accept_invites = ${!!perms.acceptInvites},
      edit_all_channels = ${!!perms.editAllChannels},
      ban_users = ${!!perms.banUsers},
      manage_maps = ${!!perms.manageMaps},
      manage_map_pools = ${!!perms.manageMapPools},
      mass_delete_maps = ${!!perms.massDeleteMaps},
      manage_matchmaking_times = ${!!perms.manageMatchmakingTimes},
      manage_rally_point_servers = ${!!perms.manageRallyPointServers}
    WHERE user_id = ${userId}
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
