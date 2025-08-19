import { DbClient } from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

export class InvalidSignupCodeError extends Error {
  constructor(message: string = 'Invalid signup code') {
    super(message)
    this.name = 'InvalidSignupCodeError'
  }
}

export interface SignupCodeInfo {
  id: string
  code: string
  expiresAt: Date
  maxUses: number | null
  uses: number
  exhausted: boolean
}

type DbSignupCodeInfo = Dbify<SignupCodeInfo>

function toSignupCodeInfo(dbRow: DbSignupCodeInfo): SignupCodeInfo {
  return {
    id: dbRow.id,
    code: dbRow.code,
    expiresAt: dbRow.expires_at,
    maxUses: dbRow.max_uses,
    uses: dbRow.uses,
    exhausted: dbRow.exhausted,
  }
}

/**
 * Validates and locks a signup code, returning the code ID if valid.
 * Should be called within the transaction that increments the usage count.
 *
 * @throws `InvalidSignupCodeError` if the code is invalid
 */
export async function validateAndLockSignupCode(code: string, client: DbClient): Promise<string> {
  const result = await client.query<DbSignupCodeInfo>(
    sql`
      SELECT id, code, expires_at, max_uses, uses, exhausted
      FROM user_signup_codes
      WHERE code = ${code}
        AND NOT exhausted
      LIMIT 1
      FOR UPDATE
    `,
  )

  if (result.rows.length === 0) {
    throw new InvalidSignupCodeError('Signup code does not exist')
  }

  const signupCode = toSignupCodeInfo(result.rows[0])

  if (signupCode.expiresAt < new Date()) {
    throw new InvalidSignupCodeError('Signup code has expired')
  }

  if (signupCode.maxUses && signupCode.uses >= signupCode.maxUses) {
    throw new InvalidSignupCodeError('Signup code has reached its usage limit')
  }

  return signupCode.id
}

/**
 * Increments the usage count for a signup code.
 */
export async function incrementSignupCodeUsage(codeId: string, client: DbClient): Promise<void> {
  await client.query(sql`UPDATE user_signup_codes SET uses = uses + 1 WHERE id = ${codeId}`)
}
