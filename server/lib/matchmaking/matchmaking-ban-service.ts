import { container, singleton } from 'tsyringe'
import { ReadonlyDeep } from 'type-fest'
import { SbUserId } from '../../../common/users/sb-user-id'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { Clock } from '../time/clock'
import { ClientIdentifierString, MIN_IDENTIFIER_MATCHES } from '../users/client-ids'
import { convertStringIds } from '../users/user-identifier-manager'
import {
  addMatchmakingBan,
  checkActiveMatchmakingBan,
  checkUnclearedMatchmakingBan,
  markClearedBans,
  MatchmakingBanRow,
} from './matchmaking-ban-models'

const MINUTES = 60 * 1000
const HOURS = 60 * MINUTES
const DAYS = 24 * HOURS

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

  /** Ban a user, automatically escalating the ban level as necessary. */
  async banUser(
    userId: SbUserId,
    identifiers: ReadonlyDeep<ClientIdentifierString[]>,
  ): Promise<void> {
    const unclearedBan = await checkUnclearedMatchmakingBan({
      userId,
      now: new Date(this.clock.now()),
      minSameIdentifiers: MIN_IDENTIFIER_MATCHES,
    })

    const { banLevel, banDuration, clearDuration } = getNextBanLevel(unclearedBan)
    const convertedIds = convertStringIds(identifiers)

    await addMatchmakingBan({
      userId,
      identifiers: convertedIds,
      banLevel,
      banDurationMillis: banDuration,
      clearDurationMillis: clearDuration,
      now: new Date(this.clock.now()),
    })
    // TODO(tec27): Notify user (especially for the warning level)
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
