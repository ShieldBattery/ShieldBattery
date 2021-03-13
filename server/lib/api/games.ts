import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import type { Next } from 'koa'
import { GameStatus } from '../../../common/game-status'
import gameLoader from '../games/game-loader'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'

const throttle = createThrottle('games', {
  rate: 20,
  burst: 40,
  window: 60000,
})

export default function (router: Router) {
  router.put(
    '/:gameId',
    ensureLoggedIn,
    throttleMiddleware(throttle, ctx => ctx.session!.userId),
    updateGameStatus,
  )
}

async function updateGameStatus(ctx: RouterContext, next: Next) {
  const { gameId } = ctx.params
  const { status } = ctx.request.body

  if (status < GameStatus.Playing || status > GameStatus.Error) {
    throw new httpErrors.BadRequest('invalid game status')
  }

  if (
    (status === GameStatus.Playing || status === GameStatus.Error) &&
    !gameLoader.isLoading(gameId)
  ) {
    throw new httpErrors.Conflict('game must be loading')
  }

  if (status === GameStatus.Playing) {
    if (!gameLoader.registerGameAsLoaded(gameId, ctx.session!.userName)) {
      throw new httpErrors.NotFound('game not found')
    }
  } else if (status === GameStatus.Error) {
    if (!gameLoader.maybeCancelLoading(gameId, ctx.session!.userName)) {
      throw new httpErrors.NotFound('game not found')
    }
  } else {
    throw new httpErrors.BadRequest('invalid game status')
  }

  ctx.status = 204
}
