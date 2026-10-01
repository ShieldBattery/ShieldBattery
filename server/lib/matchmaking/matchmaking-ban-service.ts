import { container, singleton } from 'tsyringe'
import { ReadonlyDeep } from 'type-fest'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { sql } from '../db/sql'
import transact from '../db/transaction'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { Clock } from '../time/clock'
import { ClientIdentifierString, MIN_IDENTIFIER_MATCHES } from '../users/client-ids'
import { convertStringIds } from '../users/user-identifier-manager'
import {
  addMatchmakingBan,
  checkActiveMatchmakingBan,
  checkActiveMatchmakingBans,
  checkUnclearedMatchmakingBan,
  GAME_PENALTY_ENFORCEMENT_LEASE_MINUTES,
  markClearedBans,
  MatchmakingBanRow,
} from './matchmaking-ban-models'

const MINUTES = 60 * 1000
const HOURS = 60 * MINUTES
const DAYS = 24 * HOURS

const GAME_PENALTY_LOCK_TIMEOUT =
  "SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s'"

/** The matchmaking consequence a game-scoped penalty carried, alongside its recorded loss. */
export type GamePenalty = 'lossAndBan' | 'lossAndWarning'

export interface GamePenaltyResult {
  penalty: GamePenalty
  /** Whether this caller holds the lease to enforce the penalty against live matchmaking state. */
  needsEnforcement: boolean
}

const BAN_LEVELS: ReadonlyDeep<Array<[banDuration: number, clearDuration: number]>> = [
  // First level is a warning
  [0, 4 * HOURS],
  [15 * MINUTES, 4 * HOURS],
  [30 * MINUTES, 4 * HOURS],
  [45 * MINUTES, 8 * HOURS],
  [1 * HOURS, 8 * HOURS],
  [2 * HOURS, 8 * HOURS],
  [2 * HOURS, 1 * DAYS + 12 * HOURS],
  [3 * HOURS, 1 * DAYS + 12 * HOURS],
  [4 * HOURS, 1 * DAYS + 12 * HOURS],
  [4 * HOURS, 2 * DAYS],
  [4 * HOURS, 3 * DAYS],
]

function getNextBanLevel(unclearedBan?: MatchmakingBanRow): {
  banLevel: number
  banDuration: number
  clearDuration: number
} {
  if (!unclearedBan) {
    const [banDuration, clearDuration] = BAN_LEVELS[0]
    return {
      banLevel: 0,
      banDuration,
      clearDuration,
    }
  } else {
    let currentBanLevel = Math.min(unclearedBan.banLevel, BAN_LEVELS.length - 1)
    const [, currentBanClearDuration] = BAN_LEVELS[currentBanLevel]
    if (Number(unclearedBan.clearsAt) - Date.now() <= currentBanClearDuration / 2) {
      // If the user has served half their clear time, we keep them at the current level
      currentBanLevel -= 1
    }
    const nextBanLevel = Math.max(Math.min(currentBanLevel + 1, BAN_LEVELS.length - 1), 0)
    const [banDuration, clearDuration] = BAN_LEVELS[nextBanLevel]
    return {
      banLevel: nextBanLevel,
      banDuration,
      clearDuration,
    }
  }
}

@singleton()
export class MatchmakingBanService {
  constructor(private clock: Clock) {
    container.resolve(MatchmakingBanClearerJob) // Ensure the job is registered
  }

  /** Check if a user has a current active ban, returning the relevant ban information if so. */
  async checkUser(userId: SbUserId): Promise<MatchmakingBanRow | undefined> {
    return await checkActiveMatchmakingBan({
      userId,
      now: new Date(this.clock.now()),
      minSameIdentifiers: MIN_IDENTIFIER_MATCHES,
    })
  }

  /** Checks proposed match participants without acquiring one pool connection per player. */
  async checkUsers(userIds: ReadonlyArray<SbUserId>): Promise<Set<SbUserId>> {
    return await checkActiveMatchmakingBans(
      userIds,
      new Date(this.clock.now()),
      MIN_IDENTIFIER_MATCHES,
    )
  }

