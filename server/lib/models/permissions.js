import db from '../db'

class Permissions {
  constructor(props) {
    this.editPermissions = props.edit_permissions
    this.debug = props.debug
    this.acceptInvites = props.accept_invites
    this.editAllChannels = props.edit_all_channels
    this.banUsers = props.ban_users
    this.manageMaps = props.manage_maps
    this.manageStarcraftPatches = props.manage_starcraft_patches
  }
}

export async function createPermissions(dbClient, userId) {
  const query = 'INSERT INTO permissions (user_id) VALUES ($1) RETURNING *'
  const params = [ userId ]

  const result = await dbClient.queryPromise(query, params)
  if (result.rows.length < 1) throw new Error('No rows returned')
  return new Permissions(result.rows[0])
}

export async function getPermissions(userId) {
  const query = `
    SELECT user_id, edit_permissions, debug, accept_invites, edit_all_channels, ban_users,
        manage_maps, manage_starcraft_patches
    FROM permissions
    WHERE user_id = $1
  `
  const params = [ userId ]

  const { client, done } = await db()
  try {
    const result = await client.queryPromise(query, params)
    return new Permissions(result.rows[0])
  } finally {
    done()
  }
}

export async function updatePermissions(userId, perms) {
  const query = `
    UPDATE permissions SET edit_permissions = $2, debug = $3, accept_invites = $4,
        edit_all_channels = $5, ban_users = $6, manage_maps = $7, manage_starcraft_patches = $8
    WHERE user_id = $1
    RETURNING *
  `
  const params = [
    userId,
    !!perms.editPermissions,
    !!perms.debug,
    !!perms.acceptInvites,
    !!perms.editAllChannels,
    !!perms.banUsers,
    !!perms.manageMaps,
    !!perms.manageStarcraftPatches,
  ]

  const { client, done } = await db()
  try {
    const result = await client.queryPromise(query, params)
    return new Permissions(result.rows[0])
  } finally {
    done()
  }
}
