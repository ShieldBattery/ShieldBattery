import { singleton } from 'tsyringe'
import {
  DIVISION_RATING_OFFSET_REFERENCE_TYPE,
  MatchmakingSeason,
  MatchmakingSeasonsEvent,
  MatchmakingSeasonsServiceErrorCode,
  SeasonId,
  ServerAddMatchmakingSeasonRequest,
  toMatchmakingSeasonJson,
} from '../../../common/matchmaking'
import { CodedError } from '../errors/coded-error'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { Clock } from '../time/clock'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  computeDivisionRatingOffsets,
  DIVISION_RATING_OFFSET_MIN_LIFETIME_GAMES,
  OFFSET_MATCHMAKING_TYPES,
} from './division-rating-offsets'
import {
  addMatchmakingSeason,
  deleteMatchmakingSeason,
  getMatchmakingSeasons,
  getRatingDifferencesFromReference,
  setMatchmakingSeasonDivisionRatingOffsets,
} from './models'

const DIVISION_RATING_OFFSETS_JOB_ID = 'lib/matchmaking#seasonDivisionRatingOffsets'
const DIVISION_RATING_OFFSETS_RETRY_JOB_ID = 'lib/matchmaking#seasonDivisionRatingOffsetsRetry'
const DIVISION_RATING_OFFSETS_SYNC_RETRY_JOB_ID =
  'lib/matchmaking#seasonDivisionRatingOffsetsSyncRetry'
/** How long to wait before the first retry of a failed offsets computation. */
const DIVISION_RATING_OFFSETS_RETRY_INITIAL_DELAY_MS = 60 * 1000
/** The longest wait between retries of a failed offsets computation, which doubles each time. */
const DIVISION_RATING_OFFSETS_RETRY_MAX_DELAY_MS = 30 * 60 * 1000

/** The path every connected client is subscribed to for updates to seasons. */
export const MATCHMAKING_SEASONS_PATH = '/matchmaking-seasons'

function nextRetryDelay(delayMs: number): number {
  return Math.min(delayMs * 2, DIVISION_RATING_OFFSETS_RETRY_MAX_DELAY_MS)
}

export class MatchmakingSeasonsServiceError extends CodedError<MatchmakingSeasonsServiceErrorCode> {
  // the formatter wants to put this brace on the preceding line, making the line too long *shrug*
}

/**
 * Manages matchmaking seasons, including each season's division rating offsets. Those are computed
 * once, when a season becomes the current one: the current season's on startup if it doesn't have
 * them yet, and the next season's by a job scheduled at its start. A failed computation is retried
 * with backoff until it succeeds or a later season starts. Storing them only succeeds if the season
 * has none yet, so restarts and multiple server processes can't change them.
 *
 * Every connected client is subscribed to `MATCHMAKING_SEASONS_PATH`, which sends the current
 * season on connect and a season again once its offsets are stored, so clients that loaded a season
 * before its offsets existed pick them up.
 */
@singleton()
export class MatchmakingSeasonsService {
  private seasonsPromise: Promise<MatchmakingSeason[]> | undefined

  constructor(
    private clock: Clock,
    private jobScheduler: JobScheduler,
    private publisher: TypedPublisher<MatchmakingSeasonsEvent>,
    clientSocketsManager: ClientSocketsManager,
  ) {
    clientSocketsManager.on('newClient', c => {
      c.subscribe<MatchmakingSeasonsEvent | undefined>(MATCHMAKING_SEASONS_PATH, async () => {
        try {
          const season = await this.getCurrentSeason()
          return season
            ? { type: 'seasonUpdate', season: toMatchmakingSeasonJson(season) }
            : undefined
        } catch (err) {
          logger.error({ err }, 'Error retrieving the current season for a new client')
          return undefined
        }
      })
    })

    this.syncDivisionRatingOffsets().catch(err => {
      logger.error({ err }, 'Error syncing matchmaking season division rating offsets')
    })
  }

  /** Retrieves all the seasons, ordered by start date, descending. */
  async getAllSeasons(): Promise<MatchmakingSeason[]> {
    if (!this.seasonsPromise) {
      const promise = getMatchmakingSeasons()
      this.seasonsPromise = promise
      // A failed load isn't cached, so the next call tries again
      promise.catch(() => {
        if (this.seasonsPromise === promise) {
          this.seasonsPromise = undefined
        }
      })
    }
    return this.seasonsPromise
  }

  async getCurrentSeason(): Promise<MatchmakingSeason> {
    const now = this.clock.now()
    return (await this.getSeasonForDate(new Date(now)))[0]
  }

  /**
   * Returns the applicable `MatchmakingSeason` and end date for the given `Date`. If the date is
   * before all available seasons, the first season is returned. If it is the last season, the end
   * date will be `undefined`.
   */
  async getSeasonForDate(
    date: Date,
  ): Promise<[season: MatchmakingSeason, endDate: Date | undefined]> {
    const seasons = await this.getAllSeasons()
    const dateNum = Number(date)
    for (let i = 0; i < seasons.length; i++) {
      const s = seasons[i]
      if (Number(s.startDate) <= dateNum) {
        const nextSeasonStart = i > 0 ? seasons[i - 1].startDate : undefined
        return [s, nextSeasonStart]
      }
    }

    return [seasons[0], undefined]
  }

  async addSeason(season: ServerAddMatchmakingSeasonRequest): Promise<MatchmakingSeason> {
    if (Number(season.startDate) < this.clock.now()) {
      throw new MatchmakingSeasonsServiceError(
        MatchmakingSeasonsServiceErrorCode.MustBeInFuture,
        'New seasons must start in the future',
      )
    }

    const result = await addMatchmakingSeason(season)
    this.seasonsPromise = undefined
    this.scheduleDivisionRatingOffsets(await this.getAllSeasons(), this.clock.now())
    return result
  }

