// User model, corresponding to a user account on the site (with a login, password, etc.)
import db from '../db'
import transact from '../db/transaction'
import permissions from './permissions'
import { addUserToChannel } from './chat-channels'
import { deleteInvite } from './invites'

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
    this.ipAddressAtSignup = this._fromDb ? props.ip_address_at_signup : props.ipAddressAtSignup
  }

  async save() {
    if (!this.name || !this.email || !this.password || !this.created) {
      throw new Error('Incomplete data')
    }
    // TODO(tec27): it's very strange that the return value changes here depending on whether its
    // an insert or an update, find a way to reconcile those
    if (!this._fromDb) {
      return await this._insert()
    } else {
      return await this._update()
    }
  }

  async _insert() {
    const query = 'INSERT INTO users (name, email, password, created, ip_address_at_signup) ' +
        'VALUES ($1, $2, $3, $4, $5) RETURNING id'
    const params = [ this.name, this.email, this.password, this.created, this.ipAddressAtSignup ]

    return await transact(async client => {
      const result = await client.queryPromise(query, params)
      if (result.rows.length < 1) {
        throw new Error('No rows returned')
      }

      this.id = result.rows[0].id
      this._fromDb = true
      await deleteInvite(client, this.email)
      const userPermissions = await permissions.create(client, this.id)
      await addUserToChannel(this.id, 'ShieldBattery', client)
      return { user: this, permissions: userPermissions }
    })
  }

  async _update() {
    if (!this.id) throw new Error('Incomplete data')
    const query =
        `UPDATE users SET name = $1, email = $2, password = $3, created = $4,
        ip_address_at_signup = $5 WHERE id = $6`
    const params =
        [ this.name, this.email, this.password, this.created, this.ipAddressAtSignup, this.id ]

    const { client, done } = await db()
    try {
      await client.queryPromise(query, params)
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
    ipAddressAtSignup: ipAddress,
  })
}

async function findUser(criteria) {
  let query = 'SELECT id, name, email, password, created FROM users WHERE '
    , params
  if (typeof criteria != 'number') {
    // by name
    query += 'name = $1'
    params = [ criteria + '' ]
  } else {
    // by id
    query += 'id = $1'
    params = [ criteria ]
  }

  const { client, done } = await db()
  try {
    const result = await client.queryPromise(query, params)
    return result.rows.length < 1 ? null : new User(result.rows[0], true)
  } finally {
    done()
  }
}

export async function updateUsersIpAddress(userId, ipAddress) {
  return transact(async function(client) {
    const result = await client.queryPromise(
        'SELECT ip_address_at_signup FROM users WHERE id = $1',
        [ userId ])

    if (result.rows.length < 1) {
      throw new Error('No rows returned')
    }

    const ipAddressAtSignup = result.rows[0].ip_address_at_signup
    if (!ipAddressAtSignup) {
      return client.queryPromise('UPDATE users SET ip_address_at_signup = $1 WHERE id = $2',
        [ ipAddress, userId ])
    }

    return Promise.resolve()
  })
}

export default {
  create: createUser,
  find: findUser,
  updateIp: updateUsersIpAddress,
}
