var db = require('../db')

function Permissions(props) {
  this.editPermissions = props.edit_permissions
  this.debug = props.debug
  this.acceptInvites = props.accept_invites
}

function createPermissions(dbClient, userId, cb) {
  var query
    , params
  query = 'INSERT INTO permissions (user_id) VALUES ($1) RETURNING *'
  params = [ userId ]

  dbClient.query(query, params, function(err, result) {
    if (err) return cb(new Error('Error running query'))

    if (result.rows.length < 1) return cb(new Error('No rows returned'))

    cb(null, new Permissions(result.rows[0]))
  })
}

function getPermissions(userId, cb) {
  var query
    , params
  query = 'SELECT user_id, edit_permissions, debug, accept_invites ' +
      'FROM permissions WHERE user_id = $1'
  params = [ userId ]

  db(function(err, client, done) {
    if (err) return cb(new Error('Error fetching client from pool'))

    client.query(query, params, function(err, result) {
      done()
      if (err) return cb(new Error('Error running query'))

      cb(null, new Permissions(result.rows[0]))
    })
  })
}

function updatePermissions(userId, perms, cb) {
  var query
    , params
  query = 'UPDATE permissions SET edit_permissions = $1, debug = $2, accept_invites = $3 ' +
      'WHERE user_id = $4 RETURNING *'
  params = [ !!perms.editPermissions, !!perms.debug, !!perms.acceptInvites, userId ]

  db(function(err, client, done) {
    if (err) return cb(new Error('Error fetching client from pool'))

    client.query(query, params, function(err, result) {
      done()
      if (err) return cb(new Error('Error running query'))

      cb(null, new Permissions(result.rows[0]))
    })
  })
}

module.exports =
    { create: createPermissions
    , get: getPermissions
    , update: updatePermissions
    }
