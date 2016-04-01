import db from '../db'

class Permissions {
  constructor(props) {
    this.editPermissions = props.edit_permissions
    this.debug = props.debug
    this.acceptInvites = props.accept_invites
  }
}

function* createPermissions(dbClient, userId) {
  const query = 'INSERT INTO permissions (user_id) VALUES ($1) RETURNING *'
  const params = [ userId ]

  const result = yield dbClient.queryPromise(query, params)
  if (result.rows.length < 1) throw new Error('No rows returned')
  return new Permissions(result.rows[0])
}

function* getPermissions(userId) {
  const query =
      'SELECT user_id, edit_permissions, debug, accept_invites FROM permissions WHERE user_id = $1'
  const params = [ userId ]

  const { client, done } = yield db()
  try {
    const result = yield client.queryPromise(query, params)
    return new Permissions(result.rows[0])
  } finally {
    done()
  }
}

function* updatePermissions(userId, perms) {
  const query = 'UPDATE permissions SET edit_permissions = $1, debug = $2, accept_invites = $3 ' +
      'WHERE user_id = $4 RETURNING *'
  const params = [ !!perms.editPermissions, !!perms.debug, !!perms.acceptInvites, userId ]

  const { client, done } = yield db()
  try {
    const result = yield client.queryPromise(query, params)
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
