import httpErrors from 'http-errors'
import { getUserGameRecord, setReportedResults } from '../models/games-users'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'

const throttle = createThrottle('gamesResults', {
  rate: 10,
  burst: 30,
  window: 60000,
})

export default function (router) {
  router.post(
    '/:gameId',
    throttleMiddleware(throttle, ctx => ctx.ip),
    submitGameResults,
  )
}

// TODO(tec27): clients also need to report the assigned races for each player
async function submitGameResults(ctx, next) {
  const { gameId } = ctx.params
  const { userId, resultCode, results } = ctx.request.body

  if (userId == null) {
    throw new httpErrors.BadRequest('userId must be specified')
  } else if (!resultCode) {
    throw new httpErrors.BadRequest('resultCode must be specified')
  } else if (!results) {
    throw new httpErrors.BadRequest('results must be specified')
  } else if (!Array.isArray(results) || !results.length) {
    throw new httpErrors.BadRequest('results must be a non-empty array')
  }

  // TODO(tec27): Check that the results only contain players that are actually in the game
  for (const result of results) {
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      isNaN(result[1]) ||
      result[1] < 0 ||
      result[1] > 3
    ) {
      throw new httpErrors.BadRequest('results are incorrectly formatted')
    }
  }

  const gameRecord = await getUserGameRecord(userId, gameId)
  if (!gameRecord || gameRecord.resultCode !== resultCode) {
    // TODO(tec27): Should we be giving this info to clients? Should we be giving *more* info?
    throw new httpErrors.NotFound('no matching game found')
  }

  if (gameRecord.reportedResults) {
    throw new httpErrors.Conflict('results already reported')
  }

  await setReportedResults({ userId, gameId, reportedResults: results, reportedAt: new Date() })

  ctx.status = 204

  // TODO(tec27): check if this game now has complete results
}
