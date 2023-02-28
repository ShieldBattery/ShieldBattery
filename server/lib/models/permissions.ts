import sql from 'sql-template-strings'
import { SbPermissions } from '../../../common/users/permissions'
import { SbUserId } from '../../../common/users/sb-user'
import db, { DbClient } from '../db'
import { Dbify } from '../db/types'

type DbPermissions = Dbify<SbPermissions>

function convertFromDb(props: DbPermissions): SbPermissions {
  return {
    editPermissions: props.edit_permissions,
    debug: props.debug,
    banUsers: props.ban_users,
    manageLeagues: props.manage_leagues,
    manageMaps: props.manage_maps,
    manageMapPools: props.manage_map_pools,
    manageMatchmakingSeasons: props.manage_matchmaking_seasons,
    manageMatchmakingTimes: props.manage_matchmaking_times,
    manageRallyPointServers: props.manage_rally_point_servers,
    massDeleteMaps: props.mass_delete_maps,
    moderateChatChannels: props.moderate_chat_channels,
  }
}

export async function createPermissions(
  dbClient: DbClient,
  userId: SbUserId,
): Promise<SbPermissions> {
  const query = sql`
    INSERT INTO permissions (user_id) VALUES (${userId}) RETURNING *;
  `

  const result = await dbClient.query(query)
  if (result.rowCount < 1) throw new Error('No rows returned')
  return convertFromDb(result.rows[0])
}

export async function getPermissions(userId: SbUserId): Promise<SbPermissions | undefined> {
  const query = sql`
    SELECT user_id, edit_permissions, debug, ban_users, manage_leagues, manage_maps,
        manage_map_pools, mass_delete_maps, manage_matchmaking_times, manage_rally_point_servers,
        moderate_chat_channels, manage_matchmaking_seasons
    FROM permissions
    WHERE user_id = ${userId};
  `

  const { client, done } = await db()
  try {
    const result = await client.query<DbPermissions>(query)
    return result.rows.length ? convertFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

export async function updatePermissions(
  userId: SbUserId,
  perms: SbPermissions,
): Promise<SbPermissions | undefined> {
  const query = sql`
    UPDATE permissions
    SET
      edit_permissions = ${!!perms.editPermissions},
      debug = ${!!perms.debug},
      ban_users = ${!!perms.banUsers},
      manage_leagues = ${!!perms.manageLeagues},
      manage_maps = ${!!perms.manageMaps},
      manage_map_pools = ${!!perms.manageMapPools},
      mass_delete_maps = ${!!perms.massDeleteMaps},
      manage_matchmaking_times = ${!!perms.manageMatchmakingTimes},
      manage_rally_point_servers = ${!!perms.manageRallyPointServers},
      moderate_chat_channels=${!!perms.moderateChatChannels},
      manage_matchmaking_seasons=${!!perms.manageMatchmakingSeasons}
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
