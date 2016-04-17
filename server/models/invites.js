import db from '../db'

class Invite {
  constructor(props) {
    this.email = props.email
    this.teamliquidName = props.teamliquid_name
    this.os = props.os
    this.browser = props.browser
    this.graphics = props.graphics
    this.canHost = props.can_host
    this.isAccepted = !!props.token
  }
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
function* createInvite(invite) {
  let query
    , params
  query = 'SELECT 1 FROM invites WHERE email = $1'
  params = [ invite.email ]

  const { client, done } = yield db()
  try {
    const result = yield client.queryPromise(query, params)
    if (result.rows.length < 1) {
      query = 'INSERT INTO invites (email, teamliquid_name, os, browser, graphics, can_host) ' +
          'VALUES ($1, $2, $3, $4, $5, $6)'
      params = [
        invite.email,
        invite.teamliquidName,
        invite.os,
        invite.browser,
        invite.graphics,
        !!invite.canHost,
      ]

      // TODO(tec27): this is a race condition, we should be doing this in a transaction or at least
      // handling the case that this next query fails better
      yield client.queryPromise(query, params)
    } else {
      throw new Error('That email has already been used')
    }
  } finally {
    done()
  }
}

function* _getInvitesCount(condition) {
  let query = 'SELECT COUNT(*) FROM invites'
  const params = []

  if (condition) {
    query += ' ' + condition
  }

  const { client, done } = yield db()
  try {
    const result = yield client.queryPromise(query, params)
    return result.rows[0]
  } finally {
    done()
  }
}

function* _getInvites(condition, limit, pageNumber) {
  let query = 'SELECT * FROM invites'
  let params = []

  if (condition) {
    query += ' ' + condition
  }

  query += ' ORDER BY email LIMIT $1 OFFSET $2'
  params = [
    limit,
    pageNumber * limit
  ]

  const total = yield* _getInvitesCount(condition)

  const { client, done } = yield db()
  try {
    const result = yield client.queryPromise(query, params)
    return { total: parseInt(total.count, 10), invites: result.rows.map(row => new Invite(row)) }
  } finally {
    done()
  }
}

function* getAllInvites(limit, pageNumber) {
  return yield* _getInvites(null, limit, pageNumber)
}

function* getUnacceptedInvites(limit, pageNumber) {
  return yield* _getInvites('WHERE token IS NULL', limit, pageNumber)
}

function* getAcceptedInvites(limit, pageNumber) {
  return yield* _getInvites('WHERE token IS NOT NULL', limit, pageNumber)
}

function* acceptInvite(email, token) {
  const query = 'UPDATE invites SET token = $1 WHERE email = $2 AND token IS NULL RETURNING *'
  const params = [ token, email ]

  const { client, done } = yield db()
  try {
    const result = yield client.queryPromise(query, params)
    if (!result.rows.length) throw new Error('No such uninvited email')
    return new Invite(result.rows[0])
  } finally {
    done()
  }
}

export default {
  create: createInvite,
  getAll: getAllInvites,
  getAccepted: getAcceptedInvites,
  getUnaccepted: getUnacceptedInvites,
  accept: acceptInvite,
}
