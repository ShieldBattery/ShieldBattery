import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { GetRankingsPayload, LadderPlayer } from '../../../common/ladder'
import { ALL_MATCHMAKING_TYPES, MatchmakingType } from '../../../common/matchmaking'
import { SbUser } from '../../../common/users/user-info'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpGet } from '../http/route-decorators'
import { JobScheduler } from '../jobs/job-scheduler'
import { getRankings, refreshRankings } from '../matchmaking/models'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'

const UPDATE_RANKS_MINUTES = 5

@httpApi('/ladder')
@httpBeforeAll(ensureLoggedIn)
export class LadderApi {
  constructor(private jobScheduler: JobScheduler) {
    const startTime = new Date()
    const timeRemainder = UPDATE_RANKS_MINUTES - (startTime.getMinutes() % UPDATE_RANKS_MINUTES)
    startTime.setMinutes(startTime.getMinutes() + timeRemainder, 0, 0)
    this.jobScheduler.scheduleJob(
      'lib/ladder#updateRanks',
      startTime,
      UPDATE_RANKS_MINUTES * 60 * 1000,
      async () => {
        await refreshRankings(MatchmakingType.Match1v1)
      },
    )
  }

  @httpGet('/:matchmakingType')
  async getRankings(ctx: RouterContext): Promise<GetRankingsPayload> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ matchmakingType: MatchmakingType }>({
        matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
      }),
    })

    const rankings = await getRankings(params.matchmakingType)

    const players: LadderPlayer[] = []
    const users: SbUser[] = []
    for (const r of rankings) {
      players.push({
        rank: r.rank,
        userId: r.userId,
        rating: r.rating,
        wins: r.wins,
        losses: r.losses,
        lastPlayedDate: Number(r.lastPlayedDate),
      })
      users.push({
        id: r.userId,
        name: r.username,
      })
    }

    return {
      totalCount: rankings.length,
      players,
      users,
    }
  }
}
