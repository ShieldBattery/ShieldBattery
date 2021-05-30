import Router, { RouterContext } from '@koa/router'
import Joi from 'joi'
import { GetRankingsPayload, LadderPlayer } from '../../../common/ladder'
import { ALL_MATCHMAKING_TYPES, MatchmakingType } from '../../../common/matchmaking'
import { User } from '../../../common/users/user-info'
import { getRankings as getRankingsFromDb } from '../matchmaking/models'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'

export default function (router: Router) {
  router.use(ensureLoggedIn).get('/:matchmakingType', getRankings)
}

interface GetRankingsParams {
  matchmakingType: MatchmakingType
}

const GET_RANKINGS_SCHEMA = {
  params: Joi.object<GetRankingsParams>({
    matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
  }),
}

async function getRankings(ctx: RouterContext) {
  const { params } = validateRequest(ctx, GET_RANKINGS_SCHEMA)

  const rankings = await getRankingsFromDb(params.matchmakingType)

  const players: LadderPlayer[] = []
  const users: User[] = []
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

  const result: GetRankingsPayload = {
    totalCount: rankings.length,
    players,
    users,
  }

  ctx.body = result
}
