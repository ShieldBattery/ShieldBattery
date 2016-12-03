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
    this.token = props.token
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
async function createInvite(invite) {
  let query
    , params
  query = 'SELECT 1 FROM invites WHERE email = $1'
  params = [ invite.email ]

  const { client, done } = await db()
  try {
    const result = await client.queryPromise(query, params)
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
      await client.queryPromise(query, params)
    } else {
      const error = new Error('That email has already been used')
      error.name = 'DuplicateEmail'
      throw error
    }
  } finally {
    done()
  }
}

async function _getInvitesCount(condition) {
  let query = 'SELECT COUNT(*) FROM invites'
  const params = []

  if (condition) {
    query += ' ' + condition
  }

  const { client, done } = await db()
  try {
    const result = await client.queryPromise(query, params)
    return result.rows[0]
  } finally {
    done()
  }
}

async function _getInvites(condition, limit, pageNumber) {
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

  const total = await _getInvitesCount(condition)

  const { client, done } = await db()
  try {
    const result = await client.queryPromise(query, params)
    return { total: parseInt(total.count, 10), invites: result.rows.map(row => new Invite(row)) }
  } finally {
    done()
  }
}

async function getAllInvites(limit, pageNumber) {
  return await _getInvites(null, limit, pageNumber)
}

async function getUnacceptedInvites(limit, pageNumber) {
  return await _getInvites('WHERE token IS NULL', limit, pageNumber)
}

async function getAcceptedInvites(limit, pageNumber) {
  return await _getInvites('WHERE token IS NOT NULL', limit, pageNumber)
}

async function acceptInvite(client, email, token) {
  const query = 'UPDATE invites SET token = $1 WHERE email = $2 AND token IS NULL RETURNING *'
  const params = [ token, email ]

  const result = await client.queryPromise(query, params)
  if (!result.rows.length) throw new Error('No such uninvited email')
  return new Invite(result.rows[0])
}

export async function getTokenByEmail(email) {
  const query = 'SELECT token FROM invites WHERE email = $1'
  const params = [ email ]

  const { client, done } = await db()
  try {
    const result = await client.queryPromise(query, params)
    if (result.rows.length < 1) {
      const error = new Error('No such email signed up for beta')
      error.name = 'NonexistentEmail'
      throw error
    } else {
      return result.rows[0].token
    }
  } finally {
    done()
  }
}

export async function deleteInvite(client, email) {
  const result = await client.queryPromise('DELETE FROM invites WHERE email = $1', [ email ])
  if (result.rowCount < 1) {
    throw new Error('No rows deleted')
  }
}

export default {
  create: createInvite,
  getAll: getAllInvites,
  getAccepted: getAcceptedInvites,
  getUnaccepted: getUnacceptedInvites,
  accept: acceptInvite,
}
