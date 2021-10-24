import bcrypt from 'bcrypt'
import sql from 'sql-template-strings'
import { container } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import createDeferred from '../../../common/async/deferred'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { SbPermissions } from '../../../common/users/permissions'
import { SbUser, SbUserId, SelfUser } from '../../../common/users/user-info'
import ChatService from '../chat/chat-service'
import db from '../db'
import transact from '../db/transaction'
import { Dbify } from '../db/types'
import { createPermissions } from '../models/permissions'
import { createUserStats } from './user-stats-model'

/**
 * A user in the database. This is meant to be used internally by functions in this file, and
 * should *NEVER* be returned to callers directly (it contains too much information that we don't
 * want to leak to API callers).
 */
interface UserInternal {
  id: SbUserId
  name: string
  email: string
  password: string
  created: Date
  signupIpAddress?: string
  emailVerified: boolean
  acceptedUsePolicyVersion: number
  acceptedTermsVersion: number
  acceptedPrivacyVersion: number
}

type DbUser = Dbify<UserInternal>

function convertFromDb(dbUser: DbUser): UserInternal {
  return {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    password: dbUser.password,
    created: dbUser.created,
    signupIpAddress: dbUser.signup_ip_address,
    emailVerified: dbUser.email_verified,
    acceptedPrivacyVersion: dbUser.accepted_privacy_version,
    acceptedTermsVersion: dbUser.accepted_terms_version,
    acceptedUsePolicyVersion: dbUser.accepted_use_policy_version,
  }
}

/**
 * Converts a UserInternal into the relevant information for external APIs, provided that this user
 * is the one currently logged in for this request.
 */
function convertToExternalSelf(userInternal: UserInternal): SelfUser {
  return {
    id: userInternal.id,
    name: userInternal.name,
    email: userInternal.email,
    emailVerified: userInternal.emailVerified,
    acceptedPrivacyVersion: userInternal.acceptedPrivacyVersion,
    acceptedTermsVersion: userInternal.acceptedTermsVersion,
    acceptedUsePolicyVersion: userInternal.acceptedUsePolicyVersion,
  }
}

/**
 * Converts a UserInternal into the relevant information for external APIs, when the specified user
 * is *not* the currently logged in user for this request.
 */
function convertToExternal(userInternal: UserInternal): SbUser {
  return {
    id: userInternal.id,
    name: userInternal.name,
  }
}

/** Creates a new user with default permissions, returning both the user and permissions. */
export async function createUser({
  name,
  email,
  hashedPassword,
  ipAddress,
  createdDate = new Date(),
}: {
  name: string
  email: string
  hashedPassword: string
  ipAddress: string
  createdDate?: Date
}): Promise<{ user: SelfUser; permissions: SbPermissions }> {
  const transactionCompleted = createDeferred<void>()
  transactionCompleted.catch(swallowNonBuiltins)

  try {
    const transactionResult = await transact(async client => {
      const result = await client.query<DbUser>(sql`
      INSERT INTO users (name, email, password, created, signup_ip_address, email_verified)
      VALUES (${name}, ${email}, ${hashedPassword}, ${createdDate}, ${ipAddress}, false)
      RETURNING *
    `)

      if (result.rows.length < 1) {
        throw new Error('No rows returned')
      }

      const userInternal = convertFromDb(result.rows[0])
      const chatService = container.resolve(ChatService)

      const [permissions] = await Promise.all([
        createPermissions(client, userInternal.id),
        chatService.joinChannel('ShieldBattery', userInternal.id, client, transactionCompleted),
        createUserStats(client, userInternal.id),
      ])

      return { user: convertToExternalSelf(userInternal), permissions }
    })
    transactionCompleted.resolve()

    return transactionResult
  } catch (err) {
    transactionCompleted.reject(err)
    throw err
  }
}

/** Fields that can be updated for a user. */
export type UserUpdatables = Omit<UserInternal, 'id' | 'name' | 'created' | 'signupIpAddress'>

/**
 * Updates an existing user. Returns the user's info or undefined if the user could not be found.
 * This should only be called for the currently active user.
 */
