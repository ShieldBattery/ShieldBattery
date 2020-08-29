import db from '../db'
import sql from 'sql-template-strings'

class Permissions {
  constructor(props) {
    this.editPermissions = props.edit_permissions
    this.debug = props.debug
    this.acceptInvites = props.accept_invites
    this.editAllChannels = props.edit_all_channels
    this.banUsers = props.ban_users
    this.manageMaps = props.manage_maps
    this.manageMapPools = props.manage_map_pools
    this.massDeleteMaps = props.mass_delete_maps
  }
}

export async function createPermissions(dbClient, userId) {
  const query = sql`
    INSERT INTO permissions (user_id) VALUES (${userId}) RETURNING *;
  `

  const result = await dbClient.query(query)
  if (result.rows.length < 1) throw new Error('No rows returned')
  return new Permissions(result.rows[0])
}

export async function getPermissions(userId) {
  const query = sql`
    SELECT user_id, edit_permissions, debug, accept_invites, edit_all_channels, ban_users,
        manage_maps, manage_map_pools, mass_delete_maps
    FROM permissions
    WHERE user_id = ${userId};
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return new Permissions(result.rows[0])
  } finally {
    done()
  }
}

export async function updatePermissions(userId, perms) {
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
      mass_delete_maps = ${!!perms.massDeleteMaps}
    WHERE user_id = ${userId}
    RETURNING *;
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return new Permissions(result.rows[0])
  } finally {
    done()
  }
}
