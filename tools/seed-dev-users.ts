import dotenv from 'dotenv'
import dotenvExpand from 'dotenv-expand'
import got from 'got'
import pg from 'pg'

// Load the same env the servers use, so DATABASE_URL / SB_CANONICAL_HOST resolve identically.
dotenvExpand.expand(dotenv.config({ quiet: true }))

/**
 * Seeds the local development database with known test accounts, so that verification flows
 * (login, chat, lobbies, parties, matchmaking between multiple users) have stable credentials.
 *
 * Usage:
 *   pnpm run seed-dev
 *
 * Idempotent: accounts that already exist are left alone (only their permissions / verified
 * status are re-applied). Safe to run repeatedly.
 *
 * Requirements:
 *   - Dev Postgres running (see DATABASE_URL in .env)
 *   - Node web server running (pnpm run start-server) for the signup endpoint
 *   - Rust server (server-rs) running, since signup checks the username against it
 *
 * The accounts are deliberately named so they're obviously test data. `claude-admin` gets every
 * permission; the rest are plain players. All share the same password and are marked email-verified
 * so the verification dialog never blocks automated flows.
 */

const BASE_URL = (process.env.SB_CANONICAL_HOST ?? 'http://localhost:5555').replace(/\/$/, '')
const DATABASE_URL = process.env.DATABASE_URL

/** Shared password for every seeded account. */
export const SEED_PASSWORD = 'shieldbattery'

interface SeedAccount {
  username: string
  email: string
  admin: boolean
}

/**
 * The accounts to create. `claude-1`..`claude-3` line up with the SB_SESSION=session1..3 instances
 * documented in the dev-env / verify-app skills (one account per running app instance). Add more
 * here if a flow needs them; with more than 4 accounts you'll want to start the Node server with
 * SB_DISABLE_THROTTLING=1 so the account-creation throttle doesn't reject the burst.
 */
const ACCOUNTS: SeedAccount[] = [
  { username: 'claude-admin', email: 'claude-admin@example.org', admin: true },
  { username: 'claude-1', email: 'claude-1@example.org', admin: false },
  { username: 'claude-2', email: 'claude-2@example.org', admin: false },
  { username: 'claude-3', email: 'claude-3@example.org', admin: false },
]

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function signup(account: SeedAccount): Promise<void> {
  // Retry on throttle (429) since the account-creation throttle has a small burst window.
  for (let attempt = 0; ; attempt++) {
    const res = await got.post(`${BASE_URL}/api/1/users`, {
      // Origin marks the request as coming from the Electron client; signup is gated to it.
      headers: { Origin: 'shieldbattery://app' },
      json: {
        username: account.username,
        email: account.email,
        password: SEED_PASSWORD,
        clientIds: [[0, `claude-seed-${account.username}`]],
      },
      throwHttpErrors: false,
    })

    if (res.statusCode >= 200 && res.statusCode < 300) {
      return
    }

    if (res.statusCode === 429 && attempt < 2) {
      console.log(`  throttled creating ${account.username}, waiting 60s before retrying...`)
      await delay(60_000)
      continue
    }

    throw new Error(
      `Failed to create ${account.username}: ${res.statusCode} ${res.statusMessage}\n${res.body}`,
    )
  }
}

async function main(): Promise<void> {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL must be set (it normally comes from .env)')
  }

  const pool = new pg.Pool({ connectionString: DATABASE_URL })
  try {
    // Sanity check that the DB is reachable before we start hitting the HTTP API.
    await pool.query('SELECT 1')

    for (const account of ACCOUNTS) {
      const existing = await pool.query<{ id: number }>('SELECT id FROM users WHERE name = $1', [
        account.username,
      ])
      if (existing.rowCount) {
        console.log(`✓ ${account.username} already exists (id ${existing.rows[0].id})`)
        continue
      }

      console.log(`+ creating ${account.username}...`)
      await signup(account)
    }

    const usernames = ACCOUNTS.map(a => a.username)

    // Mark every seeded account email-verified so the verification dialog never blocks flows.
    await pool.query('UPDATE users SET email_verified = true WHERE name = ANY($1)', [usernames])

    // Grant admins every permission. Rather than hardcode the column list (which grows over time),
    // flip every boolean column on the permissions table except the user_id key.
    const adminNames = ACCOUNTS.filter(a => a.admin).map(a => a.username)
    if (adminNames.length) {
      const permCols = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'permissions' AND data_type = 'boolean'`,
      )
      const setClause = permCols.rows.map(r => `"${r.column_name}" = true`).join(', ')
      await pool.query(
        `UPDATE permissions SET ${setClause}
         WHERE user_id IN (SELECT id FROM users WHERE name = ANY($1))`,
        [adminNames],
      )
      console.log(`✓ granted all permissions to: ${adminNames.join(', ')}`)
    }

    console.log('')
    console.log('Seeded accounts (password for all):', SEED_PASSWORD)
    for (const account of ACCOUNTS) {
      console.log(`  ${account.username}${account.admin ? '  (admin)' : ''}`)
    }
  } finally {
    await pool.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
