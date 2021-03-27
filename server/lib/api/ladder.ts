import Router, { RouterContext } from '@koa/router'
import Joi from 'joi'
import { GetRankingsPayload } from '../../../common/ladder'
import { ALL_MATCHMAKING_TYPES, MatchmakingType } from '../../../common/matchmaking'
import { getRankings as getRankingsFromDb } from '../matchmaking/models'
import ensureLoggedIn from '../session/ensure-logged-in'
import { JoiValidationDescriptor, validateRequest } from '../validation/joi-validator'

export default function (router: Router) {
  router.use(ensureLoggedIn).get('/:matchmakingType', getRankings)
}

interface GetRankingsParams {
  matchmakingType: MatchmakingType
}

const GET_RANKINGS_SCHEMA: JoiValidationDescriptor<GetRankingsParams> = {
  params: Joi.object({
    matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
  }),
}

async function getRankings(ctx: RouterContext) {
  const { params } = validateRequest(ctx, GET_RANKINGS_SCHEMA)

  const rankings = await getRankingsFromDb(params.matchmakingType)
  const result: GetRankingsPayload = {
    totalCount: rankings.length,
    players: rankings.map(r => ({
      rank: r.rank,
      user: {
        id: r.userId,
        name: r.username,
      },
      rating: r.rating,
      wins: r.wins,
      losses: r.losses,
      lastPlayedDate: Number(r.lastPlayedDate),
    })),
  }

  ctx.body = result
}
