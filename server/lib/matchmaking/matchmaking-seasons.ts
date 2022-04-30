import { singleton } from 'tsyringe'
import {
  MatchmakingSeason,
  MatchmakingSeasonsServiceErrorCode,
  SeasonId,
} from '../../../common/matchmaking'
import { CodedError } from '../errors/coded-error'
import { Clock } from '../time/clock'
import { addMatchmakingSeason, deleteMatchmakingSeason, getMatchmakingSeasons } from './models'

export class MatchmakingSeasonsServiceError extends CodedError<MatchmakingSeasonsServiceErrorCode> {
  // prettier wants to put this brace on the preceding line which makes the line too long, *shrug*
}

@singleton()
export class MatchmakingSeasonsService {
  private seasonsPromise: Promise<MatchmakingSeason[]> | undefined

  constructor(private clock: Clock) {}

  /** Retrieves all the seasons, ordered by start date, descending. */
  async getAllSeasons(): Promise<MatchmakingSeason[]> {
    if (!this.seasonsPromise) {
      this.seasonsPromise = getMatchmakingSeasons()
    }
    return this.seasonsPromise
  }

  async getCurrentSeason(): Promise<MatchmakingSeason> {
    const now = this.clock.now()
    return this.getSeasonForDate(new Date(now))
  }

  /**
   * Returns the applicable `MatchmakingSeason` for the given `Date`. If the date is before all
   * available seasons, the first season is returned.
   */
  async getSeasonForDate(date: Date): Promise<MatchmakingSeason> {
    const seasons = await this.getAllSeasons()
    const dateNum = Number(date)
    for (const s of seasons) {
      if (Number(s.startDate) <= dateNum) {
        return s
      }
    }

    return seasons[0]
  }

  async addSeason(season: Omit<MatchmakingSeason, 'id'>): Promise<MatchmakingSeason> {
    if (Number(season.startDate) < this.clock.now()) {
      throw new MatchmakingSeasonsServiceError(
        MatchmakingSeasonsServiceErrorCode.MustBeInFuture,
        'New seasons must start in the future',
      )
    }

    const result = await addMatchmakingSeason(season)
    this.seasonsPromise = undefined
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
  }
}