  async deleteSeason(id: SeasonId): Promise<void> {
    const seasons = await this.getAllSeasons()
    const season = seasons.find(s => s.id === id)
    if (!season) {
      throw new MatchmakingSeasonsServiceError(
        MatchmakingSeasonsServiceErrorCode.NotFound,
        'No matching season found',
      )
    } else if (Number(season.startDate) <= this.clock.now()) {
      throw new MatchmakingSeasonsServiceError(
        MatchmakingSeasonsServiceErrorCode.MustBeInFuture,
        'Only future seasons can be deleted',
      )
    }

    await deleteMatchmakingSeason(id)
    this.seasonsPromise = undefined
    this.scheduleDivisionRatingOffsets(await this.getAllSeasons(), this.clock.now())
  }

  /**
   * Computes the current season's division rating offsets if it doesn't have them yet, and
   * schedules computing the next season's at its start. If the seasons can't be loaded, the whole
   * sync is retried with backoff.
   */
  private async syncDivisionRatingOffsets(
    retryDelayMs = DIVISION_RATING_OFFSETS_RETRY_INITIAL_DELAY_MS,
  ): Promise<void> {
    const now = this.clock.now()
    let seasons: MatchmakingSeason[]
    try {
      seasons = await this.getAllSeasons()
    } catch (err) {
      logger.error(
        { err },
        `Error loading seasons to sync division rating offsets, retrying in ${retryDelayMs}ms`,
      )
      this.scheduleRetry(DIVISION_RATING_OFFSETS_SYNC_RETRY_JOB_ID, retryDelayMs, () =>
        this.syncDivisionRatingOffsets(nextRetryDelay(retryDelayMs)),
      )
      return
    }

    this.scheduleDivisionRatingOffsets(seasons, now)
    const current = seasons.find(s => Number(s.startDate) <= now)
    if (current && !current.divisionRatingOffsets) {
      await this.ensureDivisionRatingOffsets(current.id)
    }
  }

  /**
   * Schedules computing the division rating offsets of the first of `seasons` that starts after
   * `after`, at its start. When that runs, the season after it is scheduled in turn from the same
   * list, which stays accurate because adding or deleting a season reschedules from a fresh one.
   */
  private scheduleDivisionRatingOffsets(
    seasons: ReadonlyArray<MatchmakingSeason>,
    after: number,
  ): void {
    // Seasons are ordered by start date descending, so the last one found starts soonest
    let next: MatchmakingSeason | undefined
    for (const season of seasons) {
      if (Number(season.startDate) > after) {
        next = season
      }
    }

    if (!next) {
      this.jobScheduler.unscheduleJob(DIVISION_RATING_OFFSETS_JOB_ID)
      return
    }

    const { id, startDate } = next
    this.jobScheduler.scheduleJob(DIVISION_RATING_OFFSETS_JOB_ID, startDate, -1, async () => {
      this.scheduleDivisionRatingOffsets(seasons, Number(startDate))
      await this.ensureDivisionRatingOffsets(id)
    })
  }

  /**
   * Stores the division rating offsets of the season with `seasonId`, unless it already has them,
   * no longer exists, or a later season has started (its offsets would then come from another
   * season's games). A failure is retried with backoff, rechecking those conditions before each
   * attempt. Never throws.
   */
  private async ensureDivisionRatingOffsets(
    seasonId: SeasonId,
    retryDelayMs = DIVISION_RATING_OFFSETS_RETRY_INITIAL_DELAY_MS,
  ): Promise<void> {
    try {
      this.seasonsPromise = undefined
      const seasons = await this.getAllSeasons()
      const season = seasons.find(s => s.id === seasonId)
      if (!season || season.divisionRatingOffsets) {
        return
      }
      const now = this.clock.now()
      const superseded = seasons.some(
        s => Number(s.startDate) > Number(season.startDate) && Number(s.startDate) <= now,
      )
      if (superseded) {
        return
      }

      await this.storeDivisionRatingOffsets(season)
    } catch (err) {
      logger.error(
        { err },
        `Error storing division rating offsets for season ${seasonId}, ` +
          `retrying in ${retryDelayMs}ms`,
      )
      this.scheduleRetry(DIVISION_RATING_OFFSETS_RETRY_JOB_ID, retryDelayMs, () =>
        this.ensureDivisionRatingOffsets(seasonId, nextRetryDelay(retryDelayMs)),
      )
    }
  }

  private scheduleRetry(jobId: string, delayMs: number, retryFn: () => Promise<void>) {
    this.jobScheduler.scheduleJob(jobId, new Date(this.clock.now() + delayMs), -1, retryFn)
  }

  private async storeDivisionRatingOffsets(season: MatchmakingSeason): Promise<void> {
    const differences = await getRatingDifferencesFromReference(
      season.id,
      DIVISION_RATING_OFFSET_REFERENCE_TYPE,
      OFFSET_MATCHMAKING_TYPES,
      DIVISION_RATING_OFFSET_MIN_LIFETIME_GAMES,
    )
    const divisionRatingOffsets = computeDivisionRatingOffsets(differences)
    const stored = await setMatchmakingSeasonDivisionRatingOffsets(season.id, divisionRatingOffsets)
    this.seasonsPromise = undefined
    if (stored) {
      logger.info(
        `Stored division rating offsets for season ${season.id}: ` +
          JSON.stringify(divisionRatingOffsets),
      )
      this.publisher.publish(MATCHMAKING_SEASONS_PATH, {
        type: 'seasonUpdate',
        season: toMatchmakingSeasonJson({ ...season, divisionRatingOffsets }),
      })
    }
  }
}
