var db = require('../db')

function Invite(props) {
  this.email = props.email
  this.teamliquidName = props.teamliquid_name
  this.os = props.os
  this.browser = props.browser
  this.graphics = props.graphics
  this.canHost = props.can_host
  this.isAccepted = !!props.token
}

// invite is: {
//   email
//   teamliquidName
//   os
//   browser
//   graphics
//   canHost
// }
// isAccepted or token cannot be specified during creation
function createInvite(invite, cb) {
  var query
    , params
  query = 'SELECT 1 FROM invites WHERE email = $1'
  params = [ invite.email ]

  db(function(err, client, done) {
    if (err) return cb(err)

    client.query(query, params, function(err, result) {
      if (err) return cb(err)

      if (result.rows.length < 1) {
        query = 'INSERT INTO invites (email, teamliquid_name, os, browser, graphics, can_host) ' +
            'VALUES ($1, $2, $3, $4, $5, $6)'
        params =  [ invite.email
                  , invite.teamliquidName
                  , invite.os
                  , invite.browser
                  , invite.graphics
                  , !!invite.canHost
                  ]

        client.query(query, params, function(err, result) {
          done()
          if (err) return cb(err)

          cb(null)
        })
      } else {
        done()
        return cb(new Error('That email has already been used'))
      }
    })
  })
}

function _getInvites(condition, cb) {
  var query = 'SELECT * FROM invites'
    , params = []

  if (condition) {
    query += ' ' + condition
  }

  db(function(err, client, done) {
    if (err) return cb(err)

    client.query(query, params, function(err, result) {
      done()
      if (err) return cb(err)

      var invites = result.rows.map(function(row) {
        return new Invite(row)
      })
      cb(null, invites)
    })
  })
}

function getAllInvites(cb) {
  _getInvites(null, cb)
}

function getUnacceptedInvites(cb) {
  _getInvites('WHERE token IS NULL', cb)
}

function getAcceptedInvites(cb) {
  _getInvites('WHERE token IS NOT NULL', cb)
}

function acceptInvite(email, token, cb) {
  var query
    , params
  query = 'UPDATE invites SET token = $1 WHERE email = $2 AND token IS NULL RETURNING *'
  params = [ token, email ]

  db(function(err, client, done) {
    if (err) return cb(err)

    client.query(query, params, function(err, result) {
      done()
      if (err) return cb(err)
      if (!result.rows.length) return cb(new Error('No such uninvited email'))

      cb(null, new Invite(result.rows[0]))
    })
  })
}

module.exports =
    { create: createInvite
    , getAll: getAllInvites
    , getAccepted: getAcceptedInvites
    , getUnaccepted: getUnacceptedInvites
    , accept: acceptInvite
    }
