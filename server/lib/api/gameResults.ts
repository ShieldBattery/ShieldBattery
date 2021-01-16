import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { GameClientPlayerResult, GameClientResult } from '../../../common/game-results'
import transact from '../db/transaction'
import { hasCompletedResults, reconcileResults } from '../games/results'
import { getGameRecord, setReconciledResult } from '../models/games'
import {
  getCurrentReportedResults,
  getUserGameRecord,
  setReportedResults,
  setUserReconciledResult,
} from '../models/games-users'
import { findUserIdsForNames } from '../models/users'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { joiValidator } from '../validation/joi-validator'

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
}).required()

// TODO(tec27): This should be put somewhere common so the client code can use the same interface
// when making the request
interface SubmitGameResultsBody {
  /** The ID of the user submitting results. */
  userId: number
  /** The secret code the user was given to submit results with. */
  resultCode: string
  /** The elapsed time of the game, in milliseconds. */
  time: number
  /** A tuple of (player name, result). */
  playerResults: [string, GameClientPlayerResult][]
}

async function submitGameResults(ctx: RouterContext, next: Koa.Next) {
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

  // We don't need to hold up the response while we check for reconciling
  Promise.resolve()
    .then(async () => {
      // TODO(tec27): This should probably be moved to games/registration (and that file renamed)
      // since this will be used to check periodically for reconcilable games as well
      const currentResults = await getCurrentReportedResults(gameId)
      if (!hasCompletedResults(currentResults)) {
        return
      }

      const reconciled = reconcileResults(currentResults)
      await transact(async client => {
        // TODO(tec27): in some cases, we'll be re-reconciling results, and we may need to go back
        // and "fixup" rank changes and win/loss counters
        const resultEntries = Array.from(reconciled.results.entries())
        const userPromises = resultEntries.map(([userId, result]) =>
          setUserReconciledResult(client, userId, gameId, result),
        )

        // TODO(tec27): Perhaps we should auto-trigger a dispute request in particular cases, such
        // as when a user has an unknown result?

        // TODO(tec27): update ranks, win/loss records, etc.

        await Promise.all([...userPromises, setReconciledResult(client, gameId, reconciled)])
      })
    })
    .catch(err => {
      ctx.log.error(err, 'checking for reconcilable results on submission failed')
    })
}
