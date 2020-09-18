// User model, corresponding to a user account on the site (with a login, password, etc.)
import sql from 'sql-template-strings'
import db from '../db'
import transact from '../db/transaction'
import { createPermissions } from './permissions'
import { addUserToChannel } from './chat-channels'

function defPrivate(o, name, value) {
  Object.defineProperty(o, name, {
    enumerable: false,
    writable: true,
    value,
  })
}

class User {
  constructor(props, _fromDb) {
    defPrivate(this, '_fromDb', !!_fromDb)

    this.id = this._fromDb ? props.id : null
    this.name = props.name
    this.email = props.email
    defPrivate(this, 'password', props.password)
    this.created = props.created || new Date()
    this.signupIpAddress = this._fromDb ? props.ip_address_at_signup : props.signupIpAddress
    this.emailVerified = props.email_verified
  }

  async save() {
    if (!this.name || !this.email || !this.password || !this.created) {
      throw new Error('Incomplete data')
    }
    // TODO(tec27): it's very strange that the return value changes here depending on whether its
    // an insert or an update, find a way to reconcile those
    if (!this._fromDb) {
      return this._insert()
    } else {
      return this._update()
    }
  }

  async _insert() {
    const query =
      'INSERT INTO users (name, email, password, created, signup_ip_address) ' +
      'VALUES ($1, $2, $3, $4, $5) RETURNING id'
    const params = [this.name, this.email, this.password, this.created, this.signupIpAddress]

    return transact(async client => {
      const result = await client.query(query, params)
      if (result.rows.length < 1) {
        throw new Error('No rows returned')
      }

      this.id = result.rows[0].id
      this._fromDb = true
      const userPermissions = await createPermissions(client, this.id)
      await addUserToChannel(this.id, 'ShieldBattery', client)
      return { user: this, permissions: userPermissions }
    })
  }

  async _update() {
    if (!this.id) throw new Error('Incomplete data')
    const query = `UPDATE users SET name = $1, email = $2, password = $3, created = $4,
        signup_ip_address = $5 WHERE id = $6`
    const params = [
      this.name,
      this.email,
      this.password,
      this.created,
      this.signupIpAddress,
      this.id,
    ]

    const { client, done } = await db()
    try {
      await client.query(query, params)
      return this
    } finally {
      done()
    }
  }
}

function createUser(name, email, hashedPassword, ipAddress, createdDate) {
  return new User({
    name,
    email,
    password: hashedPassword,
    created: createdDate || new Date(),
    signupIpAddress: ipAddress,
  })
}

export async function findUser(criteria) {
  let query = 'SELECT id, name, email, password, created, email_verified FROM users WHERE ',
    params
  if (typeof criteria != 'number') {
    // by name
    query += 'name = $1'
    params = [criteria + '']
  } else {
    // by id
    query += 'id = $1'
    params = [criteria]
  }

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length < 1 ? null : new User(result.rows[0], true)
  } finally {
    done()
  }
}

export async function maybeUpdateIpAddress(userId, ipAddress) {
  const { client, done } = await db()
  try {
    return client.query(
      'UPDATE users SET signup_ip_address = $1 WHERE id = $2 AND signup_ip_address IS NULL',
      [ipAddress, userId],
    )
  } finally {
    done()
  }
}

export async function findAllUsernamesWithEmail(email) {
  const { client, done } = await db()
  try {
    const result = await client.query('SELECT name FROM users WHERE email = $1', [email])
    return result.rows.map(row => row.name)
  } finally {
    done()
  }
}

/**
 * Returns a Map of name -> user ID given a list of names. Any users that can't be found won't be
 * present in the resulting Map.
 */
export async function findUserIdsForNames(names) {
  const { client, done } = await db()
  try {
    const result = await client.query(sql`SELECT id, name FROM users WHERE name = ANY (${names})`)
    return new Map(result.rows.map(row => [row.name, row.id]))
  } finally {
    done()
  }
}

export default {
  create: createUser,
  find: findUser,
  maybeUpdateIp: maybeUpdateIpAddress,
}
