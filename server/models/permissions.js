var db = require('../db')

function Permissions(props) {
  this.editPermissions = props.edit_permissions
  this.debug = props.debug
  this.acceptInvites = props.accept_invites
}

function* createPermissions(dbClient, userId, cb) {
  let query
    , params
  query = 'INSERT INTO permissions (user_id) VALUES ($1) RETURNING *'
  params = [ userId ]

  let { client, done } = yield db()
  try {
    let result = yield client.queryPromise(query, params)
    if (result.rows.length < 1) throw new Error('No rows returned')
  } finally {
    done()
  }
}

function* getPermissions(userId, cb) {
  let query
    , params
  query = 'SELECT user_id, edit_permissions, debug, accept_invites ' +
      'FROM permissions WHERE user_id = $1'
  params = [ userId ]

  let { client, done } = yield db()
  try {
    let result = yield client.queryPromise(query, params)
    return new Permissions(result.rows[0])
  } finally {
    done()
  }
}

function* updatePermissions(userId, perms, cb) {
  let query
    , params
  query = 'UPDATE permissions SET edit_permissions = $1, debug = $2, accept_invites = $3 ' +
      'WHERE user_id = $4 RETURNING *'
  params = [ !!perms.editPermissions, !!perms.debug, !!perms.acceptInvites, userId ]

  let { client, done } = yield db()
  try {
    let result = yield client.queryPromise(query, params)
    return new Permissions(result.rows[0])
  } finally {
    done()
  }
}

module.exports =
    { create: createPermissions
    , get: getPermissions
    , update: updatePermissions
    }