  /** Ban a user, automatically escalating the ban level as necessary. */
  async banUser(
    userId: SbUserId,
    identifiers: ReadonlyDeep<ClientIdentifierString[]>,
  ): Promise<void> {
    await this.escalateBan(userId, identifiers)
  }

  /**
   * Bans a user for something they did in a particular game, escalating at most once per game
   * however many times it's retried, and leases live-match enforcement of the ban to one caller
   * (see `GAME_PENALTY_ENFORCEMENT_LEASE_MINUTES`).
   */
  async applyGamePenalty(
    userId: SbUserId,
    identifiers: ReadonlyDeep<ClientIdentifierString[]>,
    gameId: string,
  ): Promise<GamePenaltyResult> {
    return await transact(async client => {
      await client.query(GAME_PENALTY_LOCK_TIMEOUT)
      // Serializes escalation per user, so two games' penalties can't both read the same prior ban
      await client.query(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`)

      const existing = await client.query<{ penalty: GamePenalty }>(sql`
        SELECT penalty
        FROM matchmaking_game_bans
        WHERE game_id = ${gameId} AND user_id = ${userId}
        FOR UPDATE
      `)

      let penalty: GamePenalty
      if (existing.rowCount) {
        penalty = existing.rows[0].penalty
      } else {
        penalty = await this.escalateBan(userId, identifiers, client)
        await client.query(sql`
          INSERT INTO matchmaking_game_bans (game_id, user_id, penalty)
          VALUES (${gameId}, ${userId}, ${penalty})
        `)
      }

      const claimed = await client.query(sql`
        UPDATE matchmaking_game_bans
        SET enforcement_claimed_at = NOW()
        WHERE game_id = ${gameId}
          AND user_id = ${userId}
          AND enforced_at IS NULL
          AND (
            enforcement_claimed_at IS NULL
            OR enforcement_claimed_at <
              NOW() - make_interval(mins => ${GAME_PENALTY_ENFORCEMENT_LEASE_MINUTES})
          )
        RETURNING game_id
      `)
      return { penalty, needsEnforcement: !!claimed.rowCount }
    })
  }

  /** Records that a game penalty's live-match enforcement finished, releasing its lease for good. */
  async acknowledgeGamePenaltyEnforced(gameId: string, userId: SbUserId): Promise<void> {
    await transact(async client => {
      await client.query(GAME_PENALTY_LOCK_TIMEOUT)
      await client.query(sql`
        UPDATE matchmaking_game_bans
        SET enforced_at = NOW()
        WHERE game_id = ${gameId} AND user_id = ${userId} AND enforced_at IS NULL
      `)
    })
  }

  private async escalateBan(
    userId: SbUserId,
    identifiers: ReadonlyDeep<ClientIdentifierString[]>,
    client?: DbClient,
  ): Promise<GamePenalty> {
    const unclearedBan = await checkUnclearedMatchmakingBan(
      {
        userId,
        now: new Date(this.clock.now()),
        minSameIdentifiers: MIN_IDENTIFIER_MATCHES,
      },
      client,
    )

    const { banLevel, banDuration, clearDuration } = getNextBanLevel(unclearedBan)
    const convertedIds = convertStringIds(identifiers)

    await addMatchmakingBan(
      {
        userId,
        identifiers: convertedIds,
        banLevel,
        banDurationMillis: banDuration,
        clearDurationMillis: clearDuration,
        now: new Date(this.clock.now()),
      },
      client,
    )
    // TODO(tec27): Notify user (especially for the warning level)
    return banDuration > 0 ? 'lossAndBan' : 'lossAndWarning'
  }
}

@singleton()
class MatchmakingBanClearerJob {
  constructor(private jobScheduler: JobScheduler) {
    const runEvery = 3 * 60 * 60 * 1000 /* 3 hours */
    this.jobScheduler.scheduleImmediateJob(
      'lib/matchmaking#matchmakingBanClearer',
      runEvery,
      async () => {
        const count = await markClearedBans()
        if (count) {
          logger.info(`Marked ${count} matchmaking bans as cleared`)
        }
      },
    )
  }
}
