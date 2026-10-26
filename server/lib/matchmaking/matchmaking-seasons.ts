import { singleton } from 'tsyringe'
import {
  DIVISION_RATING_OFFSET_REFERENCE_TYPE,
  MatchmakingSeason,
  MatchmakingSeasonsServiceErrorCode,
  SeasonId,
  ServerAddMatchmakingSeasonRequest,
} from '../../../common/matchmaking'
import { CodedError } from '../errors/coded-error'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { Clock } from '../time/clock'
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

export class MatchmakingSeasonsServiceError extends CodedError<MatchmakingSeasonsServiceErrorCode> {
  // the formatter wants to put this brace on the preceding line, making the line too long *shrug*
}

/**
 * Manages matchmaking seasons, including each season's division rating offsets. Those are computed
 * once, when a season becomes the current one: the current season's on startup if it doesn't have
 * them yet, and the next season's by a job scheduled at its start. Storing them only succeeds if
 * the season has none yet, so restarts and multiple server processes can't change them.
 */
@singleton()
export class MatchmakingSeasonsService {
  private seasonsPromise: Promise<MatchmakingSeason[]> | undefined

  constructor(
    private clock: Clock,
    private jobScheduler: JobScheduler,
  ) {
    this.syncDivisionRatingOffsets().catch(err => {
      logger.error({ err }, 'Error syncing matchmaking season division rating offsets')
    })
  }

  /** Retrieves all the seasons, ordered by start date, descending. */
  async getAllSeasons(): Promise<MatchmakingSeason[]> {
    if (!this.seasonsPromise) {
      this.seasonsPromise = getMatchmakingSeasons()
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
    await this.scheduleDivisionRatingOffsets(this.clock.now())
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
    await this.scheduleDivisionRatingOffsets(this.clock.now())
  }

  /**
   * Computes the current season's division rating offsets if it doesn't have them yet, and
   * schedules computing the next season's at its start.
   */
  private async syncDivisionRatingOffsets(): Promise<void> {
    const now = this.clock.now()
    const seasons = await this.getAllSeasons()
    const current = seasons.find(s => Number(s.startDate) <= now)
    if (current && !current.divisionRatingOffsets) {
      await this.storeDivisionRatingOffsets(current.id)
    }
    await this.scheduleDivisionRatingOffsets(now)
  }

  /**
   * Schedules computing the division rating offsets of the first season that starts after `after`,
   * at its start. When that runs, the season after it is scheduled in turn.
   */
  private async scheduleDivisionRatingOffsets(after: number): Promise<void> {
    const seasons = await this.getAllSeasons()
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
      try {
        await this.storeDivisionRatingOffsets(id)
      } finally {
        await this.scheduleDivisionRatingOffsets(Number(startDate))
      }
    })
  }

  private async storeDivisionRatingOffsets(seasonId: SeasonId): Promise<void> {
    const differences = await getRatingDifferencesFromReference(
      seasonId,
      DIVISION_RATING_OFFSET_REFERENCE_TYPE,
      OFFSET_MATCHMAKING_TYPES,
      DIVISION_RATING_OFFSET_MIN_LIFETIME_GAMES,
    )
    const offsets = computeDivisionRatingOffsets(differences)
    const stored = await setMatchmakingSeasonDivisionRatingOffsets(seasonId, offsets)
    this.seasonsPromise = undefined
    if (stored) {
      logger.info(
        `Stored division rating offsets for season ${seasonId}: ${JSON.stringify(offsets)}`,
      )
    }
  }
}