export async function updateUser(
  id: number,
  updates: Partial<UserUpdatables>,
): Promise<SelfUser | undefined> {
  const query = sql`
    UPDATE users
    SET
  `

  let appended = false
  for (const [key, value] of Object.entries(updates)) {
    if (appended) {
      query.append(sql`,`)
    }

    const castedKey = key as keyof UserUpdatables
    switch (castedKey) {
      case 'email':
        query.append(sql`
          email = ${value}
        `)
        break
      case 'emailVerified':
        query.append(sql`
          email_verified = ${value}
        `)
        break
      case 'password':
        query.append(sql`
          password = ${value}
        `)
        break
      case 'acceptedPrivacyVersion':
        query.append(sql`
          accepted_privacy_version = ${value}
        `)
        break
      case 'acceptedTermsVersion':
        query.append(sql`
          accepted_terms_version = ${value}
        `)
        break
      case 'acceptedUsePolicyVersion':
        query.append(sql`
          accepted_use_policy_version = ${value}
        `)
        break
      default:
        assertUnreachable(castedKey)
    }

    appended = true
  }

  query.append(sql`
    WHERE id = ${id}
    RETURNING *;
  `)

  const { client, done } = await db()
  try {
    const result = await client.query<DbUser>(query)
    return result.rows.length > 0 ? convertToExternalSelf(convertFromDb(result.rows[0])) : undefined
  } finally {
    done()
  }
}

/**
 * Attempts a login using the specified user information, returning the user information if it
 * succeeds.
 */
export async function attemptLogin(
  username: string,
  password: string,
): Promise<SelfUser | undefined> {
  const user = await internalFindUserByName(username)
  if (!user) {
    return undefined
  }

  const passwordMatches = await bcrypt.compare(password, user.password)
  return passwordMatches ? convertToExternalSelf(user) : undefined
}

async function internalFindUserById(id: number): Promise<UserInternal | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbUser>(sql`
      SELECT * FROM users
      WHERE id = ${id}
    `)

    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/** Returns the `User` with the specified `id`, or `undefined` if they don't exist. */
export async function findUserById(id: number): Promise<SbUser | undefined> {
  const result = await internalFindUserById(id)
  return result ? convertToExternal(result) : undefined
}

/**
 * Returns the `SelfUser` with the specified `id`, or `undefined` if they don't exist. This should
 * only be called with the current user's `id`.
 */
export async function findSelfById(id: number): Promise<SelfUser | undefined> {
  const result = await internalFindUserById(id)
  return result ? convertToExternalSelf(result) : undefined
}

async function internalFindUserByName(name: string): Promise<UserInternal | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbUser>(sql`
      SELECT * FROM users
      WHERE name = ${name}
    `)

    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/** Returns the `User` with the specified `name`, or `undefined` if they don't exist. */
export async function findUserByName(name: string): Promise<SbUser | undefined> {
  const user = await internalFindUserByName(name)
  return user ? convertToExternal(user) : undefined
}

/**
 * Returns a `Map` of name -> `User` for a given list of names. Any names that can't be found won't
 * be present in the resulting `Map`.
 */
export async function findUsersByName(names: string[]): Promise<Map<string, SbUser>> {
  // TODO(tec27): Should this just return an array and let callers make the Map if they want?
  const { client, done } = await db()
  try {
    const result = await client.query<DbUser>(sql`SELECT * FROM users WHERE name = ANY (${names})`)
    return new Map<string, SbUser>(
      result.rows.map(row => [row.name, convertToExternal(convertFromDb(row))]),
    )
  } finally {
    done()
  }
}

/**
 * Returns a `Map` of id -> `User` for a given list of IDs. Any IDs that can't be found won't
 * be present in the resulting `Map`.
 */
export async function findUsersById(ids: number[]): Promise<Map<number, SbUser>> {
  // TODO(tec27): Should this just return an array and let callers make the Map if they want?
  const { client, done } = await db()
  try {
    const result = await client.query<DbUser>(sql`SELECT * FROM users WHERE id = ANY (${ids})`)
    return new Map<number, SbUser>(
      result.rows.map(row => [row.id, convertToExternal(convertFromDb(row))]),
    )
  } finally {
    done()
  }
}

/**
 * Adds a (guesstimated) signup IP address for the specified user if they were created before we
 * started storing that data.
 */
export async function maybeMigrateSignupIp(userId: SbUserId, ipAddress: string): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      UPDATE users
      SET signup_ip_address = ${ipAddress}
      WHERE id = ${userId} AND signup_ip_address IS NULL`)
  } finally {
    done()
  }
}

/**
 * Returns all the `User`s that have a matching email address.
 */
export async function findAllUsersWithEmail(email: string): Promise<SbUser[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbUser>(sql`SELECT name FROM users WHERE email = ${email}`)
    return result.rows.map(row => convertToExternal(convertFromDb(row)))
  } finally {
    done()
  }
}
