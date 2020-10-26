// User model, corresponding to a user account on the site (with a login, password, etc.)
import sql from 'sql-template-strings'
import db from '../db'
import transact from '../db/transaction'
import { createPermissions } from './permissions'
import { addUserToChannel } from './chat-channels'

function defPrivate(o: unknown, name: string, value: unknown) {
  Object.defineProperty(o, name, {
    enumerable: false,
    writable: true,
    value,
  })
}

class User {
  id: number | null | undefined
  name: string
  email: string
  created: Date
  signupIpAddress: string | null
  emailVerified: boolean

  private _fromDb!: boolean
  private password!: string

  constructor(
    props: {
      id?: number | null
      name: string
      email: string
      password: string
      created?: Date
      signupIpAddress?: string | null
      // eslint-disable-next-line camelcase
      ip_address_at_signup?: string | null
      // eslint-disable-next-line camelcase
      email_verified?: boolean
    },
    _fromDb = false,
  ) {
    defPrivate(this, '_fromDb', !!_fromDb)

    this.id = this._fromDb ? props.id : null
    this.name = props.name
    this.email = props.email
    defPrivate(this, 'password', props.password)
    this.created = props.created || new Date()
    this.signupIpAddress = this._fromDb
      ? props.ip_address_at_signup ?? null
      : props.signupIpAddress ?? null
    this.emailVerified = props.email_verified ?? false
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
    const query = sql`
      INSERT INTO users (name, email, password, created, signup_ip_address, email_verified)
      VALUES (${this.name}, ${this.email}, ${this.password}, ${this.created},
        ${this.signupIpAddress}, ${!!this.emailVerified})
      RETURNING id`

    return transact(async client => {
      const result = await client.query(query)
      if (result.rows.length < 1) {
        throw new Error('No rows returned')
      }

      this.id = result.rows[0].id
      this._fromDb = true
      const userPermissions = await createPermissions(client, this.id!)
      await addUserToChannel(this.id!, 'ShieldBattery', client)
      return { user: this, permissions: userPermissions }
    })
  }

  async _update() {
    if (!this.id) throw new Error('Incomplete data')
    const query = sql`
      UPDATE users
      SET name = ${this.name}, email = ${this.email}, password = ${this.password},
        created = ${this.created}, signup_ip_address = ${this.signupIpAddress},
        email_verified = ${!!this.emailVerified}
      WHERE id = ${this.id};`

    const { client, done } = await db()
    try {
      await client.query(query)
      return this
    } finally {
      done()
    }
  }
}

function createUser(
  name: string,
  email: string,
  hashedPassword: string,
  ipAddress: string,
  createdDate = new Date(),
) {
  return new User({
    name,
    email,
    password: hashedPassword,
    created: createdDate,
    signupIpAddress: ipAddress,
  })
}

export async function findUser(criteria: number | string) {
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

export async function maybeUpdateIpAddress(userId: number, ipAddress: string) {
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

export async function findAllUsernamesWithEmail(email: string) {
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
export async function findUserIdsForNames(names: string[]) {
  const { client, done } = await db()
  try {
    const result = await client.query(sql`SELECT id, name FROM users WHERE name = ANY (${names})`)
    return new Map<string, number>(result.rows.map(row => [row.name, row.id]))
  } finally {
    done()
  }
}

export default {
  create: createUser,
  find: findUser,
  maybeUpdateIp: maybeUpdateIpAddress,
}
