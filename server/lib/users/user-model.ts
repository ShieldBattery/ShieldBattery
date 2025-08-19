import bcrypt from 'bcrypt'
import { assertUnreachable } from '../../../common/assert-unreachable'
import createDeferred from '../../../common/async/deferred'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import {
  ACCEPTABLE_USE_VERSION,
  PRIVACY_POLICY_VERSION,
  TERMS_OF_SERVICE_VERSION,
} from '../../../common/policies/versions'
import { SbPermissions } from '../../../common/users/permissions'
import { SbUser, SelfUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql, sqlConcat, sqlRaw, SqlTemplate } from '../db/sql'
import transact from '../db/transaction'
import { Dbify } from '../db/types'
import { createPermissions } from '../models/permissions'
import { incrementSignupCodeUsage, validateAndLockSignupCode } from './signup-code-models'
import { createUserStats } from './user-stats-model'

/**
 * A user in the database. This is meant to be used internally by functions in this file, and
 * should *NEVER* be returned to callers directly (it contains too much information that we don't
 * want to leak to API callers).
 */
interface UserInternal {
  id: SbUserId
  name: string
  loginName: string
  email: string
  created: Date
  signupIpAddress?: string
  emailVerified: boolean
  acceptedUsePolicyVersion: number
  acceptedTermsVersion: number
  acceptedPrivacyVersion: number
  locale: string
  lastLoginNameChange?: Date
  lastNameChange?: Date
  nameChangeTokens: number
}

type DbUser = Dbify<UserInternal>

/**
 * A row stored in the users_private table. This table is for data that needs some added security
 * around querying it (e.g. passwords).
 */
interface UserPrivate {
  userId: SbUserId
  password: string
}

type DbUserPrivate = Dbify<UserPrivate>

function convertUserFromDb(dbUser: DbUser): UserInternal {
  return {
    id: dbUser.id,
    name: dbUser.name,
    loginName: dbUser.login_name,
    email: dbUser.email,
    created: dbUser.created,
    signupIpAddress: dbUser.signup_ip_address,
    emailVerified: dbUser.email_verified,
    acceptedPrivacyVersion: dbUser.accepted_privacy_version,
    acceptedTermsVersion: dbUser.accepted_terms_version,
    acceptedUsePolicyVersion: dbUser.accepted_use_policy_version,
    locale: dbUser.locale,
    lastLoginNameChange: dbUser.last_login_name_change,
    lastNameChange: dbUser.last_name_change,
    nameChangeTokens: dbUser.name_change_tokens,
  }
}

