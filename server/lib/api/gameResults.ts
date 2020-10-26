import Koa from 'koa'
import Router from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { getUserGameRecord, setReportedResults } from '../models/games-users'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { GameClientPlayerResult, GameClientResult } from '../../../common/game-results'
import { joiValidator } from '../validation/joi-validator'
import { getGameRecord } from '../models/games'
import { findUserIdsForNames } from '../models/users'

const throttle = createThrottle('gamesResults', {
  rate: 10,
  burst: 30,
  window: 60000,
})

export default function (router: Router) {
  router.post(
    '/:gameId',
    throttleMiddleware(throttle, ctx => ctx.ip),
    joiValidator({ body: submitGameResultsSchema }),
    submitGameResults,
  )
}

// TODO(tec27): we can probably pull out some of these validators into reusable pieces for other
// API calls
const submitGameResultsSchema = Joi.object({
  userId: Joi.number().min(0).required(),
  resultCode: Joi.string().required(),
  time: Joi.number().min(0).required(),
  playerResults: Joi.array()
    .items(
      Joi.array()
        .items(
          Joi.string().required(),
          Joi.object({
            result: Joi.number().min(GameClientResult.Playing).max(GameClientResult.Victory),
            race: Joi.string().valid('p', 't', 'z'),
            apm: Joi.number().min(0),
          }).required(),
        )
        .length(2),
    )
    .min(1)
    .max(8)
    .required(),
})

// TODO(tec27): This should be put somewhere common so the client code can use the same interface
// when making the request
interface SubmitGameResultsBody {
  userId: number
  resultCode: string
  time: number
  playerResults: [string, GameClientPlayerResult][]
}

async function submitGameResults(ctx: Koa.Context, next: Koa.Next) {
  const { gameId } = ctx.params
  const { userId, resultCode, time, playerResults } = ctx.request.body as SubmitGameResultsBody

  const gameUserRecord = await getUserGameRecord(userId, gameId)
  if (!gameUserRecord || gameUserRecord.resultCode !== resultCode) {
    // TODO(tec27): Should we be giving this info to clients? Should we be giving *more* info?
    throw new httpErrors.NotFound('no matching game found')
  }
  if (gameUserRecord.reportedResults) {
    throw new httpErrors.Conflict('results already reported')
  }

  const namesInResults = playerResults.map(r => r[0])
  const namesToIds = await findUserIdsForNames(namesInResults)

  const gameRecord = (await getGameRecord(gameId))!
  const playerIdsInGame = new Set(
    gameRecord.config.teams.map(team => team.filter(p => !p.isComputer).map(p => p.id)).flat(),
  )

  for (const [name, id] of namesToIds.entries()) {
    if (!playerIdsInGame.has(id)) {
      throw new httpErrors.BadRequest(`player '${name}' was not found in the game record`)
    }
  }

  const idResults: [number, GameClientPlayerResult][] = playerResults.map(([name, result]) => [
    namesToIds.get(name)!,
    result,
  ])

  await setReportedResults({
    userId,
    gameId,
    reportedResults: {
      time,
      playerResults: idResults,
    },
    reportedAt: new Date(),
  })

  ctx.status = 204

  // TODO(tec27): check if this game now has complete results
}
