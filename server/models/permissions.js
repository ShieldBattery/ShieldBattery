import db from '../db'

class Permissions {
  constructor(props) {
    this.editPermissions = props.edit_permissions
    this.debug = props.debug
    this.acceptInvites = props.accept_invites
    this.editAllChannels = props.edit_all_channels
    this.banUsers = props.ban_users
  }
}

async function createPermissions(dbClient, userId) {
  const query = 'INSERT INTO permissions (user_id) VALUES ($1) RETURNING *'
  const params = [ userId ]

  const result = await dbClient.queryPromise(query, params)
  if (result.rows.length < 1) throw new Error('No rows returned')
  return new Permissions(result.rows[0])
}

async function getPermissions(userId) {
  const query =
    `SELECT user_id, edit_permissions, debug, accept_invites, edit_all_channels, ban_users
    FROM permissions WHERE user_id = $1`
  const params = [ userId ]

  const { client, done } = await db()
  try {
    const result = await client.queryPromise(query, params)
    return new Permissions(result.rows[0])
  } finally {
    done()
  }
}

async function updatePermissions(userId, perms) {
  const query =
    `UPDATE permissions SET edit_permissions = $1, debug = $2, accept_invites = $3,
    edit_all_channels = $4, ban_users = $5 WHERE user_id = $6 RETURNING *`
  const params = [
    !!perms.editPermissions,
    !!perms.debug,
    !!perms.acceptInvites,
    !!perms.editAllChannels,
    !!perms.banUsers,
    userId
  ]

  const { client, done } = await db()
  try {
    const result = await client.queryPromise(query, params)
    return new Permissions(result.rows[0])
  } finally {
    done()
  }
}

export default {
  create: createPermissions,
  get: getPermissions,
  update: updatePermissions,
}
