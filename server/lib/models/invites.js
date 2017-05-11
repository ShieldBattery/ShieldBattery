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

export default {
  getAll: getAllInvites,
  getAccepted: getAcceptedInvites,
  getUnaccepted: getUnacceptedInvites,
  accept: acceptInvite,
}