function convertPrivateFromDb(dbUserPrivate: DbUserPrivate): UserPrivate {
  return {
    userId: dbUserPrivate.user_id,
    password: dbUserPrivate.password,
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
    loginName: userInternal.loginName,
    email: userInternal.email,
    emailVerified: userInternal.emailVerified,
    acceptedPrivacyVersion: userInternal.acceptedPrivacyVersion,
    acceptedTermsVersion: userInternal.acceptedTermsVersion,
    acceptedUsePolicyVersion: userInternal.acceptedUsePolicyVersion,
    locale: userInternal.locale,
    lastLoginNameChange: userInternal.lastLoginNameChange,
    lastNameChange: userInternal.lastNameChange,
    nameChangeTokens: userInternal.nameChangeTokens,
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
  locale,
  signupCode,
  completeCreationFn,
}: {
  name: string
  email: string
  hashedPassword: string
  ipAddress: string
  createdDate?: Date
  locale?: string
  signupCode?: string
  completeCreationFn: (
    userId: SbUserId,
    client: DbClient,
    transactionCompleted: Promise<void>,
  ) => Promise<void>
}): Promise<{ user: SelfUser; permissions: SbPermissions }> {
  const transactionCompleted = createDeferred<void>()
  transactionCompleted.catch(swallowNonBuiltins)

  try {
    const transactionResult = await transact(async client => {
      // Validate and lock signup code if provided
      let signupCodeId: string | undefined
      if (signupCode) {
        signupCodeId = await validateAndLockSignupCode(signupCode, client)
      }

      const result = await client.query<DbUser>(sql`
      INSERT INTO users (name, login_name, email, created, signup_ip_address, email_verified,
        locale, accepted_privacy_version, accepted_terms_version, accepted_use_policy_version,
        signup_code_used)
      VALUES (${name}, ${name}, ${email}, ${createdDate}, ${ipAddress}, false, ${locale},
        ${PRIVACY_POLICY_VERSION}, ${TERMS_OF_SERVICE_VERSION}, ${ACCEPTABLE_USE_VERSION},
        ${signupCodeId})
      RETURNING *
    `)

      if (result.rows.length < 1) {
        throw new Error('No rows returned')
      }

      const userInternal = convertUserFromDb(result.rows[0])

      await client.query<never>(sql`
        INSERT INTO users_private (user_id, password)
        VALUES (${userInternal.id}, ${hashedPassword});
      `)

      const [permissions] = await Promise.all([
        createPermissions(client, userInternal.id),
        createUserStats(client, userInternal.id),
        signupCodeId ? incrementSignupCodeUsage(signupCodeId, client) : Promise.resolve(),
      ])

      await completeCreationFn(userInternal.id, client, transactionCompleted)

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
export type UserUpdatables = Omit<
  UserInternal & UserPrivate,
  | 'id'
  | 'name'
  | 'created'
  | 'signupIpAddress'
  | 'userId'
  | 'loginName'
  | 'lastLoginNameChange'
  | 'lastNameChange'
  | 'nameChangeTokens'
>

/**
 * Updates an existing user. Returns the user's info or undefined if the user could not be found.
 * This should only be called for the currently active user.
 */
export async function updateUser(
  id: SbUserId,
  updates: Partial<UserUpdatables>,
): Promise<SelfUser | undefined> {
  let updatedPassword: string | undefined

  let query = sql`
    UPDATE users
    SET
  `

  const updatedEntries = Object.entries(updates).filter(([key, value]) => value !== undefined)
  if (!updatedEntries.length) {
    throw new Error('No updated fields specified')
  }

  query = query.append(
    sqlConcat(
      ', ',
      updatedEntries.map(([_key, value]) => {
        const key = _key as keyof UserUpdatables

        if (key === 'password') {
          updatedPassword = String(value)
          return sqlRaw('')
        }

        switch (key) {
          case 'email':
            return sql`email = ${value}`
          case 'emailVerified':
            return sql`email_verified = ${value}`
          case 'acceptedPrivacyVersion':
            return sql`accepted_privacy_version = ${value}`
          case 'acceptedTermsVersion':
            return sql`accepted_terms_version = ${value}`
          case 'acceptedUsePolicyVersion':
            return sql`accepted_use_policy_version = ${value}`
          case 'locale':
            return sql`locale = ${value}`
          default:
            return assertUnreachable(key)
        }
      }),
    ),
  )

  query = query.append(sql`
    WHERE id = ${id}
    RETURNING *;
  `)

  if (updatedPassword && updatedEntries.length === 1) {
    // Only updating user_private stuff, so we just need to query the current row
    query = sql`SELECT * FROM users WHERE id = ${id}`
  }

  const { client, done } = await db()
  try {
    if (updatedPassword) {
      await client.query(sql`
        UPDATE users_private
        SET password = ${updatedPassword}
        WHERE user_id = ${id};
      `)
    }

    const result = await client.query<DbUser>(query)
    return result.rows.length > 0
      ? convertToExternalSelf(convertUserFromDb(result.rows[0]))
      : undefined
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
  const user = await internalFindUserByLoginName(username)
  if (!user) {
    return undefined
  }
  const userPrivate = await internalGetUserPrivateById(user.id)
  if (!userPrivate) {
    throw new Error("Didn't find a user_private entry for this user")
  }

  const passwordMatches = await bcrypt.compare(password, userPrivate.password)
  return passwordMatches ? convertToExternalSelf(user) : undefined
}

async function internalFindUserById(
  id: number,
  withClient?: DbClient,
): Promise<UserInternal | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbUser>(sql`
      SELECT * FROM users
      WHERE id = ${id}
    `)

    return result.rows.length > 0 ? convertUserFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/** Returns the `User` with the specified `id`, or `undefined` if they don't exist. */
export async function findUserById(id: number, client?: DbClient): Promise<SbUser | undefined> {
  const result = await internalFindUserById(id, client)
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

    return result.rows.length > 0 ? convertUserFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

async function internalFindUserByLoginName(name: string): Promise<UserInternal | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbUser>(sql`
      SELECT * FROM users
      WHERE login_name = ${name}
    `)

    return result.rows.length > 0 ? convertUserFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

async function internalGetUserPrivateById(id: number): Promise<UserPrivate | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbUserPrivate>(sql`
      SELECT * FROM users_private
      WHERE user_id = ${id}
    `)

    return result.rows.length > 0 ? convertPrivateFromDb(result.rows[0]) : undefined
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
 * Returns the data for all users with the specified names. If a user cannot be found it will not
 * be included in the result. The order of the result is not guaranteed.
 */
export async function findUsersByName(names: ReadonlyArray<string>): Promise<SbUser[]> {
  if (!names.length) {
    return []
  }

  const { client, done } = await db()
  try {
    const result = await client.query<DbUser>(sql`SELECT * FROM users WHERE name = ANY (${names})`)
    return result.rows.map(r => convertToExternal(convertUserFromDb(r)))
  } finally {
    done()
  }
}

/**
 * Returns a `Map` of name -> `SbUser` for a given list of names. Any names that can't be found
 * won't be present in the resulting `Map`. If you don't need a `Map`, see `findUsersByName`
 * instead.
 */
export async function findUsersByNameAsMap(
  names: ReadonlyArray<string>,
): Promise<Map<string, SbUser>> {
  const result = await findUsersByName(names)
  return new Map<string, SbUser>(result.map(u => [u.name, u]))
}

/**
 * Returns the data for all users with the specified IDs. If a user cannot be found it will not
 * be included in the result. The order of the result is not guaranteed.
 */
export async function findUsersById(ids: ReadonlyArray<SbUserId>): Promise<SbUser[]> {
  if (!ids.length) {
    return []
  }

  const { client, done } = await db()
  try {
    const result = await client.query<DbUser>(sql`SELECT * FROM users WHERE id = ANY (${ids})`)
    return result.rows.map(r => convertToExternal(convertUserFromDb(r)))
  } finally {
    done()
  }
}

/**
 * Returns the data for all users with IDs that match the result of the specified query. The query
 * must return a column of IDs with the name it specifies (`user_id` by default). `idColumn` should
 * be a static string, never user-controlled.
 */
export async function findUsersByIdQuery(
  idQuery: SqlTemplate,
  idColumn = 'user_id',
  withClient?: DbClient,
): Promise<SbUser[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbUser>(sql`
      WITH ids AS (
        ${idQuery}
      )
      SELECT *
      FROM users
      INNER JOIN ids ON users.id = ids."${sqlRaw(idColumn)}"
    `)
    return result.rows.map(r => convertToExternal(convertUserFromDb(r)))
  } finally {
    done()
  }
}

/**
 * Returns a `Map` of id -> `SbUser` for a given list of IDs. Any IDs that can't be found won't
 * be present in the resulting `Map`. If you don't need a `Map`, see `findUsersById` instead.
 */
export async function findUsersByIdAsMap(ids: SbUserId[]): Promise<Map<SbUserId, SbUser>> {
  const result = await findUsersById(ids)
  return new Map<SbUserId, SbUser>(result.map(u => [u.id, u]))
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
    return result.rows.map(row => convertToExternal(convertUserFromDb(row)))
  } finally {
    done()
  }
}

// TODO(tec27): Delete this function and make this value part of SbUser (I don't have time to
// thread this value through everywhere that needs it because a bunch of services try to construct
// their own SbUsers from just a name and ID :( )
export async function retrieveUserCreatedDate(userId: SbUserId): Promise<Date> {
  const user = await internalFindUserById(userId)
  return user!.created
}

export async function isUsernameAvailable(
  username: string,
  type?: 'login' | 'display',
): Promise<boolean> {
  const { client, done } = await db()
  try {
    let query: SqlTemplate
    if (type === 'login') {
      query = sql`
        SELECT 1
        FROM users
        WHERE login_name = ${username}
      `
    } else if (type === 'display') {
      query = sql`
        SELECT 1
        FROM users
        WHERE name = ${username}
      `
    } else {
      query = sql`
        SELECT 1
        FROM users
        WHERE name = ${username}
        OR login_name = ${username}
      `
    }

    const result = await client.query(query)
    return result.rows.length === 0
  } finally {
    done()
  }
}
